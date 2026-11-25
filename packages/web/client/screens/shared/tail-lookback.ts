/**
 * Look back — older tail history on request.
 *
 * A tail opens on what its first load read. Looking back only helps where a
 * later read can reach something that load could not:
 *
 * - A first load from the live buffer alone (/ops/tail, unfiltered issues)
 *   never read harness transcripts. There the line offers 1h · 6h · 24h, each a
 *   `/api/tail/recent` read with `windowMs` and transcript replay; past the
 *   broker's 24h cap, "Older" raises `limit` instead.
 * - A first load that already read transcripts (a scoped session, an embedded
 *   tail, a filtered one) gains nothing from a window: the broker takes the
 *   newest `limit` lines and only then applies the window. Only more lines
 *   help, so the ladder is "Earlier" at 2,000, then 5,000. An empty first load
 *   of this kind has nothing older to find, and offers nothing.
 *
 * Every read is checked against what the view already held. One that reaches
 * no further back ends a line-count ladder with "Nothing earlier." The broker
 * drops noise lines after applying `limit`, so a first load that returned
 * fewer rows than it asked for can still have older rows; that one check is
 * the only reliable stop.
 *
 * Kept free of React so bun tests can import it; the hook and the line live
 * in tail-lookback.tsx.
 */

import { dedupeTailEvents, tailEventKey } from "../../lib/tail-event-merge.ts";
import type { TailEvent } from "../../lib/types.ts";

const HOUR_MS = 60 * 60 * 1000;

/** The broker's ceiling for `windowMs` on `/api/tail/recent` (stream.ts, broker-repo-tail-service.ts). */
export const TAIL_LOOKBACK_WINDOW_CAP_MS = 24 * HOUR_MS;

/** Lines asked for with a window step: four times the first load's 500. */
export const TAIL_LOOKBACK_WINDOW_LIMIT = 2_000;

const WINDOW_STEPS_MS = [HOUR_MS, 6 * HOUR_MS, TAIL_LOOKBACK_WINDOW_CAP_MS] as const;
const OLDER_LIMITS = [2_000, 5_000, 10_000] as const;

export type TailLookbackStep =
  | { kind: "window"; windowMs: number }
  | { kind: "older"; limit: number };

/** What the tail's first load read, which decides what a later read can add. */
export type TailLookbackOrigin = {
  /** Lines it asked for. */
  limit: number;
  /** It already read harness transcripts: a scoped session, or `transcripts=true`. */
  transcripts: boolean;
  /** Rows it returned. */
  count: number;
};

/** What the last step found, measured against what the view held before it. */
export type TailLookbackOutcome = {
  step: TailLookbackStep;
  /** Rows the read returned. */
  count: number;
  /** Rows the view did not hold before, and still holds after the merge. */
  added: number;
  /** Whether the oldest row held is now older than before. */
  movedBack: boolean;
};

/** "1h", "6h", "24h"; minutes under an hour. */
export function formatLookbackWindow(windowMs: number): string {
  if (windowMs >= HOUR_MS && windowMs % HOUR_MS === 0) return `${windowMs / HOUR_MS}h`;
  return `${Math.max(1, Math.round(windowMs / 60_000))}m`;
}

export function tailLookbackStepLabel(step: TailLookbackStep): string {
  return step.kind === "window" ? formatLookbackWindow(step.windowMs) : "Older";
}

/** Spoken form for a button's accessible name. */
export function tailLookbackStepTitle(step: TailLookbackStep): string {
  if (step.kind === "older") return `Look back ${step.limit.toLocaleString("en-US")} lines`;
  const hours = step.windowMs / HOUR_MS;
  return Number.isInteger(hours)
    ? `Look back ${hours} hour${hours === 1 ? "" : "s"}`
    : `Look back ${formatLookbackWindow(step.windowMs)}`;
}

function stepLimit(step: TailLookbackStep): number {
  return step.kind === "older" ? step.limit : TAIL_LOOKBACK_WINDOW_LIMIT;
}

/**
 * The steps still worth offering. None before the first load lands, and none
 * once the view's buffer is full (an older row would be trimmed straight away).
 * A count beyond `bufferLimit` would be trimmed too, so it ends the ladder.
 *
 * A read that came back short or empty proves nothing: the broker drops noise
 * (token counts, heartbeats) after it applies the limit, so 500 lines of noise
 * hide an answer that 2,000 lines reach. The ladder runs to its largest read.
 *
 * Windows (live-only origin): a wider window after one that came back full
 * returns the same newest rows, so a full window goes straight to Older. Once
 * transcripts are held, a window that does not reach past the oldest row adds
 * nothing either.
 */
export function nextTailLookbackSteps(input: {
  origin: TailLookbackOrigin | null;
  last: TailLookbackOutcome | null;
  bufferLimit: number;
  /** Rows the view holds now. */
  held: number;
  oldestHeldTs: number | null;
  now?: number;
}): TailLookbackStep[] {
  const { origin, last, bufferLimit, held, oldestHeldTs } = input;
  if (!origin || held >= bufferLimit) return [];

  const reachedLimit = last ? stepLimit(last.step) : origin.limit;
  const older = OLDER_LIMITS.find((limit) => limit > reachedLimit && limit <= bufferLimit);
  const olderSteps: TailLookbackStep[] = older ? [{ kind: "older", limit: older }] : [];

  // The first load read the transcripts already: windows are subsets of it.
  if (origin.transcripts) return olderSteps;

  const reachedWindowMs = last?.step.kind === "window" ? last.step.windowMs : last ? Infinity : 0;
  const windowFull = last?.step.kind === "window" && last.count >= stepLimit(last.step);
  // Before the first step the view holds only the live buffer, so even a window
  // it spans can add transcript rows from sessions that were not being watched.
  const now = input.now ?? Date.now();
  const heldAgeMs = last && oldestHeldTs !== null ? Math.max(0, now - oldestHeldTs) : 0;
  const windows: TailLookbackStep[] = windowFull
    ? []
    : WINDOW_STEPS_MS
      .filter((windowMs) => windowMs > reachedWindowMs && windowMs > heldAgeMs)
      .map((windowMs) => ({ kind: "window", windowMs }));
  return windows.length > 0 ? windows : olderSteps;
}

/** Under an empty tail: "Nothing in the last 6h." — null before any step. */
export function tailLookbackLead(last: TailLookbackOutcome | null): string | null {
  if (!last) return null;
  if (last.step.kind === "window") return `Nothing in the last ${formatLookbackWindow(last.step.windowMs)}.`;
  return `Nothing in the last ${last.step.limit.toLocaleString("en-US")} lines.`;
}

/**
 * Above the oldest row, after a step that changed nothing: "Nothing earlier in
 * 2,000 lines." for a line count, "Nothing more in the last 1h." for a window. Null when the
 * last step added rows, which the list itself shows.
 */
export function tailLookbackEarlierLead(last: TailLookbackOutcome | null): string | null {
  if (!last) return null;
  if (last.step.kind === "older") return last.movedBack ? null : `Nothing earlier in ${last.step.limit.toLocaleString("en-US")} lines.`;
  return last.added === 0 ? `Nothing more in the last ${formatLookbackWindow(last.step.windowMs)}.` : null;
}

/**
 * The read behind a step. Transcript replay is always on: older history lives
 * in harness transcripts, not in the broker's live buffer. A scoped tail keeps
 * its session, which the broker reads whole before applying the window.
 */
export function tailLookbackPath(step: TailLookbackStep, sessionId?: string): string {
  const params = new URLSearchParams({
    limit: String(stepLimit(step)),
    transcripts: "true",
  });
  if (step.kind === "window") params.set("windowMs", String(step.windowMs));
  const scoped = sessionId?.trim();
  if (scoped) params.set("sessionId", scoped);
  return `/api/tail/recent?${params.toString()}`;
}

export function oldestTailTs(events: readonly TailEvent[]): number | null {
  let oldest: number | null = null;
  for (const event of events) if (oldest === null || event.ts < oldest) oldest = event.ts;
  return oldest;
}

/**
 * Fold a step's rows into what the view holds. Held rows win a content match
 * (their ids, and so their row keys, stay put). The result is in time order:
 * a step returns the newest rows of its window, so held rows older than that
 * set would otherwise land after the newest ones, at the live end of the tail.
 * Keeps the newest `limit`.
 */
export function mergeTailLookbackEvents(
  held: readonly TailEvent[],
  older: readonly TailEvent[],
  limit: number,
): TailEvent[] {
  const merged = dedupeTailEvents([...held, ...older]).sort((left, right) => left.ts - right.ts);
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

/** What a step's rows would change, before they are merged. */
export function measureTailLookback(
  held: readonly TailEvent[],
  older: readonly TailEvent[],
  limit: number,
): Pick<TailLookbackOutcome, "added" | "movedBack"> {
  const heldKeys = new Set(held.map(tailEventKey));
  const merged = mergeTailLookbackEvents(held, older, limit);
  let added = 0;
  for (const event of merged) if (!heldKeys.has(tailEventKey(event))) added += 1;
  const before = oldestTailTs(held);
  const after = oldestTailTs(merged);
  return { added, movedBack: after !== null && (before === null || after < before) };
}
