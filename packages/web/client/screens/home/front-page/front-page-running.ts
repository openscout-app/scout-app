/* Running: the sessions at work now, for Home's right pane, grouped by
   project. Each row reads by its work, not its session: the work item's
   title, its state (waits on you, working, idle) and its newest progress
   sentence as plain text. Runtime ids, tool steps, command lines and markdown
   never show. Built from the same lanes Ops reads (buildAgentLanes, working
   only). Pure. */

import type { Agent, Route, TailDiscoveredProcess, TailDiscoveredTranscript, TailEvent } from "../../../lib/types.ts";
import { agentLaneToCardModel } from "../../ops/agent-lane-card-model.ts";
import { buildAgentLanes } from "../../ops/agent-lanes-model.ts";
import { HOME_MOVING_HORIZON } from "../home-moving.ts";
import { homeCardTerminalEnabled } from "../home-live-action.ts";
import { isSyntheticAgentId } from "../../../lib/synthetic-agent-routing.ts";
import { firstSentence, readableTitle, type HomeAgent, type HomeRef } from "./front-page-model.ts";
import { sessionTitle } from "../../../lib/harness-session-title.ts";

export type HomeStep = { id: string; at: number; text: string };

/** The work a running session does, as the runtime records it. */
export type HomeRunningWork = {
  title: string;
  /** The work's newest meaningful summary, as the runtime wrote it. */
  progress: string | null;
  startedAt: number | null;
};

/** Where a running session stands: a request of its waits on you, it is mid-turn, or it went quiet. */
export type RunningState = "waiting" | "working" | "idle";

/**
 * A running session's references and where it runs, for its hover card. Each
 * is null when nothing the client reads says it.
 */
export type HomeRunningRefs = {
  /** The pull request of the session's live Feed post: an open one first. */
  pr: HomeRef | null;
  branch: string | null;
  /** The folder the session works in. */
  worktree: string | null;
  /** The project root the runtime records for its agent. */
  projectPath: string | null;
  /** The machine the runtime names for its agent; null for a session it only observes. */
  host: string | null;
  harness: string | null;
  model: string | null;
  /** Its terminal, when the runtime knows the pane it runs in. */
  terminal: Route | null;
};

export type HomeRunning = {
  id: string;
  /** The project it works in; a copy of a repository ("demo-app-home-running") counts as the repository. */
  project: string;
  /** What the session is about: its work item's title, else the harness's name for the session, else the project. Never words from a prompt, never an id. */
  title: string;
  agent: HomeAgent;
  /** The copy or branch it works on ("home-running"), when it is not the project's own checkout on main. */
  place?: string | null;
  /** When the work started, for "for 2h 10m"; null when no work item says. */
  since: number | null;
  at: number;
  state: RunningState;
  /**
   * When the state began, as far as the client can tell: working, the
   * session's newest prompt, else its work's start; waiting, the oldest open
   * request that names it; idle, its last activity. Null when nothing says.
   */
  stateSince: number | null;
  refs: HomeRunningRefs;
  /** One sentence on where the work stands, as plain text: the work's own summary, else the agent's newest words. */
  progress: string | null;
  open: Route | null;
  /** How busy the session was, oldest first: one level (0 to RUN_TRACE_ROWS) per RUN_TRACE_STEP_MS, ending now. */
  trace: number[];
};

export type HomeRunningGroup = { project: string; rows: HomeRunning[] };

/** The activity trace: columns, dots per column, and the time each column covers (16 x 2 min = the last 32 minutes). */
export const RUN_TRACE_COLS = 16;
export const RUN_TRACE_ROWS = 4;
export const RUN_TRACE_STEP_MS = 2 * 60_000;

/** Events in a column to its lit dots: none, one, a few, several, many. */
function traceLevel(count: number): number {
  return count <= 0 ? 0 : count === 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
}

/** Each session's tail events counted into the trace's columns, oldest first; a session with none has no entry. */
export function runningTraces(events: readonly TailEvent[], nowMs: number): Map<string, number[]> {
  const counts = new Map<string, number[]>();
  const start = nowMs - RUN_TRACE_COLS * RUN_TRACE_STEP_MS;
  for (const event of events) {
    if (!event.sessionId || event.ts <= start || event.ts > nowMs) continue;
    const col = Math.min(RUN_TRACE_COLS - 1, Math.floor((event.ts - start) / RUN_TRACE_STEP_MS));
    const row = counts.get(event.sessionId) ?? new Array<number>(RUN_TRACE_COLS).fill(0);
    row[col]! += 1;
    counts.set(event.sessionId, row);
  }
  return new Map([...counts].map(([id, row]) => [id, row.map(traceLevel)]));
}

/** Rows Home shows; the rest are counted and left to All sessions. */
export const HOME_RUNNING_LIMIT = 6;

/** How far back Home's side column looks: the sessions at work now, then the ones active in this window. */
export const HOME_RECENT_MS = 4 * 60 * 60_000;
export const HOME_RECENT_LABEL = "Last 4 hours";

/** What an open request names: the agent it came from and, for a permission, the session. */
export type RunningRequest = { agentId: string | null; permission?: { sessionId: string } | null; updatedAt?: number };

function leaf(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || null;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A line as plain text: markdown links read as their words, a pull request or
 * issue URL as "#123", any other URL as its host; emphasis, code ticks,
 * headings, quotes and bullets are dropped.
 */
export function plainLine(text: string): string {
  return oneLine(text
    .replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))+\)/g, "$1")
    .replace(/<?(https?:\/\/[^\s<>()]+)>?/g, (_, url: string) => {
      const cleaned = url.replace(/[.,;:!?]+$/, "");
      const tail = url.slice(cleaned.length);
      const pr = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(?:pull|issues)\/(\d+)/.exec(cleaned);
      if (pr) return `#${pr[1]}${tail}`;
      try { return `${new URL(cleaned).host}${tail}`; } catch { return cleaned + tail; }
    })
    // a full commit hash reads as its short form
    .replace(/\b([0-9a-f]{7})[0-9a-f]{5,33}\b/g, "$1")
    .replace(/\*\*|__|`/g, "")
    .replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
    // "PR #12: #12" or "PR #12: owner/repo#12", a link beside its own URL, reads once
    .replace(/(#\d+)(?::|,)?\s+\(?(?:[\w.-]+\/[\w.-]+)?\1\b\)?/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/gm, ""));
}

/**
 * The project a session works in. A copy of a repository is named after it
 * ("demo-app-home-running" for demo-app), so a folder that starts with a
 * known project's name and a hyphen counts as that project: the longest such
 * name wins. A folder that is itself a known project stays itself (demo-app
 * is not a copy of scout). `rest` is what the copy adds ("home-running"), or null.
 */
export function runningProject(folder: string, known: Iterable<string>): { project: string; rest: string | null } {
  const names = [...known];
  if (names.includes(folder)) return { project: folder, rest: null };
  let best: string | null = null;
  for (const name of names) {
    if (!name) continue;
    if (folder.startsWith(`${name}-`) && (!best || name.length > best.length)) best = name;
  }
  return best ? { project: best, rest: folder.slice(best.length + 1) || null } : { project: folder, rest: null };
}

/* Lines the tail carries that are records, not words: timing, token counts,
   turn and task markers, snapshots, session headers. */
const PLUMBING = /^(?:turn (?:duration|context|started|complete|completed|aborted|failed)|task (?:started|complete|completed|failed)|tokens?\b|token_usage|away summary|file-history-snapshot|session [a-z0-9-]{6,}|api-request)/i;
const TIMING = /\b\d+(?:\.\d+)?\s?ms$/i;
/* Tools that run the harness itself rather than the work. */
const HARNESS_TOOLS = /^(?:ToolSearch|TodoWrite|TaskOutput|TaskStop|TaskCreate|TaskUpdate|ScheduleWakeup|SubagentHandback|EnterPlanMode|ExitPlanMode|Skill)\b/;
const STEP_MAX = 140;

function clipLine(text: string, max = STEP_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * A tail event as a line a person would read, or null to leave it out: the
 * assistant's words (its first sentence) and tool steps as a short verb and
 * target. Bracketed record kinds ("[attachment]", "[system]",
 * "[token_usage_record]"), thinking, tool output, timing lines and the
 * harness's own bookkeeping tools are left out.
 */
export function runningStep(event: Pick<TailEvent, "kind" | "summary">): string | null {
  if (event.kind !== "assistant" && event.kind !== "tool") return null;
  const text = oneLine(event.summary ?? "");
  if (!text || text.startsWith("[")) return null;
  if (PLUMBING.test(text) || TIMING.test(text)) return null;
  if (event.kind === "assistant") return firstSentence(text.replace(/\*\*|__|`/g, ""), STEP_MAX);
  if (HARNESS_TOOLS.test(text)) return null;
  // "mcp__lattices__windows_search Scout" reads as "windows search Scout"
  const mcp = /^mcp__[^_\s]+(?:_[^_\s]+)*__(\S+)\s*(.*)$/.exec(text);
  let step = mcp ? `${mcp[1]!.replace(/_/g, " ")} ${mcp[2]}`.trim() : text.replace(/^cd \S+ && /, "");
  // "python3 - <<'PY' …" is a script, not a line to read
  const heredoc = /^(\S+)[^<]*<</.exec(step);
  if (heredoc) step = `Run a ${heredoc[1]} script`;
  // a bare tool name: "request_user_input_async" reads as "request user input async"
  if (/^[a-z]+(?:_[a-z]+)+$/.test(step)) step = step.replace(/_/g, " ");
  return clipLine(step);
}

/* Lines the runtime writes about delivery, not the work: "acknowledged via
   attach", "queued for local execution", alias rebinds. */
const DELIVERY = /\b(?:acknowledged via|queued for (?:local )?execution|wakes? on demand)\b|→\s*session-/i;

/** A progress line a person would read, or null: one sentence, no ids, no delivery receipts. */
export function runningProgress(text: string | null | undefined): string | null {
  const readable = readableTitle(text);
  if (!readable || DELIVERY.test(readable)) return null;
  return progressSentence(readable);
}

/* A sentence that says where work stands: at least three words, and not cut
   at a list number ("…exactly as written: 1." reads as "…exactly as written"). */
function progressSentence(text: string): string | null {
  const first = firstSentence(plainLine(text), STEP_MAX);
  const sentence = first?.replace(/[:\s]+\d+\.$/, "").replace(/^\d+\.$/, "").trim() ?? "";
  return sentence.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length >= 3 ? sentence : null;
}

/**
 * What a running session is about: the title of the work item it runs, else
 * the harness's own name for the session, else the project it works in, else
 * who runs it. A prompt is never the title: a pasted or cut-off prompt reads
 * as a fragment. Ids and placeholders ("Pasted content") never stand as a
 * title.
 */
export function runningTitle(candidates: { work: string | null; session: string | null; project?: string | null; name: string }): string {
  const work = readableTitle(candidates.work);
  return (work ? firstSentence(work, 120) : null) ?? readableTitle(candidates.session) ?? readableTitle(candidates.project) ?? candidates.name;
}

/** How long work has been going: "4m", "2h 10m", "3d". */
export function runningFor(sinceMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours}h ${minutes % 60}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** A worktree or branch slug as words: "feed-outside-backoff" reads as "Feed outside backoff". */
function slugWords(slug: string | null | undefined): string | null {
  const words = (slug ?? "").replace(/^.*\//, "").replace(/[-_]+/g, " ").trim();
  if (!words || !/\p{L}{2}/u.test(words)) return null;
  return words[0]!.toUpperCase() + words.slice(1);
}

function harnessName(harness: string | null | undefined): string {
  const name = (harness ?? "").trim();
  return name ? name[0]!.toUpperCase() + name.slice(1) : "Agent";
}

const STATE_RANK: Record<RunningState, number> = { waiting: 0, working: 1, idle: 2 };

/** What waits on you first, then what is working, then what went quiet; newest first within each. */
export function runningOrder(a: HomeRunning, b: HomeRunning): number {
  return STATE_RANK[a.state] - STATE_RANK[b.state] || b.at - a.at;
}

/**
 * Running rows as Home draws them, grouped by project. Which rows show is
 * picked by state, then recency (what waits on you, then working, then
 * idle); how they are drawn is stable, so a session writing a line never
 * reshuffles the list: projects by their most pressing state, then by name;
 * rows by state, then title. Idle rows go newest first instead, and a project
 * of idle rows only by its newest: an idle session's time does not move.
 * `more` counts the rows left to All sessions.
 */
export function runningGroups(rows: readonly HomeRunning[], limit = HOME_RUNNING_LIMIT): { groups: HomeRunningGroup[]; total: number; more: number } {
  const shown = [...rows].sort(runningOrder).slice(0, limit);
  const byProject = new Map<string, HomeRunningGroup>();
  for (const row of shown) {
    const group = byProject.get(row.project) ?? { project: row.project, rows: [] };
    group.rows.push(row);
    byProject.set(row.project, group);
  }
  const rank = (group: HomeRunningGroup) => Math.min(...group.rows.map((row) => STATE_RANK[row.state]));
  const newest = (group: HomeRunningGroup) => Math.max(...group.rows.map((row) => row.at));
  const idleRank = STATE_RANK.idle;
  const groups = [...byProject.values()]
    .map((group) => ({ ...group, rows: group.rows.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || (a.state === "idle" ? b.at - a.at : 0) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)) }))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === idleRank ? newest(b) - newest(a) : 0) || a.project.localeCompare(b.project));
  return { groups, total: rows.length, more: rows.length - shown.length };
}

/** The open requests by the agent or session they name, each with the oldest one's time (null when none says). */
function requestKeys(requests: readonly RunningRequest[]): Map<string, number | null> {
  const keys = new Map<string, number | null>();
  const add = (key: string, at: number | null) => {
    const prior = keys.get(key);
    keys.set(key, prior == null ? at : at == null ? prior : Math.min(prior, at));
  };
  for (const request of requests) {
    const at = request.updatedAt ?? null;
    if (request.agentId) {
      add(`agent:${request.agentId}`, at);
      add(`agent:${request.agentId.split(".")[0]}`, at);
    }
    if (request.permission?.sessionId) add(`session:${request.permission.sessionId}`, at);
  }
  return keys;
}

export function homeRunning(input: {
  agents: Agent[];
  tailEvents: TailEvent[];
  transcripts: TailDiscoveredTranscript[];
  processes: TailDiscoveredProcess[];
  /** Working items by the agent that owns them (its id, and its id up to the first "."). */
  workByAgent?: ReadonlyMap<string, HomeRunningWork>;
  /** Work item titles by the harness session that runs them (the feed's live posts). */
  workTitles?: ReadonlyMap<string, string>;
  /** Pull requests by the harness session whose live Feed post names them. */
  sessionPrs?: ReadonlyMap<string, HomeRef>;
  /** The operator's open requests: a session one of them names waits on you. */
  requests?: readonly RunningRequest[];
  /** Project names the runtime already knows (the week's projects), so a copy of a repository groups with it. */
  projects?: readonly string[];
  nowMs: number;
}): HomeRunning[] {
  const { lanes } = buildAgentLanes({
    transcripts: input.transcripts,
    tailEvents: input.tailEvents,
    processes: input.processes,
    scoutAgents: input.agents,
    now: input.nowMs,
    workingOnly: true,
    horizon: HOME_MOVING_HORIZON,
  });
  // The agent's newest words per session, for when the work has no summary.
  const said = new Map<string, { at: number; text: string }>();
  for (const event of input.tailEvents) {
    if (!event.sessionId || event.kind !== "assistant") continue;
    const text = runningStep(event) ? progressSentence(event.summary) : null;
    const prior = said.get(event.sessionId);
    if (text && (!prior || event.ts >= prior.at)) said.set(event.sessionId, { at: event.ts, text });
  }
  // The newest prompt per session: when its current turn began.
  const prompted = new Map<string, number>();
  for (const event of input.tailEvents) {
    if (!event.sessionId || event.kind !== "user") continue;
    if (event.ts > (prompted.get(event.sessionId) ?? -Infinity)) prompted.set(event.sessionId, event.ts);
  }
  const sessionNames = new Map<string, string>();
  for (const transcript of input.transcripts) {
    // The shared reading: an operator's name, else the harness's, never Scout's launch name.
    const name = sessionTitle(transcript);
    if (transcript.sessionId && name) sessionNames.set(transcript.sessionId, name);
  }
  const waiting = requestKeys(input.requests ?? []);
  const traces = runningTraces(input.tailEvents, input.nowMs);
  const quiet = new Array<number>(RUN_TRACE_COLS).fill(0);
  const cards = lanes.map((lane) => ({ lane, card: agentLaneToCardModel(lane, { isLive: lane.current, nowMs: input.nowMs }) }));
  // Projects named by the runtime, and by a lane's own project when it differs
  // from its folder (a folder name alone would keep every copy apart).
  const known = new Set(input.projects ?? []);
  for (const { card } of cards) {
    if (card.project && card.project !== leaf(card.cwdFull ?? card.cwd)) known.add(card.project);
  }
  return cards.map(({ lane, card }) => {
    const sessionId = card.sessionIdFull ?? null;
    const agentId = lane.agent.id;
    const work = input.workByAgent?.get(agentId) ?? input.workByAgent?.get(agentId.split(".")[0]!) ?? null;
    const folder = leaf(card.cwdFull ?? card.cwd) ?? (card.project || card.name);
    const { project, rest } = runningProject(folder, known);
    const branch = card.branch && !/^(?:main|master|HEAD)$/.test(card.branch) ? card.branch : null;
    const title = runningTitle({
      work: work?.title ?? (sessionId ? input.workTitles?.get(sessionId) ?? null : null),
      session: sessionId ? sessionNames.get(sessionId) ?? null : null,
      // Without a title, the copy or branch it works on says which of a project's sessions this is.
      project: slugWords(rest) ?? slugWords(branch) ?? null,
      // The project already heads the group: never the title again.
      name: readableTitle(card.name) && card.name !== project && card.name !== folder ? card.name : `${harnessName(card.harness)} session`,
    });
    // Who runs it: the session's own name, else the card's, else the harness. Never an id, never the title again.
    const named = [lane.agent.sessionName, card.name].map(readableTitle).find((n) => n && n !== title) ?? null;
    const askKeys = [`agent:${agentId}`, `agent:${agentId.split(".")[0]}`, ...(sessionId != null ? [`session:${sessionId}`] : [])].filter((key) => waiting.has(key));
    const asks = askKeys.length > 0;
    const state: RunningState = asks ? "waiting" : card.working ? "working" : "idle";
    const askedAt = askKeys.map((key) => waiting.get(key)).filter((at): at is number => at != null);
    const agent = lane.agent;
    const stateSince = state === "waiting"
      ? (askedAt.length ? Math.min(...askedAt) : null)
      : state === "working"
        ? (sessionId ? prompted.get(sessionId) ?? work?.startedAt : work?.startedAt) ?? null
        : lane.lastActiveAt || null;
    return {
      id: lane.id,
      project,
      title: plainLine(title),
      agent: { name: named ?? card.harness ?? "agent", harness: card.harness },
      place: rest ?? branch,
      since: work?.startedAt ?? null,
      at: lane.lastActiveAt,
      state,
      stateSince,
      refs: {
        pr: sessionId ? input.sessionPrs?.get(sessionId) ?? null : null,
        branch: card.branch ?? null,
        worktree: card.cwdFull ?? null,
        projectPath: agent.projectRoot ?? null,
        host: agent.authorityNodeName ?? agent.homeNodeName ?? null,
        harness: card.harness,
        model: card.model,
        terminal: homeCardTerminalEnabled(agent) && !isSyntheticAgentId(agent.id) ? { view: "terminal", agentId: agent.id, mode: "takeover" } : null,
      },
      progress: runningProgress(work?.progress) ?? (sessionId ? said.get(sessionId)?.text ?? null : null),
      open: sessionId ? { view: "sessions", sessionId } : null,
      trace: (sessionId ? traces.get(sessionId) : null) ?? quiet,
    } satisfies HomeRunning;
  }).sort(runningOrder);
}

/**
 * The sessions active lately but not at work now, newest first: Running's idle
 * rows, then every harness session on this host whose transcript moved inside
 * the window. Read from the transcripts themselves, so a session that went
 * quiet an hour ago still shows after its tail events have rolled out of the
 * recent read. A child worker shows through its parent, never on its own.
 */
export function homeRecent(input: {
  running: readonly HomeRunning[];
  transcripts: readonly TailDiscoveredTranscript[];
  projects?: readonly string[];
  nowMs: number;
  windowMs?: number;
}): HomeRunning[] {
  const since = input.nowMs - (input.windowMs ?? HOME_RECENT_MS);
  const rows = input.running.filter((row) => row.state === "idle" && row.at >= since);
  const shown = new Set(input.running.map((row) => (row.open?.view === "sessions" ? row.open.sessionId : null)).filter(Boolean));
  const known = new Set([...(input.projects ?? []), ...input.running.map((row) => row.project)]);
  const newest = new Map<string, TailDiscoveredTranscript>();
  for (const transcript of input.transcripts) {
    const id = transcript.sessionId;
    if (!id || transcript.parentSessionId || transcript.subagentId || shown.has(id)) continue;
    const at = transcript.lastEventAt ?? transcript.mtimeMs;
    const prior = newest.get(id);
    if (at >= since && at <= input.nowMs + 60_000 && (!prior || at > (prior.lastEventAt ?? prior.mtimeMs))) newest.set(id, transcript);
  }
  for (const [sessionId, transcript] of newest) {
    const at = transcript.lastEventAt ?? transcript.mtimeMs;
    const folder = leaf(transcript.cwd) ?? transcript.project;
    const { project, rest } = runningProject(folder, known);
    const name = sessionTitle(transcript);
    // `harness` is launch attribution; a session nothing launched is named by the harness that writes it.
    const harness = transcript.harness && transcript.harness !== "unattributed" ? transcript.harness : transcript.source;
    rows.push({
      id: `recent:${sessionId}`,
      project,
      title: plainLine(name ?? slugWords(rest) ?? `${harnessName(harness)} session`),
      agent: { name: harnessName(harness), harness },
      place: rest,
      since: null,
      at,
      state: "idle",
      stateSince: at,
      refs: { pr: null, branch: null, worktree: transcript.cwd, projectPath: null, host: null, harness, model: null, terminal: null },
      progress: null,
      open: { view: "sessions", sessionId },
      trace: new Array<number>(RUN_TRACE_COLS).fill(0),
    });
  }
  return rows.sort((a, b) => b.at - a.at);
}
