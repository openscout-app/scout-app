/**
 * The show sequence. Each time the companion comes on screen the hex and its
 * base come up first; once the first read is in, the crew steps out of the hex
 * one at a time, nearest spot first, and figures placed on windows pop in
 * last. Timing only: CompanionEdge applies it and edge.css draws it. Reduce
 * Motion skips it entirely.
 */
export const ENTRANCE = {
  /** The hex and the base come up over this long. */
  HEX_MS: 260,
  /** The first figure leaves the hex this long after the crew starts. */
  CREW_START_MS: 140,
  /** Each figure leaves this long after the one before it... */
  STAGGER_MS: 60,
  /** ...unless the last would leave later than this; the stagger shrinks to fit. */
  CREW_SPAN_MS: 480,
  /** One figure's trip from the hex to its spot. */
  STEP_MS: 420,
  /** A figure placed on a window pops in over this long. */
  PLACED_MS: 300,
} as const;

/** The whole crew is out by then, however many there are. */
export const ENTRANCE_TOTAL_MS = ENTRANCE.CREW_START_MS + ENTRANCE.CREW_SPAN_MS + ENTRANCE.STEP_MS;

/**
 * When each figure leaves the hex, in ms after the crew starts. The home row
 * goes nearest to the hex first, so the crew files out rather than crossing;
 * placed figures follow in the order given.
 */
export function entranceDelays(
  row: ReadonlyArray<{ id: string; x: number }>,
  homeX: number,
  placed: readonly string[] = [],
): Map<string, number> {
  const order = [
    ...[...row].sort((a, b) => Math.abs(a.x - homeX) - Math.abs(b.x - homeX)).map((slot) => slot.id),
    ...placed,
  ];
  const stagger = order.length > 1 ? Math.min(ENTRANCE.STAGGER_MS, ENTRANCE.CREW_SPAN_MS / (order.length - 1)) : 0;
  return new Map(order.map((id, index) => [id, Math.round(ENTRANCE.CREW_START_MS + index * stagger)]));
}
