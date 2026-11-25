import { describe, expect, test } from "bun:test";
import { fitSides, moveItem, splitPair } from "./DockedSides.tsx";

describe("docked sides fit the window", () => {
  test("sides that fit keep their own widths", () => {
    expect(fitSides(1400, { left: 340, right: 520 })).toEqual({ left: 340, right: 520 });
  });

  test("short of room, the open sides give way together and leave the main area its minimum", () => {
    const fitted = fitSides(774, { left: 340, right: 520 });
    expect((fitted.left ?? 0) + (fitted.right ?? 0)).toBeLessThanOrEqual(774);
    // in proportion: the wider side stays the wider
    expect(fitted.right! > fitted.left!).toBe(true);
  });

  test("a side never draws narrower than its narrowest", () => {
    const fit = fitSides(300, { left: 340, right: 520 });
    expect(fit.left!).toBeGreaterThanOrEqual(58);
    expect(fit.right!).toBeGreaterThanOrEqual(58);
    expect(fit.left! + fit.right!).toBeLessThanOrEqual(300);
    expect(fitSides(264, { left: 58, right: 960 })).toEqual({ left: 58, right: 206 });
  });

  test("a folded side takes nothing from the open one", () => {
    expect(fitSides(500, { right: 520 })).toEqual({ right: 500 });
    expect(fitSides(900, { left: 340 })).toEqual({ left: 340 });
  });
});

describe("a side's stacked panels", () => {
  test("a drag shares the height and neither panel goes below its minimum", () => {
    expect(splitPair(400, 200, 50)).toEqual([450, 150]);
    expect(splitPair(400, 200, -400)).toEqual([72, 528]);
    expect(splitPair(400, 200, 400)).toEqual([528, 72]);
  });

  test("moving a panel lands it at the new index", () => {
    expect(moveItem(["hosts", "rack"], 1, 0)).toEqual(["rack", "hosts"]);
    expect(moveItem(["hosts", "rack"], 0, 0)).toEqual(["hosts", "rack"]);
    expect(moveItem(["hosts", "rack"], 5, 0)).toEqual(["hosts", "rack"]);
  });
});
