import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ViewComposition, ViewSide } from "./views-model.ts";
import { PANE_SIDE_WIDTH, SIDE_RAIL_COLLAPSE_BELOW } from "../../scout/sidebar/sidebar-collapse-state.ts";
import { useFrameSpacing } from "../../components/hud-grid/frame-spacing.ts";

/*
 * The sides of a composition (views-model › sides): panels docked beside the
 * grid, each side a stack that folds to a strip naming its panels. A side is
 * set in pixels, not cells, so folding one gives the grid its room. Open and
 * width are remembered per view and viewer, and only the operator changes
 * them: a side folds when it is dragged past its collapse point or folded with
 * its control, never because the window narrowed. Panels in a side keep an
 * order and a height split the viewer drags; a short drag of a title reorders,
 * the seam between two panels resizes them. Below WIDE, where the grid
 * itself stacks into one column (the phone layout), a side becomes a sheet
 * that opens over the body instead of beside it.
 */

export type DockedPanel = {
  id: string;
  /** The module's name, for the strip. */
  label: string;
  title: ReactNode;
  right?: ReactNode;
  className?: string;
  /** Share of the side's height, from the module's size. */
  weight: number;
  /** Height follows content (a fit module): drawn at its own height, never stretched. */
  fit?: boolean;
  /** Where the module puts its count; the strip reads it from there. */
  countEl: HTMLElement | null;
  /** The panel's spot in the folded strip, which a module fills with ModuleStrip; empty, the strip names the panel. */
  stripRef?: (el: HTMLElement | null) => void;
  children: ReactNode;
};

type SideState = { open: boolean; width: number };
type SidesState = Record<ViewSide, SideState>;

const STRIP = 36;
const MIN_W = SIDE_RAIL_COLLAPSE_BELOW;
/** The widest a side is kept, whatever the window. The window's own room caps it before this does. */
const MAX_W = 960;
/** Dragged narrower than this, a side folds. */
const FOLD_BELOW = SIDE_RAIL_COLLAPSE_BELOW;
/** The main area between the sides never draws narrower than this while they are open beside it. */
const MAIN_MIN = 480;
/** A keyboard step on the edge; with Shift, four of them. */
const KEY_STEP = 16;
const DEFAULT_W: Record<ViewSide, number> = { left: PANE_SIDE_WIDTH, right: PANE_SIDE_WIDTH };
/** Docked beside the grid down to the grid's stacking point (hud-grid-layout › gridColumnsFor, views.css @media 759px). */
const WIDE = "(min-width: 760px)";

const sidesKey = (viewId: string) => `openscout.views.sides.v1.${viewId}`;

const shipped = (view: ViewComposition): SidesState => ({
  left: { open: true, width: clampWidth(view.sideWidth?.left ?? DEFAULT_W.left) },
  right: { open: true, width: clampWidth(view.sideWidth?.right ?? DEFAULT_W.right) },
});

const clampWidth = (w: number) => Math.round(Math.min(MAX_W, Math.max(FOLD_BELOW, w)));

/** A panel in a side never draws shorter than this while it is being sized. */
const SPLIT_MIN = 72;

/**
 * Share `dy` pixels between two stacked panels, keeping both at least `min`
 * and their combined height unchanged.
 */
export function splitPair(above: number, below: number, dy: number, min = SPLIT_MIN): [number, number] {
  const total = above + below;
  const nextAbove = Math.min(Math.max(min, total - min), Math.max(min, above + dy));
  return [nextAbove, total - nextAbove];
}

/** Move the item at `from` to index `to`. An index outside the list leaves it unchanged. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

type SideLayout = { order: string[]; grow: Record<string, number> | null };

const layoutStorageKey = (side: string, ids: readonly string[]) =>
  `openscout.views.sideLayout.v1.${side}:${[...ids].sort().join(",")}`;

function readLayout(side: string, ids: readonly string[]): SideLayout {
  const order = [...ids];
  try {
    const raw = window.localStorage.getItem(layoutStorageKey(side, ids));
    if (!raw) return { order, grow: null };
    const saved = JSON.parse(raw) as { order?: unknown; grow?: unknown };
    const savedOrder = Array.isArray(saved.order) ? saved.order.filter((id): id is string => typeof id === "string" && ids.includes(id)) : [];
    const complete = savedOrder.length === ids.length && ids.every((id) => savedOrder.includes(id));
    const grow = saved.grow && typeof saved.grow === "object"
      ? Object.fromEntries(Object.entries(saved.grow as Record<string, unknown>).filter((entry): entry is [string, number] => ids.includes(entry[0]) && typeof entry[1] === "number" && Number.isFinite(entry[1])))
      : null;
    return { order: complete ? savedOrder : order, grow: grow && Object.keys(grow).length > 0 ? grow : null };
  } catch {
    return { order, grow: null };
  }
}

function writeLayout(side: string, ids: readonly string[], layout: SideLayout) {
  try {
    window.localStorage.setItem(layoutStorageKey(side, ids), JSON.stringify(layout));
  } catch {
    /* storage unavailable: the arrangement lasts for this visit */
  }
}

/**
 * The widths the open sides draw at when `room` is what the window leaves them
 * after the main area's minimum. Each keeps its own width while both fit;
 * when they don't, they give way in proportion, never below MIN_W. What is
 * stored stays the viewer's choice, so a wider window gives it back.
 */
export function fitSides(room: number, want: Partial<Record<ViewSide, number>>): Partial<Record<ViewSide, number>> {
  const total = (want.left ?? 0) + (want.right ?? 0);
  if (total <= room) return want;
  const open = (["left", "right"] as const).filter((side) => want[side] != null);
  const extra = open.reduce((sum, side) => sum + Math.max(0, want[side]! - MIN_W), 0);
  const remaining = Math.max(0, room - MIN_W * open.length);
  const out: Partial<Record<ViewSide, number>> = {};
  for (const side of open) {
    out[side] = MIN_W + (extra ? Math.floor(remaining * Math.max(0, want[side]! - MIN_W) / extra) : 0);
  }
  return out;
}

// Per-viewer convenience: without storage both sides draw open at their shipped width.
function readSides(view: ViewComposition): SidesState {
  const out = shipped(view);
  try {
    const raw = window.localStorage.getItem(sidesKey(view.id));
    const saved = raw ? (JSON.parse(raw) as Partial<Record<ViewSide, Partial<SideState>>>) : null;
    for (const side of ["left", "right"] as const) {
      const s = saved?.[side];
      if (typeof s?.open === "boolean") out[side].open = s.open;
      if (typeof s?.width === "number" && Number.isFinite(s.width)) out[side].width = clampWidth(s.width);
    }
  } catch {
    /* unreadable: the shipped sides */
  }
  return out;
}

// A width is kept only when the viewer chose one, so a side they never sized follows its shipped width.
function writeSides(view: ViewComposition, sides: SidesState) {
  const base = shipped(view);
  const out: Partial<Record<ViewSide, Partial<SideState>>> = {};
  for (const side of ["left", "right"] as const) {
    out[side] = sides[side].width === base[side].width ? { open: sides[side].open } : sides[side];
  }
  try {
    window.localStorage.setItem(sidesKey(view.id), JSON.stringify(out));
  } catch {
    /* storage unavailable: the sides last for this visit */
  }
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window === "undefined" || !window.matchMedia || window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** The text a module put in its count slot, kept current. */
function useSlotText(el: HTMLElement | null): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!el) return setText("");
    const read = () => setText(el.textContent?.trim() ?? "");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [el]);
  return text;
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select, [contenteditable], .xterm"));

/**
 * Open and width per side, and the keys: [ the left side, ] the right, \ both
 * (Focus). Narrow, at most one side is open at a time, over the grid, and that
 * is not remembered.
 */
export function useDockedSides(view: ViewComposition) {
  const wide = useWide();
  // the gutter between a side and the main area: the side owns it, and its edge (the handle) lives in it;
  // it is the frame's panel gap, so a side sits as far from the grid as two grid panels sit apart
  const { gap: gutter } = useFrameSpacing();
  const has = { left: !!view.sides?.left?.length, right: !!view.sides?.right?.length };
  const [sides, setSides] = useState<SidesState>(() => readSides(view));
  const [overlay, setOverlay] = useState<ViewSide | null>(null);

  useEffect(() => {
    setSides(readSides(view));
    setOverlay(null);
    // read once per view id: a composition's shipped widths don't change under it
  }, [view.id]);

  // the body the sides and the main area share, so the sides can be held to what it has room for
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null);
  const [bodyW, setBodyW] = useState<number | null>(null);
  useEffect(() => {
    if (!bodyEl) return;
    setBodyW(bodyEl.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBodyW(bodyEl.clientWidth));
    ro.observe(bodyEl);
    return () => ro.disconnect();
  }, [bodyEl]);

  const isOpen = (side: ViewSide) => (wide ? sides[side].open : overlay === side);

  // wide, an open side draws at its width unless the body can't hold both sides and the main area's
  // minimum; then the sides give way together. A folded side keeps its strip.
  const openBeside = (side: ViewSide) => wide && has[side] && sides[side].open;
  const room =
    bodyW == null
      ? Number.POSITIVE_INFINITY
      : bodyW - MAIN_MIN - (["left", "right"] as const).reduce((n, s) => n + (has[s] ? gutter + (openBeside(s) ? 0 : STRIP) : 0), 0);
  const fitted = fitSides(room, {
    left: openBeside("left") ? sides.left.width : undefined,
    right: openBeside("right") ? sides.right.width : undefined,
  });
  /** What a side draws at: its own width, or less while the window is short of room. */
  const widthOf = (side: ViewSide) => fitted[side] ?? sides[side].width;
  /** The widest a drag or a key can take a side right now: the room the other side and the main area leave. */
  const maxOf = (side: ViewSide) => {
    const other = side === "left" ? "right" : "left";
    const own = openBeside(side) ? 0 : STRIP;
    return Math.max(MIN_W, Math.min(MAX_W, room + own - (fitted[other] ?? 0)));
  };

  const setOpen = useCallback((side: ViewSide, open: boolean) => {
    if (!wide) return setOverlay(open ? side : null);
    setSides((prev) => {
      const next = { ...prev, [side]: { ...prev[side], open } };
      writeSides(view, next);
      return next;
    });
  }, [wide, view.id]);

  const setWidth = useCallback((side: ViewSide, width: number) => {
    setSides((prev) => {
      const next = { ...prev, [side]: { open: true, width: clampWidth(width) } };
      writeSides(view, next);
      return next;
    });
  }, [view.id]);

  const focused = (!has.left || !isOpen("left")) && (!has.right || !isOpen("right"));
  const setFocus = useCallback((focus: boolean) => {
    if (!wide) return setOverlay(null);
    setSides((prev) => {
      const next = { left: { ...prev.left, open: !focus }, right: { ...prev.right, open: !focus } };
      writeSides(view, next);
      return next;
    });
  }, [wide, view.id]);

  // read through a ref so the listener stays put across renders
  const live = useRef({ isOpen, setOpen, setFocus, focused, has, wide, overlay });
  live.current = { isOpen, setOpen, setFocus, focused, has, wide, overlay };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || typing(e.target)) return;
      const { isOpen: open, setOpen: set, setFocus: focus, focused: f, has: h } = live.current;
      if (e.key === "Escape" && !live.current.wide && live.current.overlay) {
        live.current.setOpen(live.current.overlay, false);
        return;
      }
      const side = e.key === "[" ? "left" : e.key === "]" ? "right" : null;
      if (side && h[side]) set(side, !open(side));
      else if (e.key === "\\") focus(!f);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { wide, has, sides, isOpen, setOpen, setWidth, widthOf, maxOf, focused, setFocus, bodyRef: setBodyEl };
}

export function DockedSide({
  side,
  panels,
  open,
  width,
  maxWidth,
  overlay,
  onOpen,
  onWidth,
}: {
  side: ViewSide;
  panels: DockedPanel[];
  open: boolean;
  /** What the side draws at now (useDockedSides › widthOf). */
  width: number;
  /** The widest the edge can take it now (useDockedSides › maxOf). */
  maxWidth: number;
  /** Narrow: the side opens over the grid. */
  overlay: boolean;
  onOpen: (open: boolean) => void;
  onWidth: (width: number) => void;
}) {
  // the width under the hand while its edge is dragged; null otherwise
  const [live, setLive] = useState<number | null>(null);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const key = side === "left" ? "[" : "]";
  const { gap: gutter } = useFrameSpacing();
  const panelIds = panels.map((panel) => panel.id).join(",");
  const [layout, setLayout] = useState<SideLayout>(() => readLayout(side, panels.map((panel) => panel.id)));
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const idsRef = useRef<string[]>([]);
  idsRef.current = panels.map((panel) => panel.id);
  useEffect(() => {
    const next = readLayout(side, idsRef.current);
    layoutRef.current = next;
    setLayout(next);
  }, [side, panelIds]);
  const rank = new Map(layout.order.map((id, index) => [id, index]));
  const ordered = [...panels].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const sized = layout.grow != null;
  const panelRefs = useRef(new Map<string, HTMLElement>());
  const splitDrag = useRef<{ aboveId: string; belowId: string; y: number; above: number; below: number } | null>(null);
  const reorderDrag = useRef<{ id: string; y: number; moved: boolean } | null>(null);
  const [lift, setLift] = useState<{ id: string; dy: number; over: string | null } | null>(null);
  const liftRef = useRef(lift);
  liftRef.current = lift;

  const commitLayout = (next: SideLayout) => {
    layoutRef.current = next;
    writeLayout(side, idsRef.current, next);
    setLayout(next);
  };

  const onHeadPointerDown = (id: string) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || ordered.length < 2) return;
    if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
    reorderDrag.current = { id, y: event.clientY, moved: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer already ended */ }
  };
  const onHeadPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = reorderDrag.current;
    if (!current) return;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.abs(dy) <= 4) return;
    current.moved = true;
    const over = ordered.find((panel) => {
      if (panel.id === current.id) return false;
      const el = panelRefs.current.get(panel.id);
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY <= rect.bottom;
    });
    const next = { id: current.id, dy, over: over?.id ?? null };
    liftRef.current = next;
    setLift(next);
  };
  const onHeadPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const current = reorderDrag.current;
    reorderDrag.current = null;
    const dropped = liftRef.current;
    setLift(null);
    liftRef.current = null;
    if (!current?.moved || !dropped?.over) return;
    const from = ordered.findIndex((panel) => panel.id === current.id);
    const to = ordered.findIndex((panel) => panel.id === dropped.over);
    if (from < 0 || to < 0) return;
    commitLayout({ ...layoutRef.current, order: moveItem(ordered.map((panel) => panel.id), from, to) });
    const blockClick = (click: Event) => {
      click.preventDefault();
      click.stopPropagation();
      event.currentTarget.removeEventListener("click", blockClick, true);
    };
    event.currentTarget.addEventListener("click", blockClick, true);
  };

  const onSplitPointerDown = (aboveId: string, belowId: string) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const aboveEl = panelRefs.current.get(aboveId);
    const belowEl = panelRefs.current.get(belowId);
    if (!aboveEl || !belowEl) return;
    event.preventDefault();
    splitDrag.current = {
      aboveId,
      belowId,
      y: event.clientY,
      above: aboveEl.getBoundingClientRect().height,
      below: belowEl.getBoundingClientRect().height,
    };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer already ended */ }
  };
  const onSplitPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = splitDrag.current;
    if (!current) return;
    const [above, below] = splitPair(current.above, current.below, event.clientY - current.y);
    const grow: Record<string, number> = { ...(layoutRef.current.grow ?? {}) };
    for (const panel of ordered) {
      if (grow[panel.id] == null) {
        grow[panel.id] = Math.round(panelRefs.current.get(panel.id)?.getBoundingClientRect().height ?? panel.weight);
      }
    }
    grow[current.aboveId] = above;
    grow[current.belowId] = below;
    const next = { ...layoutRef.current, grow };
    layoutRef.current = next;
    setLayout(next);
    // A fit panel such as the rack stays collapsed until it is given room.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("openscout-side-grown", { detail: { id: current.belowId, height: below } }));
    }
  };
  const onSplitPointerUp = () => {
    if (!splitDrag.current) return;
    splitDrag.current = null;
    writeLayout(side, idsRef.current, layoutRef.current);
  };
  const onSplitKeyDown = (aboveId: string, belowId: string) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const aboveEl = panelRefs.current.get(aboveId);
    const belowEl = panelRefs.current.get(belowId);
    if (!aboveEl || !belowEl) return;
    event.preventDefault();
    const dy = (event.key === "ArrowDown" ? 1 : -1) * (event.shiftKey ? KEY_STEP * 4 : KEY_STEP);
    const [above, below] = splitPair(aboveEl.getBoundingClientRect().height, belowEl.getBoundingClientRect().height, dy);
    const grow: Record<string, number> = { ...(layoutRef.current.grow ?? {}), [aboveId]: above, [belowId]: below };
    commitLayout({ ...layoutRef.current, grow });
    window.dispatchEvent(new CustomEvent("openscout-side-grown", { detail: { id: belowId, height: below } }));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (overlay || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: open ? width : STRIP };
    setLive(drag.current.w);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.x) * (side === "left" ? 1 : -1);
    setLive(Math.max(STRIP, Math.min(maxWidth, drag.current.w + dx)));
  };
  const onPointerUp = () => {
    if (!drag.current || live == null) return;
    const start = drag.current.w;
    drag.current = null;
    // a press that never moved (a click, half a double-click) sizes nothing: it would keep a width
    // the window squeezed as if the viewer had chosen it
    if (live === start) return setLive(null);
    if (live < FOLD_BELOW) onOpen(false);
    else onWidth(live);
    setLive(null);
  };

  // the edge is a splitter: arrows toward the main area widen the side and away narrow it (past
  // the narrowest it folds), Shift takes bigger steps, Home and End go to the bounds, Enter folds or opens
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
    const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
    if (e.key === grow) {
      if (open) onWidth(Math.min(maxWidth, width + step));
      else onOpen(true);
    } else if (e.key === shrink) {
      if (!open) return;
      if (width - step < MIN_W) onOpen(false);
      else onWidth(width - step);
    } else if (e.key === "Home") onWidth(MIN_W);
    else if (e.key === "End") onWidth(maxWidth);
    else if (e.key === "Enter" || e.key === " ") onOpen(!open);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const stackW = live ?? width;
  const shown = live != null ? live >= FOLD_BELOW : open;
  // the side owns the gutter toward the main area, so its edge sits between the two, not over a panel
  const drawnW = (overlay ? STRIP : live ?? (open ? width : STRIP)) + gutter;

  return (
    <aside
      className={`vw-side${live != null ? " is-dragging" : ""}${overlay ? " is-overlay" : ""}`}
      data-side={side}
      data-open={shown}
      style={{ width: drawnW, "--vw-side-w": `${stackW}px` } as CSSProperties}
      aria-label={`${side === "left" ? "Left" : "Right"} side`}
    >
      <div className="vw-side-strip" inert={shown || undefined}>
        <button type="button" className="vw-side-fold" onClick={() => onOpen(true)} title={`Open (${key})`} aria-label={`Open the ${side} side`}>
          {side === "left" ? <ChevronRight size={14} aria-hidden /> : <ChevronLeft size={14} aria-hidden />}
        </button>
        {ordered.map((p) => (
          <StripItem key={p.id} panel={p} onOpen={() => onOpen(true)} />
        ))}
      </div>
      <div
        className={`vw-side-stack${ordered.length > 1 ? " is-arrangeable" : ""}${sized ? " is-sized" : ""}`}
        inert={!shown || undefined}
      >
        {ordered.map((p, i) => {
          const grow = sized ? (layout.grow?.[p.id] ?? p.weight) : (p.fit ? 0 : p.weight);
          const style: CSSProperties = {
            flexGrow: grow,
            ...(sized ? { ["--vw-split" as string]: String(grow) } : {}),
            ...(lift?.id === p.id ? { transform: `translateY(${lift.dy}px)`, zIndex: 3, position: "relative" } : {}),
          };
          return (
            <Fragment key={p.id}>
              {i > 0 && (
                <div
                  className="vw-side-split"
                  role="separator"
                  tabIndex={0}
                  aria-orientation="horizontal"
                  aria-label={`Resize ${ordered[i - 1].label} and ${p.label}`}
                  title="Drag to resize"
                  onPointerDown={onSplitPointerDown(ordered[i - 1].id, p.id)}
                  onPointerMove={onSplitPointerMove}
                  onPointerUp={onSplitPointerUp}
                  onPointerCancel={onSplitPointerUp}
                  onKeyDown={onSplitKeyDown(ordered[i - 1].id, p.id)}
                />
              )}
              <section
                className={`hud-grid-panel vw-side-panel${p.fit ? " is-fit" : ""}${lift?.id === p.id ? " is-lifted" : ""}${lift?.over === p.id ? " is-drop" : ""}${p.className ? ` ${p.className}` : ""}`}
                style={style}
                data-panel={p.id}
                ref={(el) => {
                  if (el) panelRefs.current.set(p.id, el);
                  else panelRefs.current.delete(p.id);
                }}
              >
                <header
                  className="hud-grid-head vw-side-head"
                  title={ordered.length > 1 ? "Drag to move this panel" : undefined}
                  onPointerDown={onHeadPointerDown(p.id)}
                  onPointerMove={onHeadPointerMove}
                  onPointerUp={onHeadPointerUp}
                  onPointerCancel={onHeadPointerUp}
                >
                  <span className="hud-grid-title">{p.title}</span>
                  {p.right != null && <span className="hud-grid-right">{p.right}</span>}
                  {i === 0 && (
                    <button type="button" className="hud-grid-expand vw-side-fold-in" onClick={() => onOpen(false)} title={`Fold (${key})`} aria-label={`Fold the ${side} side`}>
                      {side === "left" ? <ChevronLeft size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
                    </button>
                  )}
                </header>
                <div className="hud-grid-body">{p.children}</div>
              </section>
            </Fragment>
          );
        })}
      </div>
      {!overlay && (
        <div
          className="vw-side-edge"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={`Resize the ${side} side`}
          aria-valuemin={MIN_W}
          aria-valuemax={maxWidth}
          aria-valuenow={shown ? Math.round(stackW) : 0}
          aria-valuetext={shown ? `${Math.round(stackW)} pixels wide` : "Folded"}
          title={`Drag to resize, double-click to fold (${key})`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => onOpen(!open)}
          onKeyDown={onKeyDown}
        />
      )}
    </aside>
  );
}

function StripItem({ panel, onOpen }: { panel: DockedPanel; onOpen: () => void }) {
  const count = useSlotText(panel.countEl);
  return (
    <div className="vw-side-strip-panel">
      <button type="button" className="vw-side-strip-item" onClick={onOpen} title={`Open ${panel.label}`}>
        <span className="vw-side-strip-title">{panel.label}</span>
        {count && <span className="vw-side-strip-count">{count}</span>}
      </button>
      <div className="vw-side-strip-body" role="list" aria-label={panel.label} ref={panel.stripRef} />
    </div>
  );
}
