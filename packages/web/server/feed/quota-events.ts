/**
 * Quota warnings: each time a provider window passed a threshold, read from
 * the service budgets' stored history (a week of readings per window, one per
 * hour). Pure. A window cycle is the run of readings whose reset times
 * agree within a few minutes: a reset read as "N seconds from now" drifts a
 * little on every reading. A reading whose reset was only guessed as "a window
 * from when it was taken" moves by the whole gap between readings, so it
 * belongs to no cycle and is left out. A cycle that never reached the
 * threshold makes no event, and neither does one that reached it on pace:
 * using most of a window by the time it resets is good use. A crossing is a
 * warning only when it came ahead of an even pace (shared/quota-pace.ts), or
 * when the window ran out.
 */
import type { FeedQuotaEvent } from "../../shared/api/feed-sources.ts";
import { aheadOfPace, windowLength } from "../../shared/quota-pace.ts";
import { dayKey } from "./days.ts";

export const QUOTA_WARN_AT = 0.9;
/** A reading this full is the window run out. */
export const QUOTA_OUT_AT = 0.995;
/** How far apart two readings' reset times may be and still be one cycle. */
export const QUOTA_RESET_TOLERANCE_MS = 5 * 60_000;
/** Window lengths the budget reader falls back to when a provider gives no reset (server/service-budgets.ts). */
const FALLBACK_WINDOWS_MS = [5 * 3_600_000, 7 * 86_400_000, 30 * 86_400_000];

type Reading = { capturedAt: number; fill: number; resetAt: number };

/** True when a reading's reset is only its capture time plus a window length: a guess, not a reset. */
function guessedReset(point: Reading, windowMs: number | undefined): boolean {
  const lead = point.resetAt - point.capturedAt;
  return [windowMs, ...FALLBACK_WINDOWS_MS].some((w) => w !== undefined && Math.abs(lead - w) < 1_000);
}

/** Readings grouped into cycles: sorted by reset, a new cycle wherever the reset jumps by more than the tolerance. */
function cyclesOf(points: readonly Reading[]): Reading[][] {
  const byReset = [...points].sort((a, b) => a.resetAt - b.resetAt);
  const cycles: Reading[][] = [];
  for (const point of byReset) {
    const cycle = cycles.at(-1);
    if (cycle && point.resetAt - cycle.at(-1)!.resetAt <= QUOTA_RESET_TOLERANCE_MS) cycle.push(point);
    else cycles.push([point]);
  }
  return cycles.map((c) => c.sort((a, b) => a.capturedAt - b.capturedAt));
}

/** The parts of a service gauge this reads (server/service-budgets.ts ServiceGauge). */
export type QuotaGaugeInput = {
  id: string;
  label: string;
  kind: string;
  windows?: ReadonlyArray<{
    label: string;
    fill: number;
    resetAt: number;
    windowMs?: number;
    awaitingReset?: boolean;
    history?: ReadonlyArray<{ capturedAt: number; fill: number; resetAt?: number }>;
  }>;
};

/** Every crossing in the gauges' history, newest first. */
export function quotaCrossings(gauges: readonly QuotaGaugeInput[], threshold = QUOTA_WARN_AT): FeedQuotaEvent[] {
  const out: FeedQuotaEvent[] = [];
  for (const gauge of gauges) {
    if (gauge.kind !== "quota") continue;
    for (const window of gauge.windows ?? []) {
      const points = (window.history ?? []).flatMap((p): Reading[] =>
        p.resetAt != null && Number.isFinite(p.resetAt) && Number.isFinite(p.fill) ? [{ capturedAt: p.capturedAt, fill: p.fill, resetAt: p.resetAt }] : []);
      for (const readings of cyclesOf(points.filter((p) => !guessedReset(p, window.windowMs)))) {
        const first = readings.find((p) => p.fill >= threshold);
        if (!first) continue;
        const peak = readings.reduce((best, p) => (p.fill > best.fill ? p : best), readings[0]!);
        // The newest reading's reset is the best estimate; the first one's, to the minute, names the cycle as readings arrive.
        const resetAt = readings.at(-1)!.resetAt;
        const windowMs = windowLength(window.label, window.windowMs);
        const ranOut = readings.find((p) => p.fill >= QUOTA_OUT_AT);
        if (!ranOut && !aheadOfPace(first.fill, first.capturedAt, resetAt, windowMs)) continue;
        const name = Math.round(readings[0]!.resetAt / 60_000) * 60_000;
        const sameCycle = Math.abs(window.resetAt - resetAt) <= QUOTA_RESET_TOLERANCE_MS;
        const current = !sameCycle && !window.awaitingReset ? { fill: window.fill, resetAt: window.resetAt } : null;
        out.push({
          id: `quota:${gauge.id}:${window.label}:${name}`,
          provider: gauge.id,
          label: gauge.label,
          window: window.label,
          threshold,
          crossedAt: first.capturedAt,
          day: dayKey(first.capturedAt),
          peak: peak.fill,
          peakAt: peak.capturedAt,
          resetAt,
          windowMs,
          ranOutAt: ranOut?.capturedAt ?? null,
          points: readings.map((p) => [p.capturedAt, p.fill]),
          now: current,
        });
      }
    }
  }
  return out.sort((a, b) => b.crossedAt - a.crossedAt);
}
