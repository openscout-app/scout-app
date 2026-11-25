import { foldAskEchoes } from "../../lib/activity-echoes.ts";
import type { Agent, FleetActivity, FleetAsk, FleetState, Route, TailEvent } from "../../lib/types.ts";
import { compareTimestampsDesc, normalizeTimestampMs, timeAgo } from "../../lib/time.ts";

/*
 * What Home works out from its reads, without React: the coordination
 * window, the stream's rows and shape, the velocity curve, the moving asks
 * and actors, and the cockpit's sync line. HomeContent (basic web, the Mac
 * app's /embed/home) and the Home panels on a view (screens/views/modules/
 * home-*.tsx) draw from the same rules. Pure, so they test on their own
 * (home-derive.test.ts).
 */

export type LookbackOption = { label: string; value: number; activityLimit: number };

/** The coordination windows, narrowest first, each with the fleet's activity cap. */
export const LOOKBACK_WINDOWS: readonly LookbackOption[] = [
  { label: "30m", value: 30 * 60_000, activityLimit: 80 },
  { label: "6h", value: 6 * 60 * 60_000, activityLimit: 250 },
  { label: "24h", value: 24 * 60 * 60_000, activityLimit: 800 },
];
export const DEFAULT_LOOKBACK_MS = LOOKBACK_WINDOWS[2]!.value;

/** Same actor, same line, this close together: one event logged twice. */
export const ACTIVITY_ECHO_WINDOW_MS = 60_000;
/** Rows the coordination stream draws before it says how many more there are. */
export const COORD_ROW_LIMIT = 30;
/** Fewer events than this in the velocity window and the curve says nothing. */
export const HEARTRATE_COMBINED_EVENT_THRESHOLD = 3;

export type HeartrateBucket = { ts: number; count: number; value: number };
export type HeartrateReading = { windowLabel: string; bucketLabel?: string; buckets: HeartrateBucket[] };

export function lookbackOptionFor(ms: number): LookbackOption {
  return LOOKBACK_WINDOWS.find((option) => option.value === ms) ?? LOOKBACK_WINDOWS[LOOKBACK_WINDOWS.length - 1]!;
}

export function nextLookbackOption(ms: number): LookbackOption | null {
  const index = LOOKBACK_WINDOWS.findIndex((option) => option.value === ms);
  return index >= 0 && index < LOOKBACK_WINDOWS.length - 1 ? LOOKBACK_WINDOWS[index + 1]! : null;
}

/** Where the auto window starts: the last settled one when it is a known window, else the narrowest. */
export function rememberedLookback(remembered: number | undefined): number {
  return LOOKBACK_WINDOWS.some((option) => option.value === remembered) ? remembered! : LOOKBACK_WINDOWS[0]!.value;
}

/** The /api/fleet query for a window. A warm peek must use the same bytes as the read. */
export function fleetQueryFor(option: LookbackOption): string {
  return new URLSearchParams({
    activityLookbackMs: String(option.value),
    activityLimit: String(option.activityLimit),
  }).toString();
}

/** The /api/tail/recent query Home reads the local tail with: the shared recent replay. */
export { tailRecentQuery } from "../../lib/tail-recent-replay.ts";

export function formatAge(timestamp: number | null | undefined, nowMs: number): string {
  const timestampMs = normalizeTimestampMs(timestamp);
  if (timestampMs === null) return "—";
  const seconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const ACTIVITY_VERBS: Record<string, string> = {
  handoff_sent: "handed off",
  handoff_received: "received handoff",
  ask_sent: "asked",
  ask_opened: "asked",
  ask_working: "working",
  invocation_recorded: "asked",
  agent_message: "said",
  message_posted: "said",
  message_sent: "said",
  message_received: "received",
  status_message: "status",
  flight_started: "started",
  flight_completed: "finished",
};

/**
 * The verb a coordination row carries. A kind with no plain word (the
 * generic `collaboration_event`, or one the runtime adds later) says nothing
 * rather than its storage name.
 */
export function activityVerb(kind: string): string {
  return ACTIVITY_VERBS[kind] ?? "";
}

/**
 * Which of a set of echoed rows to keep: the one whose kind reads best.
 * Lower is better; the generic collaboration record comes last.
 */
function activityKindRank(kind: string): number {
  switch (kind) {
    case "agent_message":
    case "message_posted":
    case "message_sent":
    case "status_message":
    case "handoff_sent":
      return 0;
    case "ask_opened":
    case "ask_sent":
    case "ask_working":
      return 1;
    case "invocation_recorded":
      return 2;
    case "collaboration_event":
      return 4;
    default:
      return 3;
  }
}

/** Long request ids in coordination copy (`inv-request-<64 hex>`) to a short handle. */
export function scrubActivityIds(text: string): string {
  return text.replace(/\b(inv-request|inv|flt|req)-([0-9a-f]{12,})\b/gi, (_match, prefix: string, hex: string) => `${prefix}-${hex.slice(0, 7)}`);
}

/**
 * What a coordination row says, as a person reads it: the routing tags a
 * message can open with ("[ask:ask-df320e07-…]", "[answered]") are dropped,
 * and long request ids are shortened.
 */
export function activityLine(item: Pick<FleetActivity, "title" | "summary">): string {
  return scrubActivityIds((item.title ?? item.summary ?? "").replace(/^\s*(?:\[[a-z_-]+(?::[^\]]+)?\]\s*)+/i, "")).trim();
}

/** Where a coordination row opens: its conversation, else its work item, else its agent. */
export function fleetActivityRoute(item: FleetActivity): Route | null {
  if (item.conversationId) return { view: "conversation", conversationId: item.conversationId };
  if (item.recordId) return { view: "work", workId: item.recordId };
  if (item.agentId) return { view: "agents-v2", agentId: item.agentId };
  return null;
}

export function formatLookback(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export type ActivityShape = { count: number; lastAgoMs: number; longestGapMs: number };

export function computeActivityShape(items: FleetActivity[], lookbackMs: number, nowMs: number): ActivityShape | null {
  if (items.length === 0) return null;
  const stamps = items
    .map((it) => normalizeTimestampMs(it.ts))
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a);
  if (stamps.length === 0) return null;
  const newest = stamps[0]!;
  const oldest = stamps[stamps.length - 1]!;
  let longestGap = 0;
  for (let i = 1; i < stamps.length; i++) {
    longestGap = Math.max(longestGap, stamps[i - 1]! - stamps[i]!);
  }
  // Trailing silence: from window start to oldest visible event.
  const windowStart = nowMs - lookbackMs;
  longestGap = Math.max(longestGap, oldest - windowStart);
  return {
    count: items.length,
    lastAgoMs: Math.max(0, nowMs - newest),
    longestGapMs: Math.max(0, longestGap),
  };
}

export function smoothHeartrateCounts(counts: number[]): number[] {
  const energy = counts.map((count) => Math.sqrt(count));
  const weights = [0.56, 0.28, 0.11, 0.05];

  return energy.map((_, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -3; offset <= 3; offset++) {
      const nextIndex = index + offset;
      if (nextIndex < 0 || nextIndex >= energy.length) continue;
      const weight = weights[Math.abs(offset)] ?? 0;
      total += energy[nextIndex]! * weight;
      weightTotal += weight;
    }
    return weightTotal > 0 ? total / weightTotal : 0;
  });
}

/** The broker's velocity buckets with the local tail's events counted in, smoothed and scaled to the peak. */
export function combineHeartrateWithTailEvents(
  heartrate: HeartrateBucket[],
  tailEvents: TailEvent[],
  nowMs: number,
): HeartrateBucket[] {
  if (heartrate.length < 2 || tailEvents.length === 0) return heartrate;

  const bucketMs = Math.max(1, heartrate[1]!.ts - heartrate[0]!.ts);
  const startMs = heartrate[0]!.ts;
  const endMs = heartrate[heartrate.length - 1]!.ts + bucketMs;
  const counts = heartrate.map((bucket) => bucket.count);

  for (const event of tailEvents) {
    const eventTs = normalizeTimestampMs(event.ts);
    if (eventTs === null || eventTs < startMs || eventTs > nowMs || eventTs >= endMs) {
      continue;
    }
    const index = Math.floor((eventTs - startMs) / bucketMs);
    if (index >= 0 && index < counts.length) {
      counts[index] = (counts[index] ?? 0) + 1;
    }
  }

  const smoothed = smoothHeartrateCounts(counts);
  const peak = Math.max(1, ...smoothed);
  return heartrate.map((bucket, index) => ({
    ...bucket,
    count: counts[index] ?? bucket.count,
    value: (smoothed[index] ?? 0) / peak,
  }));
}

export function heartrateTotal(buckets: HeartrateBucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.count, 0);
}

const HIDDEN_TURN_VERDICTS = new Set([
  "ask_failed",
  "ask_replied",
  "flight.completed",
  "flight.updated",
  "flight_updated",
]);

/**
 * The coordination stream: the window's activity, harness verdicts left out,
 * machine echoes collapsed. The firehose logs some events twice with identical
 * copy but different kinds (`agent message` then `invocation recorded`, `ask
 * opened` then `invocation recorded`), not always adjacent and not always
 * within the same second. Two rows are one when they would read the same,
 * same actor and same line, within a minute. The row keeps the first one's
 * place in the feed and the kind that reads best, so the generic collaboration
 * record never stands in for the message it echoes.
 */
export function liveActivityFrom(activity: readonly FleetActivity[] | undefined, sinceMs: number): FleetActivity[] {
  // One ask is one row: its work item and request message fold into the invocation.
  const items = foldAskEchoes(activity ?? []).filter((item) =>
    !HIDDEN_TURN_VERDICTS.has(item.kind)
    && (normalizeTimestampMs(item.ts) ?? 0) >= sinceMs,
  );
  const kept: FleetActivity[] = [];
  const keptAt = new Map<string, { ts: number; index: number }>();
  for (const item of items) {
    const key = `${item.actorName ?? ""}\u0000${item.title ?? item.summary ?? ""}`;
    const ts = normalizeTimestampMs(item.ts) ?? 0;
    const prior = keptAt.get(key);
    if (prior !== undefined && Math.abs(prior.ts - ts) <= ACTIVITY_ECHO_WINDOW_MS) {
      // An echo keeps the first row's place but the kind that reads best.
      if (activityKindRank(item.kind) < activityKindRank(kept[prior.index].kind)) kept[prior.index] = item;
      continue;
    }
    keptAt.set(key, { ts, index: kept.length });
    kept.push(item);
  }
  return kept;
}

/** The newest row's window, once the auto window has settled: the narrowest that holds it. */
export function settledLookbackFor(input: {
  pick: number | null;
  widening: boolean;
  answered: boolean;
  liveActivity: readonly FleetActivity[];
  nowMs: number;
  auto: number;
}): number | null {
  if (input.pick !== null || input.widening || !input.answered) return null;
  const newest = input.liveActivity.reduce((max, item) => Math.max(max, normalizeTimestampMs(item.ts) ?? 0), 0);
  if (newest <= 0) return input.auto;
  return LOOKBACK_WINDOWS.find((option) => input.nowMs - newest <= option.value)?.value ?? input.auto;
}

/**
 * The id a name was made from, when the broker title-cased a generated id
 * into it ("Session Muctndv7 L3xnop" from `session-muctndv7-l3xnop`, "Project
 * Woolf 38" from `project-woolf-38`): that id, shown as it is, instead of an
 * invented name. Null for a name someone chose. Only ids with a digit count,
 * so `scout` → "Scout" stays a name. Each id is also tried up to its first
 * dot (`session-x.dev-host` → `session-x`), as the broker names actors.
 */
export function generatedNameSource(name: string | null | undefined, ids: readonly (string | null | undefined)[]): string | null {
  const shown = name?.trim();
  if (!shown) return null;
  for (const id of ids) {
    const full = id?.trim();
    if (!full) continue;
    for (const candidate of new Set([full.split(".")[0]!, full])) {
      if (/\d/.test(candidate) && candidate !== shown && titleCasedId(candidate) === shown) return candidate;
    }
  }
  return null;
}

function titleCasedId(value: string): string {
  return value
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

/** Asks still out (queued or working). */
export function movingAsksFrom(fleet: FleetState | null): FleetAsk[] {
  return (fleet?.activeAsks ?? []).filter((ask) => ask.status === "queued" || ask.status === "working");
}

/** Each agent's latest ask. */
export function latestAskByAgent(asks: readonly FleetAsk[]): Map<string, FleetAsk> {
  const byAgent = new Map<string, FleetAsk>();
  for (const ask of asks) {
    const current = byAgent.get(ask.agentId);
    const askUpdatedAt = normalizeTimestampMs(ask.updatedAt) ?? 0;
    const currentUpdatedAt = normalizeTimestampMs(current?.updatedAt) ?? 0;
    if (!current || askUpdatedAt > currentUpdatedAt) byAgent.set(ask.agentId, ask);
  }
  return byAgent;
}

const OBSERVED_ACTOR_KINDS = new Set([
  "agent_message",
  "status_message",
  "ask_opened",
  "ask_working",
  "handoff_sent",
  "collaboration_event",
]);

/**
 * Native and unmanaged actors seen in the activity firehose inside the
 * moving window, one row each (their latest). Anything Scout already tracks
 * as an agent is left out (it draws as a working row), and so is the operator.
 */
export function observedMovingActorsFrom(input: {
  activity: readonly FleetActivity[] | undefined;
  agents: readonly Agent[];
  operatorName: string;
  cutoffMs: number;
}): FleetActivity[] {
  const managedNames = new Set(input.agents.map((a) => a.name.toLowerCase()));
  const managedIds = new Set(input.agents.map((a) => a.id));
  const operator = input.operatorName.toLowerCase();
  const byActor = new Map<string, FleetActivity>();
  for (const item of input.activity ?? []) {
    const itemTs = normalizeTimestampMs(item.ts);
    if (itemTs === null || itemTs < input.cutoffMs) continue;
    if (!OBSERVED_ACTOR_KINDS.has(item.kind)) continue;
    const name = item.actorName?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (key === operator || managedNames.has(key)) continue;
    if (item.agentId && managedIds.has(item.agentId)) continue;
    const current = byActor.get(key);
    const currentTs = normalizeTimestampMs(current?.ts) ?? 0;
    if (!current || itemTs > currentTs) byActor.set(key, item);
  }
  return [...byActor.values()].sort((a, b) => compareTimestampsDesc(a.ts, b.ts));
}

/** "3", or "9 of 14" when the panel draws fewer rows than there are. */
export function movingCountLabel(shown: number, total: number): string {
  return total > shown && shown > 0 ? `${shown} of ${total}` : `${total}`;
}

export function friendlySyncError(message: string): string {
  return /failed to fetch|networkerror|load failed|couldn't connect|connection refused/i.test(message)
    ? "Scout server is unreachable"
    : message;
}

export function isOfflineSyncError(message: string | null): boolean {
  return message === "Scout server is unreachable";
}

export function settledError(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === "fulfilled") return null;
  return friendlySyncError(result.reason instanceof Error ? result.reason.message : String(result.reason));
}

/** The cockpit's sync line: loading, refreshing, offline or a sync issue (since when), or when it last landed. */
export function syncLabelFor(
  state: { loading: boolean; refreshing: boolean; error: string | null; lastLoadedAt: number | null },
  nowMs: number,
): string {
  if (state.loading) return "Loading Scout…";
  if (state.refreshing) return "Refreshing…";
  if (state.error) {
    return `${isOfflineSyncError(state.error) ? "offline" : "sync issue"} · ${state.lastLoadedAt ? timeAgo(state.lastLoadedAt, nowMs) : "waiting"}`;
  }
  return state.lastLoadedAt ? `Last updated ${timeAgo(state.lastLoadedAt, nowMs)}` : "waiting";
}

export function syncToneFor(state: { loading: boolean; refreshing: boolean; error: string | null }): "pending" | "err" | "ok" {
  return state.loading || state.refreshing ? "pending" : state.error ? "err" : "ok";
}

/** The name the cockpit wears: the operator's, else the suggestion, else "operator". */
export function operatorNameFrom(onboarding: { operatorName?: string | null; operatorNameSuggestion?: string | null } | null | undefined): string {
  return onboarding?.operatorName?.trim() || onboarding?.operatorNameSuggestion?.trim() || "operator";
}

/**
 * The machines the roster runs on, for a Home panel's Machine scope: each
 * agent's authority and home node, the two ids the page's ?machineId= narrows
 * Home by (lib/machine-scope.ts). Named where a node says its name, by label.
 */
export function homeMachineOptions(agents: readonly Agent[]): { value: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const agent of agents) {
    const nodes: Array<[string | null | undefined, string | null | undefined]> = [
      [agent.authorityNodeId, agent.authorityNodeName],
      [agent.homeNodeId, agent.homeNodeName],
    ];
    for (const [id, name] of nodes) {
      const value = id?.trim();
      if (!value) continue;
      const label = name?.trim();
      // a later agent that names the node wins over one that did not
      if (!byId.has(value) || (label && byId.get(value) === value)) byId.set(value, label || value);
    }
  }
  return [...byId]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}
