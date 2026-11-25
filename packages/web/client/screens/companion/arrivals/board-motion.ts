/**
 * The board's motion, on one clock. Every time here is a whole number of
 * 16 ms frames and everything eases out the same way, so the parts of a
 * gesture land together instead of on their own beats.
 *
 * Opening is two moves from the board's corner: the folded card widens along
 * its edge to the board's width, then the board rises away from the corner,
 * overshooting a touch and settling. The rows come in nearest the corner
 * first as it rises, and each row's status flaps riffle and land left to
 * right as the row arrives. Folding is the same two moves backwards, quicker:
 * the board drops to its strip, then narrows into the card.
 */

export const FRAME_MS = 16;

/** The pointer has to rest on the folded board this long before it opens. */
export const HOVER_INTENT_MS = 5 * FRAME_MS;
/** Leaving, the board waits this long before it folds, so a slip off the edge does not fold it. */
export const FOLD_GRACE_MS = 20 * FRAME_MS;

/** Opening, first move: the folded card widens along its edge to the board's width. */
export const WIDEN_MS = 7 * FRAME_MS;
/** Opening, second move: the board rises from that strip to its full height, with a small pop. */
export const RISE_MS = 12 * FRAME_MS;
/** The folded card growing into the board: widen, then rise. */
export const UNFOLD_MS = WIDEN_MS + RISE_MS;
/** Folding, first move: the board drops back to its strip. */
export const DROP_MS = 5 * FRAME_MS;
/** Folding, second move: the strip narrows into the card. */
export const NARROW_MS = 4 * FRAME_MS;
/** The board shrinking back into its card: drop, then narrow. */
export const FOLD_MS = DROP_MS + NARROW_MS;
/** The pop: how far past its height the rising board goes before it settles, as a fraction of its height. */
export const RISE_POP = 0.025;
/** The pop peaks this far into the rise, then settles over the rest. */
export const RISE_POP_AT = 0.6;
/** A row, a detail or a plate coming in. */
export const ENTER_MS = 10 * FRAME_MS;

/** One row after another, from the corner out. */
export const ROW_STEP_MS = FRAME_MS;
/** Rows past this many steps from the corner come in together. */
export const ROW_STEPS_MAX = 8;

/** A flap shows the next letter of its drum this often. */
export const FLAP_TICK_MS = 2 * FRAME_MS;
/** Opening: a row's first cell lands this long after the row starts coming in. */
export const RIFFLE_FIRST_MS = 6 * FRAME_MS;
/** Opening: each cell lands one frame after the cell before it. */
export const RIFFLE_CELL_MS = FRAME_MS;
/** A status that changed is news: it turns slower so it is seen. */
export const NEWS_FIRST_MS = 12 * FRAME_MS;
export const NEWS_CELL_MS = 3 * FRAME_MS;

/** An ask blinks on this cycle, every asking row in step. */
export const PULSE_MS = 80 * FRAME_MS;

/**
 * The board rewrites on this beat: 30 s, on the wall clock (:00 and :30), so
 * every board agrees. Between passes nothing moves but an ask.
 */
export const PASS_MS = 1875 * FRAME_MS;
/** At a pass, changed rows rewrite one after another from the board's corner, this far apart. */
export const PASS_ROW_MS = 3 * FRAME_MS;
/** A session busy with nothing written this long reads QUIET: 5 min. */
export const QUIET_AFTER_MS = 18_750 * FRAME_MS;

/** One curve for everything that arrives, the same curve inverted for what leaves. */
export const EASE_OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
export const EASE_IN = "cubic-bezier(0.8, 0, 0.8, 0.2)";
/** The widen gathers before it goes (a little ease in), so the two moves read as two. */
export const EASE_GATHER = "cubic-bezier(0.5, 0, 0.2, 1)";

/**
 * When the item at `index` of `count` starts coming in. The wave starts at
 * the corner the board hangs from: on a bottom corner the last item is
 * nearest, on a top corner the first.
 */
export function waveDelay(index: number, count: number, fromBottom: boolean): number {
  const fromCorner = fromBottom ? count - 1 - index : index;
  return Math.min(Math.max(fromCorner, 0), ROW_STEPS_MAX) * ROW_STEP_MS;
}

/**
 * Opening: when the item at `index` of `count` starts coming in. The item at
 * the corner sits in the strip, so it comes in with the widen; the rest come
 * in as the board rises to them, from the corner out.
 */
export function openDelay(index: number, count: number, fromBottom: boolean): number {
  const d = waveDelay(index, count, fromBottom);
  return d === 0 ? 0 : WIDEN_MS + d - ROW_STEP_MS;
}

/** Opening: when cell `cell` of a row that starts at `rowDelay` lands. */
export function riffleSettle(rowDelay: number, cell: number): number {
  return rowDelay + RIFFLE_FIRST_MS + cell * RIFFLE_CELL_MS;
}

/** A status change: when cell `cell` lands. */
export function newsSettle(cell: number): number {
  return NEWS_FIRST_MS + cell * NEWS_CELL_MS;
}

/** The longest a riffle can run, from the open to the last cell landing. */
export function riffleSpan(cells: number): number {
  return riffleSettle(WIDEN_MS + (ROW_STEPS_MAX - 1) * ROW_STEP_MS, cells - 1);
}

/**
 * The delay that puts a blink started at `now` (ms on the page clock) in
 * step with every other: all of them read the same clock, so they share a
 * phase however late each row began asking.
 */
export function pulseDelay(now: number): number {
  const into = ((now % PULSE_MS) + PULSE_MS) % PULSE_MS;
  return into === 0 ? 0 : -into;
}

/** The pass a moment belongs to: the last :00 or :30 at or before it. */
export function passFloor(now: number): number {
  return Math.floor(now / PASS_MS) * PASS_MS;
}

/** How long until the next pass lands, in (0, PASS_MS]. */
export function nextPassIn(now: number): number {
  return PASS_MS - (((now % PASS_MS) + PASS_MS) % PASS_MS);
}

/** Reduce Motion: no open, fold or riffle; the board just changes. */
export function prefersReducedMotion(): boolean {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

/** The motion tokens as CSS custom properties, for the board's root. */
export const MOTION_VARS: Record<string, string> = {
  "--arv-enter": `${ENTER_MS}ms`,
  "--arv-pulse": `${PULSE_MS}ms`,
  "--arv-ease": EASE_OUT,
  "--arv-ease-in": EASE_IN,
};
