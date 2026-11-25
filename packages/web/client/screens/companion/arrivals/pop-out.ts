/**
 * Pop out from S or M: right-click a session and it lands on the desk beside
 * the board, the way a row dragged off L does. A menu click carries no drag,
 * so the page picks the spot and the host places it there.
 */

export type PopBox = { left: number; top: number; right: number; bottom: number };

/** The gap between the board's side and what pops out of it. */
export const POP_GAP = 12;
/** Kept this far inside the display's edges. */
const POP_INSET = 12;

/**
 * Where a popped-out agent stands, in page points. A free spot is the bottom
 * middle of what lands there (a strip's foot, a figure's feet), so it sits half
 * its `width` out from the board, on the side with more room, and level with
 * the row the menu opened on (`at`, the row's middle; `rise` is half its height).
 */
export function popOutSpot(board: PopBox, at: { x: number; y: number }, screen: { width: number; height: number }, width: number, rise = 14): { x: number; y: number } {
  const half = width / 2;
  const left = board.left > screen.width - board.right;
  const x = left ? board.left - POP_GAP - half : board.right + POP_GAP + half;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    x: clamp(x, POP_INSET + half, screen.width - POP_INSET - half),
    y: clamp(at.y + rise, POP_INSET + rise * 2, screen.height - POP_INSET),
  };
}
