import { describe, expect, test } from "bun:test";
import { INSPECTOR_LAYER_WIDTH, inspectorLayerPlacement } from "./home-moving-layer.ts";

const host = {} as Element;
const stage = { top: 280, bottom: 500, left: 60, right: 1700 };

function row(top: number, height = 34) {
  return { top, bottom: top + height, left: stage.left, right: stage.right };
}

describe("What's moving inspector layer", () => {
  test("sits level with the row, against the panel's right edge, when the window has room", () => {
    const placed = inspectorLayerPlacement(row(300), stage, 2576, 1056, host, 480)!;
    expect(placed.top).toBe(300);
    expect(placed.width).toBe(INSPECTOR_LAYER_WIDTH);
    expect(placed.left).toBe(stage.right - INSPECTOR_LAYER_WIDTH - 8);
    // Taller than the 220px panel it belongs to: the window caps it, not the panel.
    expect(placed.maxHeight).toBe(1056 - 16 - 300);
  });

  test("slides up just enough to show all of its content for a low row", () => {
    const placed = inspectorLayerPlacement(row(370), stage, 1280, 760, host, 470)!;
    expect(placed.top).toBe(760 - 16 - 470);
    expect(placed.maxHeight).toBe(470);
  });

  test("takes the whole window height when the content is taller than the window", () => {
    const placed = inspectorLayerPlacement(row(500), stage, 1280, 600, host, 2000)!;
    expect(placed.top).toBe(16);
    expect(placed.maxHeight).toBe(600 - 32);
  });

  test("starts on the row before its height is measured", () => {
    const placed = inspectorLayerPlacement(row(300), stage, 1440, 900, host)!;
    expect(placed.top).toBe(300);
    expect(placed.maxHeight).toBe(900 - 16 - 300);
  });

  test("stays inside a narrow window", () => {
    const narrow = { ...stage, right: 300 };
    const placed = inspectorLayerPlacement(row(100), narrow, 320, 640, host, 400)!;
    expect(placed.width).toBe(288);
    expect(placed.left).toBe(16);
  });

  test("a row scrolled out of the window hides the layer", () => {
    expect(inspectorLayerPlacement(row(-60), stage, 1440, 900, host)).toBeNull();
    expect(inspectorLayerPlacement(row(910), stage, 1440, 900, host)).toBeNull();
  });
});
