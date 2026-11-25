/**
 * Terminal sessions hosted in herdr that are blocked on a prompt.
 *
 * herdr reports each pane's agent status itself (`blocked` = the agent stopped
 * for input or a permission prompt), so this does not guess from timing. The
 * pane's visible text is read to say what it is asking. A Claude permission
 * dialog Scout can parse carries a `version` (a fingerprint of the dialog), and
 * the operator can answer it from another device through
 * `answerHerdrPermission`, which presses Yes or No only while that same dialog
 * is still up. Anything else is answered at the terminal.
 */

import type { DiscoverySnapshot } from "@openscout/runtime/tail";
import type { HerdrPaneProjection } from "@openscout/protocol";
import { answerablePermissionDialog, permissionDialogVersion } from "./pane-dialog.ts";
import { readHerdrSessions, readHerdrTopology } from "@openscout/runtime/system-probes";

import { herdrTerminalHost } from "../../terminal-hosts/herdr.ts";
import { detectClaudeTmuxHostAttention } from "./tmux-host-attention.ts";

// Shared with tmux panes; kept exported here for the herdr answer path.
export { answerablePermissionDialog, permissionDialogVersion };

export type HerdrHostAttentionItem = {
  id: string;
  /** The harness's own session id when herdr knows it, else the pane id. */
  sessionId: string;
  sessionName: string;
  harness: string;
  title: string;
  summary: string;
  detail: string | null;
  /** Where the prompt is: `<herdr session> · <pane>`. */
  location: string;
  herdrSession: string;
  paneId: string;
  /**
   * Fingerprint of a parsed permission dialog. Present only when the operator
   * can answer it remotely; an answer must name it, so a tap on one prompt can
   * never press a key on the next prompt in the same pane.
   */
  version: number | null;
  updatedAt: number;
};

const ANSI = /\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)/gu;
const PROMPT_TAIL_LINES = 8;
const MAX_PANES = 16;

export type HerdrBlockedPane = { session: string; pane: HerdrPaneProjection };

export async function collectHerdrHostAttention(
  options: { now?: number } = {},
): Promise<HerdrHostAttentionItem[]> {
  const now = options.now ?? Date.now();
  const blocked = await readBlockedHerdrPanes();
  const items = await Promise.all(blocked.slice(0, MAX_PANES).map(async ({ session, pane }) => {
    const text = await captureHerdrPane(session, pane);
    return herdrAttentionItem(session, pane, text, now);
  }));
  return items;
}

/** Every pane herdr reports `blocked`, across running herdr sessions. */
export async function readBlockedHerdrPanes(options: { uniqueSessions?: boolean; fresh?: boolean } = {}): Promise<HerdrBlockedPane[]> {
  const sessions = await readHerdrSessions(options.fresh ? { maxAgeMs: 0 } : undefined).catch(() => []);
  const blocked: Array<{ session: string; pane: HerdrPaneProjection }> = [];
  const references = new Map<string, number>();
  for (const session of sessions) {
    if (!session.running) continue;
    const topology = await readHerdrTopology(session.name, options.fresh ? { maxAgeMs: 0 } : undefined).catch(() => null);
    if (!topology?.running) continue;
    for (const workspace of topology.workspaces) {
      for (const tab of workspace.tabs) {
        for (const pane of tab.panes) {
          const ref = pane.agentSession;
          if (ref?.value) {
            const key = JSON.stringify([ref.agent, ref.value]);
            references.set(key, (references.get(key) ?? 0) + 1);
          }
          if (pane.agentStatus === "blocked") blocked.push({ session: session.name, pane });
        }
      }
    }
  }
  return options.uniqueSessions ? blocked.filter(({ pane }) => {
    const ref = pane.agentSession;
    return ref && references.get(JSON.stringify([ref.agent, ref.value])) === 1;
  }) : blocked;
}

/**
 * Same native-id -> exact session/pane association as session-steering, not a
 * steering authorization. Never match cwd, labels, or the pane-id fallback.
 * No native timestamp is reported, so since stays unknown rather than moving
 * forward on every poll.
 */
export function joinHerdrTailAttention(
  snapshot: DiscoverySnapshot,
  blocked: HerdrBlockedPane[],
): DiscoverySnapshot {
  const bySession = new Map<string, HerdrBlockedPane[]>();
  for (const item of blocked) {
    const ref = item.pane.agentSession;
    if (!ref?.value) continue;
    const key = JSON.stringify([ref.agent, ref.value]);
    bySession.set(key, [...(bySession.get(key) ?? []), item]);
  }
  return {
    ...snapshot,
    transcripts: snapshot.transcripts.map((transcript) => {
      const matches = bySession.get(JSON.stringify([transcript.source, transcript.sessionId]));
      if (matches?.length !== 1) return transcript;
      const match = matches[0]!;
      return { ...transcript, attention: {
        kind: "ask", source: "herdr", since: null,
        reason: `Terminal is waiting for input (herdr:${match.session}/${match.pane.paneId}).`,
      } };
    }),
  };
}

export async function captureHerdrPane(session: string, pane: HerdrPaneProjection): Promise<string | null> {
  return await herdrTerminalHost.capture?.({ sessionName: session, paneId: pane.paneId })
    .catch(() => null) ?? null;
}

/** The id an item for this pane carries, minus its `herdr-permission:` / `herdr-blocked:` prefix. */
export function herdrPaneItemKey(session: string, pane: HerdrPaneProjection): string {
  const sessionId = pane.agentSession?.value ?? `${session}:${pane.paneId}`;
  return `${session}:${pane.paneId}:${sessionId}`;
}

export function herdrAttentionItem(
  session: string,
  pane: HerdrPaneProjection,
  paneText: string | null,
  now: number,
): HerdrHostAttentionItem {
  const harness = pane.agent ?? pane.agentSession?.agent ?? "terminal";
  const sessionId = pane.agentSession?.value ?? `${session}:${pane.paneId}`;
  const sessionName = pane.name ?? pane.label ?? pane.paneId;
  const location = `${session} · ${pane.paneId}`;
  const key = herdrPaneItemKey(session, pane);
  const base = { sessionId, sessionName, harness, location, herdrSession: session, paneId: pane.paneId, updatedAt: now };

  const isAntigravity = harness === "antigravity" || harness === "agy";
  const claudeText = harness === "claude" ? paneText : null;
  const claude = claudeText
    ? detectClaudeTmuxHostAttention(claudeText, { agentId: sessionId, agentName: sessionName, sessionId, now })
    : null;
  const dialog = harness === "claude" || isAntigravity ? answerablePermissionDialog(paneText) : null;
  if (claude || dialog) {
    const product = isAntigravity ? "Antigravity" : "Claude";
    return {
      ...base,
      id: `herdr-permission:${key}`,
      title: claude?.title ?? `${product} needs permission`,
      summary: claude?.summary ?? dialog?.title ?? "A command requires approval.",
      detail: claude?.detail ?? dialog?.command ?? null,
      version: dialog ? permissionDialogVersion(dialog) : null,
    };
  }

  return {
    ...base,
    id: `herdr-blocked:${key}`,
    version: null,
    title: `${capitalize(harness)} is waiting for input`,
    summary: promptTail(paneText) ?? "The terminal is waiting for input.",
    detail: null,
  };
}

/** The last few non-empty lines — where a terminal prompt puts its question. */
function promptTail(text: string | null): string | null {
  if (!text) return null;
  const lines = text.replace(ANSI, "").replaceAll("\r", "").split("\n")
    .map((line) => line.replace(/[│┃╭╮╰╯─━]+/gu, " ").trimEnd())
    .filter((line) => line.trim().length > 0);
  const tail = lines.slice(-PROMPT_TAIL_LINES).map((line) => line.trim()).join("\n");
  return tail || null;
}

function capitalize(value: string): string {
  return value ? value[0]!.toUpperCase() + value.slice(1) : value;
}
