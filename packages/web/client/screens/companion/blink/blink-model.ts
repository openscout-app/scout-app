/**
 * Blink (Studio: /studies/companion-blink): when an agent asks, one light runs
 * along the screen edge from the far side to where the asking surface sits,
 * once. Nothing dims, and nothing glows.
 *
 * Pure geometry, so the paths are testable without a screen. A position on
 * the edge is its distance along the perimeter, clockwise from the top-left.
 */

export type Point = { x: number; y: number };

/** Where a point inside the screen meets the nearest edge. */
export function nearestEdgePoint(w: number, h: number, p: Point): Point {
  const x = Math.min(w, Math.max(0, p.x));
  const y = Math.min(h, Math.max(0, p.y));
  const d = [y, w - x, h - y, x];
  const min = Math.min(...d);
  if (min === d[0]) return { x, y: 0 };
  if (min === d[1]) return { x: w, y };
  if (min === d[2]) return { x, y: h };
  return { x: 0, y };
}

function along(w: number, h: number, p: Point): number {
  if (p.y === 0) return p.x;
  if (p.x === w) return w + p.y;
  if (p.y === h) return w + h + (w - p.x);
  return 2 * w + h + (h - p.y);
}

function at(w: number, h: number, d: number): Point {
  const per = 2 * (w + h);
  const t = ((d % per) + per) % per;
  if (t <= w) return { x: t, y: 0 };
  if (t <= w + h) return { x: w, y: t - w };
  if (t <= 2 * w + h) return { x: w - (t - w - h), y: h };
  return { x: 0, y: h - (t - 2 * w - h) };
}

/**
 * The two runs of light: both start at the edge point opposite the anchor
 * and travel half the perimeter each way, so they arrive at the anchor
 * together. Returned as SVG path data in screen pixels.
 */
export function blinkPaths(w: number, h: number, anchor: Point): [string, string] {
  const end = nearestEdgePoint(w, h, anchor);
  const per = 2 * (w + h);
  const a = along(w, h, end);
  const start = a + per / 2;
  const corners = [0, w, w + h, 2 * w + h];
  const run = (dir: 1 | -1) => {
    const pts: Point[] = [at(w, h, start)];
    // Corners crossed on the way, in travel order.
    const crossed = corners
      .flatMap((c) => [c, c + per, c + 2 * per])
      .map((c) => (dir === 1 ? c - start : start - c))
      .map((offset, i) => ({ offset, i }))
      .filter(({ offset }) => offset > 0 && offset < per / 2)
      .sort((p, q) => p.offset - q.offset);
    for (const { offset } of crossed) pts.push(at(w, h, start + dir * offset));
    pts.push(end);
    return pts.map((p, i) => `${i ? "L" : "M"}${round(p.x)} ${round(p.y)}`).join(" ");
  };
  return [run(1), run(-1)];
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
