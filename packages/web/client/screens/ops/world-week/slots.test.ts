import { describe, expect, test } from "bun:test";
import { buildSlots, scoreSlot, tierOf, topSlots, SLOT_MS } from "./slots.ts";

const T0 = Date.UTC(2026, 9, 5, 0, 0, 0);
// strs: 0 lane, 1 a file, 2 a short command, 3 a clipped command
const strs = ["~/dev/openscout", "/src/a.ts", "bun test", "cd /private/tmp/" + "x".repeat(100)];
const ev = (sec: number, k: string, sess: number, tgt: number, add = 0, rem = 0) => [sec, 0, k, sess, 0, tgt, -1, add, rem];

describe("world slots", () => {
  test("cuts events into lane × bucket slots with counts", () => {
    const D = { from: T0, now: T0 + 3600e3, strs, asks: [], events: [ev(10, "e", 0, 1, 30, 5), ev(20, "r", 1, 1), ev(700, "c", 0, 2)] };
    const s = buildSlots(D);
    expect(s.map(x => x.t0 - T0)).toEqual([0, SLOT_MS]);
    expect(s[0]).toMatchObject({ lane: "~/dev/openscout", calls: 2, edits: 1, lines: 35, files: 1, sessions: [0, 1] });
  });

  test("counts waste: rereads and repeats by the same session, never on clipped targets", () => {
    const events = [ev(1, "r", 0, 1), ev(2, "r", 0, 1), ev(3, "r", 1, 1), ev(4, "c", 0, 2), ev(5, "c", 0, 2), ev(6, "c", 0, 2), ev(7, "c", 0, 3), ev(8, "c", 0, 3)];
    const [s] = buildSlots({ from: T0, now: T0 + 60e3, strs, asks: [], events, colds: [[9, 0, 40000]] });
    expect(s).toMatchObject({ rereads: 1, repeats: 2, colds: 1, coldTokens: 40000 });
  });

  test("asks and errors land in the lane of their session", () => {
    const D = { from: T0, now: T0 + 3600e3, strs, events: [ev(1, "c", 4, 2)], errs: [[30, 4, 0, 0, 0]],
      asks: [[T0 + 1e3, T0 + 2e3, "c", 0, 1, "t", ""], [T0 + 1e3, null, "f", 0, 1, "t", "boom"]], work: { 0: { s: 4 }, 1: { s: 4 } } };
    const [s] = buildSlots(D);
    expect(s).toMatchObject({ errors: 1, asksDone: [0], asksFailed: [1], asksOpened: [0, 1] });
  });

  test("score is 0–3 and grows with what happened", () => {
    const quiet = scoreSlot({ calls: 3, lines: 0, files: 0, sessions: [0], errors: 0, asksDone: [], asksFailed: [] });
    const big = scoreSlot({ calls: 300, lines: 5000, files: 20, sessions: [0, 1, 2], errors: 9, asksDone: [1, 2], asksFailed: [3] });
    expect(quiet).toBeLessThan(0.5);
    expect(big).toBe(3);
  });

  test("tiers rank within the window and need a floor score", () => {
    expect(tierOf(2.5, 0.01)).toBe("must-see");
    expect(tierOf(1.9, 0.01)).toBe("interesting");
    expect(tierOf(2.5, 0.5)).toBe("routine");
    expect(tierOf(0.5, 0)).toBe("routine");
  });

  test("since keeps later slots but tiers still rank against the whole window", () => {
    const events = Array.from({ length: 50 }, (_, i) => ev(i * 600, "c", 0, 2));
    const all = buildSlots({ from: T0, now: T0 + 50 * 600e3, strs, asks: [], events });
    const late = buildSlots({ from: T0, now: T0 + 50 * 600e3, strs, asks: [], events }, { since: T0 + 40 * 600e3 });
    expect(late.length).toBe(10);
    expect(late.map(s => s.tier)).toEqual(all.slice(40).map(s => s.tier));
  });

  test("topSlots spaces picks within a lane", () => {
    const mk = (t0: number, score: number) => ({ id: String(t0), lane: "a", t0, score } as any);
    expect(topSlots([mk(0, 3), mk(600e3, 2.9), mk(7200e3, 2)], 2).map(s => s.t0)).toEqual([0, 7200e3]);
  });
});
