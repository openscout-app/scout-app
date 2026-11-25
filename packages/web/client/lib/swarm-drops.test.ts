import { describe, expect, test } from "bun:test";

import { CROWDED_SPACING_PX, dropsCrowded, dropsToDraw, type DropAsk } from "./swarm-drops.ts";

const routine = (id: string, x: number): DropAsk => ({ id, x, open: false, fromLane: false, related: false });

/** `count` routine asks spread evenly across `width` pixels. */
function spread(count: number, width: number): DropAsk[] {
  return Array.from({ length: count }, (_, i) => routine(`a${i}`, (i * width) / count));
}

describe("dropsCrowded", () => {
  test("asks at least the spacing apart do not crowd the board", () => {
    expect(dropsCrowded(77, 770)).toBe(false);
  });

  test("asks closer than the spacing, on average, crowd it", () => {
    expect(dropsCrowded(78, 770)).toBe(true);
    expect(770 / 78).toBeLessThan(CROWDED_SPACING_PX);
  });

  test("one ask or none never crowds a board, however narrow", () => {
    expect(dropsCrowded(0, 4)).toBe(false);
    expect(dropsCrowded(1, 4)).toBe(false);
  });
});

describe("dropsToDraw", () => {
  test("a sparse board draws every line", () => {
    const asks = spread(20, 800);
    expect(dropsToDraw(asks, 800)).toEqual(new Set(asks.map((ask) => ask.id)));
  });

  test("a crowded board draws only open asks, asks between lanes and asks in focus", () => {
    const asks = spread(260, 770);
    asks[3] = { ...asks[3]!, open: true };
    asks[40] = { ...asks[40]!, fromLane: true };
    asks[200] = { ...asks[200]!, related: true };
    expect(dropsToDraw(asks, 770)).toEqual(new Set(["a3", "a40", "a200"]));
  });

  test("a crowded board with nothing open or in focus draws no lines", () => {
    expect(dropsToDraw(spread(260, 770), 770).size).toBe(0);
  });

  test("focus adds lines on a crowded board but never makes it sparse", () => {
    const asks = spread(100, 770).map((ask, i) => ({ ...ask, related: i < 50 }));
    expect(dropsToDraw(asks, 770).size).toBe(50);
  });

  test("a wider board can turn a crowded window sparse", () => {
    const asks = spread(100, 770);
    expect(dropsToDraw(asks, 770).size).toBe(0);
    expect(dropsToDraw(asks, 1200).size).toBe(100);
  });
});
