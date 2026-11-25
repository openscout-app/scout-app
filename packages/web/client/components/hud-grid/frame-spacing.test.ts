import { describe, expect, test } from "bun:test";
import { FRAME_SPACING_FALLBACK, parseFrameSpacing } from "./frame-spacing.ts";
import { rowsFor } from "./hud-grid-layout.ts";

const reader = (values: Record<string, string>) => (name: string) => values[name] ?? "";

describe("parseFrameSpacing", () => {
  test("reads the gap and the vertical edge from the custom properties", () => {
    expect(parseFrameSpacing(reader({ "--frame-gap": " 4px", "--frame-edge-y": "6px", "--frame-unit": "4px" }))).toEqual({ gap: 4, edgeY: 6, seam: 12 });
  });

  test("the seam is three frame units", () => {
    expect(parseFrameSpacing(reader({ "--frame-unit": "1px" })).seam).toBe(3);
    expect(parseFrameSpacing(reader({ "--frame-unit": " 2px" })).seam).toBe(6);
  });

  test("an unset or unreadable property falls back to the frame before Density set it", () => {
    expect(parseFrameSpacing(reader({}))).toEqual(FRAME_SPACING_FALLBACK);
    expect(parseFrameSpacing(reader({ "--frame-gap": "wide", "--frame-edge-y": "-2px", "--frame-unit": "x" }))).toEqual(FRAME_SPACING_FALLBACK);
  });

  test("zero is a real gap, not a missing one", () => {
    expect(parseFrameSpacing(reader({ "--frame-gap": "0px", "--frame-edge-y": "0", "--frame-unit": "0px" }))).toEqual({ gap: 0, edgeY: 0, seam: 0 });
  });
});

describe("rowsFor with the frame's gap", () => {
  test("the gap between rows counts toward the content's height", () => {
    // 24px rows: 100px of content is 4 rows at an 8px gap and at a 4px gap; 120px needs 4 rows at 8, 5 at 0
    expect(rowsFor(100, 24, 8)).toBe(4);
    expect(rowsFor(100, 24, 4)).toBe(4);
    expect(rowsFor(120, 24, 8)).toBe(4);
    expect(rowsFor(120, 24, 0)).toBe(5);
  });

  test("defaults to the grid's own gap", () => {
    expect(rowsFor(120, 24)).toBe(rowsFor(120, 24, 8));
  });
});
