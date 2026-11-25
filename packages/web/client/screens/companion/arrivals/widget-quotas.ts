import type { ServiceGauge } from "../../home/HomeHero";
import { formatResetChip, formatResetRelative, quotaWindowRolledOver } from "../../home/quota-reset";
import { formatClockTimestamp, timeAgoPast } from "../../../lib/time";
import type { Quota } from "./CompanionWidget";

/**
 * A provider reports usage only while one of its sessions runs, so a reading
 * can be hours old while it still looks current. Past this age the tooltip
 * shows how old it is.
 */
export const QUOTA_STALE_MS = 60 * 60 * 1000;

/** How old a reading is, when it is old enough to say so ("15h"). */
export function quotaReadingAge(readAt: number | undefined, now: Date): string | undefined {
  if (readAt === undefined || !Number.isFinite(readAt)) return undefined;
  if (now.getTime() - readAt < QUOTA_STALE_MS) return undefined;
  return timeAgoPast(readAt, now.getTime()) || undefined;
}

/** The hover line for one window: usage, reset, and when it was read. */
export function quotaTitle(q: Quota): string {
  const reading = q.unavailable ? "Awaiting read" : `${q.used}% used · resets ${q.reset}`;
  const read = q.readAt === undefined ? "" : ` · read ${q.age ? `${q.age} ago, ` : ""}${formatClockTimestamp(q.readAt)}`;
  return `${q.label} ${q.window} · ${reading}${read}`;
}

/** One cell per provider, retaining every window and its reset tooltip. */
export function groupWidgetQuotas(quotas: Quota[]) {
  const providers = new Map<string, { label: string; windows: Quota[]; worst: Quota | null }>();
  for (const quota of quotas) {
    const key = quota.label.toLowerCase();
    let provider = providers.get(key);
    if (!provider) {
      provider = { label: quota.label, windows: [], worst: null };
      providers.set(key, provider);
    }
    provider.windows.push(quota);
    if (!quota.unavailable && (!provider.worst || quota.used > provider.worst.used)) provider.worst = quota;
  }
  return [...providers.values()];
}

/** A compact countdown in days and hours, including the last hour. */
function compactResetCountdown(resetAt: number, now: Date): string {
  const remaining = formatResetRelative({ resetAt }, now);
  if (remaining.includes("d")) return remaining;
  return remaining.includes("h") ? remaining.split(" ")[0]! : "<1h";
}

/** Keep all windows in duration order (short/long, as HomeHero does). */
export function widgetQuotas(gauges: ServiceGauge[], now: Date): Quota[] {
  return gauges.flatMap((g) => {
    if (g.kind !== "quota") return [];
    const windows = g.windows?.length ? g.windows : [{ ...g, label: g.unitLabel === "weekly" ? "7d" : g.unitLabel }];
    const minutes = (label: string) => {
      const match = label.match(/(\d+)\s*([mhd])/i);
      return match ? Number(match[1]) * ({ m: 1, h: 60, d: 1440 }[match[2]!.toLowerCase()] ?? 1) : Infinity;
    };
    return [...windows].sort((a, b) => minutes(a.label) - minutes(b.label)).map((w, i) => {
      const unavailable = quotaWindowRolledOver(w, now);
      const readAt = w.capturedAt ?? g.capturedAt;
      const age = unavailable ? undefined : quotaReadingAge(readAt, now);
      const reset = !unavailable && Number.isFinite(w.resetAt) && w.resetAt > 0
        ? formatResetChip(w.resetAt, now).label : undefined;
      return { id: `${g.id}:${i}`, label: g.label, window: w.label,
        used: unavailable ? 0 : Math.round(Math.min(1, Math.max(0, w.fill)) * 100),
        unavailable, reset: reset ?? (unavailable ? "Awaiting read" : "Unknown"),
        ...(reset ? { resetCountdown: compactResetCountdown(w.resetAt, now) } : {}),
        ...(readAt === undefined ? {} : { readAt }), ...(age ? { age } : {}) };
    });
  });
}
