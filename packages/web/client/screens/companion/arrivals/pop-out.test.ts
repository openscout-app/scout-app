import { describe, expect, test } from "bun:test";
import { POP_GAP, popOutSpot } from "./pop-out";

const screen = { width: 1440, height: 900 };

describe("popOutSpot", () => {
  test("a board in the bottom-right corner sends a strip out to its left, clear of the board, level with the row", () => {
    const board = { left: 1080, top: 600, right: 1416, bottom: 876 };
    const spot = popOutSpot(board, { x: 1200, y: 700 }, screen, 320);
    expect(spot).toEqual({ x: 1080 - POP_GAP - 160, y: 714 });
    expect(spot.x + 160).toBeLessThan(board.left);
  });

  test("a board on the left sends it out to its right", () => {
    const board = { left: 24, top: 24, right: 360, bottom: 300 };
    expect(popOutSpot(board, { x: 100, y: 120 }, screen, 48)).toEqual({ x: 360 + POP_GAP + 24, y: 134 });
  });

  test("what lands stays on the display", () => {
    const wide = { left: 2, top: 0, right: 1438, bottom: 40 };
    const spot = popOutSpot(wide, { x: 10, y: 4 }, screen, 320);
    expect(spot.x - 160).toBeGreaterThanOrEqual(12);
    expect(spot.x + 160).toBeLessThanOrEqual(screen.width - 12);
    expect(spot.y).toBeGreaterThanOrEqual(40);
  });
});
