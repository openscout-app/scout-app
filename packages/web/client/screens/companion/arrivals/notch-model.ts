import type { BoardCorner } from "./arrivals-model.ts";

/**
 * The notch: a placement for the board (Studio /studies/agent-notch). The
 * board keeps its own look; it hangs from the middle of a screen edge, rests
 * folded against it as a strip of chips, and opens out of it into a large board
 * from its grow control. A chip opens that agent's details beside the strip.
 * On the top edge of a display with a camera it centers on the housing, as
 * HudNotch does (hudson/docs/notch.md). Pure, so the rules are testable
 * without a page.
 */

export type NotchEdge = "top" | "right" | "bottom" | "left";
export const NOTCH_EDGES: readonly NotchEdge[] = ["top", "right", "bottom", "left"];
export const NOTCH_EDGE_LABEL: Record<NotchEdge, string> = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" };

export function parseNotchEdge(value: string | null | undefined): NotchEdge {
  return value === "right" || value === "bottom" || value === "left" ? value : "top";
}

/** Where the board sits: in a corner (or floating), or as the notch on an edge. */
export type BoardPlace = "corner" | "notch";
export function parseBoardPlace(value: string | null | undefined): BoardPlace {
  return value === "notch" ? "notch" : "corner";
}

/**
 * The corner the board grows from on each edge: away from the edge, so the
 * board's own top and left rules apply. The notch then centers it along the
 * edge.
 */
export function notchCorner(edge: NotchEdge): BoardCorner {
  return edge === "bottom" ? "bottom-right" : edge === "left" ? "top-left" : "top-right";
}

export type NotchInsets = { top: number; right: number; bottom: number; left: number };

/**
 * How far in from the display's edges the board stands: the part of the
 * display macOS gives windows (below the menu bar, beside the Dock), as the
 * host reports it in page points. Without a report (the browser preview) the
 * board stands on the page's edges.
 */
export function notchInsets(visible: { x: number; y: number; width: number; height: number } | null | undefined, view: { width: number; height: number }): NotchInsets {
  if (!visible || visible.width <= 0 || visible.height <= 0) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: Math.max(0, Math.round(visible.y)),
    left: Math.max(0, Math.round(visible.x)),
    right: Math.max(0, Math.round(view.width - (visible.x + visible.width))),
    bottom: Math.max(0, Math.round(view.height - (visible.y + visible.height))),
  };
}

/**
 * Where the board stands. On the top edge, once the host has raised the panel
 * over the menu bar (`aboveMenuBar`), it hangs from the display's edge and its
 * first `bar` points sit behind the menu bar; on a notched display it centers
 * on the camera housing. Anywhere else, or with a host that cannot raise the
 * panel, it stands inside the visible frame (`notchInsets`).
 */
export type NotchPlace = {
  insets: NotchInsets;
  hang: boolean;
  /** The menu bar's height while hanging: the board keeps its content below it. */
  bar: number;
  /** The housing's center and width in page points, while hanging on a notched display. */
  housing: { center: number; width: number } | null;
  /** How the notch makes room for Scout Desk's notch on the same top edge (`notchDeskRoom`). */
  desk: NotchDeskRoom;
};

type Rect = { x: number; y: number; width: number; height: number };

/**
 * Scout Desk's notch (dictation, a question, a receipt) grows out of the same
 * housing and draws over this panel. While Desk's is out, the housing is
 * Desk's, as a question opens over Hush on Desk's own notch: folded, the
 * notch tucks into its edge (`tuck`) and drops back out when Desk's goes;
 * open or held, the board stands just below Desk's shape (`below`) so
 * neither covers the other.
 */
export type NotchDeskRoom = "tuck" | "below" | null;
/** The gap between Desk's shape and the board standing below it. */
export const NOTCH_DESK_GAP = 8;

export function notchPlace(
  edge: NotchEdge,
  geometry: { visible: Rect | null; housing: Rect | null; aboveMenuBar: boolean; deskNotch?: Rect | null } | null | undefined,
  view: { width: number; height: number },
  open = false,
): NotchPlace {
  const insets = notchInsets(geometry?.visible, view);
  if (edge !== "top" || !geometry?.aboveMenuBar) return { insets, hang: false, bar: 0, housing: null, desk: null };
  const desk = geometry.deskNotch && geometry.deskNotch.width > 0 && geometry.deskNotch.height > 0 ? geometry.deskNotch : null;
  if (desk && open) {
    return { insets: { ...insets, top: Math.round(desk.y + desk.height + NOTCH_DESK_GAP) }, hang: false, bar: 0, housing: null, desk: "below" };
  }
  const h = geometry.housing && geometry.housing.width > 0 && geometry.housing.height > 0 ? geometry.housing : null;
  return {
    insets: { ...insets, top: 0 },
    hang: true,
    bar: h ? Math.round(h.height) : insets.top,
    housing: h ? { center: h.x + h.width / 2, width: Math.round(h.width) } : null,
    desk: desk ? "tuck" : null,
  };
}

/**
 * The board's root on its edge: centered along the edge (on the camera, when
 * there is one), so it grows evenly to both sides as it opens.
 */
export function notchBoardStyle(edge: NotchEdge, place: NotchPlace, view: { width: number; height: number }): { top: string; right: string; bottom: string; left: string; translate: string } {
  const { insets } = place;
  const midX = place.housing?.center ?? insets.left + (view.width - insets.left - insets.right) / 2;
  const midY = insets.top + (view.height - insets.top - insets.bottom) / 2;
  const px = (n: number) => `${Math.round(n)}px`;
  switch (edge) {
    case "top": return { top: px(insets.top), bottom: "auto", left: px(midX), right: "auto", translate: "-50% 0" };
    case "bottom": return { top: "auto", bottom: px(insets.bottom), left: px(midX), right: "auto", translate: "-50% 0" };
    case "left": return { top: px(midY), bottom: "auto", left: px(insets.left), right: "auto", translate: "0 -50%" };
    case "right": return { top: px(midY), bottom: "auto", left: "auto", right: px(insets.right), translate: "0 -50%" };
  }
}

/**
 * The pointer is gone this long before the open notch folds: moving away puts it away.
 * Hovering never opens it: the strip holds still under the pointer, so its chips can be
 * clicked (a chip opens that agent's details beside the strip); its grow control opens the board.
 */
export const NOTCH_LEAVE_MS = 160;
/** Open with nothing touched this long, the notch folds even under a still pointer: the interaction is over. */
export const NOTCH_IDLE_MS = 3000;

/*
 * The notch's motion: everything comes out of its edge and goes back into it.
 * Opening, the shape springs open and its content follows it out of the edge.
 * Folding, the content goes first, quickly, and the shape springs back after.
 * Hidden from the host (its hotkey), the notch slides into the edge before the
 * panel goes; shown again, it drops back out with a small pop.
 */
/** Folding: the open content leaves this long before the shape folds. */
export const NOTCH_FOLD_MS = 80;
/** Hiding: the notch slides into its edge over this long; the host hides the panel after it. */
export const NOTCH_RETRACT_MS = 160;
/**
 * Showing: the notch drops out of its edge over this long, then pops a touch from the edge's
 * middle. Each leg eases out; nothing overshoots its place, so it never comes off the edge.
 */
export const NOTCH_ARRIVE_MS = 288;
/** Brought in by the hotkey and never reached by the pointer, the notch puts itself away after this. */
export const NOTCH_PEEK_MS = 3_000;
export const NOTCH_ARRIVE_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/**
 * Whether the notch is put away in its edge, coming out of it, or at rest.
 * Hidden: away. Shown after being hidden, or first shown: arriving. A retract
 * from the host: away, until it is hidden.
 */
export type NotchAway = "away" | "arriving" | null;
export function notchAwayOnVisible(was: boolean | undefined, now: boolean | undefined): NotchAway | "keep" {
  if (now === false) return "away";
  if (now === true && was !== true) return "arriving";
  return "keep";
}

/**
 * The opened board: half the display's width along the top or bottom edge,
 * less beside it, and never a wall across a large display. What it covers
 * is the work behind it.
 */
export const NOTCH_OPEN_MAX = 880;
export function notchOpenWidth(edge: NotchEdge, view: { width: number }): number {
  const share = edge === "left" || edge === "right" ? 0.4 : 0.5;
  return Math.round(Math.max(440, Math.min(NOTCH_OPEN_MAX, view.width * share)));
}

/**
 * The notch has two states: folded to S, the strip against the edge, and
 * open, L. A step up from the strip opens it; a step down from the open board
 * folds it. M, a corner's card, would sit across the work behind it.
 */
export function notchSizeStep(from: "s" | "m" | "l", to: "s" | "m" | "l"): "open" | "fold" {
  return to === "l" || (to === "m" && from === "s") ? "open" : "fold";
}

/**
 * What came out of the notch, and holds it open past a leave and the idle
 * wait: a sheet (Settings, New), Scoutbot, the details panel, a choices
 * list, a menu, or a field with text in it. Each closes on its own ×, on
 * Esc, or with a click outside; the notch folds after it.
 */
export type NotchHolds = { composing: boolean; settings: boolean; scoutbot: boolean; details: boolean; choices: boolean; menu: boolean; typing: boolean };
export function notchHeld(holds: NotchHolds): boolean {
  return holds.composing || holds.settings || holds.scoutbot || holds.details || holds.choices || holds.menu || holds.typing;
}

/** A board let go this close to an edge (inside the menu bar and Dock), near its middle, hangs there as the notch. */
export const NOTCH_SNAP = 32;
/** How much of the edge, centred, counts as its middle. */
export const NOTCH_SNAP_SPAN = 0.4;

/**
 * Where a board let go at `rect` goes: the notch on the edge it was dropped
 * against, near that edge's middle, or null to stand free where it landed.
 * Pulling the notch off its edge detaches it; dropping it back, or on the
 * middle of another edge, hangs it there.
 */
export function notchDropEdge(
  rect: { left: number; top: number; width: number; height: number },
  insets: NotchInsets,
  view: { width: number; height: number },
): NotchEdge | null {
  const inSpan = (mid: number, from: number, to: number) => Math.abs(mid - (from + to) / 2) <= ((to - from) * NOTCH_SNAP_SPAN) / 2;
  const across = inSpan(rect.left + rect.width / 2, insets.left, view.width - insets.right);
  const along = inSpan(rect.top + rect.height / 2, insets.top, view.height - insets.bottom);
  const gaps: [NotchEdge, number, boolean][] = [
    ["top", rect.top - insets.top, across],
    ["bottom", view.height - insets.bottom - (rect.top + rect.height), across],
    ["left", rect.left - insets.left, along],
    ["right", view.width - insets.right - (rect.left + rect.width), along],
  ];
  const near = gaps.filter(([, gap, mid]) => mid && gap <= NOTCH_SNAP).sort((a, b) => a[1] - b[1]);
  return near[0]?.[0] ?? null;
}
