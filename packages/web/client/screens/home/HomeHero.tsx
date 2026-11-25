import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Activity, Plus, RefreshCw } from "lucide-react";
import type { Route } from "../../lib/types.ts";
import type { HudGridPanel } from "../../components/hud-grid/HudGrid.tsx";
import "./home-hero.css";
import { formatWeeklyResetCountdown } from "./quota-reset.ts";
import {
  buildTooltip,
  currentWindowFill,
  gaugeTone,
  isQuotaGauge,
  quotaWindows,
  usageLabel,
  usageWindow,
  type ServiceGauge,
  type ServiceQuotaWindowGauge,
} from "./quota-gauge.ts";

export type { ServiceGauge } from "./quota-gauge.ts";

type HeartrateBucketView = { ts: number; count: number; value: number };

export type HomeHeroProps = {
  now: Date;
  operatorName?: string;
  syncLabel: string;
  error: string | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Starts a new chat: the Mac app's composer when embedded, the web one otherwise. */
  onNewChat?: () => void;
  navigate: (route: Route) => void;
  heartrate: HeartrateBucketView[];
  heartrateWindow: string;
  heartrateBucketLabel: string;
  heartrateVisibleEventThreshold?: number;
  serviceGauges: ServiceGauge[];
  /** First fetch still in flight: reserve the card instead of growing into it. */
  gaugesPending?: boolean;
  heartratePending?: boolean;
  /** Last settled cockpit shape; sizes the pending cards. */
  layoutHint?: { gauges: number; heartrate: boolean };
};

const HEARTRATE_VISIBLE_EVENT_THRESHOLD = 3;
const HOME_SERVICE_GAUGE_LIMIT = 2;

function EmptyGaugeCell() {
  return <span className="hd-gauge-cell hd-gauge-cell--empty">—</span>;
}

/** The reset cell of an absent window: the dash in the usage cell already says "none". */
function BlankGaugeCell() {
  return <span className="hd-gauge-cell" aria-hidden="true" />;
}

function QuotaUsageCell({ window, now }: { window: ServiceQuotaWindowGauge | null; now: Date }) {
  if (!window) return <EmptyGaugeCell />;
  const fill = currentWindowFill(window, now);
  const windowPct = Math.round(fill * 100);
  const windowTone = gaugeTone(fill);
  return (
    <span className="hd-gauge-cell hd-gauge-cell--usage">
      <span className="hd-gauge-window-name label-xs">{window.label}</span>
      <span className="hd-gauge-bar" aria-hidden="true">
        <span
          className={`hd-gauge-bar-fill hd-gauge-bar-fill--${windowTone}`}
          style={{ width: `${windowPct}%` }}
        />
      </span>
      <span className="hd-gauge-window-used">{usageLabel(window, now)}</span>
    </span>
  );
}

function QuotaResetCell({ window, now }: { window: ServiceQuotaWindowGauge | null; now: Date }) {
  if (!window) return <BlankGaugeCell />;
  const countdown = formatWeeklyResetCountdown(window, now);
  return (
    <span
      className={`hd-gauge-cell hd-gauge-reset hd-gauge-reset--featured hd-gauge-reset--${countdown.tone}`}
      aria-live="off"
      aria-label={countdown.ariaLabel}
    >
      <strong>{countdown.primary}</strong>
      {countdown.dateTime ? (
        <time dateTime={countdown.dateTime}>{countdown.secondary}</time>
      ) : (
        <span>{countdown.secondary}</span>
      )}
    </span>
  );
}

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const segs: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    segs.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`);
  }
  return segs.join(" ");
}

function useMeasuredSize(fallbackWidth: number, fallbackHeight: number) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: fallbackWidth, height: fallbackHeight });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const sync = (width: number, height: number) => {
      const w = Math.round(width);
      const h = Math.round(height);
      setSize((current) => {
        const next = { width: w > 0 ? w : current.width, height: h > 0 ? h : current.height };
        return next.width === current.width && next.height === current.height ? current : next;
      });
    };
    const rect = node.getBoundingClientRect();
    sync(rect.width, rect.height);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      sync(box?.width ?? 0, box?.height ?? 0);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}

const HEARTRATE_MIN_HEIGHT = 72;
const HEARTRATE_DAY_LABEL_MIN_GAP = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnights strictly inside (startMs, endMs). */
function dayBoundaries(startMs: number, endMs: number): number[] {
  const out: number[] = [];
  const first = new Date(startMs);
  first.setHours(24, 0, 0, 0);
  for (let t = first.getTime(); t < endMs && out.length < 32; ) {
    out.push(t);
    const next = new Date(t + DAY_MS + 2 * 60 * 60 * 1000);
    next.setHours(0, 0, 0, 0);
    t = next.getTime();
  }
  return out;
}

function HeartrateGraph({ buckets, fill = false }: { buckets: HeartrateBucketView[]; fill?: boolean }) {
  const [ref, size] = useMeasuredSize(372, HEARTRATE_MIN_HEIGHT);
  const W = size.width;
  // On the grid the plot takes the panel's height; elsewhere it keeps its strip.
  const H = fill ? Math.max(HEARTRATE_MIN_HEIGHT, size.height) : HEARTRATE_MIN_HEIGHT;
  const top = 8;
  const bottom = H - 18;
  const labelY = H - 4;
  const N = buckets.length;
  const allZero = N < 2 || buckets.every((b) => b.count === 0);
  const plotW = Math.max(1, W - 4);
  const wrapClass = `hd-heartrate-svg-wrap${fill ? " hd-heartrate-svg-wrap--fill" : ""}`;

  const svgProps = {
    viewBox: `0 0 ${W} ${H}`,
    style: { width: "100%", height: H, display: "block" } as const,
  };

  if (allZero) {
    return (
      <div ref={ref} className={wrapClass}>
        <svg {...svgProps}>
          <line x1="0" y1={bottom} x2={W} y2={bottom} stroke="var(--border)" />
        </svg>
      </div>
    );
  }

  const stepX = plotW / (N - 1);
  const points = buckets.map((b, i) => ({
    x: i * stepX,
    y: bottom - Math.max(0, Math.min(1, b.value)) * (bottom - top),
  }));
  const path = buildSmoothPath(points);
  const areaPath = `${path} L ${plotW} ${bottom} L 0 ${bottom} Z`;

  // Day ticks: a hairline at each local midnight, labelled with the weekday
  // where there is room, so "when" reads off the axis rather than "7d · 3d".
  const startMs = buckets[0]!.ts;
  const endMs = buckets[N - 1]!.ts;
  const spanMs = Math.max(1, endMs - startMs);
  const xFor = (ts: number) => ((ts - startMs) / spanMs) * plotW;
  const nowLabelLeft = W - 24;
  let lastLabelX = -Infinity;
  const days = dayBoundaries(startMs, endMs).map((ts) => {
    const x = xFor(ts);
    const labelled = x - lastLabelX >= HEARTRATE_DAY_LABEL_MIN_GAP && x + 12 < nowLabelLeft && x > 10;
    if (labelled) lastLabelX = x;
    return { ts, x, labelled, label: new Date(ts).toLocaleDateString([], { weekday: "short" }).toLowerCase() };
  });

  return (
    <div ref={ref} className={wrapClass}>
      <svg {...svgProps} role="img" aria-label="Fleet events over the window">
        <defs>
          <linearGradient id="hrdFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={top} x2={W} y2={top} stroke="var(--border)" opacity="0.25" />
        <line x1="0" y1={(top + bottom) / 2} x2={W} y2={(top + bottom) / 2} stroke="var(--border)" opacity="0.25" />
        {days.map((day) => (
          <line key={day.ts} x1={day.x} y1={top} x2={day.x} y2={bottom} stroke="var(--border)" opacity="0.25" />
        ))}
        <line x1="0" y1={bottom} x2={W} y2={bottom} stroke="var(--border)" />
        {days.map((day) => (
          <line key={`t${day.ts}`} x1={day.x} y1={bottom} x2={day.x} y2={bottom + 3} stroke="var(--dim)" />
        ))}
        <path d={areaPath} fill="url(#hrdFill)" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.75" strokeLinecap="round" />
        <circle cx={points[N - 1].x} cy={points[N - 1].y} r="3" fill="var(--accent)" />
        <circle cx={points[N - 1].x} cy={points[N - 1].y} r="6" fill="var(--accent)" opacity="0.25" />
        {days.filter((day) => day.labelled).map((day) => (
          <text key={`l${day.ts}`} x={day.x} y={labelY} textAnchor="middle" fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">
            {day.label}
          </text>
        ))}
        <text x={W} y={labelY} textAnchor="end" fill="var(--dim)" fontSize="9" fontFamily="var(--font-mono)">now</text>
      </svg>
    </div>
  );
}

function Gauge({
  gauge,
  now,
  onClick,
}: {
  gauge: ServiceGauge;
  now: Date;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "span";
  const interactiveProps = onClick
    ? { type: "button" as const, onClick }
    : {};

  if (gauge.kind === "status") {
    return (
      <Tag
        className={`hd-gauge hd-gauge--status hd-gauge--${gauge.tone}${onClick ? " hd-gauge--interactive" : ""}`}
        aria-label={`${gauge.label} subscription usage`}
        {...interactiveProps}
      >
        <span className="hd-gauge-head">
          <span className="hd-gauge-label">{gauge.label}</span>
          <span className={`hd-gauge-dot hd-gauge-dot--${gauge.tone}`} aria-hidden="true" />
        </span>
        <span className="hd-gauge-cell hd-gauge-cell--usage hd-gauge-cell--status">
          <span className="hd-gauge-window-name label-xs">{gauge.windowLabel ?? "usage"}</span>
          <span className="hd-gauge-status">{gauge.statusLabel}</span>
        </span>
        <span className="hd-gauge-cell hd-gauge-reset">{gauge.detailLabel ?? "quota n/a"}</span>
      </Tag>
    );
  }
  const window = usageWindow(quotaWindows(gauge));
  const tone = gaugeTone(window ? currentWindowFill(window, now) : 0);
  const tooltip = buildTooltip(window, now);
  return (
    <Tag
      className={`hd-gauge hd-gauge--${tone}${onClick ? " hd-gauge--interactive" : ""}`}
      title={tooltip}
      aria-label={`${gauge.label} subscription usage. ${tooltip}`}
      {...interactiveProps}
    >
      <span className="hd-gauge-head">
        <span className="hd-gauge-label">{gauge.label}</span>
      </span>
      <QuotaUsageCell window={window} now={now} />
      <QuotaResetCell window={window} now={now} />
    </Tag>
  );
}

function compactNumberValue(label: string): number {
  const match = label.trim().match(/^(\d+(?:\.\d+)?)([kKmM])?$/u);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  switch (match[2]?.toLowerCase()) {
    case "m":
      return value * 1_000_000;
    case "k":
      return value * 1_000;
    default:
      return value;
  }
}

function gaugeUsageScore(gauge: ServiceGauge): number {
  if (gauge.kind === "quota") {
    return Math.max(gauge.fill, ...quotaWindows(gauge).map((window) => window.fill));
  }
  return compactNumberValue(gauge.statusLabel) > 0 ? 0.01 : 0;
}

/** "2,099 events · 7d": the pill reads as the window's total. */
function heartrateTotalLabel(total: number, windowLabel: string): string {
  const events = `${total.toLocaleString()} ${total === 1 ? "event" : "events"}`;
  const span = windowLabel.replace(/^\s*trailing\s+/i, "").trim();
  return span ? `${events} · ${span}` : events;
}

function topServiceGauges(gauges: ServiceGauge[]): ServiceGauge[] {
  return sortedServiceGauges(gauges).slice(0, HOME_SERVICE_GAUGE_LIMIT);
}

function sortedServiceGauges(gauges: ServiceGauge[]): ServiceGauge[] {
  return gauges
    .map((gauge, index) => ({ gauge, index, score: gaugeUsageScore(gauge) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ gauge }) => gauge);
}

/* Pending cards reuse the real chrome and row classes, with invisible text
   holding each line box, so the swap to data changes pixels, not geometry. */
function QuotasCardSkeleton({ rows, bodyOnly = false }: { rows: number; bodyOnly?: boolean }) {
  const set = (
      <div className="hd-gauge-set" aria-hidden={bodyOnly || undefined}>
        <div className="hd-gauge-table-head label-xs">
          <span>Service</span>
          <span>Usage</span>
          <span>Reset countdown</span>
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="hd-gauge-wrap">
            <span className="hd-gauge">
              <span className="hd-gauge-head">
                <span className="hd-gauge-label"><span className="home-skel" style={{ width: 44 }} />{"\u00a0"}</span>
              </span>
              <span className="hd-gauge-cell"><span className="home-skel" style={{ width: "80%" }} /></span>
              <span className="hd-gauge-cell hd-gauge-reset hd-gauge-reset--featured">
                <strong><span className="home-skel" style={{ width: 64 }} />{"\u00a0"}</strong>
                <span>{"\u00a0"}</span>
              </span>
            </span>
          </span>
        ))}
      </div>
  );
  if (bodyOnly) return set;
  return (
    <div className="hd-card hd-card--quotas hd-card--pending" aria-hidden="true">
      <div className="hd-card-head">
        <div className="hd-card-head-left">
          <span className="label-xs hd-card-title">Subscriptions & quotas</span>
          <span className="chip chip--neutral chip--mono chip--sm home-skel-chip">0 active</span>
        </div>
      </div>
      {set}
    </div>
  );
}

function HeartrateCardSkeleton() {
  return (
    <div className="hd-card hd-card--heartrate hd-card--pending" aria-hidden="true">
      <div className="hd-card-head">
        <div className="hd-card-head-left">
          <Activity size={12} className="hd-heartrate-icon" aria-hidden="true" />
          <span className="label-xs hd-card-title">Fleet Velocity</span>
        </div>
        <div className="hd-card-head-right">
          <span className="chip chip--neutral chip--mono chip--sm home-skel-chip">0 Events</span>
        </div>
      </div>
      <div className="hd-heartrate-plot-body">
        <HeartrateGraph buckets={[]} />
      </div>
    </div>
  );
}

/** One telemetry panel's parts, drawn by HomeContent's grid and by the Home panels on a view. */
export type HomeTelemetryPart = {
  /** It has rows or a curve to draw, or holds its place while its first read is out. */
  shown: boolean;
  /** The head's count chip. */
  count?: string;
  /** The head's controls. */
  right?: ReactNode;
  body: ReactNode;
};

/**
 * Subscriptions & quotas: the two busiest subscriptions (or all of them), each
 * with its short and long window and when each resets. The grid draws the
 * head, so the body is the card without its frame; while the first read is
 * out it holds its rows with skeletons rather than dropping out.
 */
export function useQuotasPart(
  props: Pick<HomeHeroProps, "now" | "navigate" | "serviceGauges" | "gaugesPending" | "layoutHint">,
): HomeTelemetryPart {
  const {
    now,
    navigate,
    serviceGauges,
    gaugesPending = false,
    layoutHint = { gauges: HOME_SERVICE_GAUGE_LIMIT, heartrate: true },
  } = props;
  const [showAllGauges, setShowAllGauges] = useState(false);
  const subscriptionGauges = serviceGauges.filter(isQuotaGauge);
  const compactGauges = topServiceGauges(subscriptionGauges);
  const gauges = showAllGauges ? sortedServiceGauges(subscriptionGauges) : compactGauges;
  const hasHiddenGauges = subscriptionGauges.length > compactGauges.length;
  const reserveGauges = gauges.length === 0 && gaugesPending && layoutHint.gauges > 0;
  return {
    shown: gauges.length > 0 || reserveGauges,
    // Rows are the busiest subscriptions first; the count says how many of
    // the total are on screen, so the toggle never contradicts it.
    count: reserveGauges
      ? undefined
      : gauges.length < subscriptionGauges.length
        ? `${gauges.length} of ${subscriptionGauges.length}`
        : `${subscriptionGauges.length}`,
    right: hasHiddenGauges ? (
      <button
        type="button"
        className="hd-gauge-toggle"
        aria-expanded={showAllGauges}
        title={showAllGauges ? "Show the two busiest subscriptions" : "Show every subscription"}
        onClick={() => setShowAllGauges((value) => !value)}
      >
        {showAllGauges ? "Busiest 2" : "Show all"}
      </button>
    ) : undefined,
    body: reserveGauges ? (
      <QuotasCardSkeleton rows={layoutHint.gauges} bodyOnly />
    ) : (
      <div className="hd-gauge-set home-arrive">
        <div className="hd-gauge-table-head label-xs" aria-hidden="true">
          <span>Service</span>
          <span>Usage</span>
          <span>Reset countdown</span>
        </div>
        {gauges.map((g) => (
          <span key={g.id} className="hd-gauge-wrap">
            <Gauge gauge={g} now={now} onClick={() => navigate({ view: "harnesses" })} />
          </span>
        ))}
      </div>
    ),
  };
}

/** Fleet velocity: the window's events as one curve, drawn once there are enough to say something. */
export function useVelocityPart(
  props: Pick<
    HomeHeroProps,
    "heartrate" | "heartrateWindow" | "heartrateBucketLabel" | "heartrateVisibleEventThreshold" | "heartratePending" | "layoutHint"
  >,
): HomeTelemetryPart {
  const {
    heartrate,
    heartrateWindow,
    heartrateBucketLabel,
    heartrateVisibleEventThreshold = HEARTRATE_VISIBLE_EVENT_THRESHOLD,
    heartratePending = false,
    layoutHint = { gauges: HOME_SERVICE_GAUGE_LIMIT, heartrate: true },
  } = props;
  const totalHeartrateEvents = heartrate.reduce((total, bucket) => total + bucket.count, 0);
  const showHeartrate = totalHeartrateEvents >= heartrateVisibleEventThreshold;
  const reserveHeartrate = !showHeartrate && heartratePending && layoutHint.heartrate;
  return {
    shown: showHeartrate || reserveHeartrate,
    count: showHeartrate ? heartrateTotalLabel(totalHeartrateEvents, heartrateWindow) : undefined,
    right: showHeartrate && heartrateBucketLabel ? (
      <span className="hd-card-sub hd-grid-sub">{heartrateBucketLabel}</span>
    ) : undefined,
    body: (
      <div className="hd-heartrate-plot-body hd-heartrate-plot-body--fill">
        <HeartrateGraph buckets={showHeartrate ? heartrate : []} fill />
      </div>
    ),
  };
}

/** Quotas and velocity as HomeContent's grid panels; a part with nothing to draw drops out. */
export function useHomeTelemetryPanels(props: HomeHeroProps): HudGridPanel[] {
  const quotas = useQuotasPart(props);
  const velocity = useVelocityPart(props);
  const panels: HudGridPanel[] = [];
  if (quotas.shown) {
    panels.push({
      id: "quotas",
      title: "Subscriptions & quotas",
      count: quotas.count,
      className: "hd-grid-quotas",
      right: quotas.right,
      children: quotas.body,
    });
  }
  if (velocity.shown) {
    panels.push({
      id: "velocity",
      title: "Fleet velocity",
      count: velocity.count,
      className: "hd-grid-velocity",
      right: velocity.right,
      children: velocity.body,
    });
  }
  return panels;
}

/**
 * The cockpit's controls: New chat, the sync line (with a warning mark while a
 * read is failing) and Refresh. The Home band draws them beside its title; the
 * Fleet cockpit panel on a view draws them in its body.
 */
export function HomeCockpitControls({
  syncLabel,
  error,
  loading,
  refreshing,
  onRefresh,
  onNewChat,
}: Pick<HomeHeroProps, "syncLabel" | "error" | "loading" | "refreshing" | "onRefresh" | "onNewChat">) {
  const syncTone = loading || refreshing ? "pending" : error ? "err" : "ok";
  return (
    <div className="hd-vitals-right">
      {onNewChat && (
        <button type="button" className="hd-new-chat" onClick={onNewChat} title="New chat (⌘N)">
          <Plus size={11} aria-hidden="true" />
          New chat
        </button>
      )}
      {error && !loading && !refreshing && <span className="dot dot--warning" aria-hidden="true" />}
      <span className={`hd-meta hd-meta--${syncTone}`}>{syncLabel}</span>
      <button
        type="button"
        className="hd-refresh-btn"
        disabled={loading || refreshing}
        onClick={onRefresh}
        title="Refresh status (r)"
        aria-label={refreshing ? "Refreshing status" : "Refresh status"}
      >
        <RefreshCw size={11} className={refreshing ? "hd-spin" : ""} aria-hidden="true" />
      </button>
    </div>
  );
}

export default function HomeHero(props: HomeHeroProps & { bandOnly?: boolean }) {
  const {
    bandOnly = false,
    now,
    operatorName,
    syncLabel,
    error,
    loading,
    refreshing,
    onRefresh,
    onNewChat,
    navigate,
    heartrate,
    heartrateWindow,
    heartrateBucketLabel,
    heartrateVisibleEventThreshold = HEARTRATE_VISIBLE_EVENT_THRESHOLD,
    serviceGauges,
    gaugesPending = false,
    heartratePending = false,
    layoutHint = { gauges: HOME_SERVICE_GAUGE_LIMIT, heartrate: true },
  } = props;
  const [showAllGauges, setShowAllGauges] = useState(false);

  const subscriptionGauges = serviceGauges.filter(isQuotaGauge);
  const sortedGauges = sortedServiceGauges(subscriptionGauges);
  const compactGauges = topServiceGauges(subscriptionGauges);
  const gauges = showAllGauges ? sortedGauges : compactGauges;
  const hasHiddenGauges = subscriptionGauges.length > compactGauges.length;

  const totalHeartrateEvents = heartrate.reduce((total, bucket) => total + bucket.count, 0);
  const showHeartrate = totalHeartrateEvents >= heartrateVisibleEventThreshold;
  // While a source is unresolved its card holds the slot it last occupied, so
  // the grid never reflows from one column to two when the data lands.
  const reserveGauges = gauges.length === 0 && gaugesPending && layoutHint.gauges > 0;
  const reserveHeartrate = !showHeartrate && heartratePending && layoutHint.heartrate;
  const hasQuotasCard = gauges.length > 0 || reserveGauges;
  const hasHeartrateCard = showHeartrate || reserveHeartrate;

  return (
    <section className="hd" aria-label="Fleet cockpit and service cluster">
      {/* ── Cockpit Vitals Band ────────────────────────────────────── */}
      <div className="hd-vitals-band">
        <div className="hd-vitals-left">
          <span className="s-eyebrow hd-vitals-title">Fleet cockpit</span>
          {operatorName && (
            <span className="chip chip--neutral chip--mono chip--sm hd-vitals-callsign">
              {operatorName}
            </span>
          )}
        </div>
        <span className="s-section-rule-line" aria-hidden="true" />
        <HomeCockpitControls
          syncLabel={syncLabel}
          error={error}
          loading={loading}
          refreshing={refreshing}
          onRefresh={onRefresh}
          onNewChat={onNewChat}
        />
      </div>

      {/* ── Modular HUD Telemetry Cards ────────────────────────────── */}
      {!bandOnly && (hasQuotasCard || hasHeartrateCard) && (
        <div className={`hd-telemetry-grid ${hasQuotasCard && hasHeartrateCard ? "hd-telemetry-grid--split" : "hd-telemetry-grid--single"}`}>
          {reserveGauges && <QuotasCardSkeleton rows={layoutHint.gauges} />}
          {/* Subscriptions & quotas Card */}
          {gauges.length > 0 && (
            <div className="hd-card hd-card--quotas home-arrive">
              <div className="hd-card-head">
                <div className="hd-card-head-left">
                  <span className="label-xs hd-card-title">Subscriptions & quotas</span>
                  <span className="chip chip--neutral chip--mono chip--sm">
                    {gauges.length} active
                  </span>
                </div>
                {hasHiddenGauges && (
                  <button
                    type="button"
                    className="hd-gauge-toggle"
                    aria-expanded={showAllGauges}
                    onClick={() => setShowAllGauges((value) => !value)}
                  >
                    [{showAllGauges ? "Top 2" : `All ${subscriptionGauges.length}`}]
                  </button>
                )}
              </div>

              <div className="hd-gauge-set">
                <div className="hd-gauge-table-head label-xs" aria-hidden="true">
                  <span>Service</span>
                  <span>Usage</span>
                  <span>Reset countdown</span>
                </div>
                {gauges.map((g) => (
                  <span key={g.id} className="hd-gauge-wrap">
                    <Gauge gauge={g} now={now} onClick={() => navigate({ view: "harnesses" })} />
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Fleet Velocity & Heartrate Oscilloscope Card */}
          {reserveHeartrate && <HeartrateCardSkeleton />}
          {showHeartrate && (
            <div className="hd-card hd-card--heartrate home-arrive">
              <div className="hd-card-head">
                <div className="hd-card-head-left">
                  <Activity size={12} className="hd-heartrate-icon" aria-hidden="true" />
                  <span className="label-xs hd-card-title">Fleet Velocity</span>
                </div>
                <div className="hd-card-head-right">
                  <span className="label-xs hd-card-sub">
                    {heartrateWindow} {heartrateBucketLabel ? `· ${heartrateBucketLabel}` : ""}
                  </span>
                  <span className="chip chip--working chip--mono chip--sm">
                    {totalHeartrateEvents} {totalHeartrateEvents === 1 ? "Event" : "Events"}
                  </span>
                </div>
              </div>
              <div className="hd-heartrate-plot-body">
                <HeartrateGraph buckets={heartrate} />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
