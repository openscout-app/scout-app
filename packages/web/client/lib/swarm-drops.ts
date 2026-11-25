/*
 * Which ask lines the lanes view draws. Each ask drops a line from whoever
 * asked, the point row or another lane, to its block. While the asks are
 * sparse, every line is drawn. When they crowd the board, the lines become a
 * curtain over the blocks, and the point row already marks each send. Then a
 * line is drawn only where it says something the blocks do not: an open ask, an
 * ask from one lane to another, or an ask in focus.
 */

export type DropAsk = {
  id: string;
  /** Where the ask was sent, in pixels along the track. */
  x: number;
  open: boolean;
  /** Another lane asked it, not the point row. */
  fromLane: boolean;
  /** The ask, its lane or its code is in focus. */
  related: boolean;
};

/** Asks closer together than this, on average, crowd the board. */
export const CROWDED_SPACING_PX = 10;

/** The board is crowded when its asks average less than `CROWDED_SPACING_PX` apart. */
export function dropsCrowded(count: number, width: number): boolean {
  return count > 1 && width / count < CROWDED_SPACING_PX;
}

/** The ids of the asks whose line the lanes view draws. Focus never changes whether the board counts as crowded. */
export function dropsToDraw(asks: readonly DropAsk[], width: number): Set<string> {
  if (!dropsCrowded(asks.length, width)) return new Set(asks.map((ask) => ask.id));
  return new Set(asks.filter((ask) => ask.open || ask.fromLane || ask.related).map((ask) => ask.id));
}
