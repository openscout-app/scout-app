import { expect, test } from "bun:test";

import { BLINK, GAZE, gazeToward, nextBlinkIn } from "./figure-life.ts";

test("blinks come a few seconds apart, never on a beat", () => {
  expect(nextBlinkIn(() => 0)).toBe(BLINK.GAP);
  expect(nextBlinkIn(() => 1)).toBe(BLINK.GAP + BLINK.SPREAD);
  expect(nextBlinkIn(() => 0.5)).toBeGreaterThan(BLINK.GAP);
  // A quick blink: shut for about an eighth of a second.
  expect(BLINK.SHUT).toBeGreaterThanOrEqual(120);
  expect(BLINK.SHUT).toBeLessThanOrEqual(180);
});

test("the glance points toward the pointer and is clamped to -1..1", () => {
  expect(gazeToward(200, 0)).toEqual({ x: 1, y: 0 });
  expect(gazeToward(-200, 0)).toEqual({ x: -1, y: 0 });
  const diagonal = gazeToward(100, 100);
  expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 2);
  expect(diagonal.y).toBeCloseTo(Math.SQRT1_2, 2);
});

test("on the figure it hardly moves; far away it looks at its own work", () => {
  expect(gazeToward(0, 0)).toEqual({ x: 0, y: 0 });
  expect(Math.abs(gazeToward(GAZE.NEAR / 4, 0).x)).toBeLessThan(0.3);
  expect(gazeToward(GAZE.RADIUS + 1, 0)).toEqual({ x: 0, y: 0 });
});
