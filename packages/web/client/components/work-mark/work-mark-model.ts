/**
 * The work mark: a 4×4 dot matrix that says where a session stands. Pure, so
 * the patterns are testable without a DOM.
 *
 * - working: the four centre dots lit, and a lit dot running round the ring.
 * - waiting: an exclamation mark in the centre columns, still.
 * - idle: the four centre dots lit, still.
 */

export type WorkMarkState = "working" | "waiting" | "idle";

export const WORK_MARK_GRID = 4;

/** One loop round the ring, in ms. */
export const WORK_MARK_PERIOD_MS = 1600;

/** The ring, clockwise from the top left corner, as [column, row]. */
export const WORK_MARK_RING: readonly (readonly [number, number])[] = [
  [0, 0], [1, 0], [2, 0], [3, 0],
  [3, 1], [3, 2], [3, 3],
  [2, 3], [1, 3], [0, 3],
  [0, 2], [0, 1],
];

const CORE = new Set(["1,1", "2,1", "1,2", "2,2"]);
const BANG = new Set(["1,0", "2,0", "1,1", "2,1", "1,3", "2,3"]);

export type WorkMarkDot = {
  x: number;
  y: number;
  lit: boolean;
  /** Its place on the ring, for the running dot; null off the ring or when the mark holds still. */
  ring: number | null;
  /** Its opacity in the still frame that reduced motion shows; null when it keeps its lit or unlit look. */
  held: number | null;
};

/** The still frame of the running dot: its head at the top left, two fading dots behind it. */
const HELD: Record<number, number> = { 0: 1, 11: 0.6, 10: 0.35 };

export function workMarkDots(state: WorkMarkState): WorkMarkDot[] {
  const ringIndex = new Map(WORK_MARK_RING.map(([x, y], i) => [`${x},${y}`, i]));
  const dots: WorkMarkDot[] = [];
  for (let y = 0; y < WORK_MARK_GRID; y++) {
    for (let x = 0; x < WORK_MARK_GRID; x++) {
      const key = `${x},${y}`;
      const onRing = ringIndex.get(key);
      const ring = state === "working" && onRing !== undefined ? onRing : null;
      const lit = state === "waiting" ? BANG.has(key) : CORE.has(key);
      dots.push({ x, y, lit, ring, held: ring !== null ? HELD[ring] ?? null : null });
    }
  }
  return dots;
}

/**
 * The animation delay that puts a mark in step with every other one on the
 * page: the document clock's place in the loop, taken once when the mark
 * mounts. CSS then runs the loop; no timer is kept.
 */
export function workMarkPhase(nowMs: number, periodMs = WORK_MARK_PERIOD_MS): number {
  return -(((nowMs % periodMs) + periodMs) % periodMs);
}
