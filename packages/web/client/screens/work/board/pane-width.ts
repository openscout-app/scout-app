export const DEFAULT_WIDTH = 400;
export const MIN_WIDTH = 360;
/** On small boards the ceiling takes precedence over the minimum. */
export function paneMax(board: number) { return Math.max(0, board * 0.7); }
export function clampWidth(width: number, board: number) {
  const max = paneMax(board);
  return Math.min(max, Math.max(Math.min(MIN_WIDTH, max), Number.isFinite(width) ? width : DEFAULT_WIDTH));
}
const KEY = "openscout.work.board.detail.width.v1";
export function readWidth(fallback = DEFAULT_WIDTH): number {
  try {
    const raw = window.localStorage.getItem(KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch { return fallback; }
}
export function writeWidth(width: number) {
  try { window.localStorage.setItem(KEY, String(width)); } catch { /* Storage is optional. */ }
}
