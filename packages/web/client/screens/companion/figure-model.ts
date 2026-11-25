/**
 * Figures you place: what the page decides for a pinned figure the operator
 * can drag anywhere on its display. The host owns placement (it reads the
 * windows and the modifier keys); this module only turns the host's answers
 * into sizes, motion, layers and popover spots.
 *
 * Pure functions only, so it is testable without a DOM.
 */

import type {
  CompanionFigure,
  CompanionFigureAnchor,
  CompanionFigureDefaults,
  CompanionFigureHold,
  CompanionFigureMotion,
  CompanionSide,
} from "../../lib/companion-host.ts";
import { hasEdgePoses, type EdgePoseArt, type EdgePoseName } from "../../lib/crew-registry.ts";
import { EDGE_SLOT } from "./edge-model.ts";

export const FIGURE_SIZE_PRESETS = [16, 24, 32, 48, 64] as const;
export const FIGURE_MOTIONS: readonly CompanionFigureMotion[] = ["full", "calm", "still"];
export const FIGURE_MOTION_LABEL: Record<CompanionFigureMotion, string> = { full: "Full", calm: "Calm", still: "Still" };
export const FIGURE_HOLD_LABEL: Record<CompanionFigureHold, string> = { edge: "Edge", iso: "Platform", latch: "Latch" };
/** A press that moves this far or less is a click, as on the host. */
export const FIGURE_CLICK_SLOP = 4;
/** The ⇧ fall, and a window that went away. Ease-in; instant under Reduce Motion. */
export const FIGURE_FALL_MS = 520;
export const FIGURE_LAND_MS = 120;

export function figureSize(figure: CompanionFigure | undefined, defaults: CompanionFigureDefaults): number {
  return figure?.size ?? defaults.size;
}

/** Reduce Motion forces Still, whatever the figure says. */
export function figureMotion(figure: CompanionFigure | undefined, defaults: CompanionFigureDefaults, reduced: boolean): CompanionFigureMotion {
  return reduced ? "still" : figure?.motion ?? defaults.motion;
}

/** Hit target for a figure: never narrower than the classic slot. */
export function figureSlot(size: number): { width: number; height: number } {
  return { width: Math.max(EDGE_SLOT, Math.round(size * 1.25)), height: size + 10 };
}

/**
 * Where a pinned or surfaced figure shows:
 *   row     — in the home row by the mark
 *   placed  — where the operator put it (the host gave its anchor)
 *   waiting — placed, but its spot is unknown or its window is on another Space
 *   hidden  — the operator hid it
 * Surfaced work has no figure settings and always stands in the row.
 */
export type FigureWhere = "row" | "placed" | "waiting" | "hidden";

export function figureWhere(figure: CompanionFigure | undefined): FigureWhere {
  if (!figure) return "row";
  if (figure.hidden) return "hidden";
  if (figure.placement.kind === "home") return "row";
  if (!figure.anchor || figure.anchor.away) return "waiting";
  return "placed";
}

/**
 * How far a held figure sits off its edge: room for the latch, or the gap an
 * iso platform floats across. Kept under the host's 8pt cover probe
 * (ghostOffset), so that probe lands on the body, not the gap.
 */
export const FIGURE_HOLD_REACH = 6;
/**
 * Iso on a side: the figure stands on its platform with its feet a little
 * below the anchor, so the slot rises this share of its height above it.
 */
export const FIGURE_ISO_RISE = 0.72;
/** How far the state plate overhangs the body's side, × size (edge.css .ce-fig__plate). */
export const FIGURE_STATE_PLATE_OVERHANG = 0.24;

/** Saved per-pin choice wins; a missing art pack must never produce an invisible grip. */
export function figureHold(figure: CompanionFigure | undefined, defaults: CompanionFigureDefaults, slug?: string | null): CompanionFigureHold {
  const hold = figure?.hold ?? defaults.hold;
  return hold === "edge" && !hasEdgePoses(slug) ? "iso" : hold;
}

export function figurePose(anchor: Pick<CompanionFigureAnchor, "down" | "attachment">, figure?: CompanionFigure): EdgePoseName | "rest" {
  if (anchor.down === null) return "rest";
  if (anchor.attachment === "stand") return "rest";
  if (anchor.attachment === "sit" || (!anchor.attachment && figure?.placement.kind === "window" && figure.placement.side === "top" && figure.windowTop !== "hang")) return "sit-on-ledge";
  if (anchor.attachment === "hang" || anchor.down === "top") return "hang-from-top";
  if (anchor.down === "left") return "cling-left";
  if (anchor.down === "right") return "cling-right";
  return "rest";
}

export type FigureBox = { left: number; top: number; bodyTop: number; bodyBottom: number;
  /** Edge art offsets in the hit slot. Absent for unchanged legacy geometry. */
  bodyLeft?: number; bodyOffsetX?: number; bodyOffsetY?: number; contactX?: number; contactY?: number;
};

export type FigureHoldSide = "top" | "left" | "right";

/** Whether a figure on this edge holds on (platform or latch) rather than standing. */
export function figureHasPlate(down: CompanionSide | null): down is FigureHoldSide {
  return down === "top" || down === "left" || down === "right";
}

/**
 * Held figures stay upright on every edge, so they never have to be read at a
 * tilt. On a floor or a title bar (down "bottom", or none while dragged) a
 * figure stands with its feet at the anchor. Under an edge or on a side it
 * holds on, by the operator's hold:
 *   latch — a slim glass latch across the edge line; the figure hangs below
 *           it, or clips on beside it centred on the anchor.
 *   iso   — a glass isometric platform floating off the edge; the figure
 *           stands on it, below an edge, or beside a side with its feet
 *           FIGURE_ISO_RISE down the slot (just below the anchor).
 * The body sits inside its slot by edge.css .is-hold-*.
 *
 * Returns the slot's top-left and the body's vertical extent, in page px.
 */
export function figureBox(
  anchor: Pick<CompanionFigureAnchor, "x" | "y" | "down">,
  size: number,
  screen: { width: number; height: number },
  hold: CompanionFigureHold,
  art?: EdgePoseArt,
): FigureBox {
  const slot = figureSlot(size);
  if (hold === "edge" && art) {
    const k = size / art.h;
    const w = art.w * k;
    const offsetX = (slot.width - w) / 2;
    const offsetY = (slot.height - size) / 2;
    let left = anchor.x - art.contact[0] * k - offsetX;
    let top = anchor.y - art.contact[1] * k - offsetY;
    // Only slide ALONG the contact edge. Never add the legacy six-point air gap.
    if (anchor.down === "top" || anchor.down === "bottom") left = Math.max(0, Math.min(screen.width - slot.width, left));
    if (anchor.down === "left" || anchor.down === "right") top = Math.max(0, Math.min(screen.height - slot.height, top));
    return { left, top, bodyLeft: left + offsetX, bodyTop: top + offsetY, bodyBottom: top + offsetY + size,
      bodyOffsetX: offsetX, bodyOffsetY: offsetY, contactX: art.contact[0] * k, contactY: art.contact[1] * k };
  }
  const gap = FIGURE_HOLD_REACH;
  const side = hold !== "latch"
    ? { top: anchor.y - slot.height * FIGURE_ISO_RISE, bodyOffset: slot.height - size }
    : { top: anchor.y - slot.height / 2, bodyOffset: (slot.height - size) / 2 };
  let left: number;
  let top: number;
  let bodyOffset: number; // body top, from the slot's top
  switch (anchor.down) {
    case "top":
      left = anchor.x - slot.width / 2; top = anchor.y + gap; bodyOffset = 0; break;
    case "left":
      left = anchor.x + gap; top = side.top; bodyOffset = side.bodyOffset; break;
    case "right":
      left = anchor.x - gap - slot.width; top = side.top; bodyOffset = side.bodyOffset; break;
    default:
      left = anchor.x - slot.width / 2; top = anchor.y - slot.height; bodyOffset = slot.height - size;
  }
  // Slide along the held edge to stay on screen, never away from it: the
  // figure stays on its hold and over the host's cover probe. Standing
  // figures keep their feet on the anchor, as the host placed them.
  // Under an edge the state plate overhangs the body's right side
  // (edge.css .ce-fig__plate: right -0.24 × size); keep room for it too.
  if (anchor.down === "top") {
    // Body and plate scale 1.06 about the body's centre in the needs pose; 2pt spare.
    const plateRight = slot.width / 2 + (size / 2 + size * FIGURE_STATE_PLATE_OVERHANG) * 1.06 + 2;
    left = Math.max(0, Math.min(screen.width - Math.max(slot.width, plateRight), left));
  }
  if (anchor.down === "left" || anchor.down === "right") top = Math.max(0, Math.min(screen.height - slot.height, top));
  return { left, top, bodyTop: top + bodyOffset, bodyBottom: top + bodyOffset + size };
}

/** Room a figure's label keeps from its feet and shadow, and from the edge it perches on. */
export const FIGURE_LABEL_GAP = 4;
const LABEL_PAD = 2;

/** A desk label's width in its 10px mono at 0.1em (.arv-figtag): six pixels a character and one between, no padding. */
export function figureLabelWidth(text: string): number {
  return Math.ceil(text.length * 6 + Math.max(0, text.length - 1));
}

/**
 * Where a figure's label sits, its top-left on the page: centred below the
 * figure, clear of its feet and shadow, and never above it. A figure standing
 * on a window top (or on the desk) has its feet on the edge, so the label sits
 * under the edge, clear of it. Holding a side, it keeps to the figure's side
 * of that edge. Where below has no room on the screen, the figure is lifted
 * to make room (DeskPlates drawnSpot); the label does not flip. Pure, so the
 * label moves in the same frame as its figure.
 */
export function figureLabelSpot(
  box: FigureBox,
  anchor: Pick<CompanionFigureAnchor, "x" | "y" | "down">,
  size: number,
  label: { width: number; height: number },
  screen: { width: number },
): { left: number; top: number } {
  const centre = box.left + figureSlot(size).width / 2;
  let left = centre - label.width / 2;
  if (anchor.down === "left") left = Math.max(left, anchor.x + LABEL_PAD);
  if (anchor.down === "right") left = Math.min(left, anchor.x - LABEL_PAD - label.width);
  left = Math.max(LABEL_PAD, Math.min(screen.width - label.width - LABEL_PAD, left));
  const below = Math.max(box.bodyBottom, anchor.down === "top" ? anchor.y : -Infinity) + FIGURE_LABEL_GAP;
  return { left: Math.round(left), top: Math.round(below) };
}

/** A box on the page, by its edges. */
export type PageEdges = { left: number; top: number; right: number; bottom: number };

/** Room a figure and its label keep from the board panel's frame. */
export const BOARD_CLEARANCE = 6;

export type Move = { dx: number; dy: number };

/**
 * How far to move a figure so that it and its label stay clear of the board
 * panel's frame by BOARD_CLEARANCE: no move when they already are, so a
 * figure that does not collide keeps its spot. The figure moves, never the
 * board, by the shortest way out that stays on screen. One standing on a
 * window top slides along that edge, within its window when the host says
 * where the window is; one holding a side moves along that side. Only when
 * its edge leaves no room does it step off it.
 */
export function clearOfBoard(
  figure: PageEdges,
  board: PageEdges | null,
  screen: { width: number; height: number },
  anchor: Pick<CompanionFigureAnchor, "x" | "down" | "frame">,
  gap = BOARD_CLEARANCE,
): Move {
  if (!board) return { dx: 0, dy: 0 };
  const keep = { left: board.left - gap, top: board.top - gap, right: board.right + gap, bottom: board.bottom + gap };
  if (figure.right <= keep.left || figure.left >= keep.right || figure.bottom <= keep.top || figure.top >= keep.bottom) return { dx: 0, dy: 0 };
  const across: Move[] = [{ dx: keep.left - figure.right, dy: 0 }, { dx: keep.right - figure.left, dy: 0 }];
  const updown: Move[] = [{ dx: 0, dy: keep.top - figure.bottom }, { dx: 0, dy: keep.bottom - figure.top }];
  const onScreen = (m: Move) =>
    figure.left + m.dx >= 0 && figure.right + m.dx <= screen.width && figure.top + m.dy >= 0 && figure.bottom + m.dy <= screen.height;
  const frame = anchor.frame;
  const onItsWindow = (m: Move) => !frame || (anchor.x + m.dx >= frame.x && anchor.x + m.dx <= frame.x + frame.w);
  const along = anchor.down === "top" ? across.filter(onItsWindow) : anchor.down === "left" || anchor.down === "right" ? updown : [...across, ...updown];
  const all = [...across, ...updown];
  return shortestMove(along.filter(onScreen)) ?? shortestMove(all.filter(onScreen)) ?? shortestMove(all)!;
}

/**
 * The smallest move that brings a figure, with everything it draws, fully onto
 * the screen, LABEL_PAD in from each edge: no move when it already is. Whole
 * points, rounded outward, so a label measured to fit below still does after
 * figureLabelSpot rounds it. Larger than the screen, its top-left stays on it.
 */
export function onScreenMove(figure: PageEdges, screen: { width: number; height: number }): Move {
  const fit = (lo: number, hi: number, max: number) => {
    const m = lo < LABEL_PAD ? LABEL_PAD - lo : hi > max - LABEL_PAD ? Math.max(LABEL_PAD - lo, max - LABEL_PAD - hi) : 0;
    return m > 0 ? Math.ceil(m) : m < 0 ? Math.floor(m) : 0;
  };
  return { dx: fit(figure.left, figure.right, screen.width), dy: fit(figure.top, figure.bottom, screen.height) };
}

function shortestMove(moves: readonly Move[]): Move | null {
  let best: Move | null = null;
  for (const m of moves) if (!best || Math.abs(m.dx) + Math.abs(m.dy) < Math.abs(best.dx) + Math.abs(best.dy)) best = m;
  return best;
}

/** A drag the host tracked is not also a click on the figure. */
export function isFigureClick(down: { x: number; y: number } | null, up: { x: number; y: number }): boolean {
  if (!down) return true;
  return Math.hypot(up.x - down.x, up.y - down.y) <= FIGURE_CLICK_SLOP;
}

/** Arrow keys nudge a placed figure 1pt, 10pt with ⇧. Page +y is down. */
export function figureNudge(key: string, shift: boolean): { dx: number; dy: number } | null {
  const step = shift ? 10 : 1;
  switch (key) {
    case "ArrowLeft": return { dx: -step, dy: 0 };
    case "ArrowRight": return { dx: step, dy: 0 };
    case "ArrowUp": return { dx: 0, dy: -step };
    case "ArrowDown": return { dx: 0, dy: step };
    default: return null;
  }
}

/**
 * A popover beside a placed figure: above it when there is room, else below,
 * kept on screen horizontally. `size` is the figure's height.
 */
export function placedPopover(
  anchor: Pick<CompanionFigureAnchor, "x" | "y" | "down">,
  size: number,
  popWidth: number,
  screen: { width: number; height: number },
  hold: CompanionFigureHold,
  margin = 12,
  art?: EdgePoseArt,
): { left: number; top?: number; bottom?: number; maxHeight: number } {
  const left = Math.max(margin, Math.min(screen.width - popWidth - margin, anchor.x - popWidth / 2));
  const { bodyTop, bodyBottom } = figureBox(anchor, size, screen, hold, art);
  const above = bodyTop - margin * 2;
  const below = screen.height - bodyBottom - margin * 2;
  if (above >= Math.min(320, below) || above >= 240) {
    return { left, bottom: screen.height - bodyTop + margin, maxHeight: Math.max(120, above) };
  }
  return { left, top: bodyBottom + margin, maxHeight: Math.max(120, below) };
}

/**
 * Where a work popover opens. A placed figure opens beside its own anchor,
 * whatever the home row is doing; a row figure opens above its spot (or the
 * "+N" slot it overflowed into). null: nowhere to open it.
 */
export function workPopoverSpot<A extends { x: number }>(
  rowX: number | null | undefined,
  placed: A | null | undefined,
): { x: number; placed: A | null } | null {
  if (placed) return { x: placed.x, placed };
  if (rowX === null || rowX === undefined) return null;
  return { x: rowX, placed: null };
}

/** Pinned figures the operator hid, for the mark's "N hidden". */
export function hiddenFigures(figures: readonly CompanionFigure[]): string[] {
  return figures.filter((figure) => figure.hidden).map((figure) => figure.workId);
}
