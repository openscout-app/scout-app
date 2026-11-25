import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  edit,
  expand,
  fitHeights,
  growToBottom,
  fitTo,
  GRID_ROW,
  gridColumnsFor,
  land,
  mergeSaved,
  minFor,
  heightLimit,
  paneOf,
  paneTarget,
  swapTarget,
  parseLayout,
  reconcile,
  resolve,
  rowsFor,
  sameLayout,
  seamAt,
  shrinkToRows,
  unfitHeights,
  widthLimit,
  type GridBonds,
  type GridEdit,
  type GridItem,
  type GridLayout,
  type GridMins,
  type PanelBox,
} from "./hud-grid-layout.ts";

const SEAM_CURSOR = { height: "ns-resize", width: "ew-resize", size: "nwse-resize" } as const;
import { useFrameSpacing } from "./frame-spacing.ts";
import { foldWord, noteSeen, panelFold, parseFoldHolds, toggleFold, type FoldHolds, type PanelContent } from "./hud-grid-fold.ts";
import { ChevronsDownUp, ChevronsUpDown, Maximize2, Minimize2, MoveHorizontal } from "lucide-react";
import "./hud-grid.css";

export type { PanelContent } from "./hud-grid-fold.ts";

export type HudGridPanel = {
  id: string;
  title: ReactNode;
  count?: ReactNode;
  /** Header controls. Buttons inside never start a drag. */
  right?: ReactNode;
  /** Quiet panel tools (a scope picker) beside the title, with expand and full view: they show on hover and never push `right` off the edge. */
  tools?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Smallest size, in cells, the content can draw at. Resize, fit and reflow never go below it. */
  minW?: number;
  minH?: number;
  /** Height in rows when the grid is stacked (narrow screens). Defaults to its default cell height. */
  stackH?: number;
  /**
   * Height follows content: the panel draws at the rows its content takes,
   * never taller than its cell, and the panels under it close up. Its cell
   * (what the operator sizes and saves) is the most it grows to. For lists
   * and forms; a chart or terminal that fills its panel leaves it off.
   */
  fit?: boolean;
  /** Filling, this panel takes its column's spare height; a panel without `fit` does anyway. */
  grow?: boolean;
};

export type HudGridArrangement = { id: string; label: string; layout: GridLayout };

/** The grid's arrangements, for a host that offers them in a control of its own (a Layout menu). */
export type HudGridControls = {
  arrangements: readonly HudGridArrangement[];
  /** The arrangement drawn now; null when the panels are where the operator put them. */
  active: string | null;
  /** False while the grid is stacked or locked: no arrangement applies then. */
  available: boolean;
  apply: (id: string) => void;
};

const storageKey = (surface: string, cols: number) => `openscout.grid.v1.${surface}.${cols}`;
/** Hand folds, per surface: the same at every column count. */
export const foldStorageKey = (surface: string) => `openscout.grid.v1.${surface}.folds`;

function readFolds(key: string): FoldHolds {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseFoldHolds(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function writeFolds(key: string, holds: FoldHolds) {
  try {
    if (Object.keys(holds).length) window.localStorage.setItem(key, JSON.stringify(holds));
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable: the folds last for this visit */
  }
}

type ContentReport = (content: PanelContent | null) => void;
const PanelContentContext = createContext<ContentReport | null>(null);

/**
 * A panel's content says whether it has anything to show. Empty, the panel
 * folds to its head row and gives its height to the panels around it; when
 * content arrives it opens again. `mark` changes when new content arrives, so
 * a panel the operator folded by hand can say so; `count` and `state` read on
 * the folded row. Outside a grid it does nothing.
 */
export function usePanelContent(content: PanelContent | null): void {
  const report = useContext(PanelContentContext);
  const key = content ? `${content.empty}\u0000${content.mark ?? ""}\u0000${content.count ?? ""}\u0000${content.state ?? ""}` : "";
  const latest = useRef(content);
  latest.current = content;
  useLayoutEffect(() => {
    report?.(latest.current);
  }, [report, key]);
  useLayoutEffect(() => () => report?.(null), [report]);
}

// Per-viewer convenience: the grid draws its defaults when storage is unavailable.
function readSaved(key: string): GridLayout | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? parseLayout(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeSaved(key: string, layout: GridLayout | null) {
  try {
    if (layout) window.localStorage.setItem(key, JSON.stringify(layout));
    else window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable: the arrangement lasts for this visit */
  }
}

type FullRect ={ top: number; left: number; width: number; height: number };

/** The nearest ancestor that scrolls: the pane the grid lives in, so full view never runs under app chrome. */
function scrollPane(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === "auto" || overflowY === "scroll") return p;
  }
  return null;
}

/** Where a panel in full view sits: over the grid's own column, from its visible top to the bottom of its pane. */
function fullRect(host: HTMLElement): FullRect {
  const r = host.getBoundingClientRect();
  const pane = scrollPane(host)?.getBoundingClientRect();
  const top = Math.max(r.top, (pane?.top ?? 0) + 8);
  const bottom = (pane?.bottom ?? window.innerHeight) - 12;
  return { top, left: r.left, width: r.width, height: Math.max(240, bottom - top) };
}

/**
 * An Esc that belongs to something inside a panel: a field, a terminal (vim
 * and herdr live on Esc), or a handler that already took it. Full view stays.
 */
function escTakenElsewhere(e: globalThis.KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  const t = e.target;
  return t instanceof Element && !!t.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), .xterm");
}

/**
 * Puts a grid panel in full view, or back, from outside the grid: a module's
 * own shortcut (a terminal's ⌘⇧B). The same as its ⤢, so nothing moves or
 * remounts. False when `panel` is not a grid panel.
 */
export function requestFullView(panel: Element): boolean {
  const button = panel.querySelector<HTMLButtonElement>(":scope > .hud-grid-head .hud-grid-full");
  button?.click();
  return !!button;
}

/**
 * Full view as a panel's content sees it: "self" when its panel fills the
 * grid, "other" when another panel does (this one is hidden), null when none
 * does. Content that hands work to a neighbour panel takes it back while
 * "self", since the neighbour is out of sight.
 */
export type GridFullView = "self" | "other" | null;
const FullViewContext = createContext<GridFullView>(null);
export function useGridFullView(): GridFullView {
  return useContext(FullViewContext);
}

/**
 * A gesture in the air, on the layout as drawn (`base`); `cells` is what that
 * drawing came from, so the landing gives fitted panels their cells back.
 * `cols` is the column count it began at: a different count ends it.
 */
type Drag = { id: string; mode: GridEdit; sx: number; sy: number; base: GridLayout; cells: GridLayout; cols: number };

/** A panel's box relative to the grid's own top-left, so scrolling or the grid moving never reads as a panel moving. */
type Rect = { x: number; y: number; w: number; h: number };

const FLIP = "hud-grid-flip";
const FLIP_SIZE = "hud-grid-flip-size";
const GHOST = "\u0000ghost";
const isFlip = (a: Animation) => a.id === FLIP || a.id === FLIP_SIZE;

function gridRect(el: HTMLElement, origin: DOMRect): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
}

/**
 * Where a gliding element is on screen right now: the cell it was gliding to
 * plus the offset and size the glide has reached. Read before the glide is
 * cancelled, while its values still apply (box-sizing is border-box, so the
 * computed size is the box's).
 */
function inFlight(el: HTMLElement, to: Rect): Rect {
  const cs = getComputedStyle(el);
  const m = cs.transform && cs.transform !== "none" ? new DOMMatrixReadOnly(cs.transform) : null;
  const w = parseFloat(cs.width);
  const h = parseFloat(cs.height);
  return { x: to.x + (m?.m41 ?? 0), y: to.y + (m?.m42 ?? 0), w: Number.isFinite(w) ? w : to.w, h: Number.isFinite(h) ? h : to.h };
}

/** The same spring the docked sides fold on (Hudson's, with its curve as the fallback). */
const SPRING = "linear(0, 0.0315, 0.1089, 0.2115, 0.3245, 0.4376, 0.544, 0.64, 0.7235, 0.7939, 0.8518, 0.8981, 0.9341, 0.9614, 0.9814, 0.9955, 1.0049, 1.0107, 1.0138, 1.0151, 1.015, 1.014, 1.0126, 1.0109, 1.0092, 1.0076, 1.006, 1.0047, 1.0035, 1.0026, 1.0018, 1.0012, 1)";
function flipEasing(el: HTMLElement): { easing: string; ms: number } {
  const cs = getComputedStyle(el);
  const easing = cs.getPropertyValue("--hud-ease-spring").trim() || SPRING;
  const raw = cs.getPropertyValue("--hud-duration-spring").trim();
  const ms = (raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : NaN) || 380;
  return { easing: CSS.supports("transition-timing-function", easing) ? easing : "cubic-bezier(0.2, 0.8, 0.2, 1)", ms };
}

/**
 * Drop the inline geometry a drag puts on the panel under the hand. Stacked,
 * React owns the panel's height, so a gesture the stack ended keeps it.
 */
function clearDragStyle(el: HTMLElement | undefined, stacked = false) {
  if (!el) return;
  el.style.transform = "";
  el.style.width = "";
  if (!stacked) el.style.height = "";
}

/**
 * Panels on a fluid 12-column grid (8 when narrower, stacked when narrower
 * still). Drag a head to move (with ⇧, its whole pane moves as one; with ⌥,
 * onto a neighbour it trades places), an edge or the corner to resize; double-click a
 * head or press e to expand into free columns (again to restore; the grid
 * remembers what to restore to across reloads). f or ⤢ puts one panel in full
 * view over the grid without moving anything; esc returns. With a panel
 * focused, ⇧+arrows move it and ⌥+arrows resize it. No gesture takes a panel
 * below its minW × minH, so content always has room to draw.
 */
export function HudGrid({
  surface,
  panels,
  defaults,
  arrangements = [],
  bonds,
  locked = false,
  fill = false,
  hint = true,
  editing = false,
  resetKey,
  controls,
}: {
  surface: string;
  panels: readonly HudGridPanel[];
  /** Authored at 12 columns. */
  defaults: GridLayout;
  arrangements?: readonly HudGridArrangement[];
  /**
   * How panels prefer to behave together (hud-grid-layout.ts `GridBonds`). Panes not declared are
   * read off the layout as it stands: panels sharing a column with no gap between them. A resize keeps
   * panes whole. A pair `swaps` declares trades places on a plain drag; any other neighbour along a
   * whole edge trades only with ⌥ held, and the ghost says "Hold ⌥ to swap" over one. With ⇧ held, a
   * pane moves as one, and trades sides with the column under the pointer.
   */
  bonds?: GridBonds;
  /** Holds every panel in place: no dragging, resizing or arranging. Expand and full view still work. */
  locked?: boolean;
  /**
   * Stretch rows so the layout fills the pane it sits in: on a tall window a
   * composition authored at 24px rows fills the screen instead of the top of
   * it. Rows never go below 24px; a layout taller than the pane scrolls.
   */
  fill?: boolean;
  /** Show the gesture hint in the bar. A host with an edit mode shows it only while editing. */
  hint?: boolean;
  /**
   * Modules are being edited: every panel draws at exactly its cell (no content fit, no fill), so
   * what is dragged or sized is what lands. Outside it, a panel whose height the operator set (its
   * cell differs from the arrangement's default) keeps that height too.
   */
  editing?: boolean;
  /**
   * Change it to drop what the grid holds (the saved arrangement, expanded
   * cells, full view) and draw the defaults again. The panels stay mounted,
   * so whatever they are running (a call, a terminal) carries on. The owner
   * clears the saved copies in storage.
   */
  resetKey?: string | number;
  /**
   * Offer the arrangements where the host draws this (a Layout menu in a row it already has)
   * instead of in a bar over the grid. The gesture hint still shows over the grid with `hint`.
   */
  controls?: (c: HudGridControls) => ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The gap between panels and the room under a filled grid, as the stylesheet draws them (Density moves
  // both). The row, fill and drag math below use these same numbers, so the cells land where the CSS puts them.
  const { gap, edgeY: fillFoot } = useFrameSpacing();
  const [width, setWidth] = useState(0);
  // the operator's cells at the current column count (read below, once the count is known)
  const [saved, setSaved] = useState<GridLayout | null>(null);

  const ids = useMemo(() => panels.map((p) => p.id), [panels]);
  const idKey = ids.join("|");
  const minKey = panels.map((p) => `${p.id}:${p.minW ?? ""}x${p.minH ?? ""}`).join("|");
  const mins = useMemo<GridMins>(
    () => Object.fromEntries(panels.filter((p) => p.minW || p.minH).map((p) => [p.id, { w: p.minW ?? 0, h: p.minH ?? 0 }])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [minKey],
  );
  // What draws at 12 columns, saved or default. With no two panels side by side it keeps 12 columns
  // at any width (gridColumnsFor), so a lone main panel between docked sides fills instead of stacking.
  // `saved` is in the deps, so a landed gesture that puts two panels side by side (or back) is seen.
  const at12 = useMemo(
    () => reconcile(readSaved(storageKey(surface, 12)), defaults, ids, 12, mins),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, defaults, idKey, mins, saved],
  );
  const cols = gridColumnsFor(width, at12);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Room from the top of the grid to the bottom of its pane, for fill.
  const [avail, setAvail] = useState<number | null>(null);
  useLayoutEffect(() => {
    const g = gridRef.current;
    if (!fill || !cols || !g) return setAvail(null);
    const pane = scrollPane(g);
    const measure = () => {
      const top = g.getBoundingClientRect().top;
      const room = pane
        ? pane.clientHeight - (top - pane.getBoundingClientRect().top + pane.scrollTop)
        : window.innerHeight - (top + window.scrollY);
      setAvail(Math.max(0, Math.floor(room - fillFoot)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (pane) ro.observe(pane);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fill, cols, fillFoot]);

  const key = cols ? storageKey(surface, cols) : null;
  useEffect(() => {
    setSaved(key ? readSaved(key) : null);
  }, [key]);

  const view = useMemo(
    () => (cols ? reconcile(saved, defaults, ids, cols, mins) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved, defaults, idKey, cols, mins],
  );

  const [live, setLive] = useState<GridLayout | null>(null); // mid-gesture
  // the same, for the pointerup that lands it (read there, not in a state updater, so landing has no side effects to repeat)
  const liveRef = useRef(live);
  liveRef.current = live;
  const [drag, setDrag] = useState<Drag | null>(null);
  // mid-move, what the ghost's chip says: the keys that would do more here, or what ⇧ is doing
  const [chip, setChip] = useState<string | null>(null);
  // mid-move with ⇧ held: the pane moving with the hand, top to bottom (null: the panel moves alone)
  const [carried, setCarried] = useState<readonly string[] | null>(null);
  // the panels the hand has put a transform on, so a reset or a let-go takes it off every one
  const handled = useRef(new Set<string>());
  const [focus, setFocus] = useState<string | null>(null);
  // The cell each expanded panel restores to. Saved beside the layout so a
  // reload still knows a panel is expanded and where it came from.
  const restoreKey = key ? `${key}.restore` : null;
  const [restore, setRestore] = useState<GridLayout>([]);
  useEffect(() => {
    setRestore((restoreKey && readSaved(restoreKey)) || []);
  }, [restoreKey]);
  const saveRestore = useCallback(
    (next: GridLayout) => {
      setRestore(next);
      if (restoreKey) writeSaved(restoreKey, next.length ? next : null);
    },
    [restoreKey],
  );
  const restoreFor = (id: string) => restore.find((i) => i.id === id);

  // What each panel's content reports (usePanelContent), by panel; one stable reporter per panel.
  const [content, setContent] = useState<Readonly<Record<string, PanelContent>>>({});
  const reporters = useRef(new Map<string, ContentReport>());
  const reporter = (id: string) => {
    let report = reporters.current.get(id);
    if (!report) {
      report = (next) =>
        setContent((prev) => {
          if (!next) {
            if (!(id in prev)) return prev;
            const { [id]: _gone, ...rest } = prev;
            return rest;
          }
          const was = prev[id];
          if (was && was.empty === next.empty && was.mark === next.mark && was.count === next.count && was.state === next.state) return prev;
          return { ...prev, [id]: next };
        });
      reporters.current.set(id, report);
    }
    return report;
  };
  // Folds the operator set by hand, saved per surface (not per column count) beside the cells.
  const foldKey = foldStorageKey(surface);
  const [holds, setHolds] = useState<FoldHolds>(() => readFolds(foldKey));
  const foldKeySeen = useRef(foldKey);
  useEffect(() => {
    if (foldKeySeen.current === foldKey) return;
    foldKeySeen.current = foldKey;
    setHolds(readFolds(foldKey));
  }, [foldKey]);
  const saveHolds = useCallback(
    (next: FoldHolds) => {
      setHolds(next);
      writeFolds(foldKey, next);
    },
    [foldKey],
  );
  // a fold made before its content reported takes the first mark it reports as seen, so that is not news
  useEffect(() => {
    let next = holds;
    for (const id of Object.keys(holds)) next = noteSeen(next, id, content[id]);
    if (next !== holds) saveHolds(next);
  }, [content, holds, saveHolds]);
  const toggleFolded = useCallback((id: string) => saveHolds(toggleFold(holds, id, content[id])), [holds, content, saveHolds]);

  const [full, setFull] = useState<string | null>(null);
  const [rect, setRect] = useState<FullRect | null>(null);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!full || !host) return setRect(null);
    const place = () => setRect(fullRect(host));
    place();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && !escTakenElsewhere(e) && setFull(null);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true, capture: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);
  useEffect(() => {
    if (full && !ids.includes(full)) setFull(null);
  }, [full, ids]);

  // Content-fit panels: how tall each one's head and content draw, in px, measured live.
  const [fitPx, setFitPx] = useState<Readonly<Record<string, number>>>({});
  const [bare, setBare] = useState<ReadonlySet<string>>(() => new Set()); // fit panels with no content under the head
  const fitObserver = useRef<ResizeObserver | null>(null);
  const fitEls = useRef(new Map<string, HTMLElement>());
  const measureFit = useCallback((el: HTMLElement) => {
    const id = el.dataset.fit;
    const panel = el.closest<HTMLElement>(".hud-grid-panel");
    if (!id || !panel) return;
    // mid-glide its width is passing through sizes it won't keep; remeasure takes it when it lands
    if (panel.getAnimations().some((a) => a.id === FLIP_SIZE)) return;
    const head = panel.querySelector<HTMLElement>(":scope > .hud-grid-head");
    // head, content and the panel's own frame
    const px = Math.ceil((head?.offsetHeight ?? 0) + el.offsetHeight + (panel.offsetHeight - panel.clientHeight));
    setFitPx((prev) => (prev[id] === px ? prev : { ...prev, [id]: px }));
    const empty = el.offsetHeight === 0;
    setBare((prev) => {
      if (prev.has(id) === empty) return prev;
      const next = new Set(prev);
      if (empty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) measureFit(e.target as HTMLElement);
    });
    fitObserver.current = ro;
    for (const el of fitEls.current.values()) ro.observe(el);
    return () => {
      ro.disconnect();
      fitObserver.current = null;
    };
  }, [measureFit]);
  const remeasure = (panel: HTMLElement) => {
    const fit = panel.querySelector<HTMLElement>(":scope > .hud-grid-body > .hud-grid-fit");
    if (fit) measureFit(fit);
  };
  // one stable ref callback per panel, so a render never re-observes
  const fitRefs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const fitRef = (id: string) => {
    let ref = fitRefs.current.get(id);
    if (!ref) {
      ref = (el) => {
        const prev = fitEls.current.get(id);
        if (prev && prev !== el) fitObserver.current?.unobserve(prev);
        if (el) {
          fitEls.current.set(id, el);
          fitObserver.current?.observe(el);
        } else fitEls.current.delete(id);
      };
      fitRefs.current.set(id, ref);
    }
    return ref;
  };

  const layout = live ?? view;
  // Arranging (editing, or a gesture in the air): the cells as they are, nothing fit, folded or filled.
  const arranging = editing || Boolean(drag);
  const bottom = (l: GridLayout) => (l.length ? Math.max(...l.map((i) => i.y + i.h)) : 0);
  // Rows keep one height: a height the operator sets is real pixels and stays put. (Stretching every
  // row to fill the window made any shrink reflow the whole page back to its end.) Filling is done by
  // giving the window's spare rows to the panels made to grow (growToBottom below).
  const rowH = GRID_ROW;
  const windowRows = fill && cols && avail ? Math.floor((avail + gap) / (GRID_ROW + gap)) : 0;
  // a height the operator chose: the cell differs from the arrangement's default; it keeps that height
  const sized = new Set(layout.filter((i) => { const d = defaults.find((x) => x.id === i.id); return Boolean(d) && d!.h !== i.h; }).map((i) => i.id));
  const need: Record<string, number> = {};
  for (const p of panels) if (p.fit && !sized.has(p.id) && fitPx[p.id] != null) need[p.id] = rowsFor(fitPx[p.id], rowH, gap);
  // a folded panel is its head row: one row, whatever its cell or content (full view shows it whole)
  const foldOf = (id: string) => panelFold(content[id], holds[id]);
  const folded = new Set(arranging ? [] : panels.filter((p) => p.id !== full && foldOf(p.id).folded).map((p) => p.id));
  for (const id of folded) need[id] = 1;
  // what draws: each content-fit panel no taller than its content, the rest closed up under it,
  // and every column ending on one line (the window's bottom, filling; else the lowest panel's):
  // a column's room goes to its panel that can use it (a stream, a list marked grow), else its last.
  // Filling a window shorter than the layout, the same panels give rows back down to their minimums,
  // so the main panel ends on the window's bottom with its sides instead of running under it.
  const fitted = cols && !arranging ? fitHeights(layout, need) : layout;
  const canGrow = (id: string) => { const p = panels.find((q) => q.id === id); return !!p && !folded.has(id) && !sized.has(id) && (!p.fit || !!p.grow); };
  const inWindow = cols && !arranging && windowRows > 0 ? shrinkToRows(fitted, windowRows, canGrow, mins) : fitted;
  const drawn = cols && !arranging ? growToBottom(inWindow, Math.max(fill && avail ? windowRows : 0, bottom(inWindow)), canGrow, (id) => folded.has(id)) : fitted;
  const rows = bottom(drawn);
  // Filling, the window is rarely a whole number of rows: the last row takes the leftover pixels, so every
  // column ends on the pane's bottom instead of up to a row pitch short of it. Rows above keep their height.
  const lastRowExtra = fill && avail && cols && !arranging && windowRows > 0 && rows === windowRows
    ? Math.max(0, avail - (windowRows * (GRID_ROW + gap) - gap))
    : 0;
  const lastAvail = useRef(avail);
  const lastWidth = useRef(width);

  /*
   * Reflow glides: each panel (and the landing ghost) animates from where it
   * is on screen to where it is now drawn. Rects are kept relative to the grid,
   * so a scroll or a side folding in between never reads as movement. A glide
   * the next change interrupts starts from where it had got to, not from where
   * it was headed, so a pointer crossing cells quickly never makes a panel jump.
   */
  const layoutKey = cols ? `${rowH}|` + drawn.map((i) => `${i.id}${i.x},${i.y},${i.w},${i.h}`).join("|") : "";
  useLayoutEffect(() => {
    const g = gridRef.current;
    if (!g) return;
    // the grid itself resized (window, a side folding) or the pane did: columns rescale every frame,
    // so follow them, don't animate; the rects are retaken so the next glide starts from the truth
    const resized = lastAvail.current !== avail || lastWidth.current !== width;
    lastAvail.current = avail;
    lastWidth.current = width;
    const reduce = resized || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const origin = g.getBoundingClientRect();
    const spring = flipEasing(g);
    const els = [...panelEls.current];
    if (ghostEl.current) els.push([GHOST, ghostEl.current]);
    for (const [id, el] of els) {
      if (drag?.id === id) continue; // under the hand; it moves itself
      let from = lastRects.current.get(id);
      const running = el.getAnimations().filter(isFlip);
      if (running.length && from) from = inFlight(el, from);
      for (const a of running) a.cancel();
      const to = gridRect(el, origin);
      lastRects.current.set(id, to);
      if (!from || reduce) continue;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(from.w - to.w) < 0.5 && Math.abs(from.h - to.h) < 0.5) continue;
      // a panel that only moves glides on the compositor; one that changes size reflows as it goes
      const sizing = Math.abs(from.w - to.w) >= 0.5 || Math.abs(from.h - to.h) >= 0.5;
      const anim = el.animate(
        sizing
          ? [
              { transform: `translate(${dx}px, ${dy}px)`, width: `${from.w}px`, height: `${from.h}px` },
              { transform: "translate(0, 0)", width: `${to.w}px`, height: `${to.h}px` },
            ]
          : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
        { duration: spring.ms, easing: spring.easing },
      );
      anim.id = sizing ? FLIP_SIZE : FLIP;
      // a content-fit panel measures its content once the glide lands, not at every frame of it
      if (sizing) anim.finished.then(() => remeasure(el), () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, drag?.id, avail, width]);

  // Saves a layout as it is. A drop saves through here: `land` already gives the layout the next
  // render draws, so another packing pass would only move what the preview showed.
  const save = useCallback(
    (next: GridLayout) => {
      if (!key) return;
      const merged = mergeSaved(saved, next);
      setSaved(merged);
      writeSaved(key, merged);
    },
    [key, saved],
  );
  // Packs, then saves: for edits that never drew a preview (keys, restore, fit).
  const commit = useCallback((next: GridLayout) => save(resolve(next)), [save]);

  // Panels by id, for pointer-following and for animating reflow.
  const panelEls = useRef(new Map<string, HTMLElement>());
  const lastRects = useRef(new Map<string, Rect>());
  const ghostRef = useCallback((el: HTMLDivElement | null) => {
    // a new gesture's ghost appears where it lands; it glides only within its gesture
    if (!el) lastRects.current.delete(GHOST);
    ghostEl.current = el;
  }, []);
  const ghostEl = useRef<HTMLDivElement | null>(null);

  // A reset mid-gesture also drops what the hand put on the panel: it stays
  // mounted, so nothing else would take that geometry off.
  const resetSeen = useRef(resetKey);
  useEffect(() => {
    if (resetSeen.current === resetKey) return;
    resetSeen.current = resetKey;
    if (drag) clearDragStyle(panelEls.current.get(drag.id), !cols);
    for (const id of handled.current) clearDragStyle(panelEls.current.get(id), !cols);
    handled.current.clear();
    setCarried(null);
    setChip(null);
    setSaved(null);
    setRestore([]);
    setLive(null);
    setDrag(null);
    setFull(null);
    saveHolds({});
  }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * While dragging, the lifted panel follows the pointer pixel for pixel (set
   * straight on the element, no re-render), a ghost shows the snapped cell it
   * will land in, and the other panels glide to make room. Snapping happens
   * only in the ghost and the neighbours, never in the panel under the hand.
   */
  useEffect(() => {
    if (!drag) return;
    const el = panelEls.current.get(drag.id);
    // the grid changed under the gesture (narrowed to another column count, stacked, locked): drop it, keep nothing
    // the other members of a pane moving as one, carried by the same transform; let go of every one
    const release = () => {
      for (const id of handled.current) clearDragStyle(panelEls.current.get(id), !cols);
      handled.current.clear();
      setCarried(null);
      setChip(null);
    };
    const cancel = () => {
      clearDragStyle(el, !cols);
      release();
      setDrag(null);
      setLive(null);
    };
    if (!cols || cols !== drag.cols || locked) return cancel();
    const g = gridRef.current;
    // the grid's exact width, not clientWidth's whole pixels: a rounded column drifts a few px by the far edge
    const colW = ((g?.getBoundingClientRect().width ?? 1200) - gap * (cols - 1)) / cols;
    const stepX = colW + gap;
    const stepY = rowH + gap;
    const o = drag.base.find((i) => i.id === drag.id)!;
    const min = minFor(mins, drag.id, cols);
    // the panel under the hand stops where its cell will: at a neighbour's minimum, not over the neighbour
    const maxW = widthLimit(drag.base, drag.id, cols, mins, bonds);
    // a seam inside a pane stops where the member under it reaches its minimum
    const maxH = heightLimit(drag.base, drag.id, cols, mins, bonds);
    const px = (cells: number, unit: number) => cells * unit - gap;
    // the pointer on the grid, in cells (column 2.5 is the middle of the third), for finding a panel to trade with
    const cellAt = (cx: number, cy: number) => {
      const r = g?.getBoundingClientRect();
      return { x: (cx - (r?.left ?? 0)) / stepX, y: (cy - (r?.top ?? 0)) / stepY };
    };
    const from = cellAt(drag.sx, drag.sy);
    let held: string | null = null;
    let last = "";
    let heldPane: string | null = null;
    let carriedKey = "";
    // where the pointer is and whether ⌥ and ⇧ are down, read live: a key press mid-drag replays the last pointer
    let at = { x: drag.sx, y: drag.sy };
    let alt = false;
    let shift = false;
    const step = () => {
      const mx = at.x - drag.sx;
      const my = at.y - drag.sy;
      // ⇧ on a member of a pane: the pane moves as one, every member under the same transform
      const pane = drag.mode === "move" && shift ? paneOf(drag.base, drag.id, bonds) : null;
      const ids = pane ? pane.map((m) => m.id).filter((id) => id !== drag.id) : [];
      for (const id of handled.current) {
        if (ids.includes(id)) continue;
        clearDragStyle(panelEls.current.get(id), !cols);
        handled.current.delete(id);
      }
      for (const id of ids) {
        const m = panelEls.current.get(id);
        if (!m) continue;
        m.style.transform = `translate(${mx}px, ${my}px)`;
        handled.current.add(id);
      }
      const key = pane ? pane.map((m) => m.id).join("|") : "";
      if (key !== carriedKey) {
        carriedKey = key;
        setCarried(pane ? pane.map((m) => m.id) : null);
      }
      if (el) {
        if (drag.mode === "move") el.style.transform = `translate(${mx}px, ${my}px)`;
        if (drag.mode === "size" || drag.mode === "width")
          el.style.width = `${Math.min(px(maxW, stepX), Math.max(px(min.w, stepX), px(o.w, stepX) + mx))}px`;
        if (drag.mode === "size" || drag.mode === "height")
          el.style.height = `${Math.max(px(min.h, stepY), Math.min(px(maxH, stepY), px(o.h, stepY) + my))}px`;
      }
      const dx = Math.round(mx / stepX);
      const dy = Math.round(my / stepY);
      // Over the middle of another panel, a move trades places with it, and holds until the pointer
      // leaves that panel: a pair the view declares on a plain drag, any other neighbour only with ⌥.
      // With ⇧ moving a pane, the pane trades sides with the column under the pointer instead.
      const cell = drag.mode === "move" ? cellAt(at.x, at.y) : null;
      const unit = cell && pane ? { trade: paneTarget(drag.base, drag.id, cell, from, heldPane, bonds) } : null;
      heldPane = unit?.trade ?? null;
      const swap = cell && !unit ? swapTarget(drag.base, drag.id, cell, from, held, cols, mins, bonds, alt) : null;
      held = swap;
      const offers = [
        cell && !unit && !swap && !alt && swapTarget(drag.base, drag.id, cell, from, null, cols, mins, bonds, true) != null ? "Hold ⌥ to swap" : null,
        cell && !unit && paneTarget(drag.base, drag.id, cell, from, null, bonds) != null ? "⇧ moves the column" : null,
      ].filter(Boolean);
      setChip(unit ? "Moving the column" : offers.length ? offers.join(" · ") : null);
      const now = `${dx},${dy},${swap},${unit ? (unit.trade ?? "-") : ""}`;
      if (now === last) return;
      last = now;
      // always from the layout the gesture began with, so a passing drag never shoves things for good
      const next = edit(drag.base, drag.id, drag.mode, dx, dy, cols, mins, bonds, swap, unit);
      liveRef.current = next;
      setLive(next);
    };
    const move = (e: globalThis.PointerEvent) => {
      at = { x: e.clientX, y: e.clientY };
      alt = e.altKey;
      shift = e.shiftKey;
      step();
    };
    // ⌥ or ⇧ pressed or let go mid-drag switches the preview at once, without waiting for the pointer to move
    const key = (e: globalThis.KeyboardEvent) => {
      if (drag.mode !== "move" || (e.altKey === alt && e.shiftKey === shift)) return;
      alt = e.altKey;
      shift = e.shiftKey;
      step();
    };
    const up = () => {
      // settle from where the hand left it: record that spot, then glide into the cell the preview showed
      if (el && g) lastRects.current.set(drag.id, gridRect(el, g.getBoundingClientRect()));
      for (const id of handled.current) {
        const m = panelEls.current.get(id);
        if (m && g) lastRects.current.set(id, gridRect(m, g.getBoundingClientRect()));
      }
      clearDragStyle(el);
      release();
      const landed = liveRef.current;
      // what lands is what the preview showed: no second packing pass after the hand lets go
      if (landed && !sameLayout(landed, drag.base)) save(land(landed, drag.base, drag.cells, drag.id, drag.mode));
      setDrag(null);
      setLive(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    // the system took the pointer (a gesture, a dialog): nothing lands
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
    };
  }, [drag, cols, locked, save, mins, bonds, rowH, gap]);

  const toggleExpand = useCallback(
    (id: string) => {
      if (!cols) return;
      const prev = restore.find((i) => i.id === id);
      const cur = layout.find((i) => i.id === id);
      if (!cur) return;
      const others = restore.filter((i) => i.id !== id);
      if (prev) {
        saveRestore(others);
        const min = minFor(mins, id, cols);
        const w = Math.min(cols, Math.max(min.w, prev.w));
        commit(resolve(layout.map((i) => (i.id === id ? { ...cur, x: Math.min(prev.x, cols - w), w, h: Math.max(min.h, prev.h) } : i)), id));
      } else {
        const next = expand(layout, id, cols);
        if (sameLayout(next, layout)) return; // already as wide as it gets
        saveRestore([...others, cur]);
        commit(next);
      }
    },
    [cols, layout, commit, restore, saveRestore, mins],
  );

  const start = (id: string, mode: GridEdit) => (e: PointerEvent) => {
    if (e.button !== 0 || !cols || locked) return;
    if (mode === "move" && (e.target as HTMLElement).closest("button, a, input, select, textarea, [role='button'], [role='group'], [role='dialog']")) return;
    e.preventDefault();
    e.stopPropagation();
    setFocus(id);
    // sizing by hand ends "expanded": there's nothing sensible to restore to
    if (mode !== "move" && restoreFor(id)) saveRestore(restore.filter((i) => i.id !== id));
    setDrag({ id, mode, sx: e.clientX, sy: e.clientY, base: drawn, cells: layout, cols });
    // The gesture works on the layout as drawn, so it starts from it: arranging draws cells as they
    // are, and without this every fitted, grown or shrunk panel jumped to its cell on the press and
    // back on the first move.
    liveRef.current = drawn;
    setLive(drawn);
  };

  /** The seam a press in the grid's gaps lands on: panels that draw their edge handles, nothing else. */
  const seamUnder = (x: number, y: number) => {
    if (!cols || locked || full) return null;
    const boxes: PanelBox[] = [];
    for (const [id, el] of panelEls.current) {
      if (folded.has(id) || !panels.some((p) => p.id === id)) continue;
      const r = el.getBoundingClientRect();
      boxes.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    }
    return seamAt(boxes, x, y, gap);
  };

  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    // fold works stacked too; everything else needs the grid
    if (e.key === "m" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && full !== id) {
      e.preventDefault();
      toggleFolded(id);
      return;
    }
    if (!cols) return;
    if (e.key === "Escape") {
      if (full) return; // the window listener leaves full view first
      (e.currentTarget as HTMLElement).blur();
      setFocus(null);
      return;
    }
    if (e.key === "f" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      setFull((f) => (f === id ? null : id));
      return;
    }
    if (full) return;
    if (e.key === "e" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      toggleExpand(id);
      return;
    }
    if (locked) return;
    if (!(e.shiftKey || e.altKey)) return;
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (!d) return;
    e.preventDefault();
    // on the layout as drawn, so a step is a step on screen; fitted panels keep their cells
    let next = edit(drawn, id, e.altKey ? "size" : "move", d[0], d[1], cols, mins, bonds);
    // moving up past a neighbour: jump over it rather than bounce back
    if (d[1] < 0 && !e.altKey) {
      const cur = drawn.find((i) => i.id === id)!;
      const blocker = drawn.find((i) => i.id !== id && i.x < cur.x + cur.w && cur.x < i.x + i.w && i.y + i.h === cur.y);
      if (blocker) next = resolve(drawn.map((i) => (i.id === id ? { ...cur, y: blocker.y } : i)), id);
    }
    commit(unfitHeights(next, drawn, layout, id));
  };

  const applyArrangement = (a: HudGridArrangement) => {
    if (!cols) return;
    saveRestore([]);
    commit(fitTo(a.layout, cols, mins));
  };

  const active = cols ? arrangements.find((a) => sameLayout(reconcile(fitTo(a.layout, cols, mins), a.layout, ids, cols, mins), layout)) : undefined;
  const byId = new Map(panels.map((p) => [p.id, p]));
  const order = cols ? [...drawn].sort((a, b) => a.y - b.y || a.x - b.x) : panels.map((p) => ({ id: p.id }) as GridItem);

  const hintText = focus ? "e expand · f full view · m fold · ⇧ arrows move · ⌥ arrows size · esc" : "Drag a head to move · edge or corner to size · double-click to expand";

  return (
    <div ref={hostRef} className="hud-grid-host">
      {controls ? (
        <>
          {controls({
            arrangements,
            active: active?.id ?? null,
            available: Boolean(cols) && !locked,
            apply: (id) => {
              const a = arrangements.find((x) => x.id === id);
              if (a) applyArrangement(a);
            },
          })}
          {cols && !locked && hint && (
            <div className="hud-grid-bar">
              <span className="hud-grid-bar-hint">{hintText}</span>
            </div>
          )}
        </>
      ) : cols && !locked && arrangements.length > 0 && (
        <div className="hud-grid-bar">
          <span className="hud-grid-bar-label">Arrangement</span>
          {arrangements.map((a) => (
            <button key={a.id} type="button" className="hud-grid-chip" aria-pressed={active?.id === a.id} onClick={() => applyArrangement(a)}>
              {a.label}
            </button>
          ))}
          {!active && <span className="hud-grid-bar-label hud-grid-bar-label--yours">Yours · saved</span>}
          {hint && <span className="hud-grid-bar-hint">{hintText}</span>}
        </div>
      )}
      <div
        ref={gridRef}
        className={`hud-grid${cols ? "" : " hud-grid--stacked"}${drag ? " is-dragging" : ""}${full ? " has-full" : ""}${locked ? " is-locked" : ""}`}
        style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: lastRowExtra ? `repeat(${rows - 1}, ${rowH}px) ${rowH + lastRowExtra}px` : `repeat(${rows}, ${rowH}px)` } : undefined}
        onPointerDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const seam = seamUnder(e.clientX, e.clientY);
          if (seam) start(seam.id, seam.mode)(e);
          else setFocus(null);
        }}
        onPointerMove={(e) => {
          // the gaps between panels are their seams: show the size cursor there
          if (drag) return;
          const seam = e.target === e.currentTarget ? seamUnder(e.clientX, e.clientY) : null;
          e.currentTarget.style.cursor = seam ? SEAM_CURSOR[seam.mode] : "";
        }}
        onPointerLeave={(e) => {
          if (!drag) e.currentTarget.style.cursor = "";
        }}
      >
        {drag && cols && (() => {
          // a pane moving as one: the ghost outlines the whole pane where it lands
          const members = carried ? drawn.filter((i) => carried.includes(i.id)) : [];
          const one = drawn.find((i) => i.id === drag.id);
          const target =
            members.length > 1
              ? { ...members[0]!, x: Math.min(...members.map((m) => m.x)), y: Math.min(...members.map((m) => m.y)), w: members[0]!.w, h: Math.max(...members.map((m) => m.y + m.h)) - Math.min(...members.map((m) => m.y)) }
              : one;
          if (!target) return null;
          const min = minFor(mins, drag.id, cols);
          const sizing = drag.mode !== "move";
          const atMin = sizing && (target.w === min.w || target.h === min.h);
          return (
            <div ref={ghostRef} className="hud-grid-ghost" style={{ gridColumn: `${target.x + 1} / span ${target.w}`, gridRow: `${target.y + 1} / span ${target.h}` }} aria-hidden="true">
              {sizing && (
                <span className={`hud-grid-size${atMin ? " is-min" : ""}`}>
                  {target.w} × {target.h}
                  {atMin ? " · min" : ""}
                </span>
              )}
              {!sizing && chip && <span className="hud-grid-size">{chip}</span>}
            </div>
          );
        })()}
        {order.map((it) => {
          const p = byId.get(it.id);
          if (!p) return null;
          const expanded = !!restoreFor(p.id);
          const isFull = full === p.id;
          const cellRows = p.stackH ?? defaults.find((d) => d.id === p.id)?.h ?? 10;
          const fitRows = p.fit && fitPx[p.id] != null ? rowsFor(fitPx[p.id], GRID_ROW, gap) : null;
          const stackRows = fitRows != null ? Math.min(cellRows, fitRows) : cellRows;
          // a content-fit panel with nothing under its head is its head: one line, no empty body
          // folded to its head row: the body stays mounted (its content keeps reporting) but draws nothing
          const fold = folded.has(p.id) ? foldOf(p.id) : null;
          const said = fold ? content[p.id] : undefined;
          const word = fold ? foldWord(fold, said) : null;
          const headOnly = !fold && !!p.fit && bare.has(p.id) && !isFull;
          // under the hand: drawn from where the gesture began; the ghost shows where it lands
          const lifted = drag?.id === p.id || !!carried?.includes(p.id);
          const at = lifted && drag ? drag.base.find((b) => b.id === p.id) ?? it : it;
          // Full view stays in place in the tree (fixed over the grid), so nothing remounts.
          const style = isFull && rect
            ? { position: "fixed" as const, top: rect.top, left: rect.left, width: rect.width, height: rect.height, ...(cols ? { gridColumn: `${it.x + 1} / span ${it.w}`, gridRow: `${it.y + 1} / span ${it.h}` } : {}) }
            : cols
              ? { gridColumn: `${at.x + 1} / span ${at.w}`, gridRow: `${at.y + 1} / span ${at.h}` }
              : { height: fold ? GRID_ROW : stackRows * (GRID_ROW + gap) - gap };
          return (
            <section
              key={p.id}
              className={`hud-grid-panel${focus === p.id ? " is-focus" : ""}${headOnly ? " is-head-only" : ""}${fold ? " is-folded" : ""}${fold?.fresh ? " is-fresh" : ""}${lifted ? " is-lifted" : ""}${isFull ? " is-full" : ""}${p.className ? ` ${p.className}` : ""}`}
              style={style}
              data-panel={p.id}
              ref={(el) => {
                if (el) panelEls.current.set(p.id, el);
                else panelEls.current.delete(p.id);
              }}
              tabIndex={cols || isFull ? 0 : undefined}
              aria-hidden={full && !isFull ? true : undefined}
              onFocus={(e) => e.target === e.currentTarget && setFocus(p.id)}
              onKeyDown={onKey(p.id)}
            >
              <header
                className="hud-grid-head"
                onPointerDown={isFull ? undefined : start(p.id, "move")}
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, a, select, [role='group'], [role='dialog']")) return;
                  if (isFull) setFull(null);
                  else if (fold) toggleFolded(p.id);
                  else toggleExpand(p.id);
                }}
              >
                <span className="hud-grid-title">{p.title}</span>
                {p.count != null && <span className="hud-grid-count">{p.count}</span>}
                {word != null && <span className="hud-grid-fold-word">{word}</span>}
                {fold && said?.count != null && said.count > 0 && <span className="hud-grid-count hud-grid-fold-count">{said.count}</span>}
                {/* hover tools ride beside the title, in the head's slack, so the panel's own controls sit flush right */}
                <span className="hud-grid-tools">
                  {p.tools}
                  {!isFull && (
                    <button
                      type="button"
                      className={`hud-grid-expand hud-grid-fold${fold ? " is-on" : ""}`}
                      onClick={() => toggleFolded(p.id)}
                      title={fold ? "Open (m)" : "Fold to its head row (m)"}
                      aria-label={fold ? "Open panel" : "Fold panel"}
                      aria-expanded={!fold}
                    >
                      {fold ? <ChevronsUpDown size={12} aria-hidden /> : <ChevronsDownUp size={12} aria-hidden />}
                    </button>
                  )}
                  {cols && !isFull && !fold && (
                    <button
                      type="button"
                      className={`hud-grid-expand${expanded ? " is-on" : ""}`}
                      onClick={() => toggleExpand(p.id)}
                      title={expanded ? "Restore (e)" : "Expand (e)"}
                      aria-label={expanded ? "Restore panel size" : "Expand panel"}
                    >
                      <MoveHorizontal size={12} aria-hidden />
                    </button>
                  )}
                  <button
                    type="button"
                    className={`hud-grid-expand hud-grid-full${isFull ? " is-on" : ""}`}
                    onClick={() => setFull(isFull ? null : p.id)}
                    title={isFull ? "Back to the grid (esc)" : "Full view (f)"}
                    aria-label={isFull ? "Leave full view" : "Full view"}
                  >
                    {isFull ? <Minimize2 size={12} aria-hidden /> : <Maximize2 size={12} aria-hidden />}
                  </button>
                </span>
                {p.right != null && <span className="hud-grid-right">{p.right}</span>}
              </header>
              {/* a click on the body's blank space lands focus here, not on the panel, so the panel's own keys (e, f, ⇧/⌥+arrows) stay with its head */}
              <div className="hud-grid-body" tabIndex={-1}>
                <FullViewContext.Provider value={full ? (isFull ? "self" : "other") : null}>
                  <PanelContentContext.Provider value={reporter(p.id)}>
                    {p.fit ? (
                      <div className="hud-grid-fit" data-fit={p.id} ref={fitRef(p.id)}>
                        {p.children}
                      </div>
                    ) : (
                      p.children
                    )}
                  </PanelContentContext.Provider>
                </FullViewContext.Provider>
              </div>
              {cols && !isFull && !locked && !fold && (
                <>
                  <span className="hud-grid-edge hud-grid-edge--r" onPointerDown={start(p.id, "width")} aria-hidden="true" />
                  <span className="hud-grid-edge hud-grid-edge--b" onPointerDown={start(p.id, "height")} aria-hidden="true" />
                  <span className="hud-grid-corner" onPointerDown={start(p.id, "size")} title="Drag to resize" aria-hidden="true" />
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
