import { notchPlacement, TAP_IN_SIZE, type TapInEdge } from "./tap-in-model.ts";

/** A sheet's width beside the board (Settings, New). */
export const SHEET_WIDTH = 400;
/** The sheet's hit region id in edge mode; the board treats it as its own. */
export const SHEET_HIT_ID = "sheet";

type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Where a sheet sits, in viewport pixels. It hangs from `top` or stands on
 * `bottom` (the other is null), grows out of the `from` edge that faces the
 * board, and scrolls past `maxHeight`, all the room it has.
 */
export type SheetPlacement = { from: TapInEdge; left: number; width: number; top: number | null; bottom: number | null; maxHeight: number; notch?: boolean;
  /** Popped out of a side notch: its own card, centred top to bottom at its own height (top and bottom are null). */
  float?: boolean };

/**
 * Beside the board, toward the screen's centre, as Tap in opens: a board in
 * the upper half hangs the sheet from its top edge, one in the lower half
 * stands it on its bottom edge, so the sheet grows away from the near screen
 * edge. With no room beside (a narrow view), it opens above or below the
 * board instead, on the board's own side.
 */
export function sheetPlacement(board: Rect, view: { width: number; height: number }, width = SHEET_WIDTH, notchEdge: TapInEdge | null = null): SheetPlacement {
  const { GAP, INSET } = TAP_IN_SIZE;
  // On a notch the sheet is the notch grown, as Tap in's panel is there (notchPlacement).
  // On a side edge it pops out instead: a thin line of icons has no room to grow a sheet out of, and a sheet held to
  // the line's height scrolls. Its own card, beside the line toward the screen's middle, centred top to bottom.
  if (notchEdge === "left" || notchEdge === "right") {
    const w = Math.max(0, Math.min(width, notchEdge === "left" ? view.width - INSET - board.right - GAP : board.left - GAP - INSET));
    const left = notchEdge === "left" ? board.right + GAP : board.left - GAP - w;
    return { from: notchEdge, left, width: w, top: null, bottom: null, maxHeight: Math.max(0, view.height - 2 * INSET), float: true };
  }
  if (notchEdge) {
    const { box, from } = notchPlacement(board, view, notchEdge, width);
    return from === "bottom"
      ? { from, left: box.left, width: box.width, top: null, bottom: view.height - board.top, maxHeight: box.height, notch: true }
      : { from, left: box.left, width: box.width, top: box.top, bottom: null, maxHeight: box.height, notch: true };
  }
  const w = Math.max(0, Math.min(width, view.width - 2 * INSET));
  const toLeft = (board.left + board.right) / 2 > view.width / 2;
  const high = (board.top + board.bottom) / 2 <= view.height / 2;
  const beside = toLeft ? board.left - GAP - w : board.right + GAP;
  if (toLeft ? beside >= INSET : beside + w <= view.width - INSET) {
    const from: TapInEdge = toLeft ? "right" : "left";
    return high
      ? { from, left: beside, width: w, top: board.top, bottom: null, maxHeight: Math.max(0, view.height - INSET - board.top) }
      : { from, left: beside, width: w, top: null, bottom: view.height - board.bottom, maxHeight: Math.max(0, board.bottom - INSET) };
  }
  const left = Math.max(INSET, Math.min(toLeft ? board.right - w : board.left, view.width - INSET - w));
  return high
    ? { from: "top", left, width: w, top: board.bottom + GAP, bottom: null, maxHeight: Math.max(0, view.height - INSET - board.bottom - GAP) }
    : { from: "bottom", left, width: w, top: null, bottom: view.height - board.top + GAP, maxHeight: Math.max(0, board.top - GAP - INSET) };
}
