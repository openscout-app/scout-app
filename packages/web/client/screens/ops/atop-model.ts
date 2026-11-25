/**
 * Runtime (Atop) without React: rows, the summary, sorting, filtering and keys
 * for the page and the Runtime panels (views/modules/runtime-*.tsx).
 *
 * Row identity = one agent: a session's transcript, joined to its process
 * when one runs.
 *
 * CPU, memory, lifetime tokens, model and the last turn come from tail
 * discovery (core: "tail discovery metrics"). Every one of them is optional:
 * a runtime that doesn't report them yet renders `—`, except tokens, model
 * and the last turn, which fall back to the event buffer and say so (a
 * buffered token count is a lower bound, drawn with `≥`). Permission requests
 * are a heuristic (string-matching "permission-mode" in summaries) until the
 * runtime adds a dedicated `permission` event kind.
 */
import { formatClockTimestamp, timeAgoWithSuffix } from "../../lib/time.ts";
import type {
  TailDiscoverySnapshot,
  TailDiscoveredProcess,
  TailDiscoveredTranscript,
  TailEvent,
  TailSessionUsage,
} from "../../lib/types.ts";
import { usageFromClaudeAssistantEvent, usageFromCodexTokenEvent } from "./agent-lanes-model.ts";

/* ── Tunables ── */

export const EVENT_BUFFER_LIMIT = 4_000;
export const RECENT_REPLAY_LIMIT = 500;
export const DISCOVERY_INTERVAL_MS = 5_000;
/** A discovery read that hasn't answered by now is dropped; the table says it's showing the last snapshot. */
export const DISCOVERY_TIMEOUT_MS = 8_000;
export const REPLAY_TIMEOUT_MS = 10_000;
/** How often the runtime's per-session usage is read for the rows on the page. */
export const USAGE_INTERVAL_MS = 15_000;
/** While a large transcript is still being read (a slice per request), read again sooner. */
export const USAGE_CATCH_UP_MS = 5_000;
/** After the usage read fails (a runtime without it), wait this long to try again. */
export const USAGE_RETRY_MS = 60_000;
/** The runtime reads at most this many sessions per usage request. */
export const USAGE_BATCH_LIMIT = 50;

/** The newest user or assistant turn; tool and system events are not turns. */
export type AtopTurn = {
  role: "user" | "assistant";
  /** Null when the runtime reports a turn without a time. */
  at: number | null;
  text: string;
};

/** The runtime's lifetime usage for the rows' sessions, by session id. */
export type AtopUsage = ReadonlyMap<string, TailSessionUsage>;
export const ACTIVE_WINDOW_MS = 5_000;
export const REQ_RATE_WINDOW_MS = 60_000;
export const SUMMARY_SAMPLE_BARS = 24;
export const PEEK_LINE_LIMIT = 40;

/* ── Derived view-model ── */

export type AtopStatus = "tool" | "run" | "idle";

export type AtopRow = {
  key: string;
  /* identity — process + session combined */
  pid: number;
  ppid: number;
  sessionId: string | null;
  transcriptPath: string | null;
  harness: string;
  attribution: TailEvent["harness"];
  project: string;
  cwd: string;
  command: string;
  parentLabel: string;

  /* lifetime */
  procRuntimeSec: number;       // process etime from `ps`, at discovery
  procEtime: string;
  /** How long the process has run, now: etime plus the time since discovery. Null without a process. */
  elapsedSec: number | null;
  sessionStartAt: number | null; // first event seen for this pid in buffer
  sessionRuntimeSec: number;     // lastEventAt - sessionStartAt (capped at procRuntime)

  /* current state */
  status: AtopStatus;
  lastEventAt: number | null;
  lastEventKind: string | null;
  lastSummary: string | null;
  /** The newest user or assistant turn: the runtime's, else the buffer's. */
  lastTurn: AtopTurn | null;

  /* host cost, from discovery (null on runtimes that don't report it) */
  cpuPercent: number | null;
  rssBytes: number | null;

  /* agent activity (counted from the buffer) */
  reqCount: number;       // count of assistant events  → ≈ model invocations
  toolCount: number;      // count of tool-call events
  permCount: number;      // count of permission-mode events (heuristic)
  eventCount: number;

  /* model and tokens: the runtime's when reported, else the buffer's */
  model: string | null;
  /** All input, cached included, for every harness. */
  tokIn: number | null;
  tokOut: number | null;
  cacheReadIn: number | null;
  cacheWriteIn: number | null;
  /**
   * "session": lifetime totals. "partial": the runtime is still reading a
   * large transcript, the totals so far. "buffer": summed from buffered
   * events only. Partial and buffer are lower bounds. Null: none known.
   */
  tokSource: "session" | "partial" | "buffer" | null;
};

export type AtopSummary = {
  total: number;
  running: number; // run | tool
  tooling: number; // tool only
  idle: number;
  harnesses: Array<{ harness: string; count: number }>;
  reqsPerMin: number;
};

type TailAttribution = TailEvent["harness"];

export const ATTRIBUTION_LABEL: Record<TailAttribution, string> = {
  "scout-managed": "scout",
  "hudson-managed": "hudson",
  unattributed: "native",
};

export const STATUS_LABEL: Record<AtopStatus, string> = {
  tool: "working",
  run: "active",
  idle: "idle",
};

/* ── Format helpers ── */

export function commandBasename(command: string): string {
  const head = command.split(/\s+/)[0] ?? "";
  const slashIdx = head.lastIndexOf("/");
  return slashIdx >= 0 ? head.slice(slashIdx + 1) : head;
}

export function shortCommand(command: string, max = 60): string {
  // Strip leading executable path; keep args trimmed.
  const tokens = command.split(/\s+/);
  if (tokens.length === 0) return command;
  tokens[0] = commandBasename(tokens[0]);
  const flat = tokens.join(" ");
  return flat.length <= max ? flat : flat.slice(0, max - 1) + "…";
}

export function parentLabelFromChain(
  chain: { pid: number; command: string }[],
): string {
  for (const ancestor of chain) {
    const base = commandBasename(ancestor.command);
    if (!base) continue;
    if (base === "sh" || base === "zsh" || base === "bash" || base === "login") continue;
    return base;
  }
  return chain[0]?.command ? commandBasename(chain[0].command) : "—";
}

export function parseEtimeSeconds(etime: string): number {
  // ps etime forms: SS, MM:SS, HH:MM:SS, DD-HH:MM:SS
  const m = etime.match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/);
  if (!m) {
    const justSec = etime.match(/^(\d+)$/);
    if (justSec) return Number.parseInt(justSec[1], 10);
    return 0;
  }
  const [, dd, hh, mm, ss] = m;
  let total = Number.parseInt(ss, 10) + Number.parseInt(mm, 10) * 60;
  if (hh) total += Number.parseInt(hh, 10) * 3600;
  if (dd) total += Number.parseInt(dd, 10) * 86400;
  return total;
}

export function formatRuntime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, "0")}`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${h}h${String(m).padStart(2, "0")}`;
  }
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d${String(h).padStart(2, "0")}h`;
}

export function formatRelative(ms: number | null, now: number): string {
  return timeAgoWithSuffix(ms, now) || "—";
}

export function formatTimestamp(ts: number): string {
  return formatClockTimestamp(ts) || "—";
}

export function shortSession(sessionId: string | null): string {
  if (!sessionId) return "—";
  return sessionId.slice(0, 8);
}

export function displayHarness(source: string | null | undefined): string {
  return source?.trim().toLowerCase() || "unknown";
}

function classPart(value: string): string {
  return displayHarness(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

export function harnessChipClass(harness: string): string {
  return `s-atop-chip s-atop-chip--harness s-atop-chip--harness-${classPart(harness)}`;
}

/** The sessions to read usage for: the rows', most recently active first. */
export function usageSessionIds(rows: readonly AtopRow[], limit = USAGE_BATCH_LIMIT): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of [...rows].sort((a, b) => (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0))) {
    if (!row.sessionId || seen.has(row.sessionId)) continue;
    seen.add(row.sessionId);
    ids.push(row.sessionId);
    if (ids.length >= limit) break;
  }
  return ids;
}

/* ── Derive ──
 *
 * One row per agent. Per-pid and per-session stats are folded out of the
 * event buffer in a single pass, so cost is O(events) per derive; each
 * event's token parse is remembered (USAGE_MEMO), so the 1s clock doesn't
 * re-read 4000 raw records.
 *
 * Tokens: the runtime's lifetime totals for the session (its usage read,
 * `AtopUsage`) win. Without them, a Codex session's newest `token_count` is
 * its lifetime total ("session"); a Claude session's buffered assistant
 * messages are summed, each message once ("buffer", a lower bound: older
 * messages left the buffer).
 */

const PERMISSION_HINT = /permission-mode/i;
const TURN_TEXT_LIMIT = 160;

type BufferedTokens = {
  tokIn: number;
  tokOut: number;
  cacheReadIn: number;
  cacheWriteIn: number;
  source: "session" | "buffer";
  at: number;
};

type EventStats = {
  firstEventAt: number;
  lastEventAt: number;
  lastKind: string;
  lastSummary: string;
  lastTurn: AtopTurn | null;
  reqCount: number;
  toolCount: number;
  permCount: number;
  eventCount: number;
  sessionId: string | null;
  model: string | null;
  modelAt: number;
  tokens: BufferedTokens | null;
  /** Claude message ids already counted: a message's usage repeats on each of its content entries. */
  countedMessages: Set<string>;
};

function emptyStats(event: TailEvent, sessionId: string | null): EventStats {
  return {
    firstEventAt: event.ts,
    lastEventAt: event.ts,
    lastKind: event.kind,
    lastSummary: event.summary,
    lastTurn: null,
    reqCount: 0,
    toolCount: 0,
    permCount: 0,
    eventCount: 0,
    sessionId,
    model: null,
    modelAt: Number.NEGATIVE_INFINITY,
    tokens: null,
    countedMessages: new Set(),
  };
}

function isPermissionEvent(event: TailEvent): boolean {
  if (event.kind !== "system") return false;
  return PERMISSION_HINT.test(event.summary);
}

function isRequestEvent(event: TailEvent): boolean {
  // One assistant turn ≈ one model invocation ≈ one billable request.
  return event.kind === "assistant";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Adapters' stand-ins for a turn with no text of its own: a bare `[assistant]`
 * (a message of tool calls only) or `[thinking]` with or without its
 * reasoning (core tail/*-source.ts). Reasoning is not a reply.
 */
const PLACEHOLDER_TURN = /^\[(assistant|thinking|user)\](\s|$)/i;

/** A turn, when the event is one: the operator's words (not harness-only text) or an assistant reply. */
export function turnFromEvent(event: TailEvent): AtopTurn | null {
  if (event.kind === "user") {
    if (event.prompt?.harnessOnly) return null;
    const words = event.prompt?.words || event.summary;
    if (PLACEHOLDER_TURN.test(words.trim())) return null;
    const text = clipTurnText(words);
    return text ? { role: "user", at: event.ts, text } : null;
  }
  if (event.kind === "assistant") {
    if (PLACEHOLDER_TURN.test(event.summary.trim())) return null;
    const text = clipTurnText(event.summary);
    return text ? { role: "assistant", at: event.ts, text } : null;
  }
  return null;
}

function clipTurnText(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= TURN_TEXT_LIMIT ? flat : `${flat.slice(0, TURN_TEXT_LIMIT - 1)}…`;
}

type EventUsage = {
  /** Codex token_count: the session total so far. Claude: this message only. */
  cumulative: boolean;
  messageId: string | null;
  model: string | null;
  tokIn: number;
  tokOut: number;
  cacheReadIn: number;
  cacheWriteIn: number;
};

const USAGE_MEMO = new WeakMap<TailEvent, EventUsage | null>();

/** One event's tokens and model, parsed once per event object. */
export function usageFromEvent(event: TailEvent): EventUsage | null {
  if (USAGE_MEMO.has(event)) return USAGE_MEMO.get(event) ?? null;
  let usage: EventUsage | null = null;
  if (event.source === "claude" && event.kind === "assistant") {
    const parsed = usageFromClaudeAssistantEvent(event);
    const message = record(record(event.raw)?.message);
    if (parsed && (parsed.inputTokens !== undefined || parsed.outputTokens !== undefined)) {
      const totals = normalizeUsage("claude", parsed);
      usage = {
        cumulative: false,
        messageId: typeof message?.id === "string" ? message.id : null,
        model: typeof message?.model === "string" ? message.model : null,
        ...totals,
      };
    }
  } else if (event.source === "codex") {
    const parsed = usageFromCodexTokenEvent(event, undefined, "session");
    if (parsed && (parsed.inputTokens !== undefined || parsed.outputTokens !== undefined)) {
      usage = { cumulative: true, messageId: null, model: null, ...normalizeUsage("codex", parsed) };
    }
  }
  USAGE_MEMO.set(event, usage);
  return usage;
}

/**
 * Totals with "in" meaning all input, for every harness. Claude reports
 * uncached input apart from cache reads and writes; Codex's input already
 * holds its cached part.
 */
export function normalizeUsage(
  source: string,
  usage: HarnessUsage,
): { tokIn: number; tokOut: number; cacheReadIn: number; cacheWriteIn: number } {
  const input = usage.inputTokens ?? 0;
  const cacheReadIn = usage.cacheReadInputTokens ?? 0;
  const cacheWriteIn = usage.cacheCreationInputTokens ?? 0;
  return {
    tokIn: source === "claude" ? input + cacheReadIn + cacheWriteIn : input,
    tokOut: usage.outputTokens ?? 0,
    cacheReadIn,
    cacheWriteIn,
  };
}

/** Usage as one harness event reports it (agent-lanes-model.ts parses it). */
type HarnessUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
};

/** The runtime's lifetime totals, with "in" meaning all input. Its `input` is uncached input for every harness. */
function tokensFromRuntime(usage: TailSessionUsage | undefined): (ReturnType<typeof normalizeUsage> & { source: "session" | "partial" }) | null {
  const tokens = usage?.tokens;
  if (!tokens) return null;
  const cacheReadIn = finite(tokens.cacheRead) ?? 0;
  const cacheWriteIn = finite(tokens.cacheWrite) ?? 0;
  return {
    tokIn: (finite(tokens.input) ?? 0) + cacheReadIn + cacheWriteIn,
    tokOut: finite(tokens.output) ?? 0,
    cacheReadIn,
    cacheWriteIn,
    source: usage!.complete === false ? "partial" : "session",
  };
}

/** The runtime's last turn, cleaned like the buffer's (its adapters' placeholders are not turns). */
function turnFromRuntime(usage: TailSessionUsage | undefined): AtopTurn | null {
  const turn = usage?.lastTurn;
  if (!turn || (turn.kind !== "user" && turn.kind !== "assistant")) return null;
  if (typeof turn.text !== "string" || PLACEHOLDER_TURN.test(turn.text.trim())) return null;
  const text = clipTurnText(turn.text);
  return text ? { role: turn.kind, at: finite(turn.at), text } : null;
}

function foldEvent(stats: EventStats, event: TailEvent): void {
  if (event.ts < stats.firstEventAt) stats.firstEventAt = event.ts;
  if (event.ts >= stats.lastEventAt) {
    stats.lastEventAt = event.ts;
    stats.lastKind = event.kind;
    stats.lastSummary = event.summary;
  }
  stats.eventCount++;
  if (event.kind === "tool") stats.toolCount++;
  if (isRequestEvent(event)) stats.reqCount++;
  if (isPermissionEvent(event)) stats.permCount++;

  const turn = turnFromEvent(event);
  if (turn && (!stats.lastTurn || event.ts >= (stats.lastTurn.at ?? 0))) stats.lastTurn = turn;

  const usage = usageFromEvent(event);
  if (!usage) return;
  if (usage.model && event.ts >= stats.modelAt) {
    stats.model = usage.model;
    stats.modelAt = event.ts;
  }
  if (usage.cumulative) {
    if (!stats.tokens || stats.tokens.source !== "session" || event.ts >= stats.tokens.at) {
      stats.tokens = { ...usage, source: "session", at: event.ts };
    }
    return;
  }
  if (stats.tokens?.source === "session") return;
  if (usage.messageId) {
    if (stats.countedMessages.has(usage.messageId)) return;
    stats.countedMessages.add(usage.messageId);
  }
  const prior = stats.tokens ?? { tokIn: 0, tokOut: 0, cacheReadIn: 0, cacheWriteIn: 0, source: "buffer" as const, at: event.ts };
  stats.tokens = {
    tokIn: prior.tokIn + usage.tokIn,
    tokOut: prior.tokOut + usage.tokOut,
    cacheReadIn: prior.cacheReadIn + usage.cacheReadIn,
    cacheWriteIn: prior.cacheWriteIn + usage.cacheWriteIn,
    source: "buffer",
    at: Math.max(prior.at, event.ts),
  };
}

/** Process age now: `ps` etime at discovery plus the time since. */
export function processElapsedSec(proc: TailDiscoveredProcess, generatedAt: number, now: number): number {
  const since = Math.max(0, Math.floor((now - generatedAt) / 1000));
  return parseEtimeSeconds(proc.etime) + since;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function deriveRows(
  discovery: TailDiscoverySnapshot | null,
  events: TailEvent[],
  now: number,
  usage: AtopUsage = new Map(),
): AtopRow[] {
  if (!discovery) return [];

  const byPid = new Map<number, EventStats>();
  const bySession = new Map<string, EventStats>();
  for (const event of events) {
    let stats = byPid.get(event.pid);
    if (!stats) {
      stats = emptyStats(event, event.sessionId || null);
      byPid.set(event.pid, stats);
    }
    foldEvent(stats, event);
    if (event.sessionId && !stats.sessionId) stats.sessionId = event.sessionId;

    if (event.sessionId) {
      let sessionStats = bySession.get(event.sessionId);
      if (!sessionStats) {
        sessionStats = emptyStats(event, event.sessionId);
        bySession.set(event.sessionId, sessionStats);
      }
      foldEvent(sessionStats, event);
    }
  }

  const processByCwd = new Map<string, TailDiscoveredProcess>();
  for (const proc of discovery.processes) {
    if (!proc.cwd) continue;
    const key = sourceCwdKey(proc.source, proc.cwd);
    const current = processByCwd.get(key);
    if (!current || proc.pid < current.pid) {
      processByCwd.set(key, proc);
    }
  }

  const latestTranscriptKeyByCwd = new Map<string, string>();
  const latestTranscriptMtimeByCwd = new Map<string, number>();
  for (const transcript of discovery.transcripts ?? []) {
    const cwdKey = sourceCwdKey(transcript.source, transcript.cwd);
    const rowKey = rowKeyForTranscript(transcript);
    const currentMtime = latestTranscriptMtimeByCwd.get(cwdKey) ?? Number.NEGATIVE_INFINITY;
    const currentKey = latestTranscriptKeyByCwd.get(cwdKey) ?? "";
    if (transcript.mtimeMs > currentMtime || (transcript.mtimeMs === currentMtime && rowKey > currentKey)) {
      latestTranscriptMtimeByCwd.set(cwdKey, transcript.mtimeMs);
      latestTranscriptKeyByCwd.set(cwdKey, rowKey);
    }
  }

  const usedProcessIds = new Set<number>();

  const buildRow = (
    key: string,
    proc: TailDiscoveredProcess | null,
    stats: EventStats | undefined,
    transcript: TailDiscoveredTranscript | null,
  ): AtopRow => {
    if (proc) {
      usedProcessIds.add(proc.pid);
    }
    let status: AtopStatus = "idle";
    const lastActivityAt = Math.max(stats?.lastEventAt ?? 0, transcript?.mtimeMs ?? 0);
    if (stats) {
      const fresh = now - stats.lastEventAt < ACTIVE_WINDOW_MS;
      if (fresh) status = stats.lastKind === "tool" ? "tool" : "run";
    }
    if (status === "idle" && now - lastActivityAt < 60_000) {
      status = "run";
    }
    const procRuntimeSec = proc ? parseEtimeSeconds(proc.etime) : 0;
    const sessionStartAt = stats?.firstEventAt ?? null;
    const sessionRuntimeSec = stats && stats.firstEventAt < stats.lastEventAt
      ? Math.min(
          Math.max(0, Math.round((stats.lastEventAt - stats.firstEventAt) / 1000)),
          procRuntimeSec || Number.POSITIVE_INFINITY,
        )
      : 0;
    const pid = proc?.pid ?? virtualPidForKey(key);
    const cwd = transcript?.cwd ?? proc?.cwd ?? "";
    const source = transcript?.source ?? proc?.source ?? "";

    const sessionId = transcript?.sessionId ?? stats?.sessionId ?? null;
    const reported = sessionId ? usage.get(sessionId) : undefined;
    // the runtime's lifetime totals win over anything the buffer can count,
    // unless it is still reading and the buffer already counted more
    const runtimeTokens = tokensFromRuntime(reported);
    const bufferTokens = stats?.tokens ?? null;
    const tokens = runtimeTokens && (runtimeTokens.source === "session" || !bufferTokens || runtimeTokens.tokIn + runtimeTokens.tokOut >= bufferTokens.tokIn + bufferTokens.tokOut)
      ? runtimeTokens
      : bufferTokens ?? runtimeTokens;
    // the newer turn wins; the buffer's when the runtime's has no time
    const bufferTurn = stats?.lastTurn ?? null;
    const reportedTurn = turnFromRuntime(reported);
    const lastTurn = reportedTurn && (!bufferTurn || (reportedTurn.at != null && reportedTurn.at >= (bufferTurn.at ?? 0)))
      ? reportedTurn
      : bufferTurn;

    return {
      key,
      pid,
      ppid: proc?.ppid ?? 0,
      sessionId,
      transcriptPath: transcript?.transcriptPath ?? null,
      harness: displayHarness(source),
      attribution: proc?.harness ?? transcript?.harness ?? "unattributed",
      project: transcript?.project?.trim() || (cwd ? basename(cwd) : "(unknown)"),
      cwd,
      command: proc?.command ?? `${transcript?.source ?? "unknown"} transcript`,
      parentLabel: proc?.parentChain?.length ? parentLabelFromChain(proc.parentChain) : proc ? "—" : "transcript",
      procRuntimeSec,
      procEtime: proc?.etime ?? "0",
      elapsedSec: proc ? processElapsedSec(proc, discovery.generatedAt, now) : null,
      sessionStartAt,
      sessionRuntimeSec,
      status,
      lastEventAt: lastActivityAt || null,
      lastEventKind: stats?.lastKind ?? null,
      lastSummary: stats?.lastSummary ?? null,
      lastTurn,
      cpuPercent: finite(proc?.cpuPct),
      // the runtime reports KiB
      rssBytes: finite(proc?.rssKb) == null ? null : proc!.rssKb! * 1024,
      reqCount: stats?.reqCount ?? 0,
      toolCount: stats?.toolCount ?? 0,
      permCount: stats?.permCount ?? 0,
      eventCount: stats?.eventCount ?? 0,
      model: reported?.model?.trim() || stats?.model || null,
      tokIn: tokens?.tokIn ?? null,
      tokOut: tokens?.tokOut ?? null,
      cacheReadIn: tokens?.cacheReadIn ?? null,
      cacheWriteIn: tokens?.cacheWriteIn ?? null,
      tokSource: tokens?.source ?? null,
    };
  };

  const transcriptRows = (discovery.transcripts ?? []).map((transcript) => {
    const key = rowKeyForTranscript(transcript);
    const cwdKey = sourceCwdKey(transcript.source, transcript.cwd);
    const proc = latestTranscriptKeyByCwd.get(cwdKey) === key
      ? processByCwd.get(cwdKey) ?? null
      : null;
    const stats = transcript.sessionId ? bySession.get(transcript.sessionId) : undefined;
    return buildRow(key, proc, stats, transcript);
  });

  const processRows = discovery.processes
    .filter((proc) => !usedProcessIds.has(proc.pid))
    .map((proc) => buildRow(rowKeyForProcess(proc), proc, byPid.get(proc.pid), null));

  return [...transcriptRows, ...processRows];
}

/** Cache reads as a share of all input (tokIn holds cached input too). */
export function cacheHitRate(row: AtopRow): number | null {
  if (row.cacheReadIn == null || row.tokIn == null || row.tokIn === 0) return null;
  return Math.min(1, row.cacheReadIn / row.tokIn);
}

export function fmtCount(n: number | null): string {
  if (n == null) return "—";
  if (n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + "k";
  return String(n);
}

export function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${Math.round(n * 100)}%`;
}

/** `ps` %cpu: one decimal under 10, whole above; can pass 100 on several cores. */
export function fmtCpu(percent: number | null): string {
  if (percent == null) return "—";
  if (percent < 10) return `${percent.toFixed(1)}%`;
  return `${Math.round(percent)}%`;
}

export function fmtBytes(bytes: number | null): string {
  if (bytes == null) return "—";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(mb >= 10 * 1024 ? 0 : 1)} GB`;
}

/** Process age, or `—` without a process. */
export function fmtElapsed(sec: number | null): string {
  return sec == null ? "—" : formatRuntime(sec);
}

function basename(p: string): string {
  if (!p) return "";
  const idx = p.lastIndexOf("/");
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function rowKeyForTranscript(transcript: TailDiscoveredTranscript): string {
  return `session:${transcript.source}:${transcript.sessionId ?? transcript.transcriptPath}`;
}

function rowKeyForProcess(process: TailDiscoveredProcess): string {
  return `process:${process.source}:${process.pid}`;
}

function virtualPidForKey(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return -((hash >>> 0) % 900_000 + 1_000);
}

function sourceCwdKey(source: string, cwd: string | null | undefined): string {
  return `${source}\0${cwd ?? ""}`;
}

export function summarize(rows: AtopRow[], events: TailEvent[], now: number): AtopSummary {
  const cutoff = now - REQ_RATE_WINDOW_MS;
  let reqEvents = 0;
  for (const event of events) {
    if (!isRequestEvent(event)) continue;
    if (event.ts >= cutoff) reqEvents++;
  }
  const summary: AtopSummary = {
    total: rows.length,
    running: 0,
    tooling: 0,
    idle: 0,
    harnesses: [],
    reqsPerMin: reqEvents,
  };
  const harnessCounts = new Map<string, number>();
  for (const row of rows) {
    if (row.status === "tool") {
      summary.tooling++;
      summary.running++;
    } else if (row.status === "run") {
      summary.running++;
    } else {
      summary.idle++;
    }
    harnessCounts.set(row.harness, (harnessCounts.get(row.harness) ?? 0) + 1);
  }
  summary.harnesses = [...harnessCounts.entries()]
    .map(([harness, count]) => ({ harness, count }))
    .sort((a, b) => b.count - a.count || a.harness.localeCompare(b.harness));
  return summary;
}

/* ── Sorting ── */

export type SortKey =
  | "status"
  | "agent"
  | "project"
  | "cpu"
  | "mem"
  | "tokens"
  | "time"
  | "turn";

export const STATUS_RANK: Record<AtopStatus, number> = { tool: 0, run: 1, idle: 2 };

function nullishNum(n: number | null | undefined): number {
  return n == null ? -1 : n;
}

/** Tokens sort by everything the session moved: in plus out. */
export function tokenTotal(row: AtopRow): number | null {
  if (row.tokIn == null && row.tokOut == null) return null;
  return (row.tokIn ?? 0) + (row.tokOut ?? 0);
}

export function compare(a: AtopRow, b: AtopRow, key: SortKey, dir: 1 | -1): number {
  switch (key) {
    case "status":
      return (STATUS_RANK[a.status] - STATUS_RANK[b.status]) * dir;
    case "agent": {
      // Use harness then short session for stable ordering.
      const ha = a.harness.localeCompare(b.harness);
      if (ha !== 0) return ha * dir;
      return (a.sessionId ?? "").localeCompare(b.sessionId ?? "") * dir;
    }
    case "project":
      return a.project.localeCompare(b.project) * dir;
    case "cpu":
      return (nullishNum(a.cpuPercent) - nullishNum(b.cpuPercent)) * dir;
    case "mem":
      return (nullishNum(a.rssBytes) - nullishNum(b.rssBytes)) * dir;
    case "tokens":
      return (nullishNum(tokenTotal(a)) - nullishNum(tokenTotal(b))) * dir;
    case "time":
      return (nullishNum(a.elapsedSec) - nullishNum(b.elapsedSec)) * dir;
    case "turn":
      return (nullishNum(a.lastTurn?.at) - nullishNum(b.lastTurn?.at)) * dir;
  }
}

/** Sort by the chosen column, then by status (unless status is the column), then keep arrival order. */
export function sortRows(rows: readonly AtopRow[], sort: { key: SortKey; dir: 1 | -1 }): AtopRow[] {
  const secondary = sort.key === "status" ? undefined : (a: AtopRow, b: AtopRow) => STATUS_RANK[a.status] - STATUS_RANK[b.status];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const primary = compare(left.row, right.row, sort.key, sort.dir);
      if (primary !== 0) return primary;
      const second = secondary?.(left.row, right.row) ?? 0;
      if (second !== 0) return second;
      return left.index - right.index;
    })
    .map((entry) => entry.row);
}

/* ── Filtering ── */

export type AtopFilter = {
  search: string;
  harness: ReadonlySet<string>;
  status: ReadonlySet<AtopStatus>;
};

/** The filter bar: a harness pill set, a status pill set and the free-text search over pid, project, command, origin, session, transcript, last summary, last turn and model. */
export function filterRows(rows: readonly AtopRow[], filter: AtopFilter): AtopRow[] {
  const q = filter.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.harness.size > 0 && !filter.harness.has(row.harness)) return false;
    if (filter.status.size > 0 && !filter.status.has(row.status)) return false;
    if (!q) return true;
    const attribution = ATTRIBUTION_LABEL[row.attribution];
    const hay = `${row.pid} ${row.project} ${row.command} ${row.harness} ${row.attribution} ${attribution} ${row.sessionId ?? ""} ${row.transcriptPath ?? ""} ${row.lastSummary ?? ""} ${row.lastTurn?.text ?? ""} ${row.model ?? ""}`.toLowerCase();
    return hay.includes(q);
  });
}

/** A panel's fixed scope, before the filter bar: one harness, one status, rows under one of these roots. Empty = all. */
export type AtopScope = { harness?: string; status?: string; roots?: readonly string[] | null };

export function scopeRows(rows: readonly AtopRow[], scope: AtopScope): AtopRow[] {
  return rows.filter(
    (row) =>
      (!scope.harness || row.harness === scope.harness) &&
      (!scope.status || row.status === scope.status) &&
      (!scope.roots || scope.roots.some((root) => underRoot(row.cwd, root))),
  );
}

/** A cwd in a root: the root itself or any folder below it. */
export function underRoot(cwd: string, root: string): boolean {
  if (!cwd || !root) return false;
  const r = root.replace(/\/+$/, "");
  return cwd === r || cwd.startsWith(`${r}/`);
}

/* ── Drawer ── */

/** The six tools a row called most, by the first word of each tool event's summary. */
export function toolHistogram(events: readonly TailEvent[]): Array<{ name: string; count: number; frac: number }> {
  const hist: Record<string, number> = {};
  for (const event of events) {
    if (event.kind !== "tool") continue;
    const match = event.summary.match(/^([a-z_][a-z0-9_]*)/i);
    const name = match ? match[1] : "(tool)";
    hist[name] = (hist[name] ?? 0) + 1;
  }
  const entries = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return entries.map(([name, count]) => ({ name, count, frac: count / max }));
}

/** The last PEEK_LINE_LIMIT events of one row: its session's, else its pid's. */
export function rowEvents(events: readonly TailEvent[], row: AtopRow): TailEvent[] {
  return events
    .filter((event) => row.sessionId ? event.sessionId === row.sessionId : event.pid === row.pid)
    .slice(-PEEK_LINE_LIMIT);
}

/* ── Keys ── */

export type AtopKeyAction = "down" | "up" | "close" | "filter" | "hold" | null;

/**
 * The table's keys: j/k or the arrows move the selection, Esc closes the
 * open row, "/" focuses the filter, Enter on a selection is held (nothing
 * else answers it). None with Cmd, Ctrl, Alt or Shift: those move and size
 * panels, and belong to the app.
 *
 * `page`: the table is the whole page (Ops › Runtime drawn full, or the
 * embed); it answers anywhere but a field, as it always did. Otherwise it is
 * a panel: it answers while focus is `inside` it, and on its own Runtime
 * route (`own`) also while nothing has focus (`idle`). Esc closes from a
 * field too, where the field is the panel's own.
 */
export function atopKeyAction(input: {
  key: string;
  inField: boolean;
  /** Focus is on a control (a button, link or select: the panel head's, a filter pill, the drawer's close), which owns its Enter. */
  onControl?: boolean;
  modified: boolean;
  hasSelection: boolean;
  page: boolean;
  inside: boolean;
  idle: boolean;
  own: boolean;
}): AtopKeyAction {
  if (input.modified) return null;
  if (!input.page && !input.inside && !(input.own && input.idle)) return null;
  if (input.key === "Escape") return input.hasSelection ? "close" : null;
  if (input.inField) return null;
  if (input.key === "/") return "filter";
  if (input.key === "j" || input.key === "ArrowDown") return "down";
  if (input.key === "k" || input.key === "ArrowUp") return "up";
  if (input.key === "Enter" && input.hasSelection && !input.onControl) return "hold";
  return null;
}

/** The next selected key after a move: the first row when nothing is selected. */
export function moveSelection(rows: readonly AtopRow[], selectedKey: string | null, dir: "down" | "up"): string | null {
  if (rows.length === 0) return selectedKey;
  const idx = rows.findIndex((row) => row.key === selectedKey);
  const next = dir === "down"
    ? rows[Math.min(rows.length - 1, idx < 0 ? 0 : idx + 1)]
    : rows[Math.max(0, idx < 0 ? 0 : idx - 1)];
  return next?.key ?? selectedKey;
}

/* ── Feed ── */

/**
 * The buffer plus newer arrivals, one copy per event id, oldest first, the
 * newest `limit` kept. The recent-tail replay and the live stream overlap
 * (the runtime's backlog frames repeat recent events), so neither may simply
 * replace or append to the other.
 */
export function mergeEvents(buffer: readonly TailEvent[], incoming: readonly TailEvent[], limit = EVENT_BUFFER_LIMIT): TailEvent[] {
  if (incoming.length === 0) return buffer.length > limit ? buffer.slice(buffer.length - limit) : buffer as TailEvent[];
  const seen = new Set<string>();
  const merged: TailEvent[] = [];
  let ordered = true;
  for (const event of [...buffer, ...incoming]) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    if (merged.length > 0 && event.ts < merged[merged.length - 1].ts) ordered = false;
    merged.push(event);
  }
  if (!ordered) {
    // stable: same-ms events keep arrival order
    merged.sort((a, b) => a.ts - b.ts);
  }
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

export type AtopFreshness = {
  /** When the runtime made the snapshot on screen. */
  generatedAt: number | null;
  /** The last discovery read failed or timed out. */
  failed: boolean;
};

/**
 * A snapshot older than this reads as stale, even with no error. The runtime
 * refreshes its process list about once a minute (core tail/service.ts, hot
 * discovery) and serves the cached list between runs, so a minute-old
 * snapshot is normal; several missed runs are not.
 */
export const STALE_SNAPSHOT_MS = 3 * 60_000;

/**
 * What the empty table says. Before the first snapshot there is nothing to
 * count, so it says it is loading rather than that no agents match.
 */
export function atopEmpty(freshness: AtopFreshness, filtering: boolean): { title: string; body?: string } {
  if (freshness.generatedAt == null) {
    return { title: freshness.failed ? "Couldn't reach the runtime" : "Loading agents" };
  }
  if (filtering) return { title: "No agents match", body: "Change the filters." };
  return { title: "No agents running" };
}

/**
 * The table's one line about its data. `message` says what's wrong, if
 * anything, and holds still (it is announced); `age` ticks with the clock.
 */
export function freshnessLine(
  freshness: AtopFreshness,
  now: number,
): { message: string | null; age: string | null; stale: boolean } {
  const { generatedAt, failed } = freshness;
  if (generatedAt == null) {
    return failed
      ? { message: "Couldn't reach the runtime.", age: null, stale: true }
      : { message: null, age: "Reading the runtime…", stale: false };
  }
  const elapsed = Math.max(0, now - generatedAt);
  const ago = elapsed < 2_000 ? "just now" : `${formatAge(elapsed)} ago`;
  if (failed) return { message: "Couldn't reach the runtime. Showing the last snapshot.", age: `Process list from ${ago}`, stale: true };
  if (elapsed > STALE_SNAPSHOT_MS) {
    return { message: "The runtime hasn't sent a newer process list.", age: `Updated ${ago}`, stale: true };
  }
  return { message: null, age: `Process list updated ${ago}`, stale: false };
}

function formatAge(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}
