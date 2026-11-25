import { describe, expect, test } from "bun:test";

import { blinkPaths, nearestEdgePoint } from "./blink-model.ts";

describe("blink geometry", () => {
  test("an anchor meets its nearest edge", () => {
    expect(nearestEdgePoint(1000, 600, { x: 900, y: 560 })).toEqual({ x: 900, y: 600 });
    expect(nearestEdgePoint(1000, 600, { x: 980, y: 300 })).toEqual({ x: 1000, y: 300 });
    expect(nearestEdgePoint(1000, 600, { x: 50, y: 20 })).toEqual({ x: 50, y: 0 });
  });

  test("both runs start opposite the anchor, end at it, and turn at the corners between", () => {
    // Anchor bottom, x=900. Perimeter 3200; opposite = top, x=100.
    const [cw, ccw] = blinkPaths(1000, 600, { x: 900, y: 590 });
    expect(cw).toBe("M100 0 L1000 0 L1000 600 L900 600");
    expect(ccw).toBe("M100 0 L0 0 L0 600 L900 600");
  });
});
