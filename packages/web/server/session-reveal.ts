/**
 * "Go to session" for a request: take the operator to the session that asked.
 *
 * The ladder, first rung that lands wins:
 *   1. window   — the live terminal already shows it; select its pane and raise
 *                 the app (the same proven focus as /api/session-ref/:id/focus).
 *   2. attached — no terminal shows it; open the operator's terminal attached
 *                 to its tmux session, or, for a Claude background session
 *                 (`claude --bg`), on `claude attach <job>`.
 * It never starts, resumes or forks a session, and it attaches only on positive
 * evidence: the focus binding proved this exact tmux session detached, or the
 * request's own runtime session id names exactly one tmux session with no
 * client. A Claude record's tmux name alone is never enough (it may be stale and
 * the name reused), and an attached session whose app Scout can't identify is
 * reported, not given a second client.
 *
 * An attached rung opens a pop-out: the attach is marked with a token, and the
 * answer carries it with the host, so the companion gives that window a Done
 * that closes it again (the session keeps running). Without a host id the
 * window still opens, unmarked, as before.
 *
 * The request carries the runtime's session id. For tmux-hosted agents that is
 * the tmux session name, which Claude records next to its own native id in
 * ~/.claude/sessions/<pid>.json — the bridge to the native ref focus needs.
 */
import type { ClaudeSessionRecord } from "@openscout/runtime";
import type { SessionFocusResult, SessionSteerAvailability } from "../shared/api/session-steer.ts";

/** A window the reveal opened that Done can close: its token, the host it is on, and the app that drew it. */
export type RevealPopOut = {
  popOut: string;
  machine: string;
  sessionRef: string;
  terminal?: { app: string; bundleId: string; appPid: number };
};

export type SessionRevealResult =
  | { ok: true; rung: "window"; reason: string; precision?: SessionFocusResult["precision"] }
  | ({ ok: true; rung: "attached"; reason: string; app: string } & Partial<RevealPopOut>)
  | { ok: false; code: string; reason: string };

/** A tmux session found by exact name on the operator's tmux server. */
export type TmuxHostSession = { socket: string | null; session: string; cwd: string | null; attached: boolean };

export type SessionRevealDeps = {
  records: () => Promise<ClaudeSessionRecord[]>;
  machine: () => Promise<string | null>;
  focus: (ref: string, machine: string) => Promise<SessionFocusResult>;
  /** The tmux session with exactly this name, or null. */
  tmuxSession: (name: string) => Promise<TmuxHostSession | null>;
  /** Opens an attach command in the operator's terminal app; with `popOut`, marked as that pop-out's. */
  open: (argv: readonly string[], cwd: string | null, popOut?: string) => Promise<{ app: string; bundleId?: string; pid?: number }>;
  /** A fresh pop-out token. Without it, attaches open unmarked and get no Done. */
  popOutToken?: () => string;
  /**
   * A session no window shows, opened on its own attach command from the
   * verified binding (session-steering.ts openTerminal). Used for a Claude
   * background session, whose job id only that binding may supply.
   */
  openAttached?: (ref: string, machine: string) => Promise<{
    ok: boolean; code: string; reason: string; app?: string;
    popOut?: string; terminal?: { app: string; bundleId: string; appPid: number };
  }>;
};

/** Native refs for a runtime session id, newest process first. */
export function nativeSessionRefs(records: readonly ClaudeSessionRecord[], sessionId: string): { ref: string; cwd: string | null }[] {
  const hits = records
    .filter((record) => record.sessionId === sessionId || record.tmux?.session === sessionId)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  const seen = new Set<string>();
  const refs: { ref: string; cwd: string | null }[] = [];
  for (const record of hits) {
    const ref = `session:claude:${record.sessionId}`;
    if (seen.has(ref)) continue;
    seen.add(ref);
    refs.push({ ref, cwd: record.cwd });
  }
  return refs;
}

export function tmuxAttachArgv(session: string, socket: string | null): string[] {
  // "=" makes tmux match the session name exactly, never a prefix.
  return ["tmux", ...(socket ? ["-S", socket] : []), "attach-session", "-t", `=${session}`];
}

export async function revealSession(sessionId: string, deps: SessionRevealDeps): Promise<SessionRevealResult> {
  const machine = await deps.machine().catch(() => null);
  const popOutOf = (token: string | undefined, sessionRef: string, terminal?: RevealPopOut["terminal"]): Partial<RevealPopOut> =>
    token && machine ? { popOut: token, machine, sessionRef, ...(terminal ? { terminal } : {}) } : {};

  const attach = async (session: string, socket: string | null, cwd: string | null, sessionRef: string): Promise<SessionRevealResult> => {
    // Done closes only on the host that opened it, so a pop-out needs the host's id.
    const token = machine ? deps.popOutToken?.() : undefined;
    try {
      const opened = await deps.open(tmuxAttachArgv(session, socket), cwd, token);
      const terminal = opened.bundleId && opened.pid ? { app: opened.app, bundleId: opened.bundleId, appPid: opened.pid } : undefined;
      return { ok: true, rung: "attached", app: opened.app, reason: `Opened ${opened.app} attached to ${session}.`, ...popOutOf(token, sessionRef, terminal) };
    } catch (error) {
      return { ok: false, code: "open_failed", reason: error instanceof Error ? error.message : "Could not open a terminal." };
    }
  };

  const refs = nativeSessionRefs(await deps.records().catch(() => []), sessionId);
  let failure: SessionFocusResult | null = null;
  if (machine) {
    for (const { ref, cwd } of refs) {
      const result = await deps.focus(ref, machine);
      if (result.ok) return { ok: true, rung: "window", reason: result.reason, precision: result.precision };
      // The binding proved this exact tmux session has no client.
      if (result.code === "tmux_detached" && result.detached) return attach(result.detached.session, result.detached.socket, cwd, ref);
      // A background session: its process is live, but only `claude attach` shows it.
      if (result.code === "background_job" && deps.openAttached) {
        const opened = await deps.openAttached(ref, machine).catch((error: unknown) => ({
          ok: false, code: "open_failed", reason: error instanceof Error ? error.message : "Could not open a terminal.",
          app: undefined, popOut: undefined, terminal: undefined,
        }));
        return opened.ok
          ? { ok: true, rung: "attached", app: opened.app ?? "a terminal", reason: opened.reason, ...popOutOf(opened.popOut, ref, opened.terminal) }
          : { ok: false, code: opened.code, reason: opened.reason };
      }
      failure = result;
      // A gone process may leave an older record; anything else is an answer.
      if (result.code !== "not_live") return { ok: false, code: result.code, reason: result.reason };
    }
  }

  // No live process proved a location. Only the request's own runtime id, as
  // an exact tmux session name, may stand in for one.
  const host = await deps.tmuxSession(sessionId).catch(() => null);
  if (host && !host.attached) return attach(host.session, host.socket, host.cwd, refs[0]?.ref ?? sessionId);
  if (host) return { ok: false, code: "attached_unverified", reason: "A terminal is attached to its tmux session, but Scout could not tell which one. Nothing was opened." };
  if (failure) return { ok: false, code: failure.code, reason: failure.reason };
  return { ok: false, code: "not_found", reason: "No live terminal or tmux session holds this session. Nothing was started." };
}

// ── the session's pane, to embed ─────────────────────────────────────────

/**
 * The tmux session a request's session runs in, for the companion to show in
 * its own terminal pop-up instead of opening a terminal app. Nothing is opened,
 * focused or attached here: the pop-up joins as a read-only client that takes
 * the pane's size, and only jumping in lets keys through (PaneTerminal).
 *
 * Found on positive evidence only, and only on the default tmux server (the
 * one the relay attaches to): the session's live process sits in a tmux pane
 * whose tty is the process's own, or the request's runtime session id is an
 * exact tmux session name, as the reveal's last rung allows.
 */
export type SessionPaneResult =
  | { ok: true; pane: { backend: "tmux"; sessionName: string }; attached: boolean; cwd: string | null }
  | { ok: false; code: string; reason: string };

export type SessionPaneDeps = Pick<SessionRevealDeps, "records" | "machine" | "tmuxSession"> & {
  /** Where the session's process is, without raising or selecting anything (session-steering.ts inspect). */
  inspect: (ref: string, machine: string) => Promise<SessionSteerAvailability>;
  /** The session and tty of a tmux pane on the default server, or null. */
  paneOf: (paneId: string) => Promise<{ session: string; tty: string | null } | null>;
};

export const TMUX_PANE_ID = /^%\d+$/u;

const NO_PANE: SessionPaneResult = { ok: false, code: "no_pane", reason: "This session isn't in a tmux session Scout can show here." };

/** The tmux session whose pane the live process sits in, proved by the pane's tty; null without that proof. */
async function provedPaneSession(ref: string, machine: string, deps: Pick<SessionPaneDeps, "inspect" | "paneOf">): Promise<string | null> {
  // inspect refuses another machine's session, so only this host's panes get this far.
  const seen = await deps.inspect(ref, machine).catch(() => null);
  const target = seen?.target;
  if (!target || target.host !== "tmux" || !TMUX_PANE_ID.test(target.address)) return null;
  const pane = await deps.paneOf(target.address).catch(() => null);
  // A pane id is per server: its tty must be the process's own, or it is another server's pane.
  return pane && target.tty && pane.tty === target.tty ? pane.session : null;
}

async function paneNamed(names: readonly string[], deps: Pick<SessionPaneDeps, "tmuxSession">): Promise<SessionPaneResult> {
  for (const name of names) {
    const host = await deps.tmuxSession(name).catch(() => null);
    if (host) return { ok: true, pane: { backend: "tmux", sessionName: host.session }, attached: host.attached, cwd: host.cwd };
  }
  return NO_PANE;
}

/** A request's session: its native refs' proved panes, then its runtime session id as an exact tmux session name. */
export async function findSessionPane(sessionId: string, deps: SessionPaneDeps): Promise<SessionPaneResult> {
  const machine = await deps.machine().catch(() => null);
  const names: string[] = [];
  if (machine) {
    for (const { ref } of nativeSessionRefs(await deps.records().catch(() => []), sessionId)) {
      const name = await provedPaneSession(ref, machine, deps);
      if (name) names.push(name);
    }
  }
  names.push(sessionId);
  return paneNamed(names, deps);
}

/**
 * Any native session by its ref (the companion's quick terminal): only the
 * pane its live process is proved to sit in. No name fallback: a ref names a
 * process, not a tmux session.
 */
export async function findRefPane(ref: string, machine: string, deps: Pick<SessionPaneDeps, "inspect" | "paneOf" | "tmuxSession">): Promise<SessionPaneResult> {
  const name = await provedPaneSession(ref, machine, deps);
  return name ? paneNamed([name], deps) : NO_PANE;
}
