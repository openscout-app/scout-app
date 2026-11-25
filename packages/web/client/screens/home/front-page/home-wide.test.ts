import { describe, expect, test } from "bun:test";

import { HOME_WIDE_MIN, isHomeWide } from "./home-wide.ts";

describe("Home's third column", () => {
  test("opens once every column fits at its floor", () => {
    // two equal sides at their 280px floor + the Feed (at least 540) + two 24px gaps + two 24px gutters
    expect(HOME_WIDE_MIN).toBeGreaterThanOrEqual(2 * 280 + 540 + 48 + 48);
    expect(isHomeWide(HOME_WIDE_MIN)).toBe(true);
  });

  test("a half-screen window on a 2560px display gets three columns", () => {
    // 1280px window less the side nav and the page card's edges
    expect(isHomeWide(1210)).toBe(true);
  });

  test("stays two columns below it", () => {
    expect(isHomeWide(HOME_WIDE_MIN - 1)).toBe(false);
    expect(isHomeWide(1080)).toBe(false);
  });
});
