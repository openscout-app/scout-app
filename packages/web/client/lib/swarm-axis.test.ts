import { describe, expect, test } from "bun:test";

import { lanesAxis } from "./swarm-axis.ts";
import { axisTicks } from "./swarm-model.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
// Local times, so the day ticks hold in any time zone.
const NOW = new Date(2026, 9, 21, 17, 0).getTime();

const quiet = { open: false };
const open = { open: true };

describe("lanesAxis", () => {
  test("a fixed window ends at now, however long the swarm has been quiet", () => {
    const axis = lanesAxis({ start: NOW - 3 * HOUR, lastActivityAt: NOW - 150 * MIN, asks: [quiet] }, { now: NOW, fit: false });
    expect(axis.live).toBe(true);
    expect(axis.end).toBe(NOW);
  });

  test("All ends at now while an ask is open", () => {
    const axis = lanesAxis({ start: NOW - 2 * 24 * HOUR, lastActivityAt: NOW - 30 * HOUR, asks: [quiet, open] }, { now: NOW, fit: true });
    expect(axis.live).toBe(true);
    expect(axis.end).toBe(NOW);
  });

  test("All ends at now when the swarm went quiet only lately", () => {
    // Three hours of work, quiet for the last 40 minutes: under a quarter of the span.
    const axis = lanesAxis({ start: NOW - 3 * HOUR, lastActivityAt: NOW - 40 * MIN, asks: [quiet] }, { now: NOW, fit: true });
    expect(axis.live).toBe(true);
    expect(axis.end).toBe(NOW);
  });

  test("All on a swarm quiet for long ends just past its last activity", () => {
    // Two hours of work two days ago.
    const start = NOW - 50 * HOUR;
    const last = start + 2 * HOUR;
    const axis = lanesAxis({ start, lastActivityAt: last, asks: [quiet, quiet] }, { now: NOW, fit: true });
    expect(axis.live).toBe(false);
    expect(axis.lastActivityAt).toBe(last);
    expect(axis.end).toBeGreaterThan(last);
    expect(axis.end - last).toBeLessThanOrEqual(5 * MIN);
    // The work fills the board: the last activity sits in its last few percent.
    expect((last - start) / (axis.end - start)).toBeGreaterThan(0.95);
    for (const tick of axis.ticks) expect(tick.at).toBeLessThan(axis.end);
  });

  test("a single quiet ask still gets an axis a minute wide", () => {
    const at = NOW - 10 * HOUR;
    const axis = lanesAxis({ start: at, lastActivityAt: at, asks: [quiet] }, { now: NOW, fit: true });
    expect(axis.live).toBe(false);
    expect(axis.end).toBe(at + MIN);
  });

  test("the first tick of each new day reads as the day", () => {
    const start = new Date(2026, 9, 19, 14, 10).getTime();
    const axis = lanesAxis({ start, lastActivityAt: NOW, asks: [open] }, { now: NOW, fit: true, maxTicks: 10 });
    const days = axis.ticks.filter((tick) => tick.day).map((tick) => new Date(tick.at).getDate());
    expect(days).toEqual([20, 21]);
    for (const tick of axis.ticks) {
      if (tick.day) expect(new Date(tick.at).getHours()).toBe(0);
    }
    // A tick on the axis's own first day reads as a clock time.
    expect(axis.ticks[0]!.day).toBe(false);
  });

  test("an axis that starts just before midnight marks the new day on its first tick", () => {
    const start = new Date(2026, 9, 20, 23, 40).getTime();
    // Half-hour ticks: the first one after 23:40 is midnight.
    const axis = lanesAxis({ start, lastActivityAt: start + 50 * MIN, asks: [open] }, { now: start + 60 * MIN, fit: false, maxTicks: 2 });
    expect(axis.ticks[0]).toEqual({ at: new Date(2026, 9, 21, 0, 0).getTime(), day: true });
  });
});

describe("axisTicks over days", () => {
  test("a ten-day span on a narrow board keeps to a few ticks", () => {
    const ticks = axisTicks(NOW - 10 * 24 * HOUR, NOW, 3);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(3);
  });

  test("a three-day span ticks at local midnights", () => {
    const ticks = axisTicks(NOW - 3 * 24 * HOUR, NOW, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const tick of ticks) expect([new Date(tick).getHours(), new Date(tick).getMinutes()]).toEqual([0, 0]);
  });
});
