import { describe, expect, test } from "bun:test";
import { aheadOfPace, runsOutAt, windowLength } from "./quota-pace.ts";

const H = 3_600_000;
const WEEK = 168 * H;
const RESET = 1_000 * H;

describe("quota pace", () => {
  test("a window's length comes from the provider, else from its label", () => {
    expect(windowLength("7d")).toBe(WEEK);
    expect(windowLength("5h")).toBe(5 * H);
    expect(windowLength("7d", 2 * H)).toBe(2 * H);
    expect(windowLength("weekly")).toBeNull();
  });

  test("90% with 8 hours of a week left is on pace; 90% with 2 days left is ahead", () => {
    expect(aheadOfPace(0.9, RESET - 8 * H, RESET, WEEK)).toBe(false);
    expect(aheadOfPace(0.9, RESET - 48 * H, RESET, WEEK)).toBe(true);
    expect(aheadOfPace(0.9, RESET - 48 * H, RESET, null)).toBe(true);
  });

  test("the run-out time follows the pace since the window opened, and is null past the reset", () => {
    // Half the week gone, 75% used: the rest of the 25% goes in a third of the time used so far.
    expect(runsOutAt(0.75, RESET - 84 * H, RESET, WEEK)).toBe(RESET - 168 * H + 112 * H);
    expect(runsOutAt(0.4, RESET - 84 * H, RESET, WEEK)).toBeNull();
    expect(runsOutAt(0.4, RESET - 84 * H, RESET, null)).toBeNull();
  });
});
