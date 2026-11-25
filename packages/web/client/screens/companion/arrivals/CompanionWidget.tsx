import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, SlidersHorizontal } from "lucide-react";
import { DotField } from "./DotField";
import { fieldIntensity } from "./dot-field";
import { PULSE_MS, ROW_STEP_MS } from "./board-motion";
import { rowSpeaker, rowWhere, sinceOf } from "./arrivals-model";
import { arrivalOrder, plottedSession, type LatestStep } from "./board-strip";
import type { StripRow } from "./FoldStrip";
import { identityMonogram } from "./Ident";
import { figureLabelSign, figureLabelText, type FigureLabel } from "./figure-labels.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { HarnessMark, harnessLabel, harnessTint, normalizeHarnessKey } from "../../../components/HarnessMark.tsx";
import { plainLine } from "./TapText";
import { groupWidgetQuotas, quotaTitle } from "./widget-quotas";
import { formatClockTimestamp, timeAgoPast } from "../../../lib/time";
import { HoverCard, type HoverRest } from "./HoverSummary.tsx";
import { hoverHitId } from "./hover-summary-model.ts";
import { BOARD_ORDER_LABEL, BOARD_ORDER_TITLE, BOARD_ORDERS, type BoardOrder } from "./board-order.ts";
import { dataTransferMayContainFiles, readRoutableFiles } from "../../../lib/media-blobs.ts";
import { ScoutbotFigure } from "../Scoutbot.tsx";
export type WidgetSize = "s" | "m" | "l";
/** When the gauges show (BoardSettings' Meters): always, only while a provider is near its limit, or never. */
export type WidgetMeters = "always" | "high" | "off";
/** A window this used (percent) is near its limit: its ring turns the accent, and "When high" gauges show. */
export const HIGH_USE = 80;
export type Quota = {
  id: string; label: string; window: string; used: number; reset: string; unavailable?: boolean;
  /** Time until reset in days and hours. */
  resetCountdown?: string;
  /** When the provider reported this reading (ms). */
  readAt?: number;
  /** Set only when the reading is old enough to say so ("15h"). */
  age?: string;
};
/** The board's own controls, in every size: New and Settings as icons, and Scoutbot on the mark with the requests waiting on it. */
export type WidgetActions = {
  newOn: boolean; onNew: () => void;
  /** Files dropped on New: a new conversation opens with them attached. */
  onNewFiles?: (files: File[]) => void;
  /** null when Scoutbot is off (Settings › Scoutbot) or has nowhere to open (the stack). */
  bot: { on: boolean; waiting: number; onToggle: () => void } | null;
  settingsOn: boolean; onSettings: () => void;
  /** Hide the companion (the host's own hide); absent where there is no host to hide it. */
  onHide?: () => void;
  /** M and L: how the rows are ordered (board-order.ts); absent, no order toggles. */
  order?: { value: BoardOrder; onChange: (order: BoardOrder) => void };
};
export const REST_KEY = "scout:companion:widget-rest";
export function readRestingSize(): WidgetSize { try { const s = localStorage.getItem(REST_KEY); if (s === "s" || s === "m" || s === "l") return s; } catch {} return "m"; }

/** M and L's width; height follows content. S has no width of its own: it fits its chips, and with none it is the mark alone (this size). */
const WIDTH: Record<WidgetSize, number> = { s: 34, m: 336, l: 440 };
/** S shows this many live sessions as chips; past it, one more chip opens M. */
export const S_CHIPS = 5;
/** A chip comes in once, as it first shows: past this, the same chip mounting again (across the camera) does not. */
const CHIP_IN_MS = 600;
/** M shows this many live sessions at once; the rest scroll into view, by wheel or from the last line, which counts them. */
const M_ROWS = 3;
const SIZE_LABEL: Record<WidgetSize, string> = {
  s: "Make it small",
  m: "Make it medium",
  l: "Make it large",
};

/* ---------- springs as CSS linear() ---------- */

type Spring = { easing: string; ms: number };

/** Simulate a unit spring and sample it into a linear() easing; ms is its settle time. */
function spring(stiffness: number, damping: number, mass = 1): Spring {
  const dt = 1 / 1000;
  let x = 0;
  let v = 0;
  const samples: number[] = [0];
  let t = 0;
  for (; t < 3; t += dt) {
    const a = (-stiffness * (x - 1) - damping * v) / mass;
    v += a * dt;
    x += v * dt;
    samples.push(x);
    if (t > 0.05 && Math.abs(x - 1) < 0.0015 && Math.abs(v) < 0.01) break;
  }
  const n = 36;
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const s = samples[Math.round((i / n) * (samples.length - 1))]!;
    pts.push(i === 0 ? "0" : i === n ? "1" : `${s.toFixed(4)} ${((i / n) * 100).toFixed(1)}%`);
  }
  return { easing: `linear(${pts.join(", ")})`, ms: Math.round(t * 1000) };
}

/** WidgetSize changes: a 3.5% overshoot, settled in ~250 ms. */
const SIZE = spring(1300, 52);
/** Cells, rows, numerals: snappy, a 1% bounce, ~250 ms. */
const SNAP = spring(1500, 62);
/** S's width following its content: a short ease out, never past where it lands. */
const CONTENT_MS = 160;
const CONTENT_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/* ---------- pieces ---------- */

const MARK = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" />
    <path fill="none" stroke="currentColor" strokeWidth="1.6" d="M8.5 12.2l2.4 2.4 4.6-5" />
  </svg>
);

function QuotaGauge({ quota, peek }: { quota: Quota; peek?: HoverRest }) {
  const id = `quota:${quota.id}`;
  const used = quota.unavailable ? 0 : quota.used;
  const percent = quota.unavailable ? "—" : `${used}%`;
  const nearLimit = used > HIGH_USE;
  const tint = harnessTint(quota.label) ?? undefined;
  const anchor = peek?.shown?.id === id ? peek.shown.el : null;
  return (
    <div
      className={`cw-gauge${quota.age ? " is-stale" : ""}`}
      role="img"
      aria-label={quotaTitle(quota)}
      tabIndex={0}
      data-hit={peek ? hoverHitId(id) : undefined}
      onPointerEnter={(event) => peek?.enter(id, event.currentTarget)}
      onPointerLeave={(event) => {
        if (document.activeElement !== event.currentTarget) peek?.leave(id);
      }}
      onFocus={(event) => peek?.enter(id, event.currentTarget)}
      onBlur={() => peek?.leave(id)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.currentTarget.focus();
        peek?.enter(id, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && anchor) {
          event.stopPropagation();
          peek?.press();
        }
      }}
    >
      <HarnessMark harness={quota.label} size={14} title={null} style={{ color: tint }} />
      <span className={`cw-gauge__ring${nearLimit ? " is-high" : ""}`} style={{ "--cw-quota-used": `${used}%` } as CSSProperties}>
        <span className="cw-gauge__value">{percent}</span>
      </span>
      {quota.resetCountdown && <span className="cw-gauge__reset">{quota.resetCountdown}</span>}
      {anchor && createPortal(
        <HoverCard anchor={anchor} beside={anchor.closest<HTMLElement>(".cw-widget")} className="cw-quota-card">
          <div className="cw-quota-card__head">
            <div className="cw-quota-card__provider">
              <HarnessMark harness={quota.label} size={15} title={null} style={{ color: tint }} />
              <strong>{harnessLabel(quota.label)}</strong>
            </div>
            <span>Weekly quota</span>
          </div>
          <div className="cw-quota-card__body">
            <div>
              <span>Used</span>
              <strong className={nearLimit ? "is-high" : undefined}>{percent}</strong>
              {quota.unavailable && <span>Awaiting reading</span>}
            </div>
            <div>
              <span>Resets in</span>
              <b>{quota.resetCountdown ?? "—"}</b>
              {quota.resetCountdown && <span>{quota.reset}</span>}
            </div>
          </div>
          {quota.readAt !== undefined && (
            <div className="cw-quota-card__foot">Read {quota.age ? `${quota.age} ago · ` : ""}{formatClockTimestamp(quota.readAt)}</div>
          )}
        </HoverCard>,
        document.body,
      )}
    </div>
  );
}

/** FLIP: rows that move settle into place on the snap spring; new ones slide in. */
function useFlip(keys: string[], slow: number, reduced: boolean) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    nodes.current.forEach((el, k) => {
      const top = el.getBoundingClientRect().top;
      next.set(k, top);
      const prev = last.current.get(k);
      if (prev === undefined || reduced) return;
      const dy = prev - top;
      if (Math.abs(dy) < 0.5) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: SNAP.ms * slow, easing: SNAP.easing });
    });
    last.current = next;
  }, [keys.join("|"), slow, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  return (k: string) => (el: HTMLElement | null) => {
    if (el) nodes.current.set(k, el);
    else nodes.current.delete(k);
  };
}

/** A chip's harness, or the speaker's monogram when the harness is unknown, so two unknown chips still read apart. */
function HarnessGlyph({ thread }: { thread: StripRow["thread"] }) {
  const known = normalizeHarnessKey(thread.harness) === "unknown" ? null : thread.harness?.trim();
  return known
    ? <HarnessMark harness={known} size={11} title={harnessLabel(known)} style={harnessTint(known) ? { color: harnessTint(known)! } : undefined} />
    : <span className="cw-chip__init" aria-hidden="true">{identityMonogram(rowSpeaker(thread))}</span>;
}

/** How often M's recency labels are read again; a coarse tick, so the time never competes with the dots. */
const AGO_MS = 10_000;
/** A working session's dots never drop below this, so the row reads as working between passes. */
const WORKING_FLOOR = 0.45;
/** An idle or quiet session's dots breathe slowly instead of going still, so a quiet board still reads as alive. */
const IDLE_FLOOR = 0.2;
const dotFloor = (remark: StripRow["remark"]) => (remark === "WORKING" ? WORKING_FLOOR : remark === "IDLE" || remark === "QUIET" ? IDLE_FLOOR : 0);
/** Scoutbot's figure where it stands on the board's top edge. */
const PERCH_SIZE = 40;

/**
 * Who an M row is, in plain type down its two lines: the project's code beside
 * the name, the agent's roster number beside its step ("OS" over "003"). A
 * session the runtime has not numbered shows the code alone; one with no
 * project, its speaker's letters, quieter.
 */
function RowSign({ t, sign, label }: { t: StripRow["thread"]; sign?: string; label?: FigureLabel }) {
  const callSign = sign ?? (label ? figureLabelSign(label) : undefined);
  const [signCode, signNum] = callSign ? callSign.split("-") : [];
  const project = t.project?.trim();
  const code = signCode || label?.project || (project ? identityMonogram(project) : null);
  const num = signNum || label?.code || null;
  const said = callSign ?? (label ? figureLabelText(label) : code ?? undefined);
  const title = [said, project].filter(Boolean).join(", ") || undefined;
  return (
    <span className={`cw-sign${code ? "" : " is-unknown"}`} role="img" aria-label={said ?? identityMonogram(rowSpeaker(t))} title={title}>
      <b aria-hidden="true">{code ?? identityMonogram(rowSpeaker(t))}</b>
      {num && <b aria-hidden="true">{num}</b>}
    </span>
  );
}

/**
 * One live session in M, on two lines, the way a mail list reads: its sign
 * down both lines, then its harness and name with how long ago it last moved
 * at the right; under them the last thing it did or said, with its activity
 * as dots at the right (its state as a word when dots are off or it is done).
 * Time and dots share one right edge in every row. An ask shows the ask,
 * timed from when it began.
 */
function LiveRow({ r, activity, steps, now, dots, label }: { r: StripRow; activity: ReadonlyMap<string, number[]>; steps: ReadonlyMap<string, LatestStep>; now: number; /** Its activity as a field of dots; off, its state as a word. */ dots: boolean; /** Its roster label: the sign carries it. */ label?: FigureLabel }) {
  const t = r.thread;
  const session = plottedSession(t.pinId, t.sessionRef);
  const counts = (session && activity.get(session)) || activity.get(r.id) || [];
  const latest = session ? steps.get(session) : undefined;
  const asking = r.remark === "ASKING";
  // Ready leads with the agent's summary, the way an ask leads with the ask.
  const ready = r.remark === "READY";
  const step = (asking || ready ? plainLine(r.now) : "") || latest?.text || plainLine(r.now) || rowWhere(t);
  const tone = asking ? " is-ask" : !latest || latest.kind === "assistant" ? " is-said" : "";
  const level = fieldIntensity(counts);
  const at = asking ? sinceOf(t) : latest?.at ?? sinceOf(t);
  return (
    <>
      <RowSign t={t} sign={r.sign} label={label} />
      <span className="cw-row__n"><HarnessGlyph thread={t} /><span className="cw-row__name">{r.name ?? (plainLine(t.task) || rowSpeaker(t))}</span></span>
      <time className="cw-row__ago" dateTime={new Date(at).toISOString()} title={formatClockTimestamp(at)}>{timeAgoPast(at, now)}</time>
      {step && <span className={`cw-row__step${tone}`} key={step}>{step}</span>}
      {r.remark === "DONE" || ready || !dots
        ? <span className="cw-row__t">{r.remark.toLowerCase()}</span>
        : <span className="cw-row__dots"><DotField seedKey={r.id} intensity={Math.max(dotFloor(r.remark), level)} /></span>}
    </>
  );
}

/** The order toggles' glyphs: 16px, thin strokes, drawn here. */
const ORDER_GLYPH: Record<BoardOrder, ReactNode> = {
  // Two labelled groups: a short heading over each pair of rows.
  project: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M2.5 3h4M4.5 5.5h9M4.5 7.5h9M2.5 10h4M4.5 12.5h9" />
    </svg>
  ),
  // A clock face.
  time: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M8 5v3.2l2 1.3" />
    </svg>
  ),
  // Rows led by their state: a filled dot, a ring, a dash.
  state: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="4" r="1.5" fill="currentColor" />
      <circle cx="3.5" cy="8" r="1.3" fill="none" stroke="currentColor" strokeWidth="1" />
      <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" d="M2.3 12h2.4M7 4h6.5M7 8h6.5M7 12h6.5" />
    </svg>
  ),
};

/** Project · Time · State: how M and L order their rows, one press each, the one in use pressed. */
function OrderToggles({ order }: { order: NonNullable<WidgetActions["order"]> }) {
  return (
    <span className="cw-order" role="group" aria-label="Order">
      {BOARD_ORDERS.map((o) => (
        <button key={o} type="button" className="cw-ico" aria-pressed={order.value === o} onClick={() => order.onChange(o)}
          title={BOARD_ORDER_TITLE[o]} aria-label={`Order: ${BOARD_ORDER_LABEL[o]}`}>{ORDER_GLYPH[o]}</button>
      ))}
    </span>
  );
}

/** M's rows, without the project headings between them. */
const rowItems = (el: HTMLElement) => (Array.from(el.children) as HTMLElement[]).filter((li) => li.classList.contains("cw-row"));

/**
 * The board's controls as one row of icons, in every size: New, Settings, and
 * the grow button. M and L carry it at the right of the top line; S after its
 * chips, past a hairline. Scoutbot is the mark itself.
 */
/** Hide: a bar sliding down out of view. 16px, thin strokes, drawn here. */
const HIDE_GLYPH = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" d="M5 6.5l3 3 3-3M3.5 12.5h9" />
  </svg>
);

/** M and L: Hide at the left of the top line. */
function StartControls({ actions }: { actions?: WidgetActions }) {
  if (!actions?.onHide) return <span />;
  return (
    <span className="cw-acts is-start" role="toolbar" aria-label="Start">
      {actions.onHide && (
        <button type="button" className="cw-ico cw-hide" onClick={actions.onHide} title="Hide companion" aria-label="Hide companion">{HIDE_GLYPH}</button>
      )}
    </span>
  );
}

/** S: Settings leads, the face sits in the middle, grow ends it. M and L: Settings and grow at the right of the top line; Hide sits at the left. */
function SettingsButton({ actions }: { actions: WidgetActions }) {
  return (
    <button type="button" className="cw-ico" aria-pressed={actions.settingsOn} onClick={actions.onSettings} title="Settings" aria-label="Settings">
      <SlidersHorizontal size={12} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function GrowButton({ size, onSize }: { size: WidgetSize; onSize: (size: WidgetSize) => void }) {
  const larger = size === "s" ? "m" : "l";
  return (
    <button type="button" className="cw-ico cw-grow" onClick={() => onSize(larger)} title={SIZE_LABEL[larger]} aria-label={SIZE_LABEL[larger]}>
      <Maximize2 size={12} strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

function Controls({ size, actions, onSize, className }: { size: WidgetSize; actions?: WidgetActions; onSize: (size: WidgetSize) => void; className?: string }) {
  const smaller = size === "l" ? "m" : "s";
  const larger = size === "s" ? "m" : "l";
  return (
    <span className={`cw-acts${className ? ` ${className}` : ""}`} role="toolbar" aria-label="Board">
      {actions && (
        <>
          <button type="button" className="cw-ico" aria-pressed={actions.settingsOn} onClick={actions.onSettings} title="Settings" aria-label="Settings">
            <SlidersHorizontal size={12} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </>
      )}
      {size !== "s" && (
        <button type="button" className="cw-ico cw-shrink" onClick={() => onSize(smaller)} title={SIZE_LABEL[smaller]} aria-label={SIZE_LABEL[smaller]}>
          <Minimize2 size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
      {size !== "l" && (
        <button type="button" className="cw-ico cw-grow" onClick={() => onSize(larger)} title={SIZE_LABEL[larger]} aria-label={SIZE_LABEL[larger]}>
          <Maximize2 size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </span>
  );
}

/* ---------- the widget ---------- */

export function CompanionWidget({ size, live = [], groups, activity = new Map(), steps = new Map(), tappedId = null, asking, quotas, actions, empty = false, meters = "always", dots = true, openWidth, minWidth = 0, minHeight = 0, perch = null, onSize, onRowsScroll, onRowMenu, peek, labelOf, onMark, markOn = false, onMarkMenu, children, onRow }: {
  size: WidgetSize; asking: number; quotas: Quota[];
  /**
   * M, with Scoutbot on: Scoutbot stands on the board's top edge as a figure, and the bar opens only on hover.
   * Only where there is room above the board (a bottom corner); the figure is drawn beside the widget, so the
   * parent must be positioned. Elsewhere the bar stays, so Scoutbot and its waiting dot are always in reach.
   */
  perch?: {
    /** The figure's pointer region (data-hit), since it stands outside the board's own. */
    hit?: string;
    /** Scoutbot stands on the desk (or is in a drag): the edge is empty, and the bar still rests closed. */
    out?: boolean;
    /** A press on the figure: the host takes the drag from here (DeskScoutbot). */
    press?: (e: ReactPointerEvent<HTMLElement>) => void;
    /** A click that ended a drag does not open Scoutbot. */
    dragged?: (e: MouseEvent<HTMLElement>) => boolean;
  } | null;
  /** L's width when the placement wants more room than the corner's (the notch opens large). */
  openWidth?: number;
  /** Never narrower than this: a notch widens to what hangs from it, so the two are one shape. */
  minWidth?: number;
  /** Never shorter than this: a notch on a side edge grows along it to what comes out of it, as minWidth on top. */
  minHeight?: number;
  /** When the board was last read. No longer shown; kept so callers need not change. */
  readAt?: string;
  /** The subscription gauges: always, only while a provider runs high, or never (the board's settings). */
  meters?: WidgetMeters;
  /** M's rows show their activity as dots; off, each row says its state. */
  dots?: boolean;
  /** New and Settings: icons beside the grow button; Scoutbot: the mark. */
  actions?: WidgetActions;
  /** L's activity rows are supplied as children; hide ordering when those rows are empty. */
  empty?: boolean;
  /** M: the sessions working or asking now, and one that just finished, in the order they arrived (ArrivalsBoard's strip rows). */
  live?: readonly StripRow[];
  /** M grouped by project: the first row of each group, with its heading (board-order.ts groupHeads). */
  groups?: ReadonlyMap<string, string>;
  /** Per session, what it did each pass (passActivity): each M row's dots. */
  activity?: ReadonlyMap<string, number[]>;
  /** Each session's latest step (latestStepBySession): each M row's second line. */
  steps?: ReadonlyMap<string, LatestStep>;
  /** M: the row whose details panel is open beside the widget. */
  tappedId?: string | null;
  /** M: its rows scrolled, so a details panel tethered to one can follow it. */
  onRowsScroll?: () => void;
  /** S and M: a session right-clicked, at this page point (its pop-out menu). Without it, right-click does nothing. */
  onRowMenu?: (id: string, at: { x: number; y: number }) => void;
  /** S and M: the board's hover summary. Each chip and row is a hit region of its own and rests it. */
  peek?: HoverRest;
  /** Each agent out's label (figure-labels.ts), the one its figure wears; absent when labels are off. */
  labelOf?: (t: CornerThread) => FigureLabel | undefined;
  /** A click on the mark while Scoutbot is off: what to do now (the companion's choices). With Scoutbot, the mark opens it. */
  onMark?: () => void;
  /** The choices are open. */
  markOn?: boolean;
  /** A right-click on the mark, at this page point (What to do now, Bring out, Clear all requests). */
  onMarkMenu?: (at: { x: number; y: number }) => void;
  onSize: (size: WidgetSize) => void; children: ReactNode; onRow: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const slow = 1;
  const sim = { size, asking };

  const inner = useRef<HTMLDivElement>(null);
  // The strip's chips: the order they arrived in, and when each first showed (CHIP_IN_MS).
  const chipOrderRef = useRef<string[]>([]);
  const [markDrop, setMarkDrop] = useState(false);
  const chipSeen = useRef(new Map<string, number>());
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  const widthOf = (s: WidgetSize) => (s === "l" && openWidth ? openWidth : WIDTH[s]);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setBox({ w: sim.size === "s" ? el.offsetWidth + 2 : widthOf(sim.size), h: el.offsetHeight + 2 });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sim.size, openWidth]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setAnimate(true), 50); return () => clearTimeout(t); }, []);
  // Only a size step springs. S takes its width from its content (chips arriving, a label filling in, a page
  // that reloaded drawing the mark before its rows); sprung, that grows past its width and back, so the notch
  // seems to swell as it comes out. Content changes ease out instead, with no overshoot.
  const lastSize = useRef(size);
  const [stepping, setStepping] = useState(false);
  useLayoutEffect(() => {
    if (lastSize.current === size) return;
    lastSize.current = size;
    setStepping(true);
    const t = window.setTimeout(() => setStepping(false), SIZE.ms * slow + 40);
    return () => window.clearTimeout(t);
  }, [size]); // eslint-disable-line react-hooks/exhaustive-deps


  const high = meters === "high";
  const gauges = size === "s" || meters === "off" ? [] : groupWidgetQuotas(quotas.filter((quota) => quota.window === "7d"))
    .filter((provider) => !high || (provider.worst?.used ?? 0) > HIGH_USE)
    .sort((a, b) => (b.worst?.used ?? -1) - (a.worst?.used ?? -1))
    .slice(0, 3);
  const showOrder = (sim.size === "l" ? !empty : live.length > 0) ? actions?.order : undefined;
  const [clock, setClock] = useState(() => Date.now());
  const ticking = sim.size === "m" && live.length > 0;
  useEffect(() => {
    if (!ticking) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), AGO_MS);
    return () => window.clearInterval(timer);
  }, [ticking]);
  const flip = useFlip(live.map((r) => r.id), slow, reduced);
  const stagger = (i: number) => ({ animationDelay: `${i * ROW_STEP_MS * 2 * slow}ms` }) as CSSProperties;

  // M's list is as tall as its first M_ROWS rows, and the rest scroll into view.
  // The last line counts the rows below and pages to them.
  const list = useRef<HTMLOListElement>(null);
  const [cap, setCap] = useState<number | undefined>(undefined);
  const [fold, setFold] = useState<{ above: number; below: number } | null>(null);
  const overflow = sim.size === "m" && live.length > M_ROWS;
  const below = fold ? fold.below : Math.max(0, live.length - M_ROWS);
  const readFold = () => {
    const el = list.current;
    if (!el) return;
    const top = el.scrollTop, bottom = top + el.clientHeight;
    let above = 0, under = 0;
    for (const li of rowItems(el)) {
      if (li.offsetTop + li.offsetHeight > bottom + 1) under++;
      else if (li.offsetTop < top - 1) above++;
    }
    setFold((f) => (f && f.above === above && f.below === under ? f : { above, below: under }));
  };
  useLayoutEffect(() => {
    const el = list.current;
    const last = overflow && el ? rowItems(el)[M_ROWS - 1] : undefined;
    setCap(el && last ? last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(el).paddingBottom) : undefined);
  }, [overflow, live.length, groups]);
  useLayoutEffect(readFold, [cap, live.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const scrollList = (top: number) => list.current?.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  /** The last line: the next rows below, or back to the first ones from the end. */
  const page = () => {
    const el = list.current;
    if (!el) return;
    const next = rowItems(el).find((li) => li.offsetTop + li.offsetHeight > el.scrollTop + el.clientHeight + 1);
    scrollList(next ? next.offsetTop - parseFloat(getComputedStyle(el).paddingTop) : 0);
  };
  /** A row clicked half out of view comes all the way in, so its details panel tethers to all of it. */
  const reveal = (li: HTMLElement) => {
    const el = list.current;
    if (!el) return;
    const pad = getComputedStyle(el);
    if (li.offsetTop < el.scrollTop) scrollList(li.offsetTop - parseFloat(pad.paddingTop));
    else if (li.offsetTop + li.offsetHeight > el.scrollTop + el.clientHeight) scrollList(li.offsetTop + li.offsetHeight - el.clientHeight + parseFloat(pad.paddingBottom));
  };
  const vars = {
    "--cw-size-ease": stepping ? SIZE.easing : CONTENT_EASE, "--cw-size-ms": `${reduced || !animate ? 0 : stepping ? SIZE.ms * slow : CONTENT_MS * slow}ms`,
    "--cw-snap-ease": SNAP.easing, "--cw-snap-ms": `${reduced ? 0 : SNAP.ms * slow}ms`,
    "--cw-pulse-ms": `${PULSE_MS * slow}ms`,
    width: Math.max(box?.w ?? widthOf(sim.size), minWidth), height: box && minHeight ? Math.max(box.h, minHeight) : box?.h,
    // The held height reaches the folded strip as a floor, not a stretch: a stretched strip would feed its own measure.
    ...(minHeight ? { "--cw-hold-h": `${minHeight - 2}px` } : {}),
    // The held width reaches the S strip the same way, so its ends meet the edges of what hangs from it.
    ...(minWidth ? { "--cw-hold-w": `${minWidth - 2}px` } : {}),
  } as CSSProperties;
  const markClass = `cw-mark${sim.asking ? " is-asking" : ""}`;
  const menuOn = (id: string) => (e: MouseEvent) => {
    if (!onRowMenu) return;
    e.preventDefault();
    onRowMenu(id, { x: e.clientX, y: e.clientY });
  };
  const rest = (id: string) => peek ? {
    "data-hit": hoverHitId(id),
    onPointerEnter: (e: { currentTarget: HTMLElement }) => peek.enter(id, e.currentTarget),
    onPointerLeave: () => peek.leave(id),
    onPointerDown: () => peek.press(),
  } : {};
  const markMenu = onMarkMenu ? (e: MouseEvent) => { e.preventDefault(); onMarkMenu({ x: e.clientX, y: e.clientY }); } : undefined;
  const bot = actions?.bot ?? null;
  const more = onMarkMenu ? " Right-click for more." : "";
  // With Scoutbot on, the mark is Scoutbot: it opens beside the board, with a dot while requests wait.
  // A file dropped on the mark opens a new conversation with it attached.
  const take = actions?.onNewFiles;
  const carriesFiles = (e: DragEvent<HTMLElement>) => Boolean(take) && dataTransferMayContainFiles(e.dataTransfer);
  const drop = take ? {
    onDragEnter: (e: DragEvent<HTMLElement>) => { if (carriesFiles(e)) { e.preventDefault(); setMarkDrop(true); } },
    onDragOver: (e: DragEvent<HTMLElement>) => { if (!carriesFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
    onDragLeave: () => setMarkDrop(false),
    onDrop: (e: DragEvent<HTMLElement>) => { if (!carriesFiles(e)) return; e.preventDefault(); e.stopPropagation(); setMarkDrop(false); take(readRoutableFiles(e.dataTransfer)); },
  } : {};
  const dropHint = take ? " Drop a file to start a conversation with it." : "";
  const markButton = (glyph: ReactNode, extra = "") => bot ? (
    <button type="button" className={`${markClass}${extra}${bot.waiting ? " has-waiting" : ""}${markDrop ? " is-drop" : ""}`} onClick={bot.onToggle} onContextMenu={markMenu} aria-pressed={bot.on} {...drop}
      aria-label={bot.waiting ? `Scoutbot, ${bot.waiting} waiting` : "Scoutbot"} title={(bot.waiting ? `Scoutbot: ${bot.waiting} waiting.` : "Scoutbot.") + dropHint + more}>
      {glyph}{!extra && bot.waiting > 0 && <i className="cw-ico__dot" aria-hidden="true" />}
    </button>
  ) : onMark ? (
    <button type="button" className={`${markClass}${extra}${markDrop ? " is-drop" : ""}`} onClick={onMark} onContextMenu={markMenu} aria-expanded={markOn} {...drop} aria-label={sim.asking ? `Scout, ${sim.asking} asking` : "Scout"} title={"What to do now." + more}>{glyph}</button>
  ) : null;
  const mark = markButton(MARK);
  // S draws Scout's face in the middle: the same button, with the face Scoutbot wears.
  const face = <ScoutbotFigure look="bone" mood={sim.asking || bot?.waiting ? "ask" : "rest"} size={22} />;
  // M: quiet when nothing is working, asking or compacting. The titles step back; the dots keep breathing.
  const quiet = sim.size === "m" && !live.some((r) => r.remark === "WORKING" || r.remark === "ASKING" || r.remark === "COMPACT");
  // Scoutbot on the board's top edge, as a figure: no plate, no ring. It is the mark, so the bar's mark steps aside.
  const perched = perch !== null && sim.size === "m" && bot !== null;
  const perchFigure = perched && bot && !perch.out ? (
    <button type="button" className={`cw-perch${bot.waiting ? " has-waiting" : ""}${markDrop ? " is-drop" : ""}`} data-hit={perch.hit}
      onPointerDown={perch.press} onClick={(e) => { if (!perch.dragged?.(e)) bot.onToggle(); }}
      onContextMenu={markMenu} aria-pressed={bot.on} {...drop}
      aria-label={bot.waiting ? `Scoutbot, ${bot.waiting} waiting` : "Scoutbot"} title={(bot.waiting ? `Scoutbot: ${bot.waiting} waiting.` : "Scoutbot.") + dropHint + more}
      style={{ "--cw-perch": `${PERCH_SIZE}px` } as CSSProperties}>
      <ScoutbotFigure look="bone" mood={sim.asking || bot.waiting ? "ask" : "rest"} working={!quiet} size={PERCH_SIZE} />
    </button>
  ) : null;
  const sFace = markButton(face, " cw-face")
    ?? <button type="button" className={`${markClass} cw-face`} onClick={() => onSize("m")} aria-label="Make it medium" title="Make it medium">{face}</button>;

  // S: a chip per live session. When the notch hangs from a camera, the first half sit before it and the rest after.
  // Which sessions get a chip follows `live` (an ask first); where each sits does not: the chips keep the order they
  // arrived in (arrivalOrder), so a state change recolours a chip in place instead of moving it. Only a newcomer
  // comes in: a chip that crosses the camera when the count changes is the same chip, so it does not come in again.
  const picked = live.slice(0, S_CHIPS);
  const chipOrder = sim.size === "s" ? arrivalOrder(chipOrderRef.current, picked.map((r) => r.id)) : [];
  const chipsShown = chipOrder.map((id) => picked.find((r) => r.id === id)!);
  const now = Date.now();
  for (const id of chipOrder) if (!chipSeen.current.has(id)) chipSeen.current.set(id, now);
  const fresh = (id: string) => now - (chipSeen.current.get(id) ?? now) < CHIP_IN_MS;
  const leadChips = Math.ceil(chipsShown.length / 2);
  chipOrderRef.current = chipOrder;
  // One that left and comes back comes in again; folded away, they all do.
  for (const id of chipSeen.current.keys()) if (!chipOrder.includes(id)) chipSeen.current.delete(id);
  const chip = (r: StripRow, i: number) => {
    const tag = labelOf?.(r.thread);
    // Its label leads; a line with a sign and no label (the board gives both from the roster) leads with the sign.
    const name = [tag ? figureLabelText(tag) : r.sign, r.name ?? (plainLine(r.thread.task) || rowSpeaker(r.thread))].filter(Boolean).join(" ");
    const tapped = tappedId === r.id;
    return (
      <button key={r.id} type="button" data-k={`line:${r.id}`} className={`cw-chip${fresh(r.id) ? " cw-in" : ""} is-${r.remark.toLowerCase()}${tapped ? " is-tapped" : ""}${tag ? " has-tag" : ""}`} style={stagger(i + 1)}
        onClick={() => onRow(r.id)} onContextMenu={menuOn(r.id)} {...rest(r.id)} aria-expanded={tapped} aria-label={`${name}, ${r.remark.toLowerCase()}`}>
        <HarnessGlyph thread={r.thread} />
        {tag && <span className="cw-chip__tag">{figureLabelText(tag)}</span>}
      </button>
    );
  };

  return (
    <>
    {perchFigure}
    <div onContextMenu={(e) => e.preventDefault()} className={`cw-widget is-${sim.size}${quiet ? " is-quiet" : ""}${perched ? " has-perch" : ""}${reduced ? " is-reduced" : ""}`} style={vars}>
      {/* M and L take the held width too (a panel or a sheet hangs from a top or bottom notch), so the top line's
          Hide, mark and controls reach the face's ends instead of bunching in its middle. */}
      <div className="cw-inner" ref={inner} key={sim.size} style={sim.size === "s" ? undefined : { width: Math.max(widthOf(sim.size), minWidth) - 2 }}>
        {/* S: the mark, and a chip per live session; nothing running, the mark alone. A chip opens its session's details beside the widget. */}
        {sim.size === "s" && (
          <div className={`cw-s${live.length ? " has-live" : ""}${minWidth ? " is-held" : ""}`}>
            {/* Settings leads, Scout's face sits in the middle, and the grow button ends it; the chips fill the halves
                between. Around a camera the halves sit either side of the housing, in the menu bar's row. */}
            <span className="cw-s__half is-lead">
              {actions && <span className="cw-acts is-lead cw-in" role="toolbar" aria-label="Board settings"><SettingsButton actions={actions} /></span>}
              {chipsShown.slice(0, leadChips).map(chip)}
            </span>
            <span className="cw-s__mid">{sFace}</span>
            <span className="cw-s__half is-tail">
              {chipsShown.slice(leadChips).map((r, i) => chip(r, i + leadChips))}
              {live.length > S_CHIPS && <button type="button" className="cw-chip is-more cw-in" style={stagger(S_CHIPS + 1)} onClick={() => onSize("m")} title="Show them all in medium">+{live.length - S_CHIPS}</button>}
              <span className="cw-acts cw-in" role="toolbar" aria-label="Board">
                <GrowButton size={sim.size} onSize={onSize} />
              </span>
            </span>
          </div>
        )}

        {sim.size !== "s" && (
          <div className={`cw-panel is-${sim.size}`}>
            {/* On top: the last read, the mark (Scoutbot), and the controls. The gauges sit above the sessions. */}
            <div className="cw-top" data-board-grip="">
              <StartControls actions={actions} />
              {mark ?? <span className={markClass} role="img" aria-label="Scout">{MARK}</span>}
              <Controls size={sim.size} actions={actions} onSize={onSize} />
            </div>
            {(gauges.length > 0 || showOrder) && (
              <div className="cw-tools" data-board-grip="">
                {gauges.length > 0 && (
                  <div className="cw-gauges" aria-label="Subscription usage" role="group">
                    {gauges.map((provider) => (
                      <QuotaGauge key={provider.label} quota={provider.worst ?? provider.windows[0]!} peek={peek} />
                    ))}
                  </div>
                )}
                {showOrder && <OrderToggles order={showOrder} />}
              </div>
            )}

            {sim.size === "l" ? children : <ol ref={list} className={`cw-rows${overflow && below ? " has-below" : ""}${overflow && fold?.above ? " has-above" : ""}`} style={cap ? { maxHeight: cap } : undefined}
              onScroll={() => { readFold(); onRowsScroll?.(); }}>
              {live.length === 0 && <li className="cw-empty cw-in">Nothing running.</li>}
              {live.map((r, i) => [
                groups?.has(r.id) && <li key={`group:${groups.get(r.id)}`} className="cw-group cw-in" style={stagger(i + 1)} role="presentation">{groups.get(r.id)}</li>,
                <li key={r.id} ref={flip(r.id)} data-k={`line:${r.id}`} onClick={(e) => { reveal(e.currentTarget); onRow(r.id); }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRow(r.id); } }} onContextMenu={menuOn(r.id)} role="button" tabIndex={0} aria-expanded={tappedId === r.id} className={`cw-row cw-in is-${r.remark.toLowerCase()}${tappedId === r.id ? " is-tapped" : ""}`} style={stagger(i + 1)} {...rest(r.id)}>
                  <LiveRow r={r} activity={activity} steps={steps} now={clock} dots={dots} label={labelOf?.(r.thread)} />
                </li>,
              ])}
            </ol>}
            {overflow && <button type="button" className="cw-more cw-in" style={stagger(M_ROWS + 1)} onClick={page} title={below ? "Scroll to the next sessions" : "Back to the first sessions"}>{below ? `+${below} more` : "Back to top"}</button>}

          </div>
        )}
      </div>
    </div>
    </>
  );
}

