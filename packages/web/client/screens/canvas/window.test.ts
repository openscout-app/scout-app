import { expect, test } from "bun:test";
import { CANVAS_REACH_DAYS, canvasEarliestEnd } from "../../../shared/canvas.ts";
import { canStepEarlier, moveEnd, readSteps, stepEnd, windowPhrase, windowSpan, windowWords } from "./window.ts";

const H = 3_600_000;
/** local times, so the phrases read the same in any time zone: Saturday 14 November 2026 */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const NOW = at(14, 15, 30);

test("a window reads newest first, from what is already shown", () => {
  expect(readSteps(4, 0)).toEqual([1, 4]);
  expect(readSteps(24, 0)).toEqual([1, 4, 24]);
  expect(readSteps(168, 4)).toEqual([24, 48, 168]);
  // narrowing reads only the narrower window
  expect(readSteps(4, 168)).toEqual([4]);
  expect(readSteps(4, 4)).toEqual([4]);
});

test("windows in words", () => {
  expect([1, 4, 24, 48, 168].map(windowPhrase)).toEqual(["the last hour", "the last 4 hours", "the last 24 hours", "the last 2 days", "the last 7 days"]);
});

test("a step moves the window by its own length, and later than now is live again", () => {
  const back = stepEnd(null, 4, -1, NOW);
  expect(back).toBe(NOW - 4 * H);
  expect(stepEnd(back, 4, -1, NOW)).toBe(NOW - 8 * H);
  expect(stepEnd(NOW - 8 * H, 24, 1, NOW)).toBeNull();
  expect(stepEnd(back, 4, 1, NOW)).toBeNull();
  expect(stepEnd(NOW - 30 * H, 24, 1, NOW)).toBe(NOW - 6 * H);
  // an end is floored to the minute, as the server floors it
  expect(stepEnd(null, 4, -1, NOW + 25_000)).toBe(NOW - 4 * H);
});

test("a window cannot start before the reach of the Review window, nor end after now", () => {
  const edge = canvasEarliestEnd(4, NOW);
  expect(edge).toBe(NOW - CANVAS_REACH_DAYS * 24 * H + 4 * H);
  expect(moveEnd(NOW - 30 * 24 * H, 4, NOW)).toBe(edge);
  expect(moveEnd(NOW + H, 4, NOW)).toBeNull();
  expect(moveEnd(null, 4, NOW)).toBeNull();
  expect(canStepEarlier(null, 4, NOW)).toBe(true);
  expect(canStepEarlier(edge + 60_000, 4, NOW)).toBe(true);
  expect(stepEnd(edge + 60_000, 4, -1, NOW)).toBe(edge);
  expect(canStepEarlier(edge, 4, NOW)).toBe(false);
});

test("a past window in words, from its real times", () => {
  expect(windowSpan(at(13, 14), at(13, 18), NOW)).toBe("Yesterday 2–6 pm");
  expect(windowSpan(at(10, 10), at(10, 14), NOW)).toBe("Tue 10 am – 2 pm");
  expect(windowSpan(at(14, 9, 47), at(14, 13, 47), NOW)).toBe("Today 9:47 am – 1:47 pm");
  expect(windowSpan(at(13, 22), at(14, 2), NOW)).toBe("Yesterday 10 pm – today 2 am");
  expect(windowSpan(at(13, 20), at(14, 0), NOW)).toBe("Yesterday 8 pm – 12 am");
  expect(windowSpan(at(14, 0), at(14, 4), NOW)).toBe("Today 12–4 am");
  expect(windowSpan(at(10, 15), at(11, 15), NOW)).toBe("Tue 3 pm – Wed 3 pm");
  expect(windowSpan(at(3, 14), at(3, 18), NOW)).toBe("Nov 3, 2–6 pm");
  expect(windowSpan(at(6, 15), at(13, 15), NOW)).toBe("Nov 6, 3 pm – yesterday 3 pm");
});

test("a sentence names the live window by its hours, a past one as this window", () => {
  expect(windowWords({ live: true, hours: 4 })).toBe("the last 4 hours");
  expect(windowWords({ live: false, hours: 4 })).toBe("this window");
});
