/**
 * The HUD grid: panels snap to fluid columns and fixed row units, and the
 * operator moves and resizes them. Pure layout math lives here so the reflow
 * rules can be tested without a DOM (see /studies/technical-hud).
 */

export type GridItem = { id: string; x: number; y: number; w: number; h: number };
export type GridLayout = GridItem[];

/** 3 steps of 8px; with an 8px gap the row pitch is 32px. */
export const GRID_ROW = 24;
export const GRID_GAP = 8;
export const GRID_MIN_W = 2;
export const GRID_MIN_H = 3;
/** Layouts are authored at 12 columns and mapped down. */
export const GRID_BASE_COLS = 12;

/**
 * Per-panel minimum size, in cells. A panel never sizes, fits or reflows
 * below its minimum, so its content always has room to draw. Missing = the
 * grid-wide 2 × 3.
 */
export type GridMins = Readonly<Record<string, { w: number; h: number }>>;

export function minFor(mins: GridMins | undefined, id: string, cols: number): { w: number; h: number } {
  const m = mins?.[id];
  return { w: Math.min(cols, Math.max(GRID_MIN_W, m?.w ?? 0)), h: Math.max(GRID_MIN_H, m?.h ?? 0) };
}

/**
 * Columns for a grid `width` px wide. Panels side by side need the room: 12
 * columns from 1100px, 8 from 720 (a 1440 window with both 320 sides open leaves about 750), and narrower than that they stack in flow.
 * A `layout` with no two panels side by side (one panel, or panels one over
 * another) never needs that room, so it keeps 12 columns at any width and
 * still fills the window. Docked sides leave the main area under 760px on a
 * laptop; stacking there capped a lone main panel at 75vh and left the sides
 * standing over nothing.
 */
export function gridColumnsFor(width: number, layout?: GridLayout): number | null {
  if (layout && width > 0 && !sideBySide(layout)) return GRID_BASE_COLS;
  if (width >= 1100) return 12;
  if (width >= 720) return 8;
  return null; // too narrow for a grid: panels stack in flow
}

/** Two panels share a row somewhere: the layout needs columns to draw them beside each other. */
export function sideBySide(layout: GridLayout): boolean {
  return layout.some((a) => layout.some((b) => a !== b && a.y < b.y + b.h && b.y < a.y + a.h));
}

export const collides = (a: GridItem, b: GridItem) =>
  a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * The pinned item holds its cell; everything else packs up, then drops below
 * whatever is still in the way. A fit (`fit`) first lets a panel narrow, down
 * to its minimum, to sit beside a panel on its right instead of dropping.
 *
 * `from` is the row a moved (pinned) panel started on. A panel that started
 * below that row and that the moved panel now lands on goes into the room the
 * move left above it, when it fits there, instead of dropping below: the moved
 * panel has passed it. Without this a panel dragged down pushed what it passed
 * further down, left a hole over itself, and packing floated it back up.
 */
export function resolve(layout: GridLayout, pinned?: string, fit?: { cols: number; mins?: GridMins }, from?: number): GridLayout {
  const out = layout.map((i) => ({ ...i }));
  const fixed = out.find((i) => i.id === pinned);
  const rest = out.filter((i) => i.id !== pinned).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: GridItem[] = fixed ? [fixed] : [];
  for (const it of rest) {
    // nothing sits below the lowest placed panel, so start no lower than that
    const floor = placed.reduce((m, p) => Math.max(m, p.y + p.h), 0);
    if (it.y > floor) it.y = floor;
    while (it.y > 0 && !placed.some((p) => collides({ ...it, y: it.y - 1 }, p))) it.y--;
    let hit = placed.find((p) => collides(it, p));
    if (fixed && hit === fixed && from != null && it.y > from) {
      const over = { ...it, y: fixed.y - it.h };
      if (over.y >= 0 && !placed.some((p) => collides(over, p))) {
        it.y = over.y;
        while (it.y > 0 && !placed.some((p) => collides({ ...it, y: it.y - 1 }, p))) it.y--;
        hit = undefined;
      }
    }
    while (hit) {
      const room = hit.x - it.x;
      if (fit && room > 0 && room >= minFor(fit.mins, it.id, fit.cols).w && !placed.some((p) => collides({ ...it, w: room }, p))) {
        it.w = room;
        break;
      }
      it.y = hit.y + hit.h;
      hit = placed.find((p) => collides(it, p));
    }
    placed.push(it);
  }
  return out;
}

/** Map a 12-column layout onto fewer columns, keeping neighbours that touched still touching. */
export function fitTo(layout: GridLayout, cols: number, mins?: GridMins): GridLayout {
  if (cols === GRID_BASE_COLS) return resolve(layout.map(clampTo(cols, mins)));
  const mapped = layout
    .map((i) => {
      const min = minFor(mins, i.id, cols);
      const x = Math.round((i.x * cols) / GRID_BASE_COLS);
      const w = Math.max(min.w, Math.round(((i.x + i.w) * cols) / GRID_BASE_COLS) - x);
      return { ...i, x: Math.min(x, cols - w), w, h: Math.max(min.h, i.h) };
    })
    .sort((a, b) => a.x - b.x || a.y - b.y);
  // a min-width bump can overlap the next panel sideways: slide it right, shrinking to fit,
  // and narrow the panel it overlaps (down to that panel's minimum) when that makes the room
  const placed: GridItem[] = [];
  for (const it of mapped) {
    const minW = minFor(mins, it.id, cols).w;
    for (const p of placed) {
      if (!collides(it, p)) continue;
      if (p.x + p.w + minW > cols && cols - minW - p.x >= minFor(mins, p.id, cols).w) p.w = cols - minW - p.x;
      if (p.x + p.w + minW <= cols) {
        const right = it.x + it.w;
        it.x = p.x + p.w;
        it.w = Math.max(minW, Math.min(right, cols) - it.x);
      }
    }
    placed.push(it);
  }
  return fillSides(resolve(placed, undefined, { cols, mins }), cols);
}

/**
 * After a fit, a panel with free columns on either side grows into them, so a
 * neighbour that no longer fits beside it and drops below leaves no hole, and
 * neither does the panel that dropped. Right-most panels claim first, rightward
 * before leftward, and a panel grows left no further than the panel it sits
 * under, so one that dropped stays in that panel's column. Fits only: an
 * authored or saved layout keeps the gaps it was given.
 */
function fillSides(layout: GridLayout, cols: number): GridLayout {
  const out = layout.map((i) => ({ ...i }));
  for (const it of [...out].sort((a, b) => b.x - a.x || a.y - b.y)) {
    while (it.x + it.w < cols && !out.some((o) => collides({ ...it, w: it.w + 1 }, o))) it.w++;
    const above = out.find((o) => o.y + o.h === it.y && o.x <= it.x && it.x < o.x + o.w);
    const stop = above ? above.x : 0;
    while (it.x > stop && !out.some((o) => collides({ ...it, x: it.x - 1, w: it.w + 1 }, o))) {
      it.x--;
      it.w++;
    }
  }
  return out;
}

const clampTo = (cols: number, mins?: GridMins) => (i: GridItem): GridItem => {
  const min = minFor(mins, i.id, cols);
  const w = Math.max(min.w, Math.min(cols, i.w));
  return { ...i, w, x: Math.max(0, Math.min(cols - w, i.x)), y: Math.max(0, i.y), h: Math.max(min.h, i.h) };
};

/** Grow right into the free columns beside the panel; with none free, take the full row and let the rest reflow below. */
export function expand(layout: GridLayout, id: string, cols: number): GridLayout {
  const it = layout.find((i) => i.id === id);
  if (!it) return layout;
  let w = it.w;
  while (it.x + w < cols && !layout.some((o) => collides({ ...it, w: w + 1 }, o))) w++;
  const next = w > it.w ? { ...it, w } : { ...it, x: 0, w: cols };
  return resolve(resolve(layout.map((i) => (i.id === id ? next : i)), id));
}

export type GridEdit = "move" | "size" | "width" | "height";

/**
 * Apply a drag or key delta (in cells) to one panel, from the layout the
 * gesture began with. `bonds` are the composition's: a resize on a member of
 * a pane resizes the pane (`paneEdit`). A move onto `swap` (the panel
 * `swapTarget` found under the pointer) trades places with it (`swapWith`)
 * instead of placing the panel at the delta. A move with `unit` set (⇧ held)
 * moves the panel's whole pane as one (`paneMove`), trading sides with
 * `unit.trade` when there is one; a panel in no pane moves as on a plain drag.
 */
export function edit(
  base: GridLayout,
  id: string,
  mode: GridEdit,
  dx: number,
  dy: number,
  cols: number,
  mins?: GridMins,
  bonds?: GridBonds,
  swap?: string | null,
  unit?: { trade: string | null } | null,
): GridLayout {
  const o = base.find((i) => i.id === id);
  if (!o) return base;
  if (mode === "move" && unit) {
    const moved = paneMove(base, id, dx, dy, cols, bonds, unit.trade);
    if (moved) return moved;
  }
  if (mode === "move" && swap) {
    const traded = swapWith(base, id, swap, bonds);
    if (traded) return traded;
  }
  const pane = mode === "move" ? null : paneAt(base, id, panesOf(base, bonds));
  if (pane) return resolve(paneEdit(base, pane, id, mode, dx, dy, cols, mins), id);
  const min = minFor(mins, id, cols);
  const w = mode === "height" || mode === "move" ? o.w : Math.max(min.w, Math.min(cols - o.x, o.w + dx));
  const h = mode === "width" || mode === "move" ? o.h : Math.max(min.h, o.h + dy);
  const next =
    mode === "move"
      ? { ...o, x: Math.max(0, Math.min(cols - o.w, o.x + dx)), y: Math.max(0, o.y + dy) }
      : // a minimum wider than the room to the right slides the panel left rather than overflow
        { ...o, w, h, x: Math.min(o.x, cols - w) };
  const shared = mode === "width" || mode === "size" ? splitter(base, o, next, cols, mins) : null;
  if (shared) return resolve(shared, id);
  // A move draws where it will land: packed the way every saved layout is (reconcile packs on each
  // render), so the drop is exactly this preview. Pinned first, so what it passes takes the room above it.
  if (mode === "move") return resolve(resolve(base.map((i) => (i.id === id ? next : i)), id, undefined, o.y));
  return resolve(base.map((i) => (i.id === id ? next : i)), id);
}

/** The panels whose left edge is `o`'s right edge, on rows `o` spans: they share that edge with it. */
function besideRight(base: GridLayout, o: GridItem): GridItem[] {
  const edge = o.x + o.w;
  return base.filter((i) => i.id !== o.id && i.x === edge && i.y < o.y + o.h && o.y < i.y + i.h);
}

/**
 * The right edge of a panel is shared with the panels that butt against it on
 * the same rows: dragging it moves the boundary, so they give up (or take
 * back) the columns instead of being shoved below. Each neighbour gives only
 * down to its minimum, and there the edge stops. (It used to fall back to
 * pushing, which threw a whole neighbouring column under the panel as soon as
 * the drag passed one column too far, and back up when it returned.)
 */
function splitter(base: GridLayout, o: GridItem, next: GridItem, cols: number, mins?: GridMins): GridLayout | null {
  let d = next.x + next.w - (o.x + o.w);
  if (d === 0 || next.x !== o.x) return null;
  const beside = besideRight(base, o);
  if (!beside.length) return null;
  if (d > 0) d = Math.min(d, ...beside.map((n) => n.w - minFor(mins, n.id, cols).w));
  // at a neighbour's minimum the width holds; a corner drag still takes its new height
  if (d <= 0 && next.w > o.w) return base.map((i) => (i.id === o.id ? { ...next, w: o.w } : i));
  const moved = new Map(beside.map((n) => [n.id, { ...n, x: n.x + d, w: n.w - d }]));
  return base.map((i) => (i.id === o.id ? { ...next, w: o.w + d } : moved.get(i.id) ?? i));
}

/**
 * The widest a width drag can take a panel, in cells: to the grid's edge, or,
 * with neighbours sharing its right edge, as far as they can give. The panel
 * under the hand is drawn no wider, so it never slides over a neighbour.
 */
export function widthLimit(base: GridLayout, id: string, cols: number, mins?: GridMins, bonds?: GridBonds): number {
  const o = base.find((i) => i.id === id);
  if (!o) return cols;
  const pane = paneAt(base, id, panesOf(base, bonds));
  if (pane) return o.w + paneRoom(base, pane, cols, mins);
  const beside = besideRight(base, o);
  if (!beside.length) return cols - o.x;
  return o.w + Math.max(0, Math.min(...beside.map((n) => n.w - minFor(mins, n.id, cols).w)));
}

/**
 * The tallest a height drag can take a panel, in cells: unbounded, except on a
 * pane member with another member under it, which gives rows only down to its
 * minimum (`paneEdit`).
 */
export function heightLimit(base: GridLayout, id: string, cols: number, mins?: GridMins, bonds?: GridBonds): number {
  const pane = paneAt(base, id, panesOf(base, bonds));
  const k = pane ? pane.findIndex((i) => i.id === id) : -1;
  if (!pane || k < 0 || k === pane.length - 1) return Infinity;
  return pane[k]!.h + pane[k + 1]!.h - minFor(mins, pane[k + 1]!.id, cols).h;
}

// ── panes ────────────────────────────────────────────────────────────────

/**
 * How a composition's panels prefer to behave together. `panes`: panels
 * stacked in one column that read as one pane (a left pane and a right pane);
 * a resize keeps each pane whole. `swaps`: pairs of panels that prefer to
 * trade places: a plain drag trades them, sooner than ⌥ trades any other pair
 * (`swapTarget`).
 */
export type GridBonds = {
  panes?: readonly (readonly string[])[];
  swaps?: readonly (readonly string[])[];
};

/** Panes by panel id, top to bottom. */
export type GridPanes = readonly (readonly string[])[];

/**
 * The panes a layout implies: panels that share a column (same x and w) and
 * stack with no gap between them. Only stacks of two or more are panes.
 */
export function inferPanes(layout: GridLayout): string[][] {
  const out: string[][] = [];
  const used = new Set<string>();
  for (const top of [...layout].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (used.has(top.id)) continue;
    const chain = [top];
    for (;;) {
      const last = chain[chain.length - 1]!;
      const next = layout.find((i) => !used.has(i.id) && !chain.includes(i) && i.x === last.x && i.w === last.w && i.y === last.y + last.h);
      if (!next) break;
      chain.push(next);
    }
    if (chain.length < 2) continue;
    for (const i of chain) used.add(i.id);
    out.push(chain.map((i) => i.id));
  }
  return out;
}

/**
 * The panes in a layout as it stands: each declared pane whose panels still
 * share a column with no gap, then the panes the layout implies
 * (`inferPanes`) among the panels no such declaration holds. A declaration
 * wins wherever it holds. One that no longer holds (a swap took a member
 * elsewhere) frees its panels, and they join the pane of the column they sit
 * in now. With nothing rearranged, the layout is the composition's default.
 */
export function panesOf(layout: GridLayout, bonds?: GridBonds): string[][] {
  const declared = (bonds?.panes ?? []).map((p) => [...p]).filter((p) => p.length > 1 && p.some((id) => paneAt(layout, id, [p])));
  const taken = new Set(declared.flat());
  const free = layout.filter((i) => !taken.has(i.id));
  return [...declared, ...inferPanes(free)];
}

/**
 * The pane `id` belongs to, as it stands in `layout`: its members on the
 * grid, top to bottom, while they still share a column and stack with no gap.
 * A pane the operator has taken apart (a member moved away) is no pane: its
 * panels resize one by one, as any other panel.
 */
export function paneAt(layout: GridLayout, id: string, panes?: GridPanes): GridItem[] | null {
  const ids = panes?.find((p) => p.includes(id));
  if (!ids) return null;
  const members = ids.flatMap((m) => layout.filter((i) => i.id === m)).sort((a, b) => a.y - b.y);
  if (members.length < 2) return null;
  for (let k = 1; k < members.length; k++) {
    const a = members[k - 1]!;
    const b = members[k]!;
    if (b.x !== a.x || b.w !== a.w || b.y !== a.y + a.h) return null;
  }
  return members;
}

/** Panels right of a pane on its rows: the ones touching its right edge give way; the rest bound it. */
function paneRight(base: GridLayout, pane: readonly GridItem[]): { flush: GridItem[]; apart: GridItem[] } {
  const edge = pane[0]!.x + pane[0]!.w;
  const top = pane[0]!.y;
  const end = pane[pane.length - 1]!.y + pane[pane.length - 1]!.h;
  const ids = new Set(pane.map((i) => i.id));
  const right = base.filter((i) => !ids.has(i.id) && i.x >= edge && i.y < end && top < i.y + i.h);
  return { flush: right.filter((i) => i.x === edge), apart: right.filter((i) => i.x > edge) };
}

/** Columns a pane can widen by: what the panels on its edge can give, down to their minimums, and no further than the next panel or the grid's edge. */
function paneRoom(base: GridLayout, pane: readonly GridItem[], cols: number, mins?: GridMins): number {
  const edge = pane[0]!.x + pane[0]!.w;
  const { flush, apart } = paneRight(base, pane);
  return Math.max(0, Math.min(cols - edge, ...flush.map((n) => n.w - minFor(mins, n.id, cols).w), ...apart.map((n) => n.x - edge)));
}

/**
 * A resize on a pane member, applied to the pane.
 *
 * Width: the pane's right edge is one edge. Every member takes the same width,
 * no narrower than the widest member's minimum, and the panels on that edge
 * (the neighbouring pane) give up or take back the same columns, each down to
 * its own minimum. So two panes side by side stay two panes: their members
 * line up before and after.
 *
 * Height: the seam between two members trades rows between those two only.
 * The pane's height holds and nothing else moves; the member under the seam
 * gives down to its minimum. The last member's bottom edge is the pane's
 * bottom: it changes the pane's height, and the grid levels pane bottoms when
 * it draws (`growToBottom`).
 */
function paneEdit(base: GridLayout, pane: readonly GridItem[], id: string, mode: GridEdit, dx: number, dy: number, cols: number, mins?: GridMins): GridLayout {
  let out = base;
  if (mode === "width" || mode === "size") {
    const w = pane[0]!.w;
    const floor = Math.max(...pane.map((m) => minFor(mins, m.id, cols).w)) - w;
    const d = Math.max(Math.min(floor, 0), Math.min(dx, paneRoom(base, pane, cols, mins)));
    if (d !== 0) {
      const ids = new Set(pane.map((i) => i.id));
      const give = new Set(paneRight(base, pane).flush.map((i) => i.id));
      out = out.map((i) => (ids.has(i.id) ? { ...i, w: w + d } : give.has(i.id) ? { ...i, x: i.x + d, w: i.w - d } : i));
    }
  }
  if (mode === "height" || mode === "size") {
    const now = out.filter((i) => pane.some((m) => m.id === i.id)).sort((a, b) => a.y - b.y);
    const k = now.findIndex((i) => i.id === id);
    const a = now[k]!;
    const minA = minFor(mins, a.id, cols).h;
    const b = now[k + 1];
    if (b) {
      const d = Math.max(minA - a.h, Math.min(dy, b.h - minFor(mins, b.id, cols).h));
      out = out.map((i) => (i.id === a.id ? { ...i, h: i.h + d } : i.id === b.id ? { ...i, y: i.y + d, h: i.h - d } : i));
    } else {
      out = out.map((i) => (i.id === a.id ? { ...i, h: Math.max(minA, i.h + dy) } : i));
    }
  }
  return out;
}

// ── swaps ────────────────────────────────────────────────────────────────

/** A point on the grid in cells, fractional: column 2.5 is the middle of the third column. */
export type GridPoint = { x: number; y: number };

const declaredSwap = (bonds: GridBonds | undefined, a: string, b: string) =>
  (bonds?.swaps ?? []).some((p) => p.includes(a) && p.includes(b));

/** Neighbours along a whole edge: one on the other in one column (same x and w), or side by side on one row (same y and h). */
const shareEdge = (a: GridItem, b: GridItem) =>
  (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) ||
  (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x));

const inside = (p: GridPoint, i: GridItem) => p.x > i.x && p.x < i.x + i.w && p.y > i.y && p.y < i.y + i.h;

/** The pointer `at`, coming from `from`, has crossed the edge of `t` it came through by `1 / share` of `t`'s size on that axis. */
const farIn = (t: GridItem, at: GridPoint, from: GridPoint, share: number) => {
  const ix = t.w / share;
  const iy = t.h / share;
  if (from.x <= t.x && at.x < t.x + ix) return false;
  if (from.x >= t.x + t.w && at.x > t.x + t.w - ix) return false;
  if (from.y <= t.y && at.y < t.y + iy) return false;
  if (from.y >= t.y + t.h && at.y > t.y + t.h - iy) return false;
  return true;
};

/**
 * The panel a move would trade places with: the one under the pointer `at`,
 * once the pointer is far enough in. Coming from `from` (where the pointer
 * started), it has to cross the edge it came through by a quarter of the
 * panel's size on that axis, or by an eighth for a pair `bonds.swaps`
 * declares. Once found it holds (`held`, the last frame's target) until the
 * pointer leaves that panel, so the preview never flickers at an edge. Over
 * empty grid, near an edge, or where the trade would put either panel below
 * its minimum, there is none and the move places the panel as before.
 *
 * Which pairs trade: a pair `bonds.swaps` declares, anywhere on the grid and
 * whatever their sizes, on a plain drag: the view has said they prefer to.
 * Any other pair trades only when the hand asks for it (`alt`, ⌥ held) and
 * only as neighbours along a whole edge (one on the other in one column, or
 * side by side on one row). Trading those reorders a column or a row and
 * keeps the grid's lines. Two undeclared panels of different shapes don't
 * trade even with ⌥: a full-width panel dragged down past a narrower one
 * would take its cell in passing, and the narrower one would go full width.
 * Without ⌥ a plain drag places the panel as before, so a trade is never a
 * surprise. Releasing ⌥ lets go of a held undeclared trade at once.
 */
export function swapTarget(
  base: GridLayout,
  id: string,
  at: GridPoint,
  from: GridPoint,
  held: string | null | undefined,
  cols: number,
  mins?: GridMins,
  bonds?: GridBonds,
  alt = false,
): string | null {
  const o = base.find((i) => i.id === id);
  if (!o) return null;
  const fits = (t: GridItem) => swapWith(base, id, t.id, bonds, cols, mins) != null;
  // declared pairs trade on a plain drag; any other pair only with ⌥ held, and only along a whole edge
  const may = (t: GridItem) => declaredSwap(bonds, id, t.id) || (alt && shareEdge(o, t));
  // a target already found holds while the pointer stays over it (only targets found below are ever held)
  const kept = held ? base.find((i) => i.id === held) : undefined;
  if (kept && inside(at, kept) && may(kept) && fits(kept)) return kept.id;
  for (const t of base) {
    if (t.id === id || !inside(at, t) || !may(t)) continue;
    if (!farIn(t, at, from, declaredSwap(bonds, id, t.id) ? 8 : 4)) continue;
    if (fits(t)) return t.id;
  }
  return null;
}

/**
 * `id` and `other` trade places; nothing else moves. Two members of one pane
 * trade their order and keep their own heights, so the pane stays whole and
 * keeps its height. Any other pair trades cells: each takes the other's x, y,
 * w and h, so both columns keep their shape and no hole opens. Null when a
 * panel would go below its minimum (only checked when `cols` is given).
 */
export function swapWith(base: GridLayout, id: string, other: string, bonds?: GridBonds, cols?: number, mins?: GridMins): GridLayout | null {
  const a = base.find((i) => i.id === id);
  const b = base.find((i) => i.id === other);
  if (!a || !b || a === b) return null;
  const pane = paneAt(base, id, panesOf(base, bonds));
  if (pane && pane.some((m) => m.id === other)) {
    const order = pane.map((m) => (m.id === id ? b : m.id === other ? a : m));
    let y = pane[0]!.y;
    const at = new Map(order.map((m) => { const c = { ...m, y }; y += m.h; return [m.id, c] as const; }));
    return base.map((i) => at.get(i.id) ?? i);
  }
  if (cols != null) {
    const ok = (p: GridItem, cell: GridItem) => { const m = minFor(mins, p.id, cols); return cell.w >= m.w && cell.h >= m.h; };
    if (!ok(a, b) || !ok(b, a)) return null;
  }
  return base.map((i) => (i.id === id ? { ...b, id } : i.id === other ? { ...a, id: other } : i));
}

// ── a pane moving as one (⇧) ─────────────────────────────────────────────

/**
 * The pane `id` moves with when ⇧ is held: its pane as the layout stands
 * (`panesOf`: declared where it holds, else inferred), top to bottom. Null
 * for a panel in no pane, which then moves on its own as on a plain drag.
 */
export function paneOf(base: GridLayout, id: string, bonds?: GridBonds): GridItem[] | null {
  return paneAt(base, id, panesOf(base, bonds));
}

const PANE_BOX = "\u0000pane";

/** A pane's outline: its column, from its top member's top to its last member's bottom. */
function outline(pane: readonly GridItem[]): GridItem {
  const top = pane[0]!;
  const last = pane[pane.length - 1]!;
  return { id: PANE_BOX, x: top.x, y: top.y, w: top.w, h: last.y + last.h - top.y };
}

/** Every column a pane can trade sides with, as panels top to bottom: the other panes, and each panel in none. */
function columnsBeside(base: GridLayout, pane: readonly GridItem[], bonds?: GridBonds): GridItem[][] {
  const mine = new Set(pane.map((m) => m.id));
  const panes = panesOf(base, bonds)
    .map((p) => paneAt(base, p[0]!, [p]))
    .filter((p): p is GridItem[] => !!p && !p.some((m) => mine.has(m.id)));
  const inPane = new Set(panes.flat().map((m) => m.id));
  return [...panes, ...base.filter((i) => !mine.has(i.id) && !inPane.has(i.id)).map((i) => [i])];
}

/**
 * `pane` and `other` (another pane, or one panel) trade sides: side by side,
 * starting on the same row, the right one moves to where the left one began
 * and the left one follows it. Each keeps its width, its height and its order
 * inside, and nothing else moves; panels above both (a full-width header)
 * stay where they are. Columns of different heights keep their heights; the
 * grid's growToBottom levels the bottoms on screen, as it does for any column.
 * Null when they don't sit side by side on one row, or when a panel under the
 * shorter column would be in the way.
 */
export function paneTrade(base: GridLayout, pane: readonly GridItem[], other: readonly GridItem[]): GridLayout | null {
  const a = outline(pane);
  const b = outline(other);
  if (a.y !== b.y) return null;
  const [left, right] = a.x < b.x ? [a, b] : [b, a];
  if (left.x + left.w !== right.x) return null;
  const shift = new Map<string, number>();
  for (const m of a === left ? pane : other) shift.set(m.id, right.w);
  for (const m of a === left ? other : pane) shift.set(m.id, -left.w);
  const out = base.map((i) => (shift.has(i.id) ? { ...i, x: i.x + shift.get(i.id)! } : i));
  const moved = out.filter((i) => shift.has(i.id));
  const rest = out.filter((i) => !shift.has(i.id));
  if (moved.some((m) => rest.some((r) => collides(m, r)))) return null;
  return out;
}

/**
 * The column a pane moving as one would trade sides with: the one under the
 * pointer, once the pointer is a quarter of the way in from the edge it came
 * through, held (`held`, any id in it) until the pointer leaves it. Null for a
 * panel in no pane, over empty grid, near an edge, or over a column it can't
 * trade with (`paneTrade`). The result is the top panel of that column.
 */
export function paneTarget(
  base: GridLayout,
  id: string,
  at: GridPoint,
  from: GridPoint,
  held: string | null | undefined,
  bonds?: GridBonds,
): string | null {
  const pane = paneOf(base, id, bonds);
  if (!pane) return null;
  const columns = columnsBeside(base, pane, bonds);
  const kept = held ? columns.find((c) => c.some((m) => m.id === held)) : undefined;
  if (kept && inside(at, outline(kept)) && paneTrade(base, pane, kept)) return kept[0]!.id;
  for (const c of columns) {
    const box = outline(c);
    if (!inside(at, box) || !farIn(box, at, from, 4)) continue;
    if (paneTrade(base, pane, c)) return c[0]!.id;
  }
  return null;
}

/**
 * Move `id`'s whole pane by the delta, as one panel: its members keep their
 * order, heights and shared width. Onto `trade` (from `paneTarget`) the two
 * columns trade sides (`paneTrade`); otherwise the pane's outline is placed
 * and packed exactly as one moved panel is (`edit`), and its members follow
 * it. Null for a panel in no pane.
 */
export function paneMove(base: GridLayout, id: string, dx: number, dy: number, cols: number, bonds?: GridBonds, trade?: string | null): GridLayout | null {
  const pane = paneOf(base, id, bonds);
  if (!pane) return null;
  if (trade) {
    const other = columnsBeside(base, pane, bonds).find((c) => c.some((m) => m.id === trade));
    const traded = other && paneTrade(base, pane, other);
    if (traded) return traded;
  }
  const box = outline(pane);
  const mine = new Set(pane.map((m) => m.id));
  const next = { ...box, x: Math.max(0, Math.min(cols - box.w, box.x + dx)), y: Math.max(0, box.y + dy) };
  const packed = resolve(resolve([...base.filter((i) => !mine.has(i.id)), next], PANE_BOX, undefined, box.y));
  const to = packed.find((i) => i.id === PANE_BOX)!;
  const at = new Map(packed.map((i) => [i.id, i] as const));
  return base.map((i) => (mine.has(i.id) ? { ...i, x: to.x, y: to.y + (i.y - box.y) } : at.get(i.id)!));
}

/**
 * The layout to draw for the panels present right now: saved cells where the
 * operator has placed them, defaults for anything new, packed so a panel that
 * is absent (no data yet) leaves no hole. Absent panels keep their saved cell
 * for when they return.
 */
export function reconcile(saved: GridLayout | null, defaults: GridLayout, ids: readonly string[], cols: number, mins?: GridMins): GridLayout {
  const fallback = fitTo(defaults, cols, mins);
  const items = ids
    .map((id) => saved?.find((i) => i.id === id) ?? fallback.find((i) => i.id === id) ?? { id, x: 0, y: 999, w: cols, h: 8 })
    .map(clampTo(cols, mins));
  return resolve(items);
}

/**
 * Rows a panel needs to show `px` of head and content at this row height:
 * whole rows, so it still snaps. At least 1.
 */
export function rowsFor(px: number, rowH: number, gap: number = GRID_GAP): number {
  return Math.max(1, Math.ceil((px + gap) / (rowH + gap)));
}

/**
 * Content-fit panels: a cell's height is the most it draws at, not what it
 * must fill. Each panel in `need` draws at the rows its content takes, never
 * taller than its cell, and the panels under it pack up into the room. The
 * cells themselves (what is saved, what an arrangement sets) are untouched.
 */
export function fitHeights(layout: GridLayout, need: Readonly<Record<string, number>>): GridLayout {
  let changed = false;
  const out = layout.map((i) => {
    const n = need[i.id];
    if (n == null || n >= i.h) return i;
    changed = true;
    return { ...i, h: Math.max(1, n) };
  });
  return changed ? resolve(out) : layout;
}

/**
 * Every column ends on the grid's bottom row. For each panel with nothing
 * under it, its column's spare rows go to the lowest panel in that column
 * that can use them (`canGrow`: a stream or a list that shows more), and
 * whatever sits under that panel moves down; with none that can, the
 * column's last panel takes them, so no column stops short of its neighbours.
 * A `fixed` panel (folded to its head row) never takes them, not even as the
 * last: a column of folded panels ends short.
 */
export function growToBottom(
  layout: GridLayout,
  rows: number,
  canGrow: (id: string) => boolean = () => true,
  fixed: (id: string) => boolean = () => false,
): GridLayout {
  const out = layout.map((i) => ({ ...i }));
  const overlaps = (a: GridItem, b: GridItem) => a.x < b.x + b.w && b.x < a.x + a.w;
  const grown = new Set<string>();
  let changed = false;
  for (const bottom of [...out].sort((a, b) => b.y - a.y)) {
    if (out.some((o) => o !== bottom && o.y >= bottom.y + bottom.h && overlaps(o, bottom))) continue;
    const slack = rows - (bottom.y + bottom.h);
    if (slack <= 0) continue;
    const column = out.filter((o) => overlaps(o, bottom) && o.y <= bottom.y).sort((a, b) => b.y - a.y);
    // a panel can take the room when the column fits within its width and everything under it is in
    // the column, so what moves down is exactly what sat under it (a wide panel over two narrow ones
    // would otherwise grow into the one outside this column)
    const under = (o: GridItem) => out.filter((u) => u !== o && u.y >= o.y + o.h && overlaps(u, o));
    const target =
      column.find((o) =>
        canGrow(o.id) &&
        !grown.has(o.id) &&
        column.every((c) => c === o || c.x >= o.x && c.x + c.w <= o.x + o.w || c.y < o.y) &&
        under(o).every((u) => column.includes(u)),
      ) ?? (grown.has(bottom.id) || fixed(bottom.id) ? null : bottom);
    if (!target) continue;
    grown.add(target.id);
    const end = target.y + target.h;
    for (const o of column) if (o !== target && o.y >= end) o.y += slack;
    target.h += slack;
    changed = true;
  }
  return changed ? out : layout;
}

/**
 * Filling's other half: a layout taller than the window comes up to end on its
 * bottom row, when it can. Rows come off whole bands: the rows between two
 * consecutive panel edges. Cutting a row from a band takes it from every panel
 * that crosses the band and moves everything under the band up by one, so
 * panels whose edges met still meet and no hole opens. (Taking rows one panel
 * at a time left each panel at its own height, and the panels under them
 * could not close up: a short list over empty rows, a stream pushed down.)
 *
 * A band can give a row when every panel crossing it can (`canShrink`: the
 * panels growToBottom gives room to, which scroll inside) and is above its
 * minimum. The band whose tightest panel has the most rows to spare gives
 * first, the taller band on a tie. All or nothing: when the layout can't end on
 * the window's bottom row without a panel going below its minimum, it keeps its
 * heights and the page scrolls as authored. The cells are untouched.
 */
export function shrinkToRows(layout: GridLayout, rows: number, canShrink: (id: string) => boolean = () => true, mins?: GridMins): GridLayout {
  const end = (l: GridLayout) => l.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  if (rows <= 0 || end(layout) <= rows) return layout;
  const minH = (id: string) => minFor(mins, id, GRID_BASE_COLS).h;
  const out = layout.map((i) => ({ ...i }));
  for (let guard = 0; guard < 4096 && end(out) > rows; guard++) {
    const edges = [...new Set(out.flatMap((i) => [i.y, i.y + i.h]))].sort((a, b) => a - b);
    let cut: { row: number; spare: number; size: number } | null = null;
    for (let k = 0; k + 1 < edges.length; k++) {
      const top = edges[k];
      const size = edges[k + 1] - top;
      // edges are every panel's top and bottom, so a panel either spans the whole band or misses it
      const crossing = out.filter((i) => i.y <= top && i.y + i.h > top);
      if (!crossing.every((i) => canShrink(i.id) && i.h > minH(i.id))) continue;
      // a band no panel crosses is empty rows: it gives first
      const spare = crossing.length ? Math.min(...crossing.map((i) => i.h - minH(i.id))) : Infinity;
      if (!cut || spare > cut.spare || (spare === cut.spare && size > cut.size)) cut = { row: top, spare, size };
    }
    if (!cut) return layout;
    for (const i of out) {
      if (i.y <= cut.row && i.y + i.h > cut.row) i.h--;
      else if (i.y > cut.row) i.y--;
    }
  }
  return end(out) <= rows ? out : layout;
}

/**
 * Back from drawn heights to cells, after a gesture made on the drawn layout:
 * a panel drawn at another height than its cell (fit to its content, grown or
 * shrunk to the window) gets its cell's height back unless the gesture sized
 * it. Moving one panel never shrinks every fitted cell, and never saves the
 * window's height into a cell: a saved height reads as one the operator chose,
 * and such a panel stops following the window.
 */
export function unfitHeights(next: GridLayout, drawn: GridLayout, cells: GridLayout, pinned?: string): GridLayout {
  const out = next.map((i) => {
    const d = drawn.find((x) => x.id === i.id);
    const c = cells.find((x) => x.id === i.id);
    return d && c && d.h !== c.h && i.h === d.h ? { ...i, h: c.h } : i;
  });
  return resolve(out, pinned);
}

/**
 * What a drag saves when the hand lets go: the layout on screen at pointerup
 * (`live`, the gesture's last preview), with fitted panels given their cells
 * back. The grid's drop and the case fixtures (hud-grid-cases.ts) both land
 * through here, so what the tests check is what pointerup does.
 *
 * A move's preview is already packed (see `edit`), so it lands as it is: the
 * only pass is the one that makes room for cells taller than they drew, and it
 * packs in the order on screen. Pinning the moved panel there pushed a fitted
 * panel above it to below it once its cell grew back. A resize keeps its panel
 * pinned: the size it set holds and the rest make room.
 */
export function land(live: GridLayout, drawn: GridLayout, cells: GridLayout, id: string, mode: GridEdit): GridLayout {
  if (mode === "move") {
    const out = unfitHeights(live, drawn, cells);
    // a trade of cells drew each panel at the other's drawn height: each saves the other's cell height
    const other = tradedWith(live, drawn, id);
    if (!other) return out;
    const cellH = (x: string) => cells.find((c) => c.id === x)?.h;
    const ha = cellH(other);
    const hb = cellH(id);
    if (ha == null || hb == null) return out;
    return resolve(out.map((i) => (i.id === id ? { ...i, h: ha } : i.id === other ? { ...i, h: hb } : i)));
  }
  return resolve(unfitHeights(live, drawn, cells, id));
}

/** The panel `id` traded cells with in `live`: each sits exactly where the other was drawn. */
function tradedWith(live: GridLayout, drawn: GridLayout, id: string): string | null {
  const same = (p: GridItem | undefined, q: GridItem | undefined) => !!p && !!q && p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h;
  const was = drawn.find((i) => i.id === id);
  const now = live.find((i) => i.id === id);
  const other = drawn.find((d) => d.id !== id && same(now, d));
  return other && same(live.find((i) => i.id === other.id), was) ? other.id : null;
}

/** Fold an edited view back into the saved layout, keeping cells of panels not on screen. */
export function mergeSaved(saved: GridLayout | null, view: GridLayout): GridLayout {
  const ids = new Set(view.map((i) => i.id));
  return [...view, ...(saved ?? []).filter((i) => !ids.has(i.id))];
}

export function sameLayout(a: GridLayout, b: GridLayout): boolean {
  const key = (l: GridLayout) =>
    [...l].sort((p, q) => p.id.localeCompare(q.id)).map((i) => `${i.id}${i.x},${i.y},${i.w},${i.h}`).join("|");
  return key(a) === key(b);
}

/** Saved cells are read back from storage anyone can edit: whole cells, in bounds, one per id, or nothing. */
const SAVED_MAX_ROWS = 2000;

export function parseLayout(raw: unknown): GridLayout | null {
  if (!Array.isArray(raw)) return null;
  const out: GridLayout = [];
  const seen = new Set<string>();
  const cell = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
  for (const v of raw) {
    if (!v || typeof v !== "object") return null;
    const { id, x, y, w, h } = v as Record<string, unknown>;
    if (typeof id !== "string" || !id) return null;
    if (!cell(x, 0, GRID_BASE_COLS - 1) || !cell(w, 1, GRID_BASE_COLS) || !cell(y, 0, SAVED_MAX_ROWS) || !cell(h, 1, SAVED_MAX_ROWS)) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, x: x as number, y: y as number, w: w as number, h: h as number });
  }
  return out;
}

/** A panel's box on screen, for finding the seam under the pointer. */
export type PanelBox = { id: string; left: number; top: number; right: number; bottom: number };

/**
 * The seam under a point in the grid's gaps: the panel whose bottom or right
 * edge it borders, and the size that seam sets. The gap between two panels is
 * where a hand goes to resize them, and the panels clip their own edge handles
 * to a sliver inside the border, so the gap itself has to answer. Past both a
 * panel's bottom and right edge (its outside corner) sizes both.
 */
export function seamAt(boxes: readonly PanelBox[], x: number, y: number, gap: number): { id: string; mode: "height" | "width" | "size" } | null {
  const slop = 2;
  const below = boxes.find((b) => y >= b.bottom - slop && y <= b.bottom + gap + slop && x >= b.left && x <= b.right + gap);
  const beside = boxes.find((b) => x >= b.right - slop && x <= b.right + gap + slop && y >= b.top && y <= b.bottom + gap);
  if (below && x <= below.right) return { id: below.id, mode: "height" };
  if (beside && y <= beside.bottom) return { id: beside.id, mode: "width" };
  if (below && beside && below.id === beside.id) return { id: below.id, mode: "size" };
  if (below) return { id: below.id, mode: "height" };
  if (beside) return { id: beside.id, mode: "width" };
  return null;
}
