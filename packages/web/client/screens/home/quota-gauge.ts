import { formatResetChip, formatResetRelative, quotaWindowRolledOver } from "./quota-reset.ts";

/*
 * One subscription's usage, as the quota rows read it: which window a row
 * shows, how full it is now, and how that is said. Pure, so the Subscriptions
 * & quotas panel (HomeHero.tsx) and the cockpit's head gauges
 * (cockpit-gauges.ts) read a subscription the same way.
 */

export type GaugeTone = "ok" | "warn" | "err" | "dim";

type ServiceQuotaHistoryPoint = {
  capturedAt: number;
  fill: number;
  usedLabel: string;
  resetAt?: number;
};

export type ServiceQuotaWindowGauge = {
  label: string;
  fill: number;
  usedLabel: string;
  capLabel: string;
  unitLabel: string;
  resetAt: number;
  windowMs?: number;
  capturedAt?: number;
  source?: string;
  history?: ServiceQuotaHistoryPoint[];
  /** The last reading predates this window's reset; current usage is unknown. */
  awaitingReset?: boolean;
};

export type ServiceGauge =
  | {
      id: string;
      label: string;
      kind: "quota";
      fill: number;
      usedLabel: string;
      capLabel: string;
      unitLabel: string;
      resetAt: number;
      windows?: ServiceQuotaWindowGauge[];
      plan?: string;
      capturedAt?: number;
      source?: string;
    }
  | {
      id: string;
      label: string;
      kind: "status";
      statusLabel: string;
      windowLabel?: string;
      detailLabel?: string;
      balanceLabel?: string;
      tone: GaugeTone;
      capturedAt?: number;
      source?: string;
    };

export type QuotaGauge = Extract<ServiceGauge, { kind: "quota" }>;

export function isQuotaGauge(gauge: ServiceGauge): gauge is QuotaGauge {
  return gauge.kind === "quota";
}

export function gaugeTone(fill: number): GaugeTone {
  if (fill >= 0.9) return "err";
  if (fill >= 0.75) return "warn";
  return "ok";
}

function formatLegacyQuotaLabel(label: string): string {
  switch (label) {
    case "weekly":
      return "7d";
    case "req/h":
      return "1h";
    default:
      return label || "quota";
  }
}

export function quotaWindows(g: QuotaGauge): ServiceQuotaWindowGauge[] {
  return g.windows && g.windows.length > 0
    ? g.windows
    : [
        {
          label: formatLegacyQuotaLabel(g.unitLabel),
          fill: g.fill,
          usedLabel: g.usedLabel,
          capLabel: g.capLabel,
          unitLabel: g.unitLabel,
          resetAt: g.resetAt,
        },
      ];
}

function quotaWindowMinutes(label: string): number | null {
  const match = label.trim().match(/^(\d+(?:\.\d+)?)([mhd])$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  switch (match[2]?.toLowerCase()) {
    case "m":
      return value;
    case "h":
      return value * 60;
    case "d":
      return value * 24 * 60;
    default:
      return null;
  }
}

/**
 * The window a row shows: the first of a day or longer, else the longest one
 * reported. The rolling short windows (5h) are gone from the providers, so the
 * table carries one window per subscription.
 */
export function usageWindow(windows: ServiceQuotaWindowGauge[]): ServiceQuotaWindowGauge | null {
  const sorted = [...windows].sort(
    (a, b) =>
      (quotaWindowMinutes(a.label) ?? Number.MAX_SAFE_INTEGER) -
      (quotaWindowMinutes(b.label) ?? Number.MAX_SAFE_INTEGER),
  );
  return (
    sorted.find((window) => (quotaWindowMinutes(window.label) ?? 0) >= 24 * 60) ??
    sorted[sorted.length - 1] ??
    null
  );
}

/** A rolled-over window's last reading belongs to the previous cycle. */
export function currentWindowFill(window: ServiceQuotaWindowGauge, now: Date): number {
  return quotaWindowRolledOver(window, now) ? 0 : window.fill;
}

export function usageLabel(window: ServiceQuotaWindowGauge, now: Date): string {
  if (quotaWindowRolledOver(window, now)) return "—";
  if (window.capLabel === "100%" && window.usedLabel.endsWith("%")) {
    return window.usedLabel;
  }
  return `${window.usedLabel}/${window.capLabel}`;
}

/** The window the row shows, in words; a window off the table is not described. */
export function buildTooltip(window: ServiceQuotaWindowGauge | null, now: Date): string {
  if (!window) return "No usage window reported";
  if (quotaWindowRolledOver(window, now)) {
    return `${window.label}: rolled over, awaiting a fresh reading`;
  }
  const chip = formatResetChip(window.resetAt, now);
  const rel = formatResetRelative(window, now);
  return `${window.label}: ${window.usedLabel} of ${window.capLabel} ${window.unitLabel}, resets ${chip.label} (in ${rel})`;
}
