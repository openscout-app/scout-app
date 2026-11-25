import { timeAgoPast } from "../../lib/time.ts";
import { formatResetChip, formatWeeklyResetCountdown, quotaWindowRolledOver } from "./quota-reset.ts";
import { gaugeTone, isQuotaGauge, quotaWindows, usageWindow, type ServiceGauge } from "./quota-gauge.ts";

/*
 * The cockpit's head gauges: each subscription in one short reading (name,
 * how full its long window is, when that resets). Same reading as the
 * Subscriptions & quotas rows (quota-gauge.ts › usageWindow), from the same
 * Home feed, so the head and the panel never disagree. In the order the
 * runtime lists them, so a gauge keeps its place as usage moves.
 */

export type CockpitGaugeTone = "ok" | "warn" | "err" | "none";

export type CockpitGauge = {
  id: string;
  label: string;
  /** How full the window is now, 0..1; null when there is no current reading. */
  fill: number | null;
  /** "27%", or "—" with no current reading. */
  used: string;
  /** The countdown the panel leads with ("2d 19h", "rolled over"); empty with no window. */
  reset: string;
  tone: CockpitGaugeTone;
  /** The hover line, and the gauge's name for assistive tech. */
  title: string;
};

/** A reading older than this says how old it is: providers report only while a session runs. */
const READING_STALE_MS = 60 * 60 * 1000;

export function cockpitGauges(gauges: readonly ServiceGauge[], now: Date): CockpitGauge[] {
  return gauges.filter(isQuotaGauge).map((gauge) => {
    const window = usageWindow(quotaWindows(gauge));
    if (!window) {
      return { id: gauge.id, label: gauge.label, fill: null, used: "—", reset: "", tone: "none", title: `${gauge.label}: no usage reported` };
    }
    if (quotaWindowRolledOver(window, now)) {
      return {
        id: gauge.id,
        label: gauge.label,
        fill: null,
        used: "—",
        reset: formatWeeklyResetCountdown(window, now).primary,
        tone: "none",
        title: `${gauge.label} ${window.label}: rolled over, waiting for a fresh reading`,
      };
    }
    const fill = Math.min(1, Math.max(0, window.fill));
    const pct = Math.round(fill * 100);
    const countdown = formatWeeklyResetCountdown(window, now);
    const readAt = window.capturedAt ?? gauge.capturedAt;
    const age = readAt != null && Number.isFinite(readAt) && now.getTime() - readAt >= READING_STALE_MS ? timeAgoPast(readAt, now.getTime()) : "";
    const resets =
      countdown.tone === "unknown"
        ? ""
        : countdown.tone === "due"
          ? countdown.primary
          : `resets ${formatResetChip(window.resetAt, now).label} (in ${countdown.primary})`;
    const parts = [`${gauge.label} ${window.label}: ${pct}% used, ${100 - pct}% left`, resets, age ? `read ${age} ago` : ""].filter(Boolean);
    return {
      id: gauge.id,
      label: gauge.label,
      fill,
      used: `${pct}%`,
      reset: countdown.primary,
      tone: gaugeTone(fill) as CockpitGaugeTone,
      title: parts.join(" · "),
    };
  });
}
