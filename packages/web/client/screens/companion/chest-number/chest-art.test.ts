import { describe, expect, test } from "bun:test";
import { CHEST_ART_MIN_SIZE, CHEST_DIGIT_ROWS, ledChestColumns, ledChestLayout, spriteChestDigitBoxes, CREW_CHEST_PANELS } from "./chest-art.tsx";

describe("chest numeral art", () => {
  test("ten distinct single-stroke 3x5 digits", () => {
    expect(new Set(CHEST_DIGIT_ROWS.map(rows => rows.join(""))).size).toBe(10);
    for (const rows of CHEST_DIGIT_ROWS) {
      expect(rows.length).toBe(5);
      for (const row of rows) expect(row).toMatch(/^[01]{3}$/);
    }
  });
  test("retains leading zeroes with one empty column between digits", () => {
    expect(ledChestColumns("001")).toEqual([31, 17, 31, 0, 31, 17, 31, 0, 18, 31, 16]);
  });
  test("rejects malformed codes instead of changing identity", () => {
    for (const code of ["", "1", "01", "0001", "OS 003", "00a", " 003", "003\n"]) expect(ledChestColumns(code)).toEqual([]);
  });
  test("every valid code has eleven columns confined to five rows", () => {
    for (let n = 0; n < 1000; n++) {
      const cols = ledChestColumns(String(n).padStart(3, "0"));
      expect(cols.length).toBe(11);
      expect(cols.every(c => c >= 0 && c < 32)).toBe(true);
    }
  });
  test("LED band fits inside body from default size up", () => {
    for (const size of [24, 32, 48, 64]) {
      const width = Math.round(size * 1.15);
      const layout = ledChestLayout(size, width);
      expect(layout.height + 2).toBeLessThanOrEqual(size);
      expect(layout.x).toBeGreaterThanOrEqual(0);
    }
    expect(CHEST_ART_MIN_SIZE).toEqual({ led: 48, crew: 64, sprite: 64 });
  });
});


test("sprite digits stay in separate lit cells, below the eye rows", () => {
  expect(spriteChestDigitBoxes(48, 48)).toEqual([]);
  const size = 64, sprite = 55, pitch = sprite / 7;
  const boxes = spriteChestDigitBoxes(size, size);
  expect(boxes.length).toBe(3);
  boxes.forEach((b, i) => {
    const left = (size - sprite) / 2 + (i + 2) * pitch;
    const top = size - sprite + 4 * pitch;
    // Stay within the cell's straight central strip horizontally; this also
    // clears its rounded corners even at the highest/lowest digit strokes.
    expect(b.x).toBeGreaterThanOrEqual(left + pitch * .27);
    expect(b.x + 3).toBeLessThanOrEqual(left + pitch * .73);
    expect(b.y).toBeGreaterThanOrEqual(top + pitch * .07);
    expect(b.y + 5).toBeLessThanOrEqual(top + pitch * .93);
  });
});

test("crew coverage is explicit; no generic chest fallback", () => {
  expect(Object.keys(CREW_CHEST_PANELS).sort()).toEqual(["milo", "brik", "sprout", "wrench", "vex", "lulu", "nori", "pip", "tuck", "fenn"].sort());
  expect(Object.entries(CREW_CHEST_PANELS).filter(([, panel]) => panel).map(([slug]) => slug)).toEqual(["lulu"]);
});
