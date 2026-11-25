import type { HerdrSessionTopology } from "@openscout/protocol";

import type { TerminalPlace, TerminalRexPlace, TerminalSource } from "../../../shared/api/terminal-sources.ts";
import { firstSourceName, harnessSessionRef, isMachineName } from "../../../shared/terminal-source-names.ts";
import { isAgentInTurn } from "../../lib/agent-state.ts";
import type { TerminalListItem } from "../../lib/terminal-sessions.ts";
import type { Agent } from "../../lib/types.ts";
import { isStoppedHostItem } from "./terminal-nav-model.ts";

/**
 * What one rail row says. The row stops describing how a terminal is hosted
 * (session name, full path, backend badge) and says what is there: who is
 * working in it, what they last did, and where. Pure, so the wording rules are
 * testable without a React runtime.
 */
export type TerminalNavRowMark =
  | { kind: "herdr" }
  | { kind: "harness"; harness: string }
  | { kind: "shell" };

export type TerminalNavPaneGroup = {
  harness: string;
  count: number;
  working: number;
};

export type TerminalNavHerdrSummary = {
  panes: TerminalNavPaneGroup[];
  paneCount: number;
  working: number;
  /** Leaf of the directory most panes are in, when any report one. */
  project: string | null;
  /** The git branch most panes in that directory are on, when the host reads one. */
  branch?: string | null;
  /**
   * The apps the session's clients run in, as its own host counted them.
   * Absent when the host did not count (a persisted projection, an older
   * core); the row then asks this host's process table instead.
   */
  apps?: string[];
  /**
   * Where each pane's harness session sits, by its session ref
   * (`session:claude:<uuid>`): the tab's own name, or "Tab N". An agent whose
   * session runs in a pane is found here, not by its terminal surface.
   */
  tabsByRef: Record<string, string>;
};

export type TerminalNavRowModel = {
  mark: TerminalNavRowMark;
  title: string;
  /** Short name that still matches `tmux ls` / `herdr session list`. */
  handle: string;
  /** The app the session's client runs in ("Rex"), when one is attached. */
  host: string | null;
  working: boolean;
  panes: TerminalNavHerdrSummary | null;
  /** The Rex block it is open in, when its client runs in Rex. */
  rex: TerminalRexPlace | null;
};

/** What the index knows about a row beyond its record: its harness's own name, and its app. */
export type TerminalNavRowContext = {
  source?: TerminalSource | null;
  place?: TerminalPlace | null;
};

/**
 * Harnesses the rail has a mark for, by the names hosts report them under
 * (herdr says "claude", a registry record may say "claude-code"). Anything
 * else — "tmux", "zsh", a backend name standing in for a harness — is a plain
 * terminal. Kept local rather than importing HarnessMark's normalizer so this
 * module stays free of JSX for bun tests.
 */
const MARKED_HARNESS_ALIASES: Record<string, string> = {
  claude: "claude",
  anthropic: "claude",
  codex: "codex",
  openai: "codex",
  grok: "grok",
  xai: "grok",
  opencode: "opencode",
  oc: "opencode",
  antigravity: "antigravity",
  agy: "antigravity",
  pi: "pi",
  omp: "pi",
  gemini: "gemini",
  kimi: "kimi",
  cursor: "cursor",
  amp: "amp",
};

export function markedHarness(harness: string | null | undefined): string | null {
  const raw = harness?.trim().toLowerCase();
  if (!raw) return null;
  const base = raw.replace(/[\s(].*$/u, "").replace(/[_-].*$/u, "");
  return MARKED_HARNESS_ALIASES[base] ?? null;
}

/**
 * Generated session names carry one readable part: `session-mulg1xl0-bvteeb`
 * is known by `mulg1xl0`, `relay-call-clean-232702-dev-host-claude` by
 * `call-clean-232702`. Operator-chosen names are already short.
 */
export function terminalNavHandle(sessionName: string): string {
  const generated = /^session-([a-z0-9]{6,})-[a-z0-9]+$/iu.exec(sessionName);
  if (generated?.[1]) return generated[1];
  const relay = /^relay-(.+?)(?:-[a-z0-9]+-mini)?-(?:claude|codex|grok|opencode|antigravity)$/iu.exec(sessionName);
  if (relay?.[1]) return relay[1];
  return sessionName;
}

function metadataText(item: TerminalListItem, key: string): string | null {
  const value = item.session.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstSentence(text: string): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  const end = trimmed.search(/[.!?](?:\s|$)/u);
  return end > 0 ? trimmed.slice(0, end + 1) : trimmed;
}

/**
 * An agent named after its session ("Session Mulg1xl0 Bvteeb") or its relay
 * ("Flat Claude Fb29e11e …") says nothing new.
 */
function chosenName(name: string, sessionName: string): string | null {
  const flatten = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  return flatten(name) === flatten(sessionName) || isMachineName(name) ? null : name;
}

/** The agent's latest broker activity, as one line. */
function latestActivitySummary(agent: Agent): string | null {
  const latest = [...(agent.brokerActivity ?? [])]
    .filter((entry) => entry.summary?.trim())
    .sort((left, right) => right.at - left.at)[0];
  return latest ? firstSentence(latest.summary) : null;
}

/**
 * One herdr session's panes, grouped by harness in order of first appearance.
 * Plain shells are counted in the pane total but get no harness chip.
 */
export function summarizeHerdrTopology(topology: HerdrSessionTopology | null | undefined): TerminalNavHerdrSummary | null {
  if (!topology?.running) return null;
  const groups = new Map<string, TerminalNavPaneGroup>();
  const directories = new Map<string, number>();
  const branches = new Map<string, Map<string, number>>();
  const tabsByRef: Record<string, string> = {};
  let paneCount = 0;
  let working = 0;
  for (const workspace of topology.workspaces) {
    for (const tab of workspace.tabs) {
      const tabName = tab.label && tab.label !== String(tab.number ?? "") ? tab.label : `Tab ${tab.number ?? ""}`.trim();
      for (const pane of tab.panes) {
        paneCount += 1;
        const ref = herdrPaneSourceRef(pane);
        if (ref) tabsByRef[ref] = tabName;
        const isWorking = pane.agentStatus === "working";
        if (isWorking) working += 1;
        const directory = pane.foregroundCwd ?? pane.cwd;
        if (directory) {
          directories.set(directory, (directories.get(directory) ?? 0) + 1);
          // Older cores do not read branches; the field is then absent.
          const branch = (pane as { gitBranch?: unknown }).gitBranch;
          if (typeof branch === "string" && branch) {
            const counts = branches.get(directory) ?? new Map<string, number>();
            counts.set(branch, (counts.get(branch) ?? 0) + 1);
            branches.set(directory, counts);
          }
        }
        const harness = markedHarness(pane.agent);
        if (!harness) continue;
        const group = groups.get(harness) ?? { harness, count: 0, working: 0 };
        group.count += 1;
        if (isWorking) group.working += 1;
        groups.set(harness, group);
      }
    }
  }
  const topDirectory = [...directories.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  const project = topDirectory?.replace(/\/+$/u, "").split("/").pop() || null;
  const branch = topDirectory
    ? [...(branches.get(topDirectory)?.entries() ?? [])].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
    : null;
  return {
    panes: [...groups.values()],
    paneCount,
    working,
    project,
    tabsByRef,
    ...(branch ? { branch } : {}),
    ...countedApps(topology),
  };
}

/**
 * The apps a topology says its clients run in. A topology that carries a
 * client count was counted on its own host, so its app list is the answer
 * even when empty (a client over ssh runs in no app).
 */
function countedApps(topology: HerdrSessionTopology): { apps?: string[] } {
  const { clients, apps } = topology as { clients?: unknown; apps?: unknown };
  if (typeof clients !== "number") return {};
  const names = Array.isArray(apps)
    ? apps.filter((app): app is string => typeof app === "string" && app.trim() !== "")
    : [];
  return { apps: names };
}

const SCOUT_SESSION_ID = /^session-[a-z0-9]{6,}-[a-z0-9]+$/iu;

/** The session ref of the harness running in a herdr pane, when herdr knows its id. */
export function herdrPaneSourceRef(pane: {
  agentSession?: { agent?: string | null; kind?: string | null; value?: string | null } | null;
}): string | null {
  const session = pane.agentSession;
  return session?.kind === "id" ? harnessSessionRef(session.agent, session.value) : null;
}

/**
 * The ref a terminal row asks for its harness's own name by: its record's
 * source session, when that is a Scout session id or a session of a harness
 * with transcripts. Herdr rows carry the operator's name and need none.
 */
export function terminalItemSourceRef(item: TerminalListItem): string | null {
  if (item.surface.backend === "herdr") return null;
  const sourceId = item.session.sourceSessionId?.trim();
  if (!sourceId) return null;
  if (SCOUT_SESSION_ID.test(sourceId)) return sourceId;
  // Discovered sessions repeat their own name as the source id.
  if (sourceId === item.surface.sessionName) return null;
  const harness = markedHarness(item.session.harness);
  return harness ? harnessSessionRef(harness, sourceId) : null;
}

/**
 * The ref an agent row asks for its harness's own name by. A session card
 * carries its Scout session id; a flat agent carries its harness session id
 * in its handle. Named agents (Hudson, Studio) are already named.
 */
export function agentSourceRef(agent: Pick<Agent, "harness" | "harnessSessionId" | "handle" | "definitionId">): string | null {
  if (agent.harnessSessionId) {
    return harnessSessionRef(markedHarness(agent.harness) ?? agent.harness, agent.harnessSessionId);
  }
  const id = agent.handle ?? agent.definitionId ?? "";
  const flat = /^flat-(claude|codex)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu.exec(id);
  if (flat) return harnessSessionRef(flat[1], flat[2]);
  return SCOUT_SESSION_ID.test(id) ? id : null;
}

export function terminalNavRow(
  item: TerminalListItem,
  owner: Agent | null,
  herdr: TerminalNavHerdrSummary | null,
  context: TerminalNavRowContext = {},
): TerminalNavRowModel {
  const handle = terminalNavHandle(item.surface.sessionName);
  // A herdr topology counted on its own host knows its apps; otherwise this
  // host's process table does, for the sessions it holds.
  const apps = herdr?.apps ?? context.place?.apps ?? [];
  const host = apps.length ? apps.join(", ") : null;
  // open in more than one Rex block, the first one found stands for it
  const rex = context.place?.rex?.[0] ?? null;
  const harness = markedHarness(owner?.harness) ?? markedHarness(item.session.harness);
  const mark: TerminalNavRowMark = item.surface.backend === "herdr"
    ? { kind: "herdr" }
    : harness
      ? { kind: "harness", harness }
      : { kind: "shell" };
  const working = Boolean((owner && isAgentInTurn(owner.state, owner)) || (herdr && herdr.working > 0));

  // A herdr session's name is the operator's own and says what it is for;
  // its panes say who is in it. Everything else leads with what happened.
  if (item.surface.backend === "herdr") {
    const handle = isStoppedHostItem(item) ? "herdr · stopped" : "herdr";
    return { mark, title: item.surface.sessionName, handle, host, working, panes: herdr, rex };
  }
  // Claude Code sets its process title to its version, so a pane running it
  // reports "2.1.280" as the current command; that is never a useful title.
  const reportedCommand = typeof item.session.metadata?.currentCommand === "string"
    ? item.session.metadata.currentCommand.trim()
    : "";
  const currentCommand = /^\d+(?:\.\d+)+$/u.test(reportedCommand) ? "" : reportedCommand;
  // The harness's own name for the session says what it is for, and so does
  // the title it gave the pane ("terminals view spacing") or a window name
  // someone chose. After them, what happened last, the owner's chosen name,
  // then what it said last.
  const told = owner?.pendingAsk?.trim()
    ? firstSentence(owner.pendingAsk)
    : firstSourceName(context.source?.title, metadataText(item, "paneTitle"), metadataText(item, "windowName"))
      ?? (owner ? latestActivitySummary(owner) ?? chosenName(owner.name, item.surface.sessionName) : null)
      ?? context.source?.doing
      ?? (currentCommand && !markedHarness(currentCommand) ? currentCommand : null);
  if (told) return { mark, title: told, handle, host, working, panes: null, rex };
  // Nothing says what happened here. A generated name reads better as its
  // short handle ("mulg1xl0", not "Session Mulg1xl0 Bvteeb"), and the detail
  // line names the harness instead of repeating it.
  if (handle !== item.surface.sessionName) {
    return { mark, title: handle, handle: harness ?? item.surface.backend, host, working, panes: null, rex };
  }
  return { mark, title: item.title, handle, host, working, panes: null, rex };
}

export type TerminalAgentRowModel = {
  title: string;
  /** Where it is: its host when that is another one, its project and branch, its terminal. */
  detail: string;
  /** Every name it goes by, for the row's tooltip. */
  tooltip: string;
};

export type TerminalAgentRowContext = {
  source?: TerminalSource | null;
  /** False when the agent's home is another host; null when unknown. */
  local?: boolean | null;
  /** The herdr session and tab its harness session runs in ("chat-levelup › 4-claudes"). */
  herdrPlace?: string | null;
};

/**
 * One Available agents row. A named agent leads with its name; a session
 * card (named after its id) leads with its harness's own name for the work,
 * else what it last did. The detail says where it is, host first when that
 * is another one.
 */
export function terminalAgentRow(agent: Agent, context: TerminalAgentRowContext = {}): TerminalAgentRowModel {
  const handle = agent.handle ?? agent.definitionId ?? agent.id;
  const title = firstSourceName(cardName(agent.name, handle) ? null : agent.name)
    ?? firstSourceName(context.source?.title)
    ?? latestActivitySummary(agent)
    ?? context.source?.doing
    ?? terminalNavHandle(handle);
  const surface = agent.terminalSurface;
  const terminal = context.herdrPlace
    ? `herdr ${context.herdrPlace}`
    : surface?.sessionName
      ? `${surface.backend} ${terminalNavHandle(surface.sessionName)}`
      : null;
  const host = context.local === false ? agentHostName(agent) : null;
  const project = agent.project ?? leafOf(agent.cwd) ?? leafOf(agent.projectRoot);
  const detail = [host, project, agent.branch, terminal].filter(Boolean).join(" · ");
  const tooltip = [
    agent.name,
    `@${handle}`,
    context.source?.title && context.source.title !== title ? context.source.title : null,
    context.source?.doing && context.source.doing !== title ? context.source.doing : null,
  ].filter(Boolean).join("\n");
  return { title, detail, tooltip };
}

/**
 * A session card's name is its id title-cased ("Session Mvvqlhza Bvredh" for
 * `session-mvvqlhza-bvredh`). Matching the id, not the name's shape, keeps a
 * name a person chose ("Session planning review").
 */
function cardName(name: string | null | undefined, handle: string): boolean {
  if (!name || !SCOUT_SESSION_ID.test(handle)) return false;
  const flat = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
  return flat(name) === flat(handle);
}

/** The host's name, else its node id less the mesh suffix (`mini-openscout` is mini). */
function agentHostName(agent: Pick<Agent, "homeNodeName" | "authorityNodeName" | "homeNodeId" | "authorityNodeId">): string | null {
  const name = (agent.homeNodeName ?? agent.authorityNodeName)?.trim();
  if (name) return name.replace(/\.local$/iu, "");
  const id = (agent.homeNodeId ?? agent.authorityNodeId)?.trim();
  return id ? id.replace(/-openscout$/iu, "").replace(/-local$/iu, "") || null : null;
}

function leafOf(path: string | null | undefined): string | null {
  const trimmed = path?.trim().replace(/\/+$/u, "");
  if (!trimmed) return null;
  return trimmed.split("/").pop() || trimmed;
}
