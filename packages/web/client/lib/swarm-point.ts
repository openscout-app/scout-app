/*
 * The lanes view's point row: who runs point, and each ask they sent. The row
 * quotes an ask where its words have room before the next ask, and marks it
 * where they do not. It places the newest asks first, so no quote covers a
 * later ask, and the asks nearest now keep their words: on 10-24 a quote of an
 * ask sent at 10:28 covered the mark of the ask that resumed a lane at 10:33,
 * and the newer ask could not be seen in the row. Where the words have no room
 * after the send, they end at it instead, if that covers no earlier ask: the
 * newest ask sits near now, at the track's right edge, and on 10-24 the ask
 * sent at 11:29 had only a mark there. An ask sent before the window opened
 * has no send on this axis. Its block runs in from the left edge, and the row
 * neither quotes nor marks it there, so the asks sent in the window keep their
 * room. Its line from the point row is not drawn either: `sentInWindow` says
 * which asks have a send to draw.
 */

export type PointAsk = { id: string; title: string; askedAt: number };

export type PointPlace = {
  id: string;
  /** Where the ask was sent, in pixels along the track. */
  x: number;
  label: string;
  /** The quote starts at the send, or ends at it. With no room either way, the row marks the ask instead. */
  quote: "after" | "before" | null;
};

/** A title longer than this is cut, and ends with an ellipsis. */
const QUOTE_CHARS = 28;

/** How far a mark reaches either side of its ask (the row draws it from 4 px before, 9 px wide), and the space kept between neighbours. */
const MARK_LEFT = 4;
const MARK_RIGHT = 5;
const GAP = 6;

/** The ask was sent at or after the axis start, so its send is on the axis. */
export function sentInWindow(ask: Pick<PointAsk, "askedAt">, start: number): boolean {
  return ask.askedAt >= start;
}

/** The quote or mark for each ask sent in the window, left to right; the newest is placed first. */
export function placePointAsks(
  asks: readonly PointAsk[],
  { start, x, width }: { start: number; x: (at: number) => number; width: number },
): PointPlace[] {
  const sent = asks.filter((ask) => sentInWindow(ask, start)).sort((a, b) => b.askedAt - a.askedAt);
  // A quote has room up to the track's end, then up to the next ask's quote or mark.
  let room = width + 4;
  return sent.map((ask, index): PointPlace => {
    const at = x(ask.askedAt);
    const label = ask.title.length > QUOTE_CHARS ? `${ask.title.slice(0, QUOTE_CHARS - 1).trimEnd()}…` : ask.title;
    const w = Math.min(190, label.length * 6.3 + 20);
    // A quote that ends at the send starts clear of the previous ask's mark, and inside the track.
    const earlier = sent[index + 1];
    const clear = earlier ? x(earlier.askedAt) + MARK_RIGHT + GAP : 0;
    const quote = at + w < room ? "after" : at < room && at - w >= clear ? "before" : null;
    room = (quote === "after" ? at : quote === "before" ? at - w : at - MARK_LEFT) - GAP;
    return { id: ask.id, x: at, label, quote };
  }).reverse();
}
