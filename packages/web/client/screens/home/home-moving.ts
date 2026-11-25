import { isAgentBusy } from "../../lib/agent-state.ts";
import type { ObserveCacheEntry } from "../../lib/observe.ts";
import { normalizeTimestampMs } from "../../lib/time.ts";
import type {
  Agent,
  FleetAsk,
  ObserveData,
  TailDiscoveredProcess,
  TailDiscoveredTranscript,
  TailEvent,
} from "../../lib/types.ts";
import {
  buildAgentLanes,
  type AgentLaneHorizonKey,
  isAgentLaneLive,
  observeLastSubstantiveActivityAt,
  shouldPollAgentForLaneObserve,
  type AgentLane,
} from "../ops/agent-lanes-model.ts";
import { plainTextExcerpt } from "../../../shared/plain-excerpt.ts";

export { plainTextExcerpt };

export const HOME_MOVING_WINDOW_MS = 30 * 60_000;
export const HOME_MOVING_HORIZON = "30m" as const;
export const HOME_MOVING_DEFAULT_SORT = "recent" as const;

export type HomeMovingWindowOption = {
  key: AgentLaneHorizonKey;
  label: string;
  windowMs: number;
};

export const HOME_MOVING_WINDOW_OPTIONS: ReadonlyArray<HomeMovingWindowOption> = [
  { key: "5m", label: "5m", windowMs: 5 * 60_000 },
  { key: "30m", label: "30m", windowMs: HOME_MOVING_WINDOW_MS },
  { key: "4h", label: "4h", windowMs: 4 * 60 * 60_000 },
  { key: "24h", label: "24h", windowMs: 24 * 60 * 60_000 },
];

export type HomeMovingSortMode = "recent" | "grouped";
export type HomeMovingBucket = "working" | "native" | "observed";

export type HomeMovingSortable = {
  bucket: HomeMovingBucket;
  id: string;
  lastActivityAt: number;
};

const HOME_MOVING_BUCKET_RANK: Record<HomeMovingBucket, number> = {
  working: 0,
  native: 1,
  observed: 2,
};

export function normalizeHomeMovingWindowKey(value: string | null | undefined): AgentLaneHorizonKey {
  const key = value?.trim();
  return HOME_MOVING_WINDOW_OPTIONS.some((option) => option.key === key)
    ? key as AgentLaneHorizonKey
    : HOME_MOVING_HORIZON;
}

export function homeMovingWindowOption(key: AgentLaneHorizonKey): HomeMovingWindowOption {
  return HOME_MOVING_WINDOW_OPTIONS.find((option) => option.key === key)
    ?? HOME_MOVING_WINDOW_OPTIONS[1]!;
}

export function normalizeHomeMovingSort(value: string | null | undefined): HomeMovingSortMode {
  return value === "grouped" ? "grouped" : HOME_MOVING_DEFAULT_SORT;
}

export function compareHomeMovingItems(
  left: HomeMovingSortable,
  right: HomeMovingSortable,
  mode: HomeMovingSortMode,
): number {
  if (mode === "grouped") {
    const rank = HOME_MOVING_BUCKET_RANK[left.bucket] - HOME_MOVING_BUCKET_RANK[right.bucket];
    if (rank !== 0) return rank;
  }

  const recent = right.lastActivityAt - left.lastActivityAt;
  if (recent !== 0) return recent;

  const rank = HOME_MOVING_BUCKET_RANK[left.bucket] - HOME_MOVING_BUCKET_RANK[right.bucket];
  if (rank !== 0) return rank;

  return left.id.localeCompare(right.id);
}

export type WorkingAgentContext = {
  sessionId: string | null;
  model: string | null;
  contextPct: number | null;
};

export function isFreshHomeMovingTimestamp(
  timestamp: number | null | undefined,
  nowMs: number,
  windowMs = HOME_MOVING_WINDOW_MS,
): boolean {
  const timestampMs = normalizeTimestampMs(timestamp);
  return timestampMs !== null && nowMs - timestampMs <= windowMs;
}

/** Map Scout harness ids to tail `source` labels (e.g. grok-acp/pi → grok). */
export function harnessTailSource(harness: string | null | undefined): string | null {
  const normalized = harness?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "pi" || normalized === "grok-acp" || normalized === "grok") return "grok";
  return normalized;
}

export function isHomeObserveCandidate(
  agent: Agent,
  nowMs: number,
  hasMovingAsk: boolean,
  tailEvents: TailEvent[] = [],
  windowMs = HOME_MOVING_WINDOW_MS,
  horizon: AgentLaneHorizonKey = HOME_MOVING_HORIZON,
): boolean {
  if (hasMovingAsk) return true;
  if (isAgentBusy(agent.state)) return true;
  if (shouldPollAgentForLaneObserve(agent, nowMs, horizon)) return true;
  if (agentHasRecentTailActivity(agent, tailEvents, nowMs, windowMs)) return true;
  return false;
}

function tailEventMatchesAgentHarness(agent: Agent, event: TailEvent): boolean {
  const agentSource = harnessTailSource(agent.harness);
  if (!agentSource) return false;
  return agentSource === event.source?.trim().toLowerCase();
}

export function agentHasRecentTailActivity(
  agent: Agent,
  tailEvents: TailEvent[],
  nowMs: number,
  windowMs = HOME_MOVING_WINDOW_MS,
): boolean {
  const sessionId = agent.harnessSessionId?.trim();
  if (!sessionId) return false;

  const cutoff = nowMs - windowMs;
  return tailEvents.some((event) => {
    const ts = normalizeTimestampMs(event.ts);
    if (ts === null || ts < cutoff) return false;
    if (!tailEventMatchesAgentHarness(agent, event)) return false;
    const eventSessionId = event.sessionId?.trim();
    return Boolean(eventSessionId && eventSessionId === sessionId);
  });
}

export function isHomeAgentMoving(input: {
  agent: Agent;
  observeEntry?: ObserveCacheEntry | null;
  tailEvents: TailEvent[];
  nowMs: number;
  movingAsk?: FleetAsk | null;
  windowMs?: number;
}): boolean {
  const {
    agent,
    observeEntry,
    tailEvents,
    nowMs,
    movingAsk,
    windowMs = HOME_MOVING_WINDOW_MS,
  } = input;

  if (movingAsk) return true;

  const observeData = observeEntry?.data;
  if (isAgentLaneLive(observeData)) return true;

  const observeAt = observeLastSubstantiveActivityAt(observeData);
  if (observeAt !== null && nowMs - observeAt <= windowMs) return true;

  if (agentHasRecentTailActivity(agent, tailEvents, nowMs, windowMs)) return true;

  if (isAgentBusy(agent.state) && isFreshHomeMovingTimestamp(agent.updatedAt, nowMs, windowMs)) {
    return true;
  }

  return false;
}

export function workingContextFromObserve(
  observeData: ObserveData | null | undefined,
  fallback?: { sessionId?: string | null; model?: string | null },
): WorkingAgentContext {
  const session = observeData?.metadata?.session;
  const usage = observeData?.metadata?.usage;
  const contextInput = usage?.contextInputTokens;
  const window = usage?.contextWindowTokens;
  const contextPct = typeof contextInput === "number" && typeof window === "number" && window > 0
    ? Math.min(100, Math.round((contextInput / window) * 100))
    : null;
  return {
    sessionId: session?.externalSessionId ?? fallback?.sessionId ?? null,
    model: session?.model ?? fallback?.model ?? null,
    contextPct,
  };
}

export function workingContextFromLane(lane: AgentLane): WorkingAgentContext {
  return workingContextFromObserve(lane.observe, {
    sessionId: lane.agent.harnessSessionId,
    model: lane.facts?.model ?? lane.agent.model,
  });
}

/** Identity of the underlying harness session an observe payload resolved to. */
export function observedSessionKey(
  entry: Pick<ObserveCacheEntry, "sessionId" | "historyPath" | "data"> | null | undefined,
): string | null {
  if (!entry) return null;
  const sessionId = entry.sessionId?.trim()
    || entry.data?.metadata?.session?.externalSessionId?.trim();
  if (sessionId) return `session:${sessionId}`;
  const historyPath = entry.historyPath?.trim()
    || entry.data?.metadata?.session?.threadPath?.trim();
  if (historyPath) return `history:${historyPath}`;
  return null;
}

export function laneObservedSessionKey(lane: AgentLane): string | null {
  const session = lane.observe?.metadata?.session;
  const sessionId = session?.externalSessionId?.trim();
  if (sessionId) return `session:${sessionId}`;
  const threadPath = session?.threadPath?.trim();
  if (threadPath) return `history:${threadPath}`;
  return null;
}

function agentOwnsObservedSession(
  agent: Agent,
  entry: ObserveCacheEntry | undefined,
): boolean {
  const observed = entry?.sessionId?.trim()
    || entry?.data?.metadata?.session?.externalSessionId?.trim();
  const own = agent.harnessSessionId?.trim();
  return Boolean(observed && own && observed === own);
}

/* Stale agent records in a project all fall back to the same newest discovered
   transcript, so without this they render as N identical rows (same context %,
   same last line). One observed session gets one row: the agent that actually
   owns the session wins, else the caller's order (recency) decides. Agents
   whose observe payload has no session identity pass through untouched. */
export function dedupeWorkingAgentsByObservedSession(
  agents: Agent[],
  observeCache: Record<string, ObserveCacheEntry | undefined>,
): Agent[] {
  const keptIndexByKey = new Map<string, number>();
  const result: Agent[] = [];
  for (const agent of agents) {
    const entry = observeCache[agent.id];
    const key = observedSessionKey(entry);
    if (!key) {
      result.push(agent);
      continue;
    }
    const keptIndex = keptIndexByKey.get(key);
    if (keptIndex === undefined) {
      keptIndexByKey.set(key, result.length);
      result.push(agent);
      continue;
    }
    const kept = result[keptIndex]!;
    if (!agentOwnsObservedSession(kept, observeCache[kept.id]) && agentOwnsObservedSession(agent, entry)) {
      result[keptIndex] = agent;
    }
  }
  return result;
}

export function homeMovingRecencyMs(
  agent: Agent,
  input: {
    observeEntry?: ObserveCacheEntry | null;
    tailEvents: TailEvent[];
    nowMs: number;
    movingAsk?: FleetAsk | null;
  },
): number {
  const { observeEntry, tailEvents, nowMs, movingAsk } = input;
  if (movingAsk) {
    return normalizeTimestampMs(movingAsk.updatedAt) ?? nowMs;
  }
  if (isAgentLaneLive(observeEntry?.data)) return nowMs;
  const observeAt = observeLastSubstantiveActivityAt(observeEntry?.data);
  if (observeAt !== null) return observeAt;
  const sessionId = agent.harnessSessionId?.trim();
  const agentSource = harnessTailSource(agent.harness);
  let latestTail = 0;
  if (sessionId) {
    for (const event of tailEvents) {
      if (agentSource && event.source !== agentSource) continue;
      if (event.sessionId?.trim() !== sessionId) continue;
      const ts = normalizeTimestampMs(event.ts);
      if (ts !== null) latestTail = Math.max(latestTail, ts);
    }
  }
  if (latestTail > 0) return latestTail;
  return normalizeTimestampMs(agent.updatedAt) ?? 0;
}

export const HOME_MOVING_CARD_LIMIT = 9;

export function buildHomeNativeMovingLanes(input: {
  agents: Agent[];
  tailEvents: TailEvent[];
  transcripts: TailDiscoveredTranscript[];
  processes?: TailDiscoveredProcess[];
  observeCache?: Record<string, ObserveCacheEntry | undefined>;
  nowMs: number;
  horizon?: AgentLaneHorizonKey;
}): AgentLane[] {
  const { lanes } = buildAgentLanes({
    transcripts: input.transcripts,
    tailEvents: input.tailEvents,
    processes: input.processes ?? [],
    scoutAgents: input.agents,
    observeCache: input.observeCache ?? {},
    now: input.nowMs,
    workingOnly: true,
    horizon: input.horizon ?? HOME_MOVING_HORIZON,
  });
  return lanes.filter((lane) => lane.source === "native");
}

/* ── Display text ──────────────────────────────────────────────────────
 * Scan lines on Home are one line of plain text. Agent prose arrives as
 * markdown and tool lines arrive as the call that ran them; both are
 * reduced here so the row reads as what happened, not how it was logged. */

function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateExcerpt(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}


/** `/example/<name>/…` → `~/…`, anywhere in a line. */
function tildeHomePaths(text: string): string {
  return text.replace(/(^|[\s'"=(:])\/(?:Users|home)\/[^/\s'"]+(?=\/|\s|$|['")])/g, "$1~");
}

/** Long hex ids (commit shas, digests) to the 7 characters people quote. */
function shortHashes(text: string): string {
  return text.replace(/(?<![\w-])([0-9a-f]{10,64})(?![\w-])/g, (hash: string) =>
    /\d/.test(hash) && /[a-f]/.test(hash) ? hash.slice(0, 7) : hash,
  );
}

/** `mcp__lattices__browser_close` → `browser close`. */
function humanToolName(name: string): string {
  const leaf = name.includes("__") ? name.split("__").filter(Boolean).pop() ?? name : name;
  return leaf.replace(/[_-]+/g, " ").trim();
}

/**
 * A tool line as a person would say it. `bash · text(await tools.mcp__x__y({…}))`
 * is a code-mode call, not a shell command, so it reads as `y`; a leading
 * `cd <dir> &&` is dropped so the verb comes first; home paths are trimmed to
 * `~` and long hashes to 7 characters.
 */
export function humanizeToolLine(line: string): string {
  let text = collapseSpaces(line);
  const call = text.match(/^(?:[\w.-]+\s+·\s+)?(?:text\(\s*)?(?:(?:const|let|var)\s+\w+\s*=\s*)?(?:await\s+)?tools\.([A-Za-z_][\w]*)\s*\(/);
  if (call?.[1] && call[1] !== "exec_command") return humanToolName(call[1]);
  // A direct MCP call names its tool by its wire id: `mcp__lattices__browser_open · url`.
  const mcp = text.match(/^(mcp__[\w-]+)(\s+·\s+[\s\S]*)?$/);
  if (mcp?.[1]) text = `${humanToolName(mcp[1])}${mcp[2] ?? ""}`;
  const shell = text.match(/^(bash|shell|sh|zsh|terminal)\s+·\s+([\s\S]*)$/i);
  if (shell) {
    let cmd = shell[2] ?? "";
    // `cd dir && cmd` / `cd dir; cmd`: the directory is context, the command is the verb.
    for (let guard = 0; guard < 3; guard += 1) {
      const next = cmd.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "");
      if (next === cmd) break;
      cmd = next;
    }
    const phrase = inlineScriptPhrase(cmd);
    if (phrase) return phrase;
    text = `${shell[1]!.toLowerCase()} · ${cmd}`;
  }
  return shortHashes(tildeHomePaths(text));
}

const SCRIPT_LANGUAGES: Array<[RegExp, string]> = [
  [/^(?:uv\s+run\s+)?python[\d.]*$/i, "a Python script"],
  [/^(?:node|bun|deno|tsx)$/i, "a JavaScript snippet"],
  [/^ruby$/i, "a Ruby script"],
  [/^perl$/i, "a Perl script"],
  [/^swift$/i, "a Swift script"],
  [/^osascript$/i, "an AppleScript"],
  [/^(?:ba|z)?sh$/i, "a shell script"],
];

const SCRIPT_FILE = /\.(?:py|js|mjs|cjs|ts|rb|pl|sh|swift|applescript)$/i;

/**
 * A shell step that runs code rather than a command, said plainly. The
 * script body (`python3 - <<'PY' import sys…`, `node -e '…'`) is not
 * something to read on a scan line; which language, or which file, is.
 * `cat > notes.md <<'EOF'` writes a file, so it says that.
 */
function inlineScriptPhrase(cmd: string): string | null {
  const body = cmd.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, "").trim();
  const write = body.match(/^cat\s+>{1,2}\s*(\S+)\s+<<-?\s*['"]?\w+/);
  if (write?.[1]) return `Writing ${pathLeaf(write[1])}`;
  const words = body.split(/\s+/);
  let head = words[0] ?? "";
  let rest = words.slice(1);
  if (/^uv$/i.test(head) && /^run$/i.test(rest[0] ?? "")) {
    head = `uv run ${rest[1] ?? ""}`;
    rest = rest.slice(2);
  }
  const language = SCRIPT_LANGUAGES.find(([pattern]) => pattern.test(head))?.[1];
  if (!language) return null;
  const inline = /<<-?\s*['"]?\w+/.test(body)
    || rest.some((word) => /^-(?:c|e|p|)$/.test(word) || word === "--eval");
  if (inline) return `Running ${language}`;
  const file = rest.find((word) => !word.startsWith("-"));
  if (file && SCRIPT_FILE.test(file.replace(/['"]/g, ""))) return `Running ${pathLeaf(file.replace(/['"]/g, ""))}`;
  return null;
}

function pathLeaf(path: string): string {
  const parts = path.replace(/['"]/g, "").split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

const TOOL_LINE = /^[A-Za-z][\w.-]{0,40}\s+·\s+/;

/** The one scan line a What's moving row shows. */
export function humanizeMovingAction(line: string | null | undefined, max = 160): string {
  const text = collapseSpaces(line ?? "");
  if (!text) return "";
  if (TOOL_LINE.test(text) || /^mcp__/.test(text) || /^(?:text\(\s*)?(?:await\s+)?tools\./.test(text)) {
    return truncateExcerpt(humanizeToolLine(text), max);
  }
  return plainTextExcerpt(text, max);
}
