/**
 * Live harness sessions as board rows (Scout-started or native). Pure; the
 * hook that reads them is in board-sessions.ts.
 *
 * Each row carries the board's remark (Studio /studies/companion-board-rewrites):
 * a state and the clock time it began, read from the
 * session's registry status when the transcript carries one, else from its
 * events, and ENDED when its process is gone.
 */

import type { Agent, SessionEntry, TailDiscoveredProcess, TailDiscoveredTranscript, TailEvent, WorkItem } from "../../../lib/types.ts";
import type { SessionBoardRow } from "../../sessions/session-board-model.ts";
import { nativeAgentId, nativeAgentName } from "../../../lib/native-agent.ts";
import { formatSessionRouteRef } from "../../../../shared/session-route-ref.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import type { TapInTranscript } from "./tap-in-model.ts";
import { isHarnessNotice, isPlaceholderLine, plainToolLine } from "../../../lib/harness-notice.ts";
import { remarkState, span, type Remark } from "./arrivals-model.ts";
import { QUIET_AFTER_MS } from "./board-motion.ts";

/** A session that wrote nothing for this long leaves the board, unless it is asking. */
export const ARRIVED_WINDOW_MS = 2 * 60 * 60_000;
/** The board is a glance, not the Sessions screen. */
export const MAX_SESSION_ROWS = 12;

const base = (path: string | null) => path?.split("/").filter(Boolean).at(-1) ?? null;
const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const rawOf = (e: TailEvent) => record(e.raw);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

// ── which events a row may read ──────────────────────────────────────────

/** A Claude subagent's or workflow agent's line. It carries its parent's session id. */
export function isSidechain(e: TailEvent): boolean {
  return rawOf(e)?.isSidechain === true;
}

/** The user line is an interrupt marker (the harness's adapter says so). */
function isInterrupt(e: TailEvent): boolean {
  return e.prompt?.parts.some((part) => part.kind === "notice" && part.source === "interrupt") ?? false;
}

/** The operator ran /compact: the compaction that follows is between turns. */
function isCompactCommand(e: TailEvent): boolean {
  return e.prompt?.parts.some((part) => part.kind === "command" && part.name === "/compact") ?? false;
}

/**
 * A user line the operator never typed: the summary that continues a
 * compacted session, a message relayed from another session, a local command
 * or shell-mode line, an interrupt marker. The harness's adapter decides
 * (`prompt.harnessOnly`). Never a name or a now line, and never the start of
 * a turn.
 */
function isHarnessUserLine(e: TailEvent): boolean {
  if (e.kind !== "user") return false;
  const raw = rawOf(e);
  if (raw?.isCompactSummary === true || raw?.isMeta === true) return true;
  return e.prompt?.harnessOnly ?? false;
}

/** A line's text: the operator's words for a classified user line, else its summary. */
function lineText(e: TailEvent): string {
  return (e.kind === "user" && e.prompt ? e.prompt.words : e.summary ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The events a row's name and now line may come from: the session's own,
 * without harness text. A subagent's lines carry its parent's session id,
 * so they would otherwise read as the parent's latest line.
 */
export function boardEvents(events: readonly TailEvent[]): TailEvent[] {
  return events.filter((e) => !isSidechain(e) && !isHarnessUserLine(e));
}

/**
 * What makes a line itself, whichever reader numbered it. Event ids are line
 * counters per reader (the broker's watcher counts one way, a session read
 * another), so the same line comes back under another id, and a subagent's
 * line can share its parent's. A line with a uuid (Claude) is known by it;
 * one without (Codex's event_msg lines) by its session, time, kind and text.
 */
function lineKey(e: TailEvent): string {
  const uuid = str(rawOf(e)?.uuid);
  if (uuid) return `${e.source}:${uuid}`;
  const raw = rawOf(e);
  const type = `${str(raw?.type) ?? ""}/${str(record(raw?.payload)?.type) ?? ""}`;
  return `${e.source}:${e.sessionId}@${e.ts}:${e.kind}:${type}:${e.summary ?? ""}`;
}

/**
 * One event once, however it arrived: pushed, polled, or read again for a
 * quiet session. Oldest first, at most `cap` kept. Over the cap, subagent
 * lines go first, oldest first: the board reads only each child's newest
 * write from them, while a session's own lines say how its turn went, so a
 * busy subagent never pushes its parent's prompt out of the window.
 */
export function mergeTailEvents(current: readonly TailEvent[], incoming: readonly TailEvent[], cap: number): TailEvent[] {
  const byKey = new Map<string, TailEvent>();
  for (const e of current) byKey.set(lineKey(e), e);
  for (const e of incoming) byKey.set(lineKey(e), e);
  const out = [...byKey.values()].sort((a, b) => a.ts - b.ts);
  if (out.length <= cap) return out;
  let over = out.length - cap;
  const kept: TailEvent[] = [];
  for (const e of out) {
    if (over > 0 && isSidechain(e)) { over--; continue; }
    kept.push(e);
  }
  return kept.length > cap ? kept.slice(kept.length - cap) : kept;
}

/**
 * Conversational lines: a session that wrote one of these in the shared
 * window has been read. A subagent's lines carry its parent's id but are not
 * the parent's own, so they do not count.
 */
export function isConversational(e: TailEvent): boolean {
  return !isSidechain(e) && (e.kind === "user" || e.kind === "assistant" || e.kind === "tool" || e.kind === "tool-result");
}

// ── the latest line ──────────────────────────────────────────────────────

/**
 * A session's latest line: what it last did (any line, the operator's prompt
 * included), and what the agent last said (its own messages only, so a DONE
 * row never reads the operator's prompt as the agent's answer).
 */
export type LatestLine = { last: string; said: string | null };

/**
 * Each session's latest line, from tail events (oldest first). Harness
 * notices and subagent lines are skipped; MCP tool calls read as plain words.
 */
export function latestLines(events: readonly TailEvent[]): Map<string, LatestLine> {
  const out = new Map<string, LatestLine>();
  for (const e of events) {
    if (e.kind !== "user" && e.kind !== "assistant" && e.kind !== "tool") continue;
    if (isSidechain(e) || isHarnessUserLine(e)) continue;
    const text = lineText(e);
    if (!text || isHarnessNotice(text) || isPlaceholderLine(text)) continue;
    const line = (e.kind === "tool" ? plainToolLine(text) : text).slice(0, 240);
    const prev = out.get(e.sessionId);
    out.set(e.sessionId, { last: line, said: e.kind === "assistant" ? line : prev?.said ?? null });
  }
  return out;
}

// ── the session's state ──────────────────────────────────────────────────

type Phase = "working" | "done" | "stopped" | "compact" | "asking" | "ended";

/** What a session's own lines, its registry status and its process say about it. */
export type SessionRead = {
  /** Null when nothing says (no events, no status). */
  phase: Phase | null;
  /** When that phase began. */
  since: number;
  /** When the turn began, when its start was seen. */
  turnStart: number | null;
  /** How long the last turn ran, when known. */
  took: number | null;
  /** What it said last in the newest turn. */
  said: string | null;
  /** What it is asking, for ASKING. */
  ask: string | null;
  /** The newest write by the session, its subagents or its workflow agents. */
  lastWrite: number;
  /** The newest write by the session itself; 0 when none is known. */
  ownWrite: number;
  /** The newest write by a child (subagent, workflow agent) still running; 0 when none. */
  childWrite: number;
  /** The harness's own title for the session. */
  title: string | null;
};

type Mark =
  | { kind: "start" }
  | { kind: "work"; said?: string | null }
  | { kind: "end"; took?: number | null; said?: string | null }
  | { kind: "abort" }
  /** `manual`: the operator ran /compact, between turns. */
  | { kind: "compact"; manual?: boolean }
  | { kind: "none" };

const ENDS = new Set(["end_turn", "stop_sequence", "max_tokens"]);
const stopReason = (e: TailEvent) => str(record(rawOf(e)?.message)?.stop_reason);

function saidOf(e: TailEvent): string | null {
  const text = e.summary?.replace(/\s+/g, " ").trim();
  return text && !isPlaceholderLine(text) && !isHarnessNotice(text) ? text.slice(0, 240) : null;
}

/** Claude: a prompt starts a turn; end_turn or turn_duration ends it; an interrupt line stops it. */
function claudeMark(e: TailEvent): Mark {
  const raw = rawOf(e);
  if (e.kind === "system") {
    if (raw?.subtype === "turn_duration") return { kind: "end", took: num(raw.durationMs) };
    if (raw?.subtype === "compact_boundary") return { kind: "compact", manual: record(raw.compactMetadata)?.trigger === "manual" };
    return { kind: "none" };
  }
  if (e.kind === "user") {
    if (isInterrupt(e)) return { kind: "abort" };
    if (isHarnessUserLine(e)) return { kind: "none" };
    return { kind: "start" };
  }
  if (e.kind === "assistant") return ENDS.has(stopReason(e) ?? "") ? { kind: "end", said: saidOf(e) } : { kind: "work", said: saidOf(e) };
  if (e.kind === "tool" || e.kind === "tool-result") return { kind: "work" };
  return { kind: "none" };
}

/** Codex marks its turns: task_started, task_complete (with its last message), turn_aborted. */
function codexMark(e: TailEvent): Mark {
  const raw = rawOf(e);
  const payload = record(raw?.payload);
  const entry = str(raw?.type) ?? "";
  const type = str(payload?.type) ?? "";
  if (type === "task_started" || type === "turn_started") return { kind: "start" };
  if (type === "task_complete" || type === "turn_complete" || type === "turn_completed") {
    return { kind: "end", took: num(payload?.duration_ms), said: str(payload?.last_agent_message)?.replace(/\s+/g, " ").slice(0, 240) ?? null };
  }
  if (type === "turn_aborted") return { kind: "abort" };
  if (entry === "compacted" || type === "context_compacted") return { kind: "compact" };
  if (e.kind === "assistant") return { kind: "work", said: saidOf(e) };
  if (e.kind === "user" || e.kind === "tool" || e.kind === "tool-result") return { kind: "work" };
  return { kind: "none" };
}

/** Antigravity: explicit USER_INPUT starts a turn; registry/attention decides idle and asking. */
function antigravityMark(e: TailEvent): Mark {
  if (e.kind === "user") return isHarnessUserLine(e) ? { kind: "none" } : { kind: "start" };
  if (e.kind === "assistant") return { kind: "work", said: saidOf(e) };
  if (e.kind === "tool" || e.kind === "tool-result") return { kind: "work" };
  return { kind: "none" };
}

type Turn = Pick<SessionRead, "phase" | "since" | "turnStart" | "took" | "said"> & {
  /** The session's newest line of any kind. */
  last: number;
  /** The newest line that started, ended, stopped or compacted the turn. */
  markAt: number;
  /** The newest end or stop. */
  endAt: number;
};

/** A session's turn, from its own lines (oldest first). */
function readTurn(events: readonly TailEvent[]): Turn {
  let phase: Phase | null = null;
  let since = 0;
  let turnStart: number | null = null;
  let took: number | null = null;
  let said: string | null = null;
  let last = 0;
  let markAt = 0;
  let endAt = 0;
  // The operator typed /compact: the next compaction is theirs, between turns.
  let compactAsked = false;
  for (const e of events) {
    last = Math.max(last, e.ts);
    const codex = e.source === "codex";
    const antigravity = e.source === "antigravity";
    if (!codex && !antigravity && e.kind === "user" && isCompactCommand(e)) compactAsked = true;
    const m = codex ? codexMark(e) : antigravity ? antigravityMark(e) : claudeMark(e);
    if (m.kind !== "work" && m.kind !== "none") markAt = Math.max(markAt, e.ts);
    switch (m.kind) {
      case "start":
        compactAsked = false;
        if (phase !== "working" || turnStart === null) {
          phase = "working"; since = e.ts; turnStart = e.ts; took = null; said = null;
        }
        break;
      case "work":
        if (phase === "compact") {
          // Compacted mid-turn: the turn carries on from its start.
          phase = "working"; since = turnStart ?? e.ts;
        } else if (phase === null || (phase !== "working" && !codex)) {
          // A turn whose start is outside the window, or a Claude turn begun without a prompt line.
          phase = "working"; since = e.ts; turnStart = null; took = null; said = null;
        }
        if (m.said) said = m.said;
        break;
      case "end":
        endAt = Math.max(endAt, e.ts);
        if (m.said) said = m.said;
        if (phase === "done") {
          // turn_duration after end_turn: the same end, now with its exact length.
          took = m.took ?? took;
        } else {
          took = m.took ?? (phase === "working" && turnStart !== null ? e.ts - turnStart : null);
          phase = "done"; since = e.ts;
        }
        break;
      case "abort":
        endAt = Math.max(endAt, e.ts);
        // The same stop read twice (pushed, then read again) keeps its first length.
        if (phase === "stopped") break;
        took = phase === "working" && turnStart !== null ? e.ts - turnStart : null;
        phase = "stopped"; since = e.ts;
        break;
      case "compact": {
        // Claude writes its boundary once the compaction is over. Mid-turn, the
        // turn carries on right after it (COMPACT until it writes again); between
        // turns (/compact, or after a turn ended) nothing follows, and the
        // session is as idle as it was.
        const manual = m.manual === true || compactAsked;
        compactAsked = false;
        if (phase === "done" || phase === "stopped") break;
        if (manual) {
          phase = "done"; since = e.ts;
        } else {
          phase = "compact"; since = e.ts;
        }
        break;
      }
    }
  }
  return { phase, since, turnStart, took, said, last, markAt, endAt };
}

const within = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** `claude --resume <id>` (or `-r`, `--session-id`) names the session a process runs. */
const SESSION_ARG = /(?:^|\s)(?:--resume|-r|--session-id)(?:=|\s+)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

/** The session a process was started for, or null when its command does not say. A fork runs a session of its own. */
function namedSession(p: TailDiscoveredProcess): string | null {
  if (/(?:^|\s)--fork-session\b/.test(p.command)) return null;
  return p.command.match(SESSION_ARG)?.[1]?.toLowerCase() ?? null;
}

/**
 * Whether a session's process is still running: true, false, or null when
 * the process table cannot say. Only Claude runs one process per session;
 * one Codex app server holds many threads, so a Codex thread's liveness is
 * not in the table. A process started for a session (`--resume <id>`) is
 * that session's own. Any other Claude process in the same folder, or one
 * above or below it, could be this session's, so it gives no verdict: only
 * a session that no running process could belong to has ended. A scan that
 * found no process of the harness at all reads the same as a failed scan.
 */
function aliveOf(t: TailDiscoveredTranscript | undefined, processes: readonly TailDiscoveredProcess[] | null | undefined): boolean | null {
  if (!t || !processes || t.source !== "claude" || !t.cwd) return null;
  const same = processes.filter((p) => p.source === t.source);
  if (!same.length) return null;
  const id = transcriptId(t).toLowerCase();
  if (same.some((p) => namedSession(p) === id)) return true;
  return same.some((p) => namedSession(p) === null && p.cwd != null && within(p.cwd, t.cwd!)) ? null : false;
}

const transcriptId = (t: TailDiscoveredTranscript) => t.sessionId?.trim() || t.transcriptPath.split("/").at(-1)?.replace(/\.jsonl$/u, "") || "";
const childKey = (id: string) => `agent:${id.replace(/^agent-/, "")}`;

/**
 * Each session's read, by session id.
 *
 *  - The registry status, when the transcript carries one, says what the
 *    session is doing. It was read when discovery ran (`discoveredAt`), so it
 *    knows nothing of a turn that started, ended or stopped after that: then
 *    the session's own lines decide.
 *  - Busy is WORKING since the turn's start, through an ask, and through a
 *    turn the session ended while its subagents or workflow agents run on.
 *    An interrupt or a compaction written after the busy flip still wins:
 *    the registry has no word for either.
 *  - Idle is DONE, except after a stop: an idle session that was stopped
 *    stays STOPPED, since both say nothing runs.
 *  - A waiting status or an ask from herdr reads ASKING.
 *  - A session no running process could belong to reads ENDED.
 */
export function sessionReads(input: {
  events: readonly TailEvent[];
  transcripts?: readonly TailDiscoveredTranscript[] | null;
  processes?: readonly TailDiscoveredProcess[] | null;
  /** When discovery read the registry and the process table (its generatedAt). */
  discoveredAt?: number | null;
}): Map<string, SessionRead> {
  const own = new Map<string, TailEvent[]>();
  const kids = new Map<string, Map<string, { at: number; done: boolean }>>();
  const kid = (parent: string, key: string, at: number, done: boolean) => {
    const m = kids.get(parent) ?? new Map<string, { at: number; done: boolean }>();
    kids.set(parent, m);
    const prev = m.get(key);
    if (!prev || at >= prev.at) m.set(key, { at, done });
  };
  for (const e of [...input.events].sort((a, b) => a.ts - b.ts)) {
    if (isSidechain(e)) {
      kid(e.sessionId, childKey(str(rawOf(e)?.agentId) ?? "?"), e.ts, e.kind === "assistant" && ENDS.has(stopReason(e) ?? ""));
      continue;
    }
    const list = own.get(e.sessionId) ?? [];
    list.push(e);
    own.set(e.sessionId, list);
  }
  const top = new Map<string, TailDiscoveredTranscript>();
  for (const t of input.transcripts ?? []) {
    if (t.parentSessionId) {
      // A child known only from discovery: its newest write, whether it ended unknown.
      const key = childKey(t.subagentId ?? transcriptId(t));
      const at = t.lastEventAt ?? t.mtimeMs;
      const known = kids.get(t.parentSessionId)?.get(key);
      if (!known || at > known.at) kid(t.parentSessionId, key, at, false);
      continue;
    }
    const id = transcriptId(t);
    if (id) top.set(id, t);
  }
  const discoveredAt = input.discoveredAt ?? null;
  const out = new Map<string, SessionRead>();
  for (const id of new Set([...own.keys(), ...top.keys()])) {
    const t = top.get(id);
    const turn = readTurn(own.get(id) ?? []);
    const children = [...(kids.get(id)?.values() ?? [])];
    const ownWrite = Math.max(0, turn.last, t ? t.lastEventAt ?? t.mtimeMs : 0);
    const lastWrite = Math.max(ownWrite, ...children.map((c) => c.at));
    const childWrite = Math.max(0, ...children.filter((c) => !c.done).map((c) => c.at));
    let { phase, since } = turn;
    let ask: string | null = null;
    const statusAt = t?.statusUpdatedAt ?? 0;
    // Without discovery's time, the registry is as new as its own last write.
    const statusRead = discoveredAt ?? statusAt;
    if (statusRead >= turn.markAt && t?.status === "busy") {
      const newerStop = (turn.phase === "stopped" || turn.phase === "compact") && turn.since >= statusAt;
      if (!newerStop) {
        // A busy flip after the newest end is a turn whose prompt has not been read yet.
        const sameTurn = turn.phase === "working" || statusAt <= turn.endAt;
        phase = "working";
        since = (sameTurn ? turn.turnStart : null) ?? (statusAt || turn.since);
      }
    } else if (statusRead >= turn.markAt && t?.status === "idle") {
      if (turn.phase !== "stopped" && turn.phase !== "done") { phase = "done"; since = statusAt || turn.since; }
    }
    const askRead = discoveredAt ?? Math.max(statusAt, t?.attention?.since ?? 0);
    if (askRead >= turn.markAt && (t?.status === "waiting" || t?.attention?.kind === "ask")) {
      phase = "asking";
      since = t.attention?.since ?? (statusAt || lastWrite);
      ask = str(t.attention?.reason) ?? str(t.waitingFor);
    }
    // A line written after the scan is from a live process, whatever the scan said.
    if (aliveOf(t, input.processes) === false && (discoveredAt === null || turn.last <= discoveredAt)) {
      phase = "ended"; since = lastWrite;
    }
    out.set(id, { phase, since, turnStart: turn.turnStart, took: turn.took, said: turn.said, ask, lastWrite, ownWrite, childWrite, title: str(t?.title) });
  }
  return out;
}

/** A row's remark: the word, when that state began, and its now line (null: the row's own). */
export type SessionRemark = { remark: Remark; since: number; now: string | null };

/**
 * The board's word for a session at `now`.
 *
 *  - QUIET is WORKING with nothing written for QUIET_AFTER_MS, since that
 *    last write. A compaction nothing followed for as long reads the same way.
 *  - A turn that ended while its subagents or workflow agents keep writing is
 *    still WORKING, since its start.
 *  - DONE says how long the turn took and what the agent said last in it.
 *  - With no read, a busy lane reads WORKING and other lanes read IDLE;
 *    children still writing keep it WORKING, since its own last write (its
 *    own lines are out of the window, theirs are not).
 */
export function readRemark(read: SessionRead | undefined, fallback: { working: boolean; at: number }, line: LatestLine | undefined, now: number, childAt = 0): SessionRemark {
  const last = line?.last ?? null;
  const children = Math.max(read?.childWrite ?? 0, childAt);
  const childrenRun = children > 0 && now - children < QUIET_AFTER_MS;
  if (!read || read.phase === null) {
    if (fallback.working) return { remark: "WORKING", since: fallback.at, now: last };
    if (childrenRun) return { remark: "WORKING", since: read?.ownWrite || fallback.at, now: last };
    return { remark: "IDLE", since: fallback.at, now: last };
  }
  const working = (since: number): SessionRemark =>
    now - read.lastWrite >= QUIET_AFTER_MS ? { remark: "QUIET", since: read.lastWrite, now: last } : { remark: "WORKING", since, now: last };
  switch (read.phase) {
    case "asking": return { remark: "ASKING", since: read.since, now: read.ask ?? last };
    case "ended": return { remark: "ENDED", since: read.since, now: "The process ended" };
    case "stopped": return { remark: "STOPPED", since: read.since, now: read.took !== null ? `stopped after ${span(read.took)}` : last };
    case "compact":
      if (now - read.since < QUIET_AFTER_MS) return { remark: "COMPACT", since: read.since, now: "Compacting the context" };
      return working(read.turnStart ?? read.since);
    case "done":
      if (childrenRun && children > read.since) return { remark: "WORKING", since: read.turnStart ?? read.since, now: last };
      return {
        remark: "DONE",
        since: read.since,
        now: read.took !== null ? `took ${span(read.took)}${read.said ? ` · ${read.said}` : ""}` : read.said ?? line?.said ?? last,
      };
    case "working":
      return working(read.since);
  }
}

/** The parent a child worker (Claude subagent, Codex spawned thread) reports to. */
const parentOf = (row: SessionBoardRow): string | null => row.lane?.facts?.parentSessionId ?? null;

/** Board rows for sessions the work list and open requests do not already show. */
export function sessionThreads(rows: readonly SessionBoardRow[], work: readonly WorkItem[], now: number, latest: ReadonlyMap<string, LatestLine> = new Map(), reads: ReadonlyMap<string, SessionRead> = new Map()): CornerThread[] {
  const covered = new Set<string>();
  for (const item of work) {
    for (const id of [item.conversationId, item.claudeSessionId, item.codexThreadId]) if (id) covered.add(id);
  }
  // Child workers fold into their parent's row: its activity, not rows of their own.
  const children = new Map<string, { count: number; working: number; at: number; workingAt: number }>();
  for (const row of rows) {
    const parent = parentOf(row);
    if (!parent) continue;
    const c = children.get(parent) ?? { count: 0, working: 0, at: 0, workingAt: 0 };
    const at = row.lastActiveAt ?? 0;
    children.set(parent, {
      count: c.count + 1,
      working: c.working + (row.working ? 1 : 0),
      at: Math.max(c.at, at),
      workingAt: row.working ? Math.max(c.workingAt, at) : c.workingAt,
    });
  }
  const out: CornerThread[] = [];
  for (const row of rows) {
    if (parentOf(row)) continue;
    // An asking session already has its request on the board.
    if (row.asks) continue;
    if (covered.has(row.sessionId) || (row.conversation && covered.has(row.conversation.id))) continue;
    // A Scout-routed row keeps its conversation's address. The lane carries
    // the native id used by the transcript and its child sessions.
    const nativeId = row.lane?.id ?? row.sessionId;
    const kids = children.get(nativeId);
    const read = reads.get(nativeId);
    const at = Math.max(row.lastActiveAt ?? 0, kids?.at ?? 0, read?.lastWrite ?? 0);
    const line = latest.get(nativeId);
    const said = readRemark(read, { working: row.working || Boolean(kids?.working), at }, line, now, kids?.workingAt ?? 0);
    const state = remarkState(said.remark);
    // Nothing written for this long: off the board, from either section. A
    // session killed mid-turn leaves no end line; it would read QUIET for good.
    if (state !== "asking" && now - at > ARRIVED_WINDOW_MS) continue;
    const scoutAgent = row.lane?.source === "scout" ? row.lane.agent : null;
    const project = base(row.project);
    const title = read?.title ?? row.title;
    out.push({
      id: `session:${row.key}`,
      workId: null,
      conversationId: row.conversation?.id ?? null,
      task: title,
      handle: scoutAgent?.name ?? row.harness ?? "session",
      // Its Scout agent, else the native agent the web app draws for this session; never the shared handle.
      identityId: row.lane?.agent.id ?? (row.harness ? nativeAgentId(row.harness, row.sessionId) : null),
      faceName: row.lane?.agent.name ?? (row.harness ? nativeAgentName(row.harness, row.sessionId) : null),
      now: said.now ?? row.preview ?? title,
      state,
      remark: said.remark,
      since: said.since,
      harness: row.harness,
      project,
      branch: row.branch,
      sessionRef: formatSessionRouteRef(row.harness, nativeId),
      pinId: sessionPinId(row.sessionId),
      at,
      request: null,
      facts: [
        ["Harness", row.harness ?? "unknown"],
        ...(project ? [["Project", project] as [string, string]] : []),
        ...(row.branch ? [["Branch", row.branch] as [string, string]] : []),
        ["Started", scoutAgent ? "through Scout" : row.origin.kind === "you" ? "by you" : "natively"],
        ...(kids ? [["Subagents", kids.working ? `${kids.count} · ${kids.working} working` : String(kids.count)] as [string, string]] : []),
      ],
    });
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_SESSION_ROWS);
}


/**
 * What Tap in reads off discovery for each session, by session id: its
 * title, registry status, what it waits for and a declared ask. A child
 * worker's transcript is its parent's activity, not a session of its own;
 * two transcripts under one id keep the newer.
 */
export function sessionTranscripts(transcripts: readonly TailDiscoveredTranscript[] | null | undefined): Map<string, TapInTranscript> {
  const out = new Map<string, TapInTranscript>();
  const seen = new Map<string, number>();
  for (const t of transcripts ?? []) {
    if (t.parentSessionId || t.subagentId) continue;
    const id = transcriptId(t);
    const at = t.lastEventAt ?? t.mtimeMs;
    if (!id || (seen.get(id) ?? -Infinity) > at) continue;
    seen.set(id, at);
    out.set(id, { title: t.title ?? null, status: t.status ?? null, waitingFor: t.waitingFor ?? null, attention: t.attention ?? null });
  }
  return out;
}

/**
 * The machine each session row runs on, by its board row id
 * (`session:<key>`), for Tap in's delivery and Open session. A row on this
 * Mac names none, and none is named until this Mac's node id is known: a
 * guess would read as another machine and refuse the reply.
 */
export function sessionMachines(rows: readonly SessionBoardRow[], localNodeId: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!localNodeId) return out;
  for (const row of rows) {
    const machine = row.selection.machineId ?? row.machine;
    if (machine && machine !== localNodeId) out.set(`session:${row.key}`, machine);
  }
  return out;
}

/**
 * Enrich from exact broker identities, not names. Work owners may no longer be
 * in the bounded live roster: their conversation still carries the target's
 * harness/workspace and session participant. Keep existing row facts, and
 * never borrow a requester's or another channel member's identity.
 */
export function withIdentity(threads: readonly CornerThread[], work: readonly WorkItem[], agents: readonly Agent[], conversations: readonly SessionEntry[] = []): CornerThread[] {
  const workById = new Map(work.map((w) => [w.id, w]));
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const conversationById = new Map(conversations.flatMap((c) => [c.id, ...(c.equivalentConversationIds ?? [])].map((id) => [id, c] as const)));
  return threads.map((t) => {
    const item = t.workId ? workById.get(t.workId) : undefined;
    const actorId = t.request?.agentId ?? item?.ownerId;
    const agent = actorId ? agentById.get(actorId) : undefined;
    const pinnedId = item?.claudeSessionId ?? item?.codexThreadId;
    const pinned = item?.claudeSessionId ? "claude" : item?.codexThreadId ? "codex" : null;
    const conversationId = t.conversationId ?? item?.conversationId;
    const conversation = (conversationId ? conversationById.get(conversationId) : undefined)
      ?? (pinnedId ? conversations.find((c) => c.harnessSessionId === pinnedId && (!pinned || c.harness === pinned)) : undefined);
    const participant = actorId ? conversation?.participants?.find((p) => p.actorId === actorId || p.agentId === actorId || p.sessionId === actorId) : undefined;
    // Top-level conversation metadata belongs to its target, not every member.
    const sessionMatch = t.pinId && [conversation?.sessionId, conversation?.harnessSessionId].some((id) => id && t.pinId === `session:${id}`);
    const target = conversation && ((actorId && conversation.agentId === actorId) || (pinnedId && conversation.harnessSessionId === pinnedId) || sessionMatch) ? conversation : undefined;
    return {
      ...t,
      harness: str(t.harness) ?? pinned ?? str(participant?.harness) ?? str(target?.harness) ?? str(agent?.harness),
      project: str(t.project) ?? base(str(target?.workspaceRoot) ?? str(participant?.workspaceRoot)) ?? str(agent?.project) ?? base(str(agent?.projectRoot) ?? str(agent?.cwd)),
      branch: str(t.branch) ?? str(target?.currentBranch) ?? str(agent?.branch),
    };
  });
}

const PIN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

/** The host pin for a session; null when its id would not pass the host's id check. */
export function sessionPinId(sessionId: string): string | null {
  const id = `session:${sessionId}`;
  return PIN_ID.test(id) ? id : null;
}
