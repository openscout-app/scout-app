import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  DEFAULT_FIGURE_DEFAULTS,
  companionKeepClear,
  onCompanionFigureDrag,
  onCompanionOverlay,
  onCompanionRetract,
  onCompanionSummoned,
  onCompanionPointer,
  openFromCompanion,
  moveCompanionToPointerDisplay,
  pinToCompanion,
  placeCompanionFigure,
  reportCompanionHitRegions,
  reportCompanionLabels,
  reportCompanionLayout,
  hideCompanion,
  sendCompanionFiguresHome,
  setCompanionEngaged,
  setCompanionNotch,
  setCompanionPreferences,
  type CompanionCorner,
  type CompanionFigure,
  type CompanionHitRegion,
  type CompanionLabelRect,
} from "../../../lib/companion-host.ts";
import { isDeclaredRequest, isReadyRequest } from "../../requests/requests-model.ts";
import { clearAllOf, type ClearAll } from "../../requests/clear-requests.ts";
import { useOperatorRequests } from "../../../lib/use-operator-requests.ts";
import { useCompanionHostState } from "../useCompanionHostState.ts";
import { Acts, useNow, useWork } from "../system-corner/SystemCorner.tsx";
import { sessionThreads, useBoardSessionRows, withIdentity } from "./board-sessions.ts";
import { useCompanionRoster } from "../companion-roster.ts";
import { buildCornerThreads, figureIdOf, placesFor, type CornerThread } from "../system-corner/system-corner-model.ts";
import { BlinkLayer } from "../blink/BlinkLayer.tsx";
import { demoFlights, FlightLayer, runtimeFlights } from "../flight/FlightLayer.tsx";
import { deskFigures, type FlightDesk } from "../flight/message-flight-model.ts";
import { useOperatorActorIds } from "../../../lib/operator-ids.ts";
import { NewConversation } from "./ArrivalsDetail.tsx";
import { BoardSettings, ScoutbotBeside, useBoardPrefs } from "./BoardSettings.tsx";
import { groupHeads, orderRows } from "./board-order.ts";
import { DeskPlates, PLATE_CARD, release } from "./DeskPlates.tsx";
import { DeskScoutbotFigure, useDeskScoutbot } from "./DeskScoutbot.tsx";
import { DEMO_DESK, demoDesk, type DemoOut } from "./desk-demo.ts";
import { CHOICES_WIDTH, CompanionChoices, MarkMenu, type MarkMenuAgent } from "./CompanionChoices.tsx";
import { companionChoices, holdChoices, readLookedAt, writeLookedAt, type CompanionChoice } from "./companion-choices.ts";
import { FigureMenu } from "./FigureTalk.tsx";
import { FigureSettings } from "./FigureSettings.tsx";
import { startRowPull, type RowPullCue } from "./row-pull.ts";
import { popOutSpot } from "./pop-out.ts";
import { formOf, setDeskForm } from "./desk-form.ts";
import { figureSlot, type PageEdges } from "../figure-model.ts";
import { RemarkCells, Roll, type BoardLook } from "./BoardCells.tsx";
import { LabelTag, Marks } from "./Ident.tsx";
import { figureLabelOf, figureLabelSign, figureLabelText, type FigureLabel } from "./figure-labels.ts";
import { DEMO_LOOP_MS, demoRosterTag, demoThreads } from "./arrivals-demo.ts";
import { rosterProjectsOf, rosterTagFor } from "./roster-model.ts";
import { usePinAgents, useRuntimeRoster } from "./runtime-roster.ts";
import { anchorBoard, boardInsetStyle, boardLead, floatingBoardStyle, floatingCorner, floatShareOf, boardPass, remarkOf, rowName, rowSpeaker, settledRow, sinceClock, sinceDay, sinceOf, type BoardMemory, type BoardRow, type BoardSection } from "./arrivals-model.ts";
import { EASE_OUT, ENTER_MS, FOLD_GRACE_MS, FOLD_MS, HOVER_INTENT_MS, MOTION_VARS, nextPassIn, openDelay, passFloor, prefersReducedMotion, pulseDelay } from "./board-motion.ts";
import { BOARD_MOVE_HIT_ID, boardMoveHandler } from "./board-move.ts";
import { SHEET_HIT_ID, SHEET_WIDTH, sheetPlacement, type SheetPlacement } from "./board-sheet.ts";
import { BoardSheet } from "./BoardSheet.tsx";
import { useBoardUnfold } from "./board-unfold.ts";
import { TapInPanel, TapInTether, type TapInHandle } from "./TapInPanel.tsx";
import { QuickTerminalHost, useQuickTerminal } from "./QuickTerminal.tsx";

/** What the quick terminal stands clear of: the board and any panel open beside it. */
function keepClearOfBoard() {
  const box = companionKeepClear();
  return box ? { left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height } : null;
}
import { TAP_IN_HIT_ID, TAP_IN_SIZE, permissionPresentation, tapInKeyAction, tapInTarget, type TapInNotch, type TapInPlacement, type TapInTranscript } from "./tap-in-model.ts";
import { plainLine } from "./TapText.tsx";
import { NOTCH_ARRIVE_EASE, NOTCH_ARRIVE_MS, notchAwayOnVisible, notchBoardStyle, notchCorner, NOTCH_FOLD_MS, notchDropEdge, notchHeld, NOTCH_IDLE_MS, notchInsets, NOTCH_LEAVE_MS, notchOpenWidth, NOTCH_PEEK_MS, notchPlace, NOTCH_RETRACT_MS, notchSizeStep, type NotchAway } from "./notch-model.ts";
import { FoldStrip, type StripRow } from "./FoldStrip.tsx";
import { api } from "../../../lib/api.ts";
import { ScoutMark } from "../../../components/ScoutMark.tsx";
import { arrivalOrder, demoPassActivity, DONE_LINGER_MS, latestStepBySession, passActivity, plottedSession, stripPage, stripWorthy } from "./board-strip.ts";
import { formatSessionRouteRef } from "../../../../shared/session-route-ref.ts";
import { formatRenamePolicy } from "../../../../shared/session-rename.ts";
import { closedTap, closeTap, detailsTap, engageTap, escapeLevel, panelRowOf, rowRectIn, settleTap, showsDetails, stackRoom, TAP_CLOSED, tapKeyStep, tapLayout, tapRow, tapRowClass, widgetWalk, type TapSel } from "./tap-in-board.ts";
import "../system-corner/system-corner.css";
import "./arrivals.css";
import { CompanionWidget, readRestingSize, REST_KEY, S_CHIPS, type WidgetSize } from "./CompanionWidget";
import { useServiceBudgets } from "../../harnesses/use-service-budgets";
import { widgetQuotas } from "./widget-quotas";
import { HoverSummary, useHoverRest, type HoverRest } from "./HoverSummary.tsx";
import { HOVER_HIT, hoverHitId, hoverIdOf } from "./hover-summary-model.ts";

/*
 * The arrivals board (Studio: /studies/companion-looks-ii, take 2), an opt-in
 * companion surface beside CompanionScreen and the system corner.
 * companion/main.tsx mounts it for `?corner=arrivals` or localStorage
 * `scout:companion:corner = arrivals`.
 *
 *  - Folded, it is one row: the most urgent thread, plus a count. An ask
 *    folds with its Allow once / Deny, so the decision never needs the board.
 *  - Open (hover), it is the crew, one line a row (Studio
 *    /studies/companion-board-light): the project's tile and the harness
 *    coin, who speaks and what it last said in its own words, then the
 *    remark and its time on one size of cell. Board draws it on the
 *    companion's flaps; Business (Settings › Look) in the app's theme, plain
 *    type. Corners follow the app's (Settings › Look).
 *  - It rewrites on a pass (Studio /studies/companion-board-rewrites): every
 *    PASS_MS on the wall clock, rows with something new rewrite from the
 *    corner, only the cells that changed turn, and a row that changed
 *    section glides to its place. Between passes nothing moves but an ask,
 *    which breaks in at once and blinks. Rows hold their order between
 *    passes, open or folded, so nothing reorders on engage.
 *  - `blink` (off unless turned on): a new ask runs one thin light along
 *    the screen edge to the board (BlinkLayer); nothing glows. Drawn only
 *    where the page covers the screen: edge mode or a browser preview.
 *  - `demo`: a scripted crew instead of live data, for watching it move.
 *  - Folded, a click opens the board. Open, a click on a row (or a chip at
 *    S and M, or a line of the folded strip) opens its engage panel beside
 *    the board (above it in the host's stack), at the row: its open request
 *    with the request's actions, the last few turns and the reply line,
 *    focused (TapInPanel, level "engage", the body a figure's card shows).
 *    Details (what it last said whole, its steps, files, places, facts and
 *    the actions that aren't quick) is one step on: the panel's link, ⌘I,
 *    or Details in the right-click menu; esc steps back. The board holds
 *    still: the row only takes a ring, and the panel a notch pointing at it
 *    (its tether). Details opens where the engage panel stands. Another row swaps the
 *    panel there; the same row, esc or × folds it. ↑/↓ move the cursor (an
 *    open panel follows as the engage panel, also from its empty reply
 *    line), ↩ opens or folds, ⌘O opens the primary place, ⌘↩ allows a
 *    backed request, typing goes to the reply. The reply line asks the Mac
 *    app for the board keys as it takes focus, as a figure's card does.
 *  - New (n) starts a conversation with any agent, in a sheet beside the board
 *    (Settings opens there too); the stack, with no room beside, opens both in L.
 *  - esc folds one level; a draft or a focused input holds the board open,
 *    and so does an open panel until a click lands outside the board. A
 *    click outside lets a focused field go; only a draft or Scoutbot holds.
 *
 * The storyline (2026-10-14) gives it three layers:
 *  1. this board, in the corner the operator picks: Arrivals (what came
 *     back: asks for you, work waiting on you, work done) over Departures
 *     (asks still out with an agent);
 *  2. Scoutbot beside it, from its button in every size, or off (Settings);
 *  3. attached agents: drag a row off the board onto an app window or the
 *     desk as a figure or a strip (DeskPlates); ⌃⌥Space shows and hides them.
 */

const REGION_ID = "popover";
const DESK_KEY = "scout:companion:desk-shown";

function readDeskShown(): boolean {
  try { return window.localStorage.getItem(DESK_KEY) !== "0"; } catch { return true; }
}

function writeDeskShown(shown: boolean): void {
  try { window.localStorage.setItem(DESK_KEY, shown ? "1" : "0"); } catch { /* storage unavailable: session only */ }
}
const EMPTY_FIGURES: CompanionFigure[] = [];
const EMPTY_ROWS: BoardRow[] = [];
/** A demo ask's decision: moves the scripted row on, reaches nothing. */
function DemoActs({ onAnswer }: { onAnswer: () => void }) {
  return (
    <span className="scx-acts">
      <button type="button" className="is-primary" onClick={onAnswer}>Allow once</button>
      <button type="button" onClick={onAnswer}>Deny</button>
    </span>
  );
}

function useDemo(on: boolean): { threads: CornerThread[]; answer: (id: string | readonly string[]) => void } {
  const [start] = useState(() => Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const [answered, setAnswered] = useState<{ loop: number; ids: Set<string> }>({ loop: 0, ids: new Set() });
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [on]);
  const elapsed = tick - start;
  const loop = Math.floor(elapsed / DEMO_LOOP_MS);
  const ids = answered.loop === loop ? answered.ids : new Set<string>();
  const threads = useMemo(() => (on ? demoThreads(elapsed, ids, tick) : []), [on, elapsed, ids, tick]);
  const answer = (id: string | readonly string[]) => setAnswered({ loop, ids: new Set([...ids, ...(typeof id === "string" ? [id] : id)]) });
  return { threads, answer };
}

/** A row's right-click menu: as wide as a figure's (DeskPlates). */
const ROW_MENU_WIDTH = 216;

/** A row written on the pass: its cells turn only when their value changed. */
/** The part of `el` its scrolling lists leave in sight (empty when none), up to the board's region. */
function seenRect(el: HTMLElement): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
  for (let up = el.parentElement; up && up.dataset.hit !== REGION_ID; up = up.parentElement) {
    const o = getComputedStyle(up);
    if (o.overflowX === "visible" && o.overflowY === "visible") continue;
    const c = up.getBoundingClientRect();
    left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function Row({ r, look, passAt, delay = 0, riffleAt, order, onOpen, onPlace, onDemoAnswer, onDragOut, onMenu, tapped = "", placed, peek, label, onPullCue }: { onPullCue: (cue: RowPullCue | null) => void; /** Its roster label (figure-labels.ts): the one its figure wears. */ label?: FigureLabel; /** A right-click on the row, at this page point: its menu. */ onMenu?: (t: CornerThread, at: { x: number; y: number }) => void; /** The board's hover summary: the row is a region of its own and rests the summary. */ peek?: HoverRest; r: BoardRow; look: BoardLook; /** The pass it was written on: an earlier day's time says its weekday. */ passAt: number; /** When this row comes in: its place in the opening wave, or its turn in a pass. Taken once, as it mounts. */ delay?: number; /** Opening: when the board opened, so the flaps riffle. */ riffleAt?: number; /** Its place on the open board (CSS order); the ask strip sits after it. */ order?: number; onOpen: (t: CornerThread) => void; onPlace: (t: CornerThread) => void; onDemoAnswer?: (id: string) => void; /** Release past the board rim to bring the agent onto the desk. */ onDragOut?: (t: CornerThread) => void; /** Tap in: " is-tapped" while its panel is open, " is-cursor" while it is the cursor (tapRowClass). */ tapped?: string; /** Attached to a window or the desk. */ placed?: boolean }) {
  const t = r.thread;
  // An entrance plays once; a later delay would send a landed row back to its start.
  const [enter] = useState(delay);
  // Later in a pass's stagger, the row holds still until its turn: its old
  // remark keeps its tone and dimming until the flaps start to turn.
  const [, turned] = useState(0);
  const waiting = r.remarkAt > Date.now();
  useEffect(() => {
    const wait = r.remarkAt - Date.now();
    if (!(wait > 0)) return;
    const timer = window.setTimeout(() => turned((n) => n + 1), wait);
    return () => window.clearTimeout(timer);
  }, [r.remarkAt]);
  const shown = waiting ? r.prevRemark : r.remark;
  const asking = shown === "ASKING";
  // Ready: done, and the next move is the operator's. Steady, in its own colour; never the ask's blink.
  const ready = shown === "READY";
  const settled = shown === "DONE" || shown === "ENDED";
  const tone = asking ? "accent" : settled ? "dim" : undefined;
  // Nothing said yet: what it is about, quiet, unless that is only who it is.
  const about = rowName(t);
  const quiet = about === rowSpeaker(t) ? "" : about;
  const command = t.request ? permissionPresentation(t.request)?.command ?? null : null;
  const pulled = useRef(false);
  const stopPull = useRef<(() => void) | null>(null);
  useEffect(() => () => stopPull.current?.(), []);
  // Every asking row blinks off the page clock, so they blink together.
  const pulse = useMemo(() => (r.asking ? pulseDelay(performance.now()) : 0), [r.asking]);
  const motion = { "--arv-d": `${enter}ms`, "--arv-pulse-d": `${pulse}ms` } as CSSProperties;
  const at = (k: number) => (order === undefined ? motion : ({ ...motion, order: order + k }) as CSSProperties);
  return (
    <>
      <li
        data-k={`row:${r.id}`}
        data-remark={look === "business" ? shown : r.remark}
        className={`arv-row ${asking ? "is-asking" : ready ? "is-ready" : settled ? "is-ended" : "is-working"}${r.now ? "" : " is-quiet"}${tapped}${placed ? " is-placed" : ""}${onDragOut ? " is-pullable" : ""}`}
        aria-current={tapped === " is-tapped" || undefined}
        style={at(0)}
        data-hit={peek ? hoverHitId(r.id) : undefined}
        onPointerDown={(e) => {
          peek?.press();
          if (e.button !== 0 || (e.target as Element).closest("button, input, textarea, a")) return;
          stopPull.current?.();
          pulled.current = false;
          if (!onDragOut) return;
          const board = e.currentTarget.closest(".arv-board");
          e.currentTarget.setPointerCapture(e.pointerId);
          stopPull.current = startRowPull({
            from: { x: e.clientX, y: e.clientY }, pointerId: e.pointerId,
            box: () => board?.getBoundingClientRect() ?? null,
            preview: onPullCue, moved: () => { pulled.current = true; },
            drop: () => onDragOut(t),
          });
        }}
        onPointerEnter={peek ? (e) => peek.enter(r.id, e.currentTarget) : undefined}
        onPointerLeave={() => peek?.leave(r.id)}
        onClick={() => { if (!pulled.current) onOpen(t); pulled.current = false; }}
        onContextMenu={onMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onMenu(t, { x: e.clientX, y: e.clientY }); } : undefined}
      >
        <Marks project={t.project} harness={t.harness} agent={rowSpeaker(t)} />
        <span className="arv-said">
          <b className="arv-name">{rowSpeaker(t)}</b>
          <LabelTag label={label} />
          <span className="arv-now">
            {r.now ? <Roll text={plainLine(r.now)} prev={plainLine(r.prevNow)} k={r.roll} at={r.rollAt} /> : <span className="arv-line is-quiet">{quiet}</span>}
          </span>
        </span>
        <RemarkCells
          look={look}
          word={look === "business" ? shown : r.remark}
          tone={tone}
          changedAt={r.remarkAt}
          riffleAt={riffleAt}
          delay={enter}
          hh={r.hh}
          mm={r.mm}
          hhAt={r.hhAt}
          mmAt={r.mmAt}
          day={sinceDay(sinceOf(t), passAt)}
        />
      </li>
      {(t.request || (onDemoAnswer && r.asking)) && (
        <li data-k={`ask:${r.id}`} className={`arv-ask${t.request && isReadyRequest(t.request) ? " is-ready" : ""}`} style={at(1)} onClick={(e) => e.stopPropagation()}>
          <span className="arv-ask__task">{t.request && isReadyRequest(t.request) ? t.request.title : t.task}</span>
          {command && <code className="arv-ask__cmd" title={command}>{command}</code>}
          {t.request ? <Acts t={t} onOpenPlace={onPlace} /> : <DemoActs onAnswer={() => onDemoAnswer!(t.id)} />}
        </li>
      )}
    </>
  );
}

/**
 * A row that moved on a pass glides from where it was (FLIP, on the
 * `translate` property so the rows' own entrance transform is untouched).
 */
function glideFrom(el: HTMLElement, dy: number): void {
  el.style.setProperty("transition", "none");
  el.style.setProperty("translate", `0 ${dy}px`);
  void el.offsetWidth;
  el.style.setProperty("transition", "translate var(--arv-enter) var(--arv-ease)");
  el.style.setProperty("translate", "0 0");
  const done = (e: TransitionEvent) => {
    if (e.target !== el || e.propertyName !== "translate") return;
    el.style.removeProperty("transition");
    el.style.removeProperty("translate");
    el.removeEventListener("transitionend", done);
  };
  el.addEventListener("transitionend", done);
}

/** The board's pass clock: the last pass, moved on as each one lands. */
function usePassClock(): number {
  const [pass, setPass] = useState(() => passFloor(Date.now()));
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      timer = window.setTimeout(() => { setPass(passFloor(Date.now())); arm(); }, nextPassIn(Date.now()));
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);
  return pass;
}

export function ArrivalsBoard({ demo = false, blink }: { demo?: boolean; /** Forced on or off by the page's URL; otherwise the board's settings say. */ blink?: boolean }) {
  const host = useCompanionHostState();
  const edgeMode = host.state?.mode === "edge";
  const preview = !host.available;
  const fullDisplay = edgeMode || preview;
  // In the panel, the layer waits for the host's first state: until then the page cannot tell a
  // corner from the notch, and drawing the corner board first makes it jump into the notch.
  const waiting = host.available && !host.state && !host.error;
  // The host's stack: the companion is a window the size of what the page reports, so Tap in opens above or below the board.
  const stackMode = !fullDisplay;
  const [prefs, setPrefs] = useBoardPrefs();
  // Floating (Settings › Companion): the board stands on the bottom edge at the host's stored share, not in a corner.
  const floating = fullDisplay && host.state?.edgeAnchor === "floating";
  const floatShare = host.state?.edgeFloat ?? 0.5;
  // The notch (Settings › Notch): the board hangs from the middle of a screen edge and opens out of it. It needs the whole display, as the desk does.
  const notch = fullDisplay && prefs.place === "notch";
  const corner: CompanionCorner = notch ? notchCorner(prefs.notchEdge) : floating ? floatingCorner(floatShare) : (fullDisplay && prefs.corner) || host.state?.corner || "bottom-right";
  const top = corner.startsWith("top");
  const left = corner.endsWith("left");

  const requests = useOperatorRequests();
  const work = useWork();
  const now = useNow(15_000);
  const pass = usePassClock();
  const scripted = useDemo(demo);
  const roster = useCompanionRoster();
  const sessions = useBoardSessionRows(roster.agents, roster.operatorName ?? null);
  // The pool reads the clock at the pass, so a row goes QUIET on the pass its five minutes run out.
  const live = useMemo(
    () => withIdentity([...buildCornerThreads(work, requests.state?.items ?? [], pass), ...sessionThreads(sessions.rows, work, pass, sessions.latest, sessions.reads)], work, roster.agents, sessions.conversations),
    [work, requests.state, sessions, pass, roster.agents],
  );
  const pool = demo ? scripted.threads : live;
  const figures = host.state?.figures ?? EMPTY_FIGURES;
  // The browser preview's demo stands a few scripted agents on the desk (desk-demo.ts); with a host, the desk is the host's.
  // Bring out on the demo desk stands the agent there too; nothing reaches a host.
  const [demoOut, setDemoOut] = useState<DemoOut[]>([]);
  const deskDemo = useMemo(
    () => (demo && preview ? demoDesk(pool, { width: window.innerWidth, height: window.innerHeight }, demoOut) : null),
    [demo, preview, pool, demoOut],
  );
  const demoDeskOn = deskDemo !== null;
  useEffect(() => {
    if (!demoDeskOn) return;
    for (const d of DEMO_DESK) if (formOf(d.id) !== d.form) setDeskForm(d.id, d.form);
  }, [demoDeskOn]);
  const placed = useMemo(() => new Set(figures.filter((f) => f.placement.kind !== "home" && !f.hidden).map((f) => f.workId)), [figures]);

  // The notch starts folded to its strip; a corner comes back to the size chosen last.
  const [widgetSize, setWidgetSize] = useState<WidgetSize>(() => (notch ? "s" : readRestingSize()));
  const [open, setOpen] = useState(() => !notch && readRestingSize() === "l");
  const [composing, setComposing] = useState(false);
  const [newFiles, setNewFiles] = useState<{ batch: number; files: File[] } | null>(null);
  const newBatch = useRef(0);
  const [settings, setSettings] = useState(false);
  const [botOpen, setBotOpen] = useState(false);
  const budgets = useServiceBudgets();
  const quotas = widgetQuotas(budgets.gauges, new Date(now));
  /**
   * S and M are where it rests: the next launch comes back to the one chosen
   * last. A details panel opened in M stays open into L;
   * moving down to S or M closes it.
   */
  /** The notch: the pointer is on the board. Opening it on purpose counts, until a real leave. */
  const notchOver = useRef(false);
  const changeSize = (size: WidgetSize) => {
    // The notch is its strip or the open board (notch-model.ts notchSizeStep).
    if (notch) {
      if (notchSizeStep(widgetSize, size) === "open") doOpen();
      else foldNotchRef.current();
      return;
    }
    if (size === "l") notchOver.current = true;
    setWidgetSize(size); setOpen(size === "l"); setRowMenu(null); setMarkMenu(null);
    if (size === "l") return;
    try { localStorage.setItem(REST_KEY, size); } catch {}
    if (size !== widgetSize) setTap(TAP_CLOSED);
    // A sheet and Scoutbot sit beside the board at any size; the stack draws its sheets inside L.
    if (!fullDisplay) { setSettings(false); setComposing(false); }
  };
  /** The open, and the folded card it grew from: the unfold starts at that size and the fold returns to it. */
  const [opened, setOpened] = useState<{ at: number; w: number; h: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  /** A session's right-click menu (any size), and where it opened. */
  const [rowMenu, setRowMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const rowMenuRef = useRef<HTMLDivElement>(null);
  /** The mark's right-click menu: Bring out, Clear all requests. */
  const [markMenu, setMarkMenu] = useState<{ x: number; y: number } | null>(null);
  /**
   * A click on the mark: a few things to do now, beside the board where a
   * sheet sits (companion-choices.ts). Catch up reads from the last look, which
   * moves on when the card closes.
   */
  const [choices, setChoices] = useState(false);
  const lookedAt = useRef<number | null>(null);
  /** What the card opened with: it holds those rows while it is open (holdChoices). */
  const heldChoices = useRef<CompanionChoice[]>([]);
  const choicesDraft = useRef(false);
  const onChoicesDraft = useCallback((b: boolean) => { choicesDraft.current = b; }, []);
  const closeChoices = () => {
    if (!choices) return;
    setChoices(false);
    choicesDraft.current = false;
    writeLookedAt(Date.now());
  };
  /** New from the choices: the project it opens on. */
  const [newProject, setNewProject] = useState<string | null>(null);
  /** Tap in: the cursor row and whether its panel is open (tap-in-board). */
  const [tap, setTap] = useState<TapSel>(TAP_CLOSED);
  const tapShowing = tap.open && !tap.closing;
  // The hover summary on the board's rows and chips, and (hush) the desk's: not while a panel or a menu of the board's is up.
  const boardBusy = tapShowing || choices || settings || composing || botOpen || rowMenu !== null || markMenu !== null;
  const peek = useHoverRest(boardBusy);
  const { enter: peekEnter, leave: peekLeave } = peek;
  const peekThread = peek.shown ? pool.find((x) => x.id === peek.shown!.id) ?? null : null;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || widgetSize === "l") return;
      const target = e.target as HTMLElement | null;
      // The panel's own reply line: Esc and ↑/↓ are the board's, not the field's (a draft holds Esc in the field).
      const inPanel = Boolean(target?.closest?.(".tap-panel"));
      const typing = Boolean(target?.closest?.("input,textarea,select"));
      // S and M: with a panel open, ↑/↓ walk the widget's rows and the panel follows as the engage panel.
      if (tapShowing && (e.key === "ArrowDown" || e.key === "ArrowUp") && !rowMenu && !markMenu) {
        const emptyReply = typing && inPanel && (target as HTMLInputElement | HTMLTextAreaElement).value === "";
        const action = tapInKeyAction(e, { tag: typing ? "INPUT" : target?.tagName ?? "", open: true, emptyReply });
        const order = widgetWalk(widgetLines, widgetSize, S_CHIPS);
        const step = tapKeyStep(action, tap, order, tap.id === null ? -1 : order.indexOf(tap.id));
        if (!step) return;
        e.preventDefault();
        selectTap(step);
        // M lists its first rows and scrolls to the rest: a cursor past them brings its row into view, and the panel follows it.
        const line = step.id === null ? null : boardRef.current?.querySelector<HTMLElement>(`[data-k="line:${step.id}"]`);
        line?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (e.key !== "Escape") return;
      if (rowMenu) { e.preventDefault(); setRowMenu(null); return; }
      if (markMenu) { e.preventDefault(); setMarkMenu(null); return; }
      const inSheet = Boolean(target?.closest?.(".arv-sheet"));
      if (!inSheet && !inPanel && typing) return;
      if (inPanel && typing && tapDraft.current) { e.preventDefault(); target?.blur?.(); return; }
      if (choices) { e.preventDefault(); target?.blur?.(); closeChoices(); return; }
      // S and M: Esc closes what is open beside the widget first (a sheet, Scoutbot, Details back to the engage panel, the panel); then M makes it small.
      if (settings) { e.preventDefault(); setSettings(false); }
      else if (composing) { e.preventDefault(); target?.blur?.(); setComposing(false); }
      else if (botOpen) { e.preventDefault(); setBotOpen(false); }
      else if (tapShowing) { e.preventDefault(); target?.blur?.(); setTap(showsDetails(tap) ? engageTap : closeTap); }
      // The open notch, with nothing out of it: Esc folds it back to its strip.
      else if (notch && open) { e.preventDefault(); foldNotchRef.current(); }
      else if (widgetSize === "m") { e.preventDefault(); changeSize("s"); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  // A press anywhere off the menu closes it, as a native menu does.
  useEffect(() => {
    if (!rowMenu && !markMenu) return;
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.(".cw-menu")) { setRowMenu(null); setMarkMenu(null); } };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [rowMenu, markMenu]);
  /** Where the panel and its tether sit, in viewport pixels; `room` is what the stack grows by to hold it. */
  const [tapAt, setTapAt] = useState<{ placement: TapInPlacement; tether: TapInNotch | null; room: number } | null>(null);
  const tapHandle = useRef<TapInHandle | null>(null);
  /** The panel's reply line holds a draft: nothing folds it. */
  const tapDraft = useRef(false);
  const onTapDraft = useCallback((b: boolean) => { tapDraft.current = b; }, []);
  /** The tapped row as it last stood on the board: the panel keeps it if the row leaves. */
  const tapHeld = useRef<BoardRow | null>(null);
  /** Where the cursor row last sat in the board's order, so ↑/↓ carry on from there if it leaves. */
  const tapIndex = useRef(-1);
  const roomRef = useRef<HTMLDivElement>(null);
  // Attached agents stay up until you hide them (⌃⌥Space, or Settings › Attached agents); the choice survives a reload.
  const [overlay, setOverlayState] = useState(() => readDeskShown());
  const setOverlay = useCallback((next: boolean | ((v: boolean) => boolean)) => {
    setOverlayState((v) => { const value = typeof next === "function" ? next(v) : next; writeDeskShown(value); return value; });
  }, []);
  const busy = useRef(false);
  const setBusy = useCallback((b: boolean) => { busy.current = b; }, []);
  const layerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // A floating board centres on its share, so it needs its own width and the display's.
  const [floatBox, setFloatBox] = useState({ board: 0, view: window.innerWidth });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!floating || !el) return;
    const measure = () => setFloatBox((prev) => {
      const next = { board: el.offsetWidth, view: window.innerWidth };
      return prev.board === next.board && prev.view === next.view ? prev : next;
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [floating]);
  const foldTimer = useRef<number | undefined>(undefined);
  const board = useRef<BoardMemory | null>(null);
  // Settle on a whole first read: work, requests and sessions, so the first snapshot needs no pass to fill in.
  const loaded = demo || ((work.length > 0 || !requests.loading) && sessions.loaded);
  const boardRef = useRef<HTMLDivElement>(null);
  // Open: the card widens, then the board rises; fold: it drops, then narrows (board-unfold).
  // Widget shell owns size springs; no second unfold animation.
  const listRef = useRef<HTMLOListElement>(null);
  const asked = useRef<Set<string> | null>(null);
  const [fire, setFire] = useState(0);

  // The board, its plates and Blink are drawn over the whole display, so the
  // board asks the host for edge mode once. The operator's other settings stay.
  const askedEdge = useRef(false);
  useEffect(() => {
    if (!host.available || !host.state || host.state.mode === "edge" || askedEdge.current) return;
    askedEdge.current = true;
    void setCompanionPreferences({ mode: "edge" }).catch(() => {});
  }, [host.available, host.state]);

  // The overlay chord, from the host. A plate just dropped shows the desk again, so you see where it went.
  useEffect(() => onCompanionOverlay(() => setOverlay((v) => !v)), [setOverlay]);
  useEffect(() => onCompanionFigureDrag((d) => { if (d.workId === null && d.dropped) setOverlay(true); }), [setOverlay]);

  // The board's memory: the first loaded snapshot is settled; then it changes
  // on each pass, and between passes only when an ask breaks in or out.
  const memory = useMemo(() => {
    if (!loaded) return null;
    board.current = boardPass(board.current, pool, Date.now(), { reduced: prefersReducedMotion(), fromBottom: !top });
    return board.current;
  }, [pool, loaded, pass, top]);

  // Blink: one shot per ask that appears after load; the first snapshot is settled.
  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(pool.filter((t) => t.state === "asking").map((t) => t.id));
    const before = asked.current;
    asked.current = ids;
    if (before && [...ids].some((id) => !before.has(id))) setFire((n) => n + 1);
  }, [pool, loaded]);
  const blinkOn = (blink ?? prefs.blink) && fullDisplay;

  const rows = memory?.rows ?? EMPTY_ROWS;
  // The open board's rows in the order picked (Project · Time · State). They are read on a pass, so the order holds between passes.
  const shownRows = useMemo(() => orderRows(rows, prefs.order), [rows, prefs.order]);
  const rowHeads = useMemo(() => groupHeads(shownRows, prefs.order), [shownRows, prefs.order]);

  const doOpen = useCallback(() => {
    window.clearTimeout(foldTimer.current);
    // Back over it mid-fold: it stays open.
    setClosing(false);
    if (open) return;
    notchOver.current = true;
    const r = boardRef.current?.getBoundingClientRect();
    setOpened({ at: Date.now(), w: r?.width ?? 0, h: r?.height ?? 0 });
    setOpen(true); setWidgetSize("l");
  }, [open]);
  const foldNow = useCallback(() => {
    setClosing(false);
    // The notch folds back to its strip; a corner folds to M.
    setOpen(false); setWidgetSize(notch ? "s" : "m"); setPlaceError(null); setTap(TAP_CLOSED); tapDraft.current = false;
    if (!notch) { try { localStorage.setItem(REST_KEY, "m"); } catch {} }
    // Beside the board, a sheet and Scoutbot outlast the fold; in the stack they lived inside L.
    if (!fullDisplay) { setComposing(false); setSettings(false); setBotOpen(false); busy.current = false; }
  }, [fullDisplay, notch]);
  // Becoming the notch (a fresh page hears it with the host's first state, or Settings picks it):
  // it starts as its strip, whatever size the corner board last rested at.
  const wasNotch = useRef(notch);
  useEffect(() => {
    if (notch && !wasNotch.current) { setClosing(false); setOpen(false); setWidgetSize("s"); }
    wasNotch.current = notch;
  }, [notch]);
  /**
   * Settings and New open as a sheet beside the board, in the details panel's
   * place, at any size. The stack has no room beside: they open inside L.
   */
  const openSheet = (which: "settings" | "new") => {
    closeChoices();
    setSettings(which === "settings");
    setComposing(which === "new");
    // The stack opens one thing inside the board at a time.
    if (!fullDisplay) setBotOpen(false);
    if (fullDisplay) setTap(closeTap);
    else if (!open) doOpen();
  };
  const toggleSettings = () => (settings ? setSettings(false) : openSheet("settings"));
  /**
   * Scoutbot from the mark. On the screen edge it opens beside the board; in
   * the host's stack there is no room beside it, so the board opens and
   * Scoutbot shows inside, in place of Settings or New.
   */
  const toggleBot = () => {
    if (botOpen) { setBotOpen(false); return; }
    if (!fullDisplay) {
      closeChoices();
      setSettings(false);
      setComposing(false);
      if (!open) doOpen();
    }
    setBotOpen(true);
  };
  const toggleNew = () => (composing ? setComposing(false) : (setNewProject(null), setNewFiles(null), openSheet("new")));
  /** Files dropped on New: open the composer (or keep it open) with them attached. */
  const newWithFiles = (files: File[]) => {
    newBatch.current += 1;
    setNewFiles({ batch: newBatch.current, files });
    if (!composing) { setNewProject(null); openSheet("new"); }
  };
  /** The board shrinks back into its card, then folds. */
  const doFold = useCallback(() => {
    window.clearTimeout(foldTimer.current);
    // An open panel folds back with the board.
    setTap(closeTap);
    if (!open || prefersReducedMotion()) { foldNow(); return; }
    setClosing(true);
    // The notch's content leaves at once and quickly; then its shape springs back to the strip.
    foldTimer.current = window.setTimeout(foldNow, notch ? NOTCH_FOLD_MS : FOLD_MS);
  }, [open, foldNow, notch]);
  // The quick terminal open beside the board keeps the panel up too, folded board or not.
  const terminalUp = useQuickTerminal() !== null;
  useEffect(() => { setCompanionEngaged(open || terminalUp); }, [open, terminalUp]);
  // In the stack Scoutbot lives inside the open board: it closes when the board folds.
  useEffect(() => { if (!fullDisplay && !open) setBotOpen(false); }, [fullDisplay, open]);

  // In a corner, explicit widget sizes never expand or collapse on hover/outside clicks.
  // The notch never opens on hover: its strip holds still so a chip can be clicked (the chip's
  // details open beside it), and the grow control opens the board. Open, it dismisses itself, as
  // HudNotch does: the bare board folds once the pointer is away from it, or after the idle wait. What came out of it (a
  // sheet, Scoutbot, the details panel, choices, a menu, or a field with text) holds it open
  // instead: those close on their own ×, on Esc, or with a click outside, and the notch folds
  // after them (notch-model.ts notchHeld).
  const notchTimer = useRef<number | undefined>(undefined);
  const notchOut = notchHeld({ composing, settings, scoutbot: botOpen, details: tapShowing, choices, menu: rowMenu !== null || markMenu !== null, typing: false });
  const notchOutRef = useRef(notchOut);
  notchOutRef.current = notchOut;
  const notchKeeps = () => {
    if (notchOutRef.current || choicesDraft.current) return true;
    const el = document.activeElement;
    const field = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
    return !!field && field.value.trim() !== "" && !!layerRef.current?.contains(field);
  };
  const foldNotch = () => {
    window.clearTimeout(notchTimer.current);
    setRowMenu(null); setMarkMenu(null); closeChoices();
    setSettings(false); setBotOpen(false);
    doFold();
  };
  const foldNotchRef = useRef(foldNotch);
  foldNotchRef.current = foldNotch;
  const armFold = () => {
    window.clearTimeout(notchTimer.current);
    if (!notch || !open || notchOver.current || notchKeeps()) return;
    notchTimer.current = window.setTimeout(() => {
      if (!notchOver.current && !notchKeeps()) foldNotchRef.current();
    }, NOTCH_LEAVE_MS);
  };
  // Whatever came out closing (its ×, Esc) with the pointer away: the notch folds after it.
  useEffect(armFold, [notch, open, notchOut]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(notchTimer.current), []);
  // The end of an interaction folds it too: open with nothing touched for NOTCH_IDLE_MS, it goes
  // away even under a still pointer. A host pointer report, a click, a key, a scroll or input
  // starts the wait again; typing holds it, as above.
  const idleTimer = useRef<number | undefined>(undefined);
  const armIdle = () => {
    window.clearTimeout(idleTimer.current);
    if (!notch || !open) return;
    idleTimer.current = window.setTimeout(() => {
      if (notchKeeps()) armIdleRef.current();
      else foldNotchRef.current();
    }, NOTCH_IDLE_MS);
  };
  const armIdleRef = useRef(armIdle);
  armIdleRef.current = armIdle;
  useEffect(() => {
    if (!notch || !open) return;
    armIdleRef.current();
    const touch = () => armIdleRef.current();
    const kinds = ["pointerdown", "pointermove", "keydown", "wheel", "input"] as const;
    for (const kind of kinds) window.addEventListener(kind, touch, { capture: true, passive: true });
    return () => {
      for (const kind of kinds) window.removeEventListener(kind, touch, { capture: true });
      window.clearTimeout(idleTimer.current);
    };
  }, [notch, open]);
  // Put away and brought back by the host (its hotkey): the notch slides into its edge before the
  // panel hides, and drops out of it when the panel shows again (notch-model.ts notchAwayOnVisible).
  const [away, setAway] = useState<NotchAway>(null);
  const [retractMs, setRetractMs] = useState(NOTCH_RETRACT_MS);
  useEffect(() => onCompanionRetract((ms) => { if (notch && !prefersReducedMotion()) { setRetractMs(ms); setAway("away"); } }), [notch]);
  const hostVisible = host.state?.visible;
  const wasVisible = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const was = wasVisible.current;
    wasVisible.current = hostVisible;
    if (!notch) return;
    const next = notchAwayOnVisible(was, hostVisible);
    if (next === "keep") return;
    // Hidden, it comes back folded to its strip.
    if (next === "away" && open) foldNow();
    setAway(next === "arriving" && prefersReducedMotion() ? null : next);
  }, [hostVisible, notch]); // eslint-disable-line react-hooks/exhaustive-deps
  // Brought in by the hotkey, the notch is a peek: it puts itself away once the pointer has been
  // and gone, or after NOTCH_PEEK_MS if the pointer never comes. Shown from the menu, it stays.
  // What holds it open (a menu, a field with text) holds the peek too.
  // The summon can reach a fresh page before the host's first state says it is the notch: it is
  // kept, and the notch is checked when the wait ends.
  const peeking = useRef(false);
  const peekTimer = useRef<number | undefined>(undefined);
  const notchRef = useRef(notch);
  notchRef.current = notch;
  const armPeek = (ms: number) => {
    window.clearTimeout(peekTimer.current);
    if (!peeking.current) return;
    peekTimer.current = window.setTimeout(() => {
      if (!notchRef.current) { peeking.current = false; return; }
      if (!peeking.current || notchOver.current || notchKeeps()) return;
      peeking.current = false;
      void hideCompanion().catch(() => {});
    }, ms);
  };
  const armPeekRef = useRef(armPeek);
  armPeekRef.current = armPeek;
  useEffect(() => onCompanionSummoned(() => { peeking.current = true; armPeekRef.current(NOTCH_PEEK_MS); }), []);
  useEffect(() => { if (hostVisible === false) { peeking.current = false; window.clearTimeout(peekTimer.current); } }, [hostVisible]);
  // A hold ending with the pointer away: the peek ends after it, as the fold does.
  useEffect(() => { if (!notchOut && !notchOver.current) armPeekRef.current(NOTCH_LEAVE_MS); }, [notchOut]);
  useEffect(() => () => window.clearTimeout(peekTimer.current), []);

  const onEnter = () => {
    window.clearTimeout(foldTimer.current);
    if (!notch) return;
    notchOver.current = true;
    window.clearTimeout(notchTimer.current);
    window.clearTimeout(peekTimer.current);
  };
  // A click that reached another app closes the menu, as it would a native one.
  const onLeave = (click = false) => {
    window.clearTimeout(foldTimer.current);
    if (notch) { notchOver.current = false; armFold(); armPeek(NOTCH_LEAVE_MS); }
    if (!click) return;
    setRowMenu(null); setMarkMenu(null);
    if (!choicesDraft.current) closeChoices();
    if (notch && open && !composing && !choicesDraft.current) foldNotch();
  };
  const leave = () => onLeave();

  // The board's rows top to bottom, as ↑/↓ walk them: Arrivals, then Departures.
  const tapOrder = useMemo(() => shownRows.map((r) => r.id), [shownRows]);
  if (tap.id !== null) {
    const i = tapOrder.indexOf(tap.id);
    if (i >= 0) tapIndex.current = i;
  }
  // A cursor whose row left the board while its panel was closed goes with it; an open panel keeps its row.
  useEffect(() => { setTap((s) => settleTap(s, new Set(tapOrder))); }, [tapOrder]);

  /**
   * Open the panel on a row, swap it, or fold it (the same row). A tap is a
   * peek: it never asks the host for the keyboard (the host has no way to
   * hand it back); the reply line asks when it takes focus.
   */
  const selectTap = (next: TapSel) => {
    if (next === tap) return;
    setTap(next);
    // The details panel opens where a sheet sits beside the board.
    if (next.open && fullDisplay) { setSettings(false); setComposing(false); closeChoices(); }
  };
  /** An agent's Details, from anywhere (a figure, its menu, ⌘I, the engage panel): the Tap in panel on its row, a step past the engage panel. */
  const openDetails = (id: string) => selectTap(detailsTap(id));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      const typing = ["INPUT", "SELECT", "TEXTAREA"].includes(tag);
      // ⌘I: the Details of the row in focus, else under the pointer, else the board's cursor.
      if (e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "i") {
        if (e.defaultPrevented) return;
        const el = target?.closest?.<HTMLElement>("[data-k^='row:'], [data-k^='line:']")
          ?? layerRef.current?.querySelector<HTMLElement>("[data-k^='row:']:hover, [data-k^='line:']:hover");
        const id = el?.dataset.k?.replace(/^(?:row|line):/u, "") ?? tap.id;
        if (id && pool.some((x) => x.id === id)) { e.preventDefault(); openDetails(id); }
        return;
      }
      if (e.key === "Escape") {
        // The desk closed an agent it had open with this Esc.
        if (e.defaultPrevented) return;
        if (rowMenu || markMenu) { setRowMenu(null); setMarkMenu(null); return; }
        target?.blur?.();
        if (choices) { closeChoices(); return; }
        const level = escapeLevel({
          draftInPanel: typing && tapDraft.current && Boolean(target?.closest(".tap-panel")),
          settings, scoutbot: botOpen, composing, inComposer: Boolean(target && (boardRef.current?.contains(target) || target.closest?.(".arv-sheet"))), details: showsDetails(tap), panel: tapShowing,
        });
        if (level === "details") setTap(engageTap);
        else if (level === "settings") setSettings(false);
        else if (level === "scoutbot") setBotOpen(false);
        else if (level === "composer") setComposing(false);
        else if (level === "panel") setTap(closeTap);
        else if (level === "board") doFold();
        return;
      }
      // A field or the desk answered this key itself.
      if (e.defaultPrevented) return;
      // A select takes its own arrows; a focused chip in the request block takes its own ⌘↩.
      const askControl = tag === "BUTTON" && Boolean(target?.closest?.(".tap-ask"));
      // The panel's own reply line, empty: ↑/↓ still walk the board.
      const emptyReply = (tag === "INPUT" || tag === "TEXTAREA") && Boolean(target?.closest?.(".tap-panel")) && (target as HTMLInputElement | HTMLTextAreaElement).value === "";
      const action = tapInKeyAction(e, { tag: tag === "SELECT" ? "INPUT" : tag, open: tapShowing, askControl, emptyReply });
      const panel = tapHandle.current;
      if (action === "allow") {
        // Only a backed request: with nothing to allow, ⌘↩ is left alone.
        if (panel?.allow()) e.preventDefault();
        return;
      }
      if (action === "primary") {
        if (!panel) return;
        e.preventDefault();
        panel.primary();
        return;
      }
      if (action === "quick") {
        // Only a row with a pane to show: otherwise ⌘T is left alone.
        if (panel?.quick()) e.preventDefault();
        return;
      }
      const step = tapKeyStep(action, tap, tapOrder, tapIndex.current);
      if (step) {
        e.preventDefault();
        selectTap(step);
        return;
      }
      // Typing reaches the reply line, the key and all; with no reply line, n is still New.
      if (action === "type" && panel?.focusReply()) return;
      if (!typing && e.key === "n" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openSheet("new"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Edge mode: WebKit runs no hover in a panel that is not key; the host reports the pointer.
  const pointerAt = useRef<string | null>(null);
  useEffect(() => {
    if (!edgeMode) return;
    return onCompanionPointer(({ id, outside }) => {
      if (notch) armIdleRef.current();
      if (outside) { onLeave(true); return; }
      const was = pointerAt.current;
      pointerAt.current = id;
      // A row or a chip (a region of its own inside the board's): its hover summary.
      const on = hoverIdOf(id);
      if (on) peekEnter(on, layerRef.current?.querySelector<HTMLElement>(`[data-hit="${HOVER_HIT}${CSS.escape(on)}"]`) ?? null);
      else peekLeave();
      // The panel is the board's own: over it, or a click on it, keeps the board open.
      if (on || id === REGION_ID || id === TAP_IN_HIT_ID || id === SHEET_HIT_ID || id === BOARD_MOVE_HIT_ID) onEnter();
      // The panel folded away under a still pointer (× or esc): its region went, the pointer did not
      // leave. The board stays, as it does in the browser; a click outside or a real leave folds it.
      // The notch folds instead: the host reports a leave once, and this is it.
      else if (!notch && id === null && was === TAP_IN_HIT_ID && !layerRef.current?.querySelector(`[data-hit="${TAP_IN_HIT_ID}"]`)) window.clearTimeout(foldTimer.current);
      else if (id === null || !id.startsWith("plate:")) onLeave();
    });
  });

  // The browser preview and the stack have no host report of a click outside: a press off every region is one.
  useEffect(() => {
    if (edgeMode || !(tapShowing || choices)) return;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element | null)?.closest?.("[data-hit]")) return;
      onLeave(true);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  });

  // What takes the pointer: in edge mode every [data-hit] (board, Scoutbot, plates); in the stack, the board's size.
  const lastRegions = useRef("");
  const lastLabels = useRef("");
  const movingBoard = useRef(false);
  const [pullCue, setPullCue] = useState<RowPullCue | null>(null);
  // The board panel's frame as last drawn, so figures on the desk keep clear of it. Not mid-move: it settles where it lands.
  const [boardFrame, setBoardFrame] = useState<PageEdges | null>(null);
  const report = useCallback(() => {
    if (fullDisplay && !movingBoard.current) {
      const r = boardRef.current?.getBoundingClientRect();
      const next = r && r.width > 0 && r.height > 0 ? { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) } : null;
      setBoardFrame((prev) => (prev && next && prev.left === next.left && prev.top === next.top && prev.right === next.right && prev.bottom === next.bottom) || prev === next ? prev : next);
    }
    if (edgeMode) {
      const regions: CompanionHitRegion[] = [];
      if (movingBoard.current) regions.push({ id: BOARD_MOVE_HIT_ID, x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
      // The whole page, not only the layer: a picker opened from the board (New's runtime) portals its panel to the body.
      for (const el of document.querySelectorAll<HTMLElement>("[data-hit]")) {
        // A row or a chip is cut to the list it scrolls in: one scrolled out of sight takes no pointer.
        const r = el.dataset.hit!.startsWith(HOVER_HIT) ? seenRect(el) : el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) regions.push({ id: el.dataset.hit!, x: r.left - 2, y: r.top - 2, width: r.width + 4, height: r.height + 4 });
      }
      // Each desk label, for the host's read of the picture under it (labelInk).
      const labels: CompanionLabelRect[] = [];
      for (const el of layerRef.current?.querySelectorAll<HTMLElement>("[data-label-for]") ?? []) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) labels.push({ workId: el.dataset.labelFor!, x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) });
      }
      const labelKey = JSON.stringify(labels);
      if (labelKey !== lastLabels.current) {
        lastLabels.current = labelKey;
        reportCompanionLabels(labels);
      }
      const key = JSON.stringify(regions);
      if (key === lastRegions.current) return;
      lastRegions.current = key;
      reportCompanionHitRegions(regions);
    } else if (rootRef.current) {
      const r = rootRef.current.getBoundingClientRect();
      reportCompanionLayout(r.width, r.height);
    }
  }, [edgeMode, fullDisplay]);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(report);
    return () => cancelAnimationFrame(frame);
  });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    // A panel portaled to the body opens or closes without a board render.
    const portals = new MutationObserver(() => requestAnimationFrame(report));
    portals.observe(document.body, { childList: true });
    return () => { observer.disconnect(); portals.disconnect(); };
  }, [report]);

  const goPrimary = (t: CornerThread) => {
    const place = placesFor(t)[0];
    if (!place) return;
    setPlaceError(null);
    const opened = place.id === "conversation" && t.conversationId
      ? openFromCompanion("thread", { workId: t.workId ?? t.conversationId, conversationId: t.conversationId })
      : t.workId ? openFromCompanion("work", { workId: t.workId }) : null;
    opened?.catch((cause) => setPlaceError(cause instanceof Error ? cause.message : "Could not open that place."));
  };

  const attachable = (t: CornerThread) => edgeMode && !demo && Boolean(figureIdOf(t));

  /** Who stands on the desk now: the host's pins, or the demo desk's. */
  const onDesk = useMemo(() => (deskDemo ? new Set(deskDemo.figures.map((f) => f.workId)) : placed), [deskDemo, placed]);
  const outNow = (t: CornerThread) => (deskDemo ? onDesk.has(t.id) : onDesk.has(figureIdOf(t) ?? ""));
  // Each agent's label is its code in the runtime's roster, "OS 003" (figure-labels.ts, runtime-roster.ts):
  // the runtime numbers each agent it lists, and the board only looks the code up. An agent it has not
  // numbered shows none. The demo's scripted agents carry the script's codes (arrivals-demo.ts).
  const hostKnows = Boolean(host.state);
  const runtimeRoster = useRuntimeRoster(!demo);
  const agentsById = useMemo(() => new Map(roster.agents.map((a) => [a.id, a])), [roster.agents]);
  const pinOf = useCallback((t: CornerThread) => (deskDemo ? t.id : figureIdOf(t)), [deskDemo]);
  const pinsNow = useMemo(() => (deskDemo ? deskDemo.figures.map((f) => f.workId) : figures.map((f) => f.workId)), [deskDemo, figures]);
  /** Who an agent is in the roster: its Scout agent id; a demo agent, its own id. */
  const agentOf = useCallback((t: CornerThread): string | null => t.identityId?.trim() || (demo ? t.id : null), [demo]);
  const tagOf = useCallback((agentId: string | null | undefined) => (demo ? demoRosterTag(agentId) : rosterTagFor(agentId, runtimeRoster, agentsById)), [demo, runtimeRoster, agentsById]);
  /** The agent each figure out is, by its pin, from the rows the board can see now. */
  const pinsSeen = useMemo(() => {
    const pinned = new Set(pinsNow);
    return (deskDemo?.threads ?? pool).flatMap((t) => { const pin = pinOf(t), id = agentOf(t); return pin && id && pinned.has(pin) ? [[pin, id] as const] : []; });
  }, [deskDemo, pool, pinsNow, pinOf, agentOf]);
  // Kept by pin, so a figure whose row has left the board still wears its agent's code.
  const pinAgents = usePinAgents(demo ? null : pinsSeen, hostKnows ? pinsNow : null);
  // Message flights: who each figure on the desk is, read when a message arrives.
  const operatorIds = useOperatorActorIds();
  const flightDesk = useCallback((): FlightDesk => {
    const byPin = new Map<string, CornerThread>();
    for (const t of deskDemo?.threads ?? pool) { const pin = pinOf(t); if (pin) byPin.set(pin, t); }
    return { operatorIds, figures: deskFigures(pinsNow, (pin) => byPin.get(pin), pinAgents) };
  }, [deskDemo, pool, pinOf, pinsNow, pinAgents, operatorIds]);
  const labelOf = (t: CornerThread): FigureLabel | undefined => (prefs.labels ? figureLabelOf(tagOf(agentOf(t))) : undefined);
  /** Each figure's label, by its pin; null with labels off. */
  const pinLabels = useMemo(() => {
    if (!prefs.labels) return null;
    const seenNow = new Map(pinsSeen);
    return new Map(pinsNow.flatMap((pin) => { const label = figureLabelOf(tagOf(seenNow.get(pin) ?? pinAgents[pin])); return label ? [[pin, label] as const] : []; }));
  }, [prefs.labels, pinsNow, pinsSeen, pinAgents, tagOf]);
  /** The projects of the agents on the board, as the runtime keeps them, for their codes in the board's settings. */
  const boardProjects = useMemo(() => (demo ? [] : rosterProjectsOf(pool.map(agentOf), runtimeRoster)), [demo, pool, agentOf, runtimeRoster]);
  const rosterSettings = useMemo(() => (demo ? null : {
    reload: () => { void runtimeRoster.reload(); },
    nameOf: (agentId: string) => agentsById.get(agentId)?.name ?? null,
    unavailable: runtimeRoster.unavailable,
  }), [demo, runtimeRoster, agentsById]);
  /** Bring out (a right-click, any size): the host can pin it, and it is not on the desk yet. */
  const canBringOut = (t: CornerThread) => (deskDemo ? !outNow(t) : attachable(t) && !outNow(t));

  // Bring out is one click: the agent is pinned and stands beside the board, level with its row (pop-out.ts).
  const bringOut = (t: CornerThread, at: { x: number; y: number } | null): Promise<void> => {
    const box = boardRef.current?.getBoundingClientRect();
    if (!box) return Promise.reject(new Error("The board is not on the screen."));
    const id = deskDemo ? t.id : figureIdOf(t);
    if (!id) return Promise.reject(new Error("That agent has nothing to pin."));
    // It lands as the desk's form for it: a strip is a card wide; a figure, its own slot.
    const width = !deskDemo && formOf(id) === "strip" ? PLATE_CARD.w : figureSlot(host.state?.figureDefaults.size ?? DEFAULT_FIGURE_DEFAULTS.size).width;
    // Level with the row (or chip) itself, wherever in it the right-click fell; from the mark, level with the board's middle.
    const line = layerRef.current?.querySelector<HTMLElement>(`[data-k="line:${CSS.escape(t.id)}"], [data-k="row:${CSS.escape(t.id)}"]`)?.getBoundingClientRect();
    const level = line ? { x: at?.x ?? box.left, y: line.top + line.height / 2 } : at ?? { x: box.left, y: (box.top + box.bottom) / 2 };
    const view = { width: window.innerWidth, height: window.innerHeight };
    const spot = popOutSpot(box, level, view, width);
    if (deskDemo) {
      // Two brought out from the same place stand side by side, not on each other.
      setDemoOut((list) => {
        const rest = list.filter((o) => o.id !== t.id);
        const step = rest.filter((o) => Math.abs(o.y - spot.y) < 40).length;
        const x = Math.max(width / 2, spot.x - step * (width + 8) * (box.left > view.width - box.right ? 1 : -1));
        return [...rest, { id: t.id, x, y: spot.y }];
      });
      return Promise.resolve();
    }
    return pinToCompanion(id)
      .then(() => placeCompanionFigure(id, spot.x, spot.y))
      .then(() => { setOverlay(true); });
  };
  /** Back to the board: the host lets the pin go; on the demo desk, it steps off. */
  const sendHome = (t: CornerThread) => {
    if (deskDemo) { setDemoOut((list) => list.filter((o) => o.id !== t.id)); return; }
    const id = figureIdOf(t);
    if (id) release(id);
  };
  /** On the desk: how its figure is drawn, for its Details. */
  const figureFor = (t: CornerThread) => {
    if (!fullDisplay || !outNow(t)) return null;
    const id = deskDemo ? t.id : figureIdOf(t);
    const pins = deskDemo?.figures ?? figures;
    const f = pins.find((x) => x.workId === id);
    if (!f) return null;
    return <FigureSettings t={t} figure={f} pins={pins} defaults={host.state?.figureDefaults ?? DEFAULT_FIGURE_DEFAULTS} cast={roster} />;
  };

  const rootClass = `scx arv${top ? " is-top" : ""}${left ? " is-left" : ""}${fullDisplay ? " is-edge" : " is-stack"}`;
  const look = prefs.look;
  const lead = boardLead(rows);
  const sections: Record<BoardSection, BoardRow[]> = { arrivals: rows.filter((r) => r.section === "arrivals"), departures: rows.filter((r) => r.section === "departures") };
  const openRequests = requests.state?.items.filter(isDeclaredRequest) ?? [];
  // Clear all requests: the runtime's own (each dismissed, or denied); the demo's asks are the script's, and nothing is sent.
  const demoAsking = demo ? pool.filter((t) => t.state === "asking").map((t) => t.id) : [];
  const clearAll: ClearAll | null = demo
    ? demoAsking.length
      ? {
        count: demoAsking.length,
        question: `Clear ${demoAsking.length} ${demoAsking.length === 1 ? "request" : "requests"}?`,
        note: "Demo · nothing is sent.",
        run: async () => { scripted.answer(demoAsking); return { line: `Cleared ${demoAsking.length} ${demoAsking.length === 1 ? "request" : "requests"}.`, ok: true }; },
      }
      : null
    // Ready is not cleared: Continue or Hold are the operator's moves, one task at a time.
    : clearAllOf(openRequests.filter((item) => !isReadyRequest(item)));
  /** Everything: the board as a click opened it before the choices, one size up. */
  const everything = {
    label: "Everything",
    go: () => { closeChoices(); setMarkMenu(null); if (widgetSize === "s") changeSize("m"); else if (!open) doOpen(); },
  };
  const toggleChoices = () => {
    if (choices) { closeChoices(); return; }
    lookedAt.current = readLookedAt();
    heldChoices.current = companionChoices(pool, { lookedAt: lookedAt.current, canStart: true });
    setChoices(true); setSettings(false); setComposing(false); setTap(closeTap); setRowMenu(null); setMarkMenu(null);
  };
  const choiceList = choices ? holdChoices(heldChoices.current, pool, { lookedAt: lookedAt.current, canStart: true }) : [];
  /** The agents the mark's menu offers to bring out: the live ones first, then the rest of the board. */
  const markAgentsOf = (): MarkMenuAgent[] => {
    const seen = new Set<string>();
    const out: MarkMenuAgent[] = [];
    const add = (t: CornerThread, name: string) => {
      if (seen.has(t.id) || out.length >= 6 || !canBringOut(t)) return;
      seen.add(t.id);
      out.push({ id: t.id, name, bring: () => bringOut(t, null) });
    };
    for (const r of arrivedRows) { const tag = labelOf(r.thread); add(r.thread, [tag && figureLabelText(tag), r.name ?? rowName(r.thread)].filter(Boolean).join(" ")); }
    for (const r of rows) add(r.thread, rowName(r.thread));
    return out;
  };
  // Scoutbot is the mark whenever it is on: beside the board on the screen edge, inside it in the stack.
  const showBot = prefs.scoutbot;
  // Scoutbot stands on the board's top edge where there is room above it (a bottom corner), and drags off
  // onto the desk from there, as a desk figure: the host places it and keeps its spot.
  const perchRoom = fullDisplay && !notch && !floating && !top;
  const deskBot = useDeskScoutbot({
    figure: host.state?.scoutbot ?? null,
    on: edgeMode && host.available && showBot,
    board: () => { const r = boardRef.current?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; },
  });
  // Preview only: ?demo=1&housing=1 is a 14-inch MacBook Pro's camera and a raised panel, to see the board hang from it
  // on any display; ?demo=1&housing=bar is a display with a menu bar and no camera.
  const previewHousing = demo ? new URLSearchParams(window.location.search).get("housing") : null;
  const previewBar = previewHousing === "1" ? 32 : previewHousing === "bar" ? 24 : 0;
  const notchGeometry = previewBar
    ? {
        visible: { x: 0, y: previewBar, width: window.innerWidth, height: window.innerHeight - previewBar },
        housing: previewHousing === "1" ? { x: window.innerWidth / 2 - 92.5, y: 0, width: 185, height: 32 } : null,
        aboveMenuBar: true,
        // &desk=1: Scout Desk's notch is out (its dictation), to see the board make room for it.
        deskNotch: new URLSearchParams(window.location.search).get("desk") === "1" ? { x: window.innerWidth / 2 - 160, y: 0, width: 320, height: 96 } : null,
      }
    : host.state?.edge;
  const notchAt = notchPlace(prefs.notchEdge, notchGeometry, { width: window.innerWidth, height: window.innerHeight }, open || notchOut);
  // Scout Desk's notch took the housing: the folded notch is in its edge until Desk's goes, then drops back out.
  const deskTuck = notch && notchAt.desk === "tuck";
  const wasDeskTuck = useRef(deskTuck);
  useEffect(() => {
    const was = wasDeskTuck.current;
    wasDeskTuck.current = deskTuck;
    if (was && !deskTuck && hostVisible !== false) setAway(prefersReducedMotion() ? null : "arriving");
  }, [deskTuck]); // eslint-disable-line react-hooks/exhaustive-deps
  const notchEdge = notch ? prefs.notchEdge : null;
  // The host raises the panel over the menu bar while the notch is on top; it says so in `edge.aboveMenuBar`.
  // A host without notch support refuses, and the board stays under the menu bar.
  useEffect(() => {
    if (!notchEdge) return;
    void setCompanionNotch(notchEdge).catch(() => {});
    return () => { void setCompanionNotch(null).catch(() => {}); };
  }, [notchEdge]);
  const count = [sections.arrivals.length ? `${sections.arrivals.length} in` : "", sections.departures.length ? `${sections.departures.length} out` : ""].filter(Boolean).join(" · ");

  // Opening is one wave from the corner: the head and each row, in the
  // order they sit (Arrivals over Departures, unlabelled), nearest the corner first.
  const wave = new Map<string, number>();
  if (open) {
    const seq = shownRows.map((r) => r.id);
    seq.forEach((id, i) => wave.set(id, openDelay(i, seq.length, !top)));
  }

  // Open, rows keep one DOM order (first seen) and sit by CSS order, so a
  // pass that moves a row moves no node: nothing remounts or replays.
  const dom = useRef<string[]>([]);
  if (!open) dom.current = [];
  else {
    const ids = new Set(rows.map((r) => r.id));
    const kept = dom.current.filter((id) => ids.has(id));
    const known = new Set(kept);
    dom.current = [...kept, ...rows.map((r) => r.id).filter((id) => !known.has(id))];
  }
  const place = new Map<string, number>();
  // Grouped by project, each group's heading sits just above its first row.
  const headPlace = new Map<string, number>();
  let slot = 0;
  for (const r of shownRows) {
    if (rowHeads.has(r.id)) { headPlace.set(r.id, slot); slot += 3; }
    place.set(r.id, slot); slot += 3;
  }

  // A pass or an ask that moved rows: each glides from where it sat, and the
  // list's height glides with them, so the board's far edge and its header
  // move with the rows instead of jumping a row's height.
  const glide = useRef<{ memory: BoardMemory | null; ys: Map<string, number>; h: number }>({ memory: null, ys: new Map(), h: 0 });
  const heightGlide = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const el = boardRef.current;
    if (!open || !list || !el || !memory) { glide.current = { memory: null, ys: new Map(), h: 0 }; return; }
    const before = glide.current;
    const moved = before.memory !== null && before.memory !== memory && memory.glide && !prefersReducedMotion();
    const growing = heightGlide.current?.playState === "running" && (heightGlide.current.effect as KeyframeEffect | null)?.target === list;
    // The list's height as it stands: mid-glide, where that glide has got to.
    const fromH = growing ? list.offsetHeight : before.h;
    if (moved && growing) { heightGlide.current!.cancel(); heightGlide.current = null; }
    // Measured from the corner the board hangs from, which holds still as the board grows.
    const edge = top ? 0 : el.offsetHeight;
    const items = [...list.children].filter((c): c is HTMLElement => c instanceof HTMLElement && Boolean(c.dataset.k));
    const ys = new Map(items.map((c) => [c.dataset.k!, c.offsetTop - edge]));
    const h = growing && !moved ? before.h : list.offsetHeight;
    if (moved) {
      for (const c of items) {
        const from = before.ys.get(c.dataset.k!);
        const to = ys.get(c.dataset.k!);
        if (from !== undefined && to !== undefined && from !== to) glideFrom(c, from - to);
      }
      if (fromH > 0 && fromH !== h && typeof list.animate === "function") {
        heightGlide.current = list.animate([{ height: `${fromH}px` }, { height: `${h}px` }], { duration: ENTER_MS, easing: EASE_OUT });
      }
    }
    glide.current = { memory, ys, h };
  });

  // A row that comes in after the opening (a new row on a pass, an ask) comes in on its turn.
  const opening = open && opened !== null && Date.now() - opened.at < ENTER_MS;
  const renderRow = (r: BoardRow, folded = false) => {
    const t = r.thread;
    const o = folded ? undefined : place.get(r.id);
    return (
      <Row
        key={r.id}
        r={r}
        look={look}
        passAt={memory?.passAt ?? pass}
        delay={opening ? wave.get(r.id) ?? 0 : Math.max(0, r.remarkAt - Date.now())}
        riffleAt={open ? opened?.at : undefined}
        order={o}
        onOpen={open ? (x) => selectTap(tapRow(tap, x.id)) : doOpen}
        onPlace={goPrimary}
        onDemoAnswer={demo ? scripted.answer : undefined}
        tapped={open && !folded ? tapRowClass(tap, r.id) : ""}
        onPullCue={setPullCue}
        onDragOut={canBringOut(t) ? (x) => {
          setPlaceError(null);
          void bringOut(x, null).catch((cause) => setPlaceError(cause instanceof Error ? cause.message : "Could not bring out that agent."));
        } : undefined}
        onMenu={(x, at) => setRowMenu({ id: x.id, ...at })}
        placed={outNow(t)}
        label={labelOf(t)}
        peek={folded ? undefined : peek}
      />
    );
  };
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Folded to a strip (··· › Folded): the cells in arrival order, a page per
  // pass past the slots, each plotting what its agent did per pass. All of it
  // is read on the pass, so the strip holds still between.
  const strip = prefs.folded !== "row";
  const passNow = memory?.passAt ?? pass;
  const arrived = useRef<string[]>([]);
  const plotted = useRef<{ at: string; map: Map<string, number[]> }>({ at: "", map: new Map() });
  // Who is on the strip is live: an agent shows up the moment it is working or asking, not on the
  // next pass; only the plots wait for the pass. Done and quiet agents wait on the open board.
  // an agent that just finished stays a moment, saying so, instead of its line just going (DONE_LINGER_MS)
  const stripLive: StripRow[] = pool.map((t) => ({ id: t.id, thread: t, remark: remarkOf(t), now: t.now }))
    .filter((r) => stripWorthy(r.remark, r.thread.state === "asking") || (r.remark === "DONE" && pass - sinceOf(r.thread) < DONE_LINGER_MS));
  // Stream lines: each line's latest step as it lands, read live (not on the pass)
  const streamLines = useMemo(() => latestStepBySession(sessions.events), [sessions.events]);
  // read on the pass, and again when the first events land (a pass read before them would sit empty)
  const plotKey = `${passNow}|${sessions.events.length > 0}`;
  if (plotted.current.at !== plotKey) {
    plotted.current = { at: plotKey, map: demo ? demoPassActivity(stripLive, passNow) : passActivity(sessions.events, passNow) };
  }
  arrived.current = arrivalOrder(arrived.current, stripLive.map((r) => r.id));
  const liveById = new Map(stripLive.map((r) => [r.id, r]));
  const arrivedLive = arrived.current.map((id) => liveById.get(id)).filter((r): r is StripRow => Boolean(r));

  // With Settings › Names › Summary, the cheap model's name for each live line's work (session-titles.ts),
  // read on each pass and worn by the lines. The read is free: a session is named once and renamed only
  // as Settings › Names › Renamed allows. Each line wears its roster label as its sign.
  const [named, setNamed] = useState<Map<string, string>>(() => new Map());
  const titleRefs = demo || prefs.names === "title" ? [] : arrivedLive.slice(0, 24).flatMap((r) => {
    // Older rows can carry only their pinned session ID.
    const ref = r.thread.sessionRef ?? formatSessionRouteRef(r.thread.harness, plottedSession(r.thread.pinId));
    return ref ? [{ id: r.id, ref, state: r.remark.toLowerCase(), at: r.thread.at }] : [];
  });
  const rename = formatRenamePolicy(prefs.rename);
  const titleKey = `${passNow}|${prefs.names}|${prefs.namesBy}|${rename}|${titleRefs.map((t) => t.ref).join(",")}`;
  useEffect(() => {
    if (titleRefs.length === 0) { setNamed((m) => (m.size ? new Map() : m)); return; }
    let live = true;
    const each = (pick: (t: (typeof titleRefs)[number]) => string | number) => titleRefs.map((t) => encodeURIComponent(String(pick(t)))).join(",");
    const by = prefs.namesBy === "harness" ? "" : `&by=${prefs.namesBy}`;
    api<{ titles: Record<string, { title: string } | null> }>(
      `/api/session-titles?refs=${each((t) => t.ref)}&states=${each((t) => t.state)}&activity=${each((t) => Math.round(t.at))}${by}&rename=${rename}`,
    )
      .then(({ titles }) => {
        if (!live) return;
        const next = new Map<string, string>();
        for (const { id, ref } of titleRefs) {
          const name = titles[ref]?.title;
          if (name) next.set(id, name);
        }
        setNamed(next);
      })
      .catch(() => { /* names stay as they were; the session title shows where none came back */ });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- titleKey is the read's identity
  }, [titleKey]);
  const arrivedRows: StripRow[] = arrivedLive.map((r) => {
    const tag = labelOf(r.thread);
    const sign = tag && figureLabelSign(tag), name = named.get(r.id);
    return sign || name ? { ...r, ...(sign ? { sign } : null), ...(name ? { name } : null) } : r;
  });
  // S and M's lines in the order picked; the folded strip keeps arrival order, so its cells hold their places.
  const widgetLines = orderRows(arrivedRows, prefs.order);
  const widgetGroups = groupHeads(widgetLines, prefs.order);
  const stripShown = stripPage(arrivedRows, strip ? Number(prefs.folded) : 0, passNow);
  const askingRow = rows.find((r) => r.asking) ?? null;

  // Tap in: the row the panel shows. It is the tapped row as the board has it
  // this pass; folding, it holds the row it folds on (even once ↑/↓ have moved
  // the cursor off it); a row that left the board while open stays in the
  // panel as it last stood, its tether dropped.
  const panelId = panelRowOf(tap);
  // S and M draw live lines; the board writes its rows on a pass. A line the board has not written yet opens on its live thread.
  const widgetLine = !open && panelId !== null ? liveById.get(panelId) : undefined;
  const tapLive = panelId !== null ? byId.get(panelId) ?? (widgetLine ? settledRow(widgetLine.thread) : null) : null;
  if (!tap.open) tapHeld.current = null;
  else if (tapLive && !tap.closing) tapHeld.current = tapLive;
  const tapShown = tap.open ? (tap.closing ? tapHeld.current : tapLive ?? (tapHeld.current?.id === tap.id ? tapHeld.current : null)) : null;
  const tapGone = tapShown !== null && !tapLive;
  // Nothing to show (no row was ever held): there is no panel to fold, so the selection lands as closed.
  // Folded to lines, a tapped line opens its panel beside the tray: the board stays folded.
  // S and M are folded too: a tapped chip or row opens its panel beside the widget, which keeps its size.
  const foldedTap = !open;
  const tapStuck = (open || foldedTap) && tap.open && tapShown === null;
  useEffect(() => { if (tapStuck) setTap((s) => ({ id: s.id, open: false, closing: false })); }, [tapStuck]);
  const tapTarget = useMemo(() => (tapShown ? tapInTarget(tapShown.thread) : null), [tapShown]);
  const tapTranscript: TapInTranscript | null = tapTarget?.kind === "native" && !demo ? sessions.transcripts.get(tapTarget.sessionId) ?? null : null;

  // The tap panel fits what it holds, which can change without a render here (a reply line, an answer).
  const panelUp = Boolean((open || foldedTap) && tapShown && tapAt);
  useLayoutEffect(() => {
    const el = panelUp ? layerRef.current?.querySelector<HTMLElement>(`[data-hit="${TAP_IN_HIT_ID}"]`) : null;
    if (!el) return;
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [report, panelUp]);

  // Where the panel sits: measured from the board after every render (a
  // pass, an ask, a row's glide), on resize, and as the board's size moves.
  const lastTapAt = useRef("");
  const measureTap = () => {
    const el = boardRef.current;
    if (!tap.open || !el) {
      if (lastTapAt.current) { lastTapAt.current = ""; setTapAt(null); }
      return;
    }
    const b = el.getBoundingClientRect();
    const board = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    // The row where it sits: offsets leave out its pass glide and entrance, so the tether lands where the row is going.
    const li = panelId !== null && !tapGone
      ? (open
        ? [...(listRef.current?.children ?? [])].find((c): c is HTMLElement => c instanceof HTMLElement && c.dataset.k === `row:${panelId}`) ?? null
        : el.querySelector<HTMLElement>(`[data-k="line:${panelId}"]`))
      : null;
    const row = li ? (li.offsetParent === el ? rowRectIn(board, li, { left: el.clientLeft, top: el.clientTop }) : li.getBoundingClientRect()) : null;
    const { placement, tether } = tapLayout(board, { width: window.innerWidth, height: window.innerHeight }, row, stackMode, notch ? prefs.notchEdge : null);
    // The stack grows by the panel's room, inside the screen the host gives it (its visible height less 2 pt a side).
    const own = (rootRef.current?.offsetHeight ?? 0) - (roomRef.current?.offsetHeight ?? 0);
    const room = stackMode ? stackRoom(own, (window.screen?.availHeight || window.innerHeight) - 4) : 0;
    const next = { placement, tether, room };
    const key = JSON.stringify(next);
    if (key === lastTapAt.current) return;
    lastTapAt.current = key;
    setTapAt(next);
  };
  // A sheet (Settings, New) beside the board, in the details panel's place; the stack draws it inside L.
  const sheet = fullDisplay ? (settings ? "settings" : composing ? "new" : choices ? "choices" : null) : null;
  const [sheetAt, setSheetAt] = useState<SheetPlacement | null>(null);
  const lastSheetAt = useRef("");
  // On a notch Scoutbot is the notch grown too, so it takes a sheet's place there.
  const sheetKind = sheet ?? (notch && showBot && botOpen ? "bot" : null);
  // On a notch, whatever hangs from it (the panel, Settings, Scoutbot, the choices) takes one width, the panel's, so
  // the strip and its content are one shape that holds still as you move between them. A top or bottom notch widens
  // to it; a strip already wider (its own chips) keeps its width and the content follows (notchPlacement).
  const notchGrown = notch && (prefs.notchEdge === "top" || prefs.notchEdge === "bottom") && (tap.open || sheetKind)
    ? TAP_IN_SIZE.WIDTH
    : 0;
  // On a side edge the notch grows along it the same way, to the panel's standard height. Sheets pop out there
  // instead (board-sheet.ts), so only an agent's panel grows it.
  const notchTall = notch && (prefs.notchEdge === "left" || prefs.notchEdge === "right") && tap.open
    ? TAP_IN_SIZE.MIN_H
    : 0;
  const measureSheet = () => {
    const el = boardRef.current;
    if (!sheetKind || !el) {
      if (lastSheetAt.current) { lastSheetAt.current = ""; setSheetAt(null); }
      return;
    }
    const b = el.getBoundingClientRect();
    const next = sheetPlacement({ left: b.left, top: b.top, right: b.right, bottom: b.bottom }, { width: window.innerWidth, height: window.innerHeight }, notch ? TAP_IN_SIZE.WIDTH : sheetKind === "choices" ? CHOICES_WIDTH : SHEET_WIDTH, notch ? prefs.notchEdge : null);
    const key = JSON.stringify(next);
    if (key === lastSheetAt.current) return;
    lastSheetAt.current = key;
    setSheetAt(next);
  };
  const measureRef = useRef(measureTap);
  measureRef.current = () => { measureTap(); measureSheet(); };
  // Drag the board anywhere on the display (not in the stack, whose window is the host's to move).
  const moveBoard = boardMoveHandler({
    boxRef: rootRef,
    moving: movingBoard,
    enabled: fullDisplay,
    // The notch's folded strip is all buttons: a press on any of them that travels pulls the notch off its edge.
    grip: notch ? "[data-board-grip], .cw-s" : undefined,
    pressThrough: notch ? ".cw-s button" : undefined,
    onFrame: () => { report(); measureRef.current(); },
    // Carried past the display's edge: the host moves the panel to the next display mid-move.
    onCross: host.available ? (rect) => moveCompanionToPointerDisplay(rect).then((moved) => moved?.rect ?? null) : undefined,
    onDrop: (rect, offView) => {
      const land = (box: { left: number; top: number; width: number; height: number }, view: { width: number; height: number }) => {
        // The notch let go against an edge's middle hangs there; anywhere else it detaches and stands free.
        if (notch) {
          const edge = notchDropEdge(box, notchInsets(notchGeometry?.visible, view), view);
          if (edge) {
            if (rootRef.current) Object.assign(rootRef.current.style, notchBoardStyle(edge, notchPlace(edge, notchGeometry, view), view));
            if (edge !== prefs.notchEdge) setPrefs({ notchEdge: edge });
            return;
          }
          if (floating) void setCompanionPreferences({ edgeAnchor: box.left + box.width / 2 < view.width / 2 ? "left" : "right" }).catch(() => {});
          const next = anchorBoard(box, view);
          if (rootRef.current) Object.assign(rootRef.current.style, boardInsetStyle(next.corner, next.inset));
          setPrefs({ ...next, place: "corner" });
          return;
        }
        // Floating: it slides along the bottom edge; where it was let go sets only its share.
        if (floating) {
          const share = floatShareOf(box, view.width);
          if (rootRef.current) Object.assign(rootRef.current.style, floatingBoardStyle(share, box.width, view.width));
          void setCompanionPreferences({ edgeFloat: share }).catch(() => {});
          return;
        }
        const next = anchorBoard(box, view);
        // Land where it was let go before the render that re-anchors it, so nothing jumps between.
        if (rootRef.current) Object.assign(rootRef.current.style, boardInsetStyle(next.corner, next.inset));
        setPrefs(next);
      };
      const here = { width: window.innerWidth, height: window.innerHeight };
      // Let go over another display the carry did not reach: the host moves the panel there and says where the board lands.
      if (offView && host.available) {
        void moveCompanionToPointerDisplay(rect)
          .then((moved) => (moved ? land(moved.rect, moved) : land(rect, here)))
          .catch(() => land(rect, here));
        return;
      }
      land(rect, here);
    },
  });
  useLayoutEffect(() => { measureRef.current(); });
  const settingsBody = (
    <BoardSettings
      prefs={prefs}
      projects={boardProjects}
      roster={rosterSettings}
      corner={corner}
      placedCount={placed.size}
      figureDefaults={edgeMode ? host.state?.figureDefaults ?? DEFAULT_FIGURE_DEFAULTS : null}
      overlay={overlay}
      canPlace={edgeMode || preview}
      floating={floating}
      onFloat={host.available ? () => { void setCompanionPreferences({ edgeAnchor: "floating" }).catch(() => {}); } : null}
      onPrefs={(patch) => {
        // A corner picked while floating puts the companion back on that side.
        if (floating && patch.corner) void setCompanionPreferences({ edgeAnchor: patch.corner.endsWith("left") ? "left" : "right" }).catch(() => {});
        setPrefs(patch);
      }}
      onOverlay={() => setOverlay((v) => !v)}
      onSendBack={() => { void sendCompanionFiguresHome().catch(() => {}); }}
    />
  );
  const composer = <NewConversation key={newProject ?? ""} demo={demo} crew={rows.map((r) => r.thread)} project={newProject} files={newFiles} panelHitId={SHEET_HIT_ID} panelClassName={`arv-rt-panel is-${look}`} onClose={() => setComposing(false)} onDraft={setBusy} />;

  // The board's size moves on its spring between renders: the panel and a sheet follow it.
  const beside = tap.open || sheet !== null;
  useEffect(() => {
    if (!beside) return;
    const el = boardRef.current;
    const measure = () => measureRef.current();
    const observer = el ? new ResizeObserver(measure) : null;
    if (el) observer!.observe(el);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [beside]);

  return (
    <div ref={layerRef} className={`arv-layer is-${look}${waiting ? " is-waiting" : ""}`} style={MOTION_VARS as CSSProperties}>
      {fullDisplay && (!preview || deskDemo) && (
        <div className="arv-desk">
          <DeskPlates
            threads={deskDemo?.threads ?? pool}
            figures={deskDemo?.figures ?? (host.state ? figures : null)}
            figureDefaults={host.state?.figureDefaults ?? null}
            cast={roster}
            overlay={deskDemo ? true : overlay}
            board={() => { const r = boardRef.current?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; }}
            boardFrame={boardFrame}
            onDraft={setBusy}
            onLayout={report}
            onDetails={openDetails}
            machines={demo ? null : sessions.machines}
            agents={roster.agents}
            demo={demo}
            onDemoAnswer={demo ? scripted.answer : undefined}
            clearAll={clearAll}
            onDemoHome={deskDemo ? (id) => setDemoOut((list) => list.filter((o) => o.id !== id)) : undefined}
            hush={boardBusy}
            labels={pinLabels}
          />
          {showBot && (
            <DeskScoutbotFigure bot={deskBot} figure={host.state?.scoutbot ?? null} defaults={host.state?.figureDefaults ?? DEFAULT_FIGURE_DEFAULTS}
              requests={openRequests} open={botOpen} now={now} waiting={openRequests.length}
              asking={rows.some((r) => r.asking)} working={rows.some((r) => r.remark === "WORKING")} onToggle={toggleBot} />
          )}
        </div>
      )}
      {pullCue && <div className={`arv-pull-cue${pullCue.ready ? " is-ready" : ""}`} role="status"
        style={{ left: Math.max(104, Math.min(window.innerWidth - 104, pullCue.x)), top: Math.max(40, pullCue.y) }}>
        {pullCue.ready ? "Release to place on desk" : "Pull past the edge to place on desk"}
      </div>}
      <div
        ref={rootRef}
        className={`${rootClass}${notch ? ` is-notch is-notch-${prefs.notchEdge}${notchAt.hang ? " is-hang" : ""}${notchAt.housing ? " has-cam" : ""}${panelUp || (sheetAt && !sheetAt.float) ? " has-panel" : ""}` : ""}`}
        style={{
          "--cw-available-height": fullDisplay ? "100vh" : `${window.screen.availHeight}px`,
          "--nt-bar": notch ? `${notchAt.bar}px` : undefined,
          "--nt-cam": notch && notchAt.housing ? `${notchAt.housing.width + 16}px` : undefined,
          "--nt-fold": notch ? `${NOTCH_FOLD_MS}ms` : undefined,
          "--nt-retract": notch ? `${retractMs}ms` : undefined,
          "--nt-arrive": notch ? `${NOTCH_ARRIVE_MS}ms` : undefined,
          "--nt-arrive-ease": notch ? NOTCH_ARRIVE_EASE : undefined,
          ...(notch
            ? notchBoardStyle(prefs.notchEdge, notchAt, { width: window.innerWidth, height: window.innerHeight })
            : floating ? floatingBoardStyle(floatShare, floatBox.board, floatBox.view) : fullDisplay ? boardInsetStyle(corner, prefs.inset) : null),
        } as CSSProperties}
      >
        {/* The stack: room for the panel inside the host's window, on the board's far side from its corner. */}
        {stackMode && tap.open && tapAt && tapAt.room > 0 && (
          <div ref={roomRef} className="arv-taproom" aria-hidden style={{ flex: "none", height: tapAt.room, order: top ? 2 : -2 }} />
        )}
        {blinkOn && <BlinkLayer fire={fire} anchor={boardRef} place={corner} />}
        <FlightLayer
          on={fullDisplay}
          source={deskDemo ? demoFlights : runtimeFlights}
          desk={flightDesk}
          board={() => { const r = boardRef.current?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; }}
        />
        {showBot && fullDisplay && botOpen && !notch && !deskBot.out && (
          <div className="arv-bot" data-hit={REGION_ID}>
            <ScoutbotBeside requests={openRequests} now={now} style={{ width: 440, maxWidth: "calc(100vw - 24px)", maxHeight: "60vh" }} />
          </div>
        )}
        <div ref={boardRef} data-hit={REGION_ID} className={`arv-board arv-widget-board${fullDisplay ? " can-move" : ""}${open ? " is-open" : ""}${closing ? " is-closing" : ""}${notch && (away === "away" || deskTuck) ? " is-away" : ""}${notch && away === "arriving" ? " is-arriving" : ""}`}
          onAnimationEnd={(e) => { if (e.target === e.currentTarget && away === "arriving") setAway(null); }}
          // Tucked for Scout Desk's notch the panel stays up: once in the edge, the board's region goes with it.
          onTransitionEnd={(e) => { if (e.target === e.currentTarget) report(); }} onMouseEnter={onEnter} onMouseLeave={leave} onPointerDown={moveBoard}>
          <CompanionWidget size={widgetSize} live={widgetLines} groups={widgetGroups} activity={plotted.current.map} steps={streamLines} tappedId={tap.open && !tap.closing ? tap.id : null} empty={!lead}
            asking={rows.filter((r) => r.asking).length} quotas={quotas}
            readAt={memory ? sinceClock(memory.passAt) : "…"} onSize={changeSize}
            openWidth={notch ? notchOpenWidth(prefs.notchEdge, { width: window.innerWidth }) : undefined}
            minWidth={notchGrown}
            minHeight={notchTall}
            perch={perchRoom ? { hit: REGION_ID, out: deskBot.out, press: deskBot.press, dragged: deskBot.dragged } : null}
            meters={prefs.meters} dots={prefs.dots}
            actions={{
              newOn: composing, onNew: toggleNew, onNewFiles: demo ? undefined : newWithFiles,
              bot: showBot ? { on: botOpen && (fullDisplay || open), waiting: openRequests.length, onToggle: toggleBot } : null,
              settingsOn: settings, onSettings: toggleSettings,
              order: { value: prefs.order, onChange: (order) => setPrefs({ order }) },
              onHide: host.available ? () => { void hideCompanion().catch(() => {}); } : undefined,
            }}
            onRow={(id) => selectTap(tapRow(tap, id))} onRowsScroll={() => { measureRef.current(); report(); }}
            peek={peek}
            labelOf={labelOf}
            onRowMenu={(id, at) => { if (pool.some((x) => x.id === id)) { setMarkMenu(null); setRowMenu({ id, ...at }); } }}
            onMark={fullDisplay ? toggleChoices : widgetSize === "s" ? () => changeSize("m") : undefined}
            markOn={choices}
            onMarkMenu={fullDisplay ? (at) => { setRowMenu(null); setMarkMenu(at); } : undefined}>

          {/* The stack has no room beside the board: its sheets open here, inside L. */}
          {open && !fullDisplay && settings && settingsBody}
          {open && !fullDisplay && composing && composer}
          {open && !fullDisplay && botOpen && (
            <div className="arv-bot is-inside">
              <ScoutbotBeside requests={openRequests} now={now} style={{ width: "100%", maxHeight: 360 }} />
            </div>
          )}
          {!lead ? (
            open ? (
              <div className="arv-empty is-open" aria-live="polite">
                <span className="arv-empty__copy">
                  <strong>{loaded ? "No activity yet" : "Checking activity"}</strong>
                  <span>{loaded ? "Agent updates will appear here." : "Looking for sessions and replies."}</span>
                </span>
                {loaded && !composing && (
                  <button type="button" className="arv-empty__new" onClick={toggleNew}>New conversation</button>
                )}
              </div>
            ) : (
              <button type="button" className="arv-empty is-folded" onClick={doOpen} aria-label={loaded ? "No activity yet. Open the board" : "Scout. Open the board"}>
                {loaded ? "No activity yet" : "Scout"}
              </button>
            )
          ) : open ? (
            <ol key="open" ref={listRef} className="arv-rows is-ordered">
              {dom.current.map((id) => { const r = byId.get(id); return r ? renderRow(r) : null; })}
              {[...rowHeads].map(([id, label]) => (
                <li key={`group:${label}`} data-k={`group:${label}`} className="arv-group" role="presentation" style={{ order: headPlace.get(id) }}>{label}</li>
              ))}
            </ol>
          ) : (
            strip ? (
              <>
                {/* An ask breaks in as the one full row, with its Allow, above the strip. */}
                {askingRow && <ol key="folded-ask" className="arv-rows arv-strip-ask">{renderRow(askingRow, true)}</ol>}
                {stripShown.shown.length > 0
                  ? <div className="arv-strip-row">
                    <FoldStrip rows={stripShown.shown} activity={plotted.current.map} page={stripShown.page} pages={stripShown.pages} stream={prefs.foldedStyle === "stream" ? streamLines : null} tappedId={tap.open && !tap.closing ? tap.id : null} onTap={(id) => selectTap(tapRow(tap, id))}
                      onMenu={(id, at) => { if (pool.some((x) => x.id === id)) { setMarkMenu(null); setRowMenu({ id, ...at }); } }} />
                    {/* a line opens its agent; the board (settings, New) opens from the tray's edge */}
                    <button type="button" className="arv-strip-board" onClick={doOpen} aria-label="Open the board" title="Open the board"><ScoutMark className="arv-mark__svg" /></button>
                  </div>
                  : !askingRow && <button type="button" className="arv-mark" onClick={doOpen} aria-label="Scout: open the board" title="Scout"><ScoutMark className="arv-mark__svg" /></button>}
              </>
            ) : (
              <ol key="folded" className="arv-rows">{renderRow(lead, true)}</ol>
            )
          )}
          {!open && !strip && rows.length > 1 && <span className="arv-more">{count}</span>}
          {placeError && <div className="arv-error">{placeError}</div>}
          </CompanionWidget>
        </div>
      </div>
      {rowMenu && (() => {
        const t = pool.find((x) => x.id === rowMenu.id);
        if (!t) return null;
        const row = arrivedRows.find((r) => r.id === t.id);
        const tag = labelOf(t);
        const name = [tag && figureLabelText(tag), row?.name ?? rowName(t)].filter(Boolean).join(" ");
        const out = outNow(t);
        return (
          <FigureMenu
            key={t.id}
            t={t}
            machineId={demo ? null : sessions.machines.get(t.id) ?? null}
            demo={demo}
            agents={roster.agents}
            name={name}
            width={ROW_MENU_WIDTH}
            at={{ x: rowMenu.x, y: rowMenu.y }}
            hitId={REGION_ID}
            elRef={rowMenuRef}
            onClose={() => setRowMenu(null)}
            onTalk={() => selectTap({ id: t.id, open: true, closing: false })}
            onDetails={() => openDetails(t.id)}
            onBringOut={canBringOut(t) ? () => bringOut(t, { x: rowMenu.x, y: rowMenu.y }) : undefined}
            onHome={out ? () => sendHome(t) : undefined}
            clearAll={clearAll}
            onDemoAnswer={demo ? scripted.answer : undefined}
          />
        );
      })()}
      {markMenu && <MarkMenu at={markMenu} hitId={REGION_ID} choices={showBot ? toggleChoices : undefined} agents={markAgentsOf()} clearAll={clearAll} everything={everything} onClose={() => setMarkMenu(null)} />}
      {peekThread && peek.shown && <HoverSummary t={peekThread} label={labelOf(peekThread)} name={arrivedRows.find((r) => r.thread.id === peekThread.id)?.name} anchor={peek.shown.el} beside={boardRef.current} hangFrom={notch && (prefs.notchEdge === "top" || prefs.notchEdge === "bottom") ? prefs.notchEdge : null} now={Date.now()} />}
      {/* Tap in sits beside .scx, outside any transformed box: the panel and its tether are fixed in viewport pixels. */}
      {(open || foldedTap) && tapShown && tapAt && (
        <div className="arv-tap" onMouseEnter={onEnter} onMouseLeave={leave}>
          <TapInTether box={tapGone ? null : tapAt.tether} closing={tap.closing} />
          <TapInPanel
            thread={tapShown.thread}
            placement={tapAt.placement}
            closing={tap.closing}
            onClosed={() => setTap(closedTap)}
            onClose={() => setTap(closeTap)}
            // Its running clocks count from the real time. The board's pass lags it by up to a pass, so a state
            // that began since the last pass read 0:00.0, and an older one read short, until the pass caught up.
            now={Date.now()}
            pass={memory?.passAt ?? pass}
            remark={{ word: tapShown.remark, changedAt: tapShown.remarkAt, hhAt: tapShown.hhAt, mmAt: tapShown.mmAt, at: sinceOf(tapShown.thread) }}
            transcript={tapTranscript}
            machineId={demo ? null : sessions.machines.get(tapShown.id) ?? null}
            demo={demo}
            handle={tapHandle}
            hitId={TAP_IN_HIT_ID}
            onDraft={onTapDraft}
            onDemoAnswer={demo ? scripted.answer : undefined}
            agents={demo ? null : roster.agents}
            figure={figureFor(tapShown.thread)}
            label={labelOf(tapShown.thread)}
            onHome={outNow(tapShown.thread) ? () => sendHome(tapShown.thread) : undefined}
            clearAll={clearAll}
            level={showsDetails(tap) ? "details" : "engage"}
            onDetails={() => openDetails(tapShown.id)}
            className={tapAt.placement.box.height > 0 ? undefined : "is-unplaced"}
          />
        </div>
      )}
      {/* Outside the board's layer, as the panel and sheets are: fixed in viewport pixels. */}
      {showBot && notch && botOpen && sheetKind === "bot" && sheetAt && (
        <div className={`arv-bot is-notch from-${sheetAt.from}`} data-hit={REGION_ID}
          style={{ left: sheetAt.left, width: sheetAt.width, top: sheetAt.top ?? undefined, bottom: sheetAt.bottom ?? undefined }}>
          <ScoutbotBeside requests={openRequests} now={now} style={{ width: "100%", maxHeight: Math.min(sheetAt.maxHeight, 560) }} />
        </div>
      )}
      {sheet === "choices" && sheetAt && (
        <CompanionChoices
          choices={choiceList}
          placement={sheetAt}
          hitId={SHEET_HIT_ID}
          demo={demo}
          now={now}
          machineOf={(t) => (demo ? null : sessions.machines.get(t.id) ?? null)}
          agents={roster.agents}
          clearAll={clearAll}
          everything={everything}
          onDetails={openDetails}
          onNew={(project) => { setNewProject(project); setNewFiles(null); openSheet("new"); }}
          onClose={closeChoices}
          onDraft={onChoicesDraft}
          onDemoAnswer={demo ? scripted.answer : undefined}
        />
      )}
      {sheet && sheet !== "choices" && sheetAt && (
        <BoardSheet
          key={sheet}
          title={sheet === "settings" ? "Settings" : "New conversation"}
          placement={sheetAt}
          hitId={SHEET_HIT_ID}
          onClose={() => (sheet === "settings" ? setSettings(false) : setComposing(false))}
        >
          {sheet === "settings" ? settingsBody : composer}
        </BoardSheet>
      )}
      {/* The quick terminal, beside the board. Only where the page spans the display: a stacked board's window has no room for it, so a terminal app opens instead. */}
      {fullDisplay && <QuickTerminalHost keepClear={keepClearOfBoard} />}
    </div>
  );
}
