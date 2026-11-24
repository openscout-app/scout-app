import { describe, expect, test } from "bun:test";

import type { FeedSummaries } from "../../../shared/api/feed.ts";
import { createTurnSummaryReader, PENDING_READS } from "./turn-summaries.ts";

function manualTimers() {
  const due: Array<() => void> = [];
  return {
    timers: { set: (fn: () => void) => { due.push(fn); return due.length; }, clear: () => {} },
    async fire() {
      const now = due.splice(0);
      for (const fn of now) fn();
      await new Promise((r) => setTimeout(r, 0));
    },
    get waiting() { return due.length; },
  };
}

describe("turn summary reader", () => {
  test("rows shown together go out as one read", async () => {
    const reads: string[][] = [];
    const clock = manualTimers();
    const reader = createTurnSummaryReader(async (ids) => {
      reads.push([...ids]);
      return { summaries: { a: { turnId: "a:1", gist: "A gist", ask: null } }, pending: false, available: true };
    }, clock.timers);
    reader.show("a", 1);
    reader.show("b", 2);
    await clock.fire();
    expect(reads).toEqual([["a", "b"]]);
    expect(reader.get("a", 1)).toEqual({ turnId: "a:1", gist: "A gist", ask: null });
    expect(reader.get("b", 2)).toBeNull();
    expect(clock.waiting).toBe(0);
  });

  test("a newer turn on the same post reads again", async () => {
    const reads: string[][] = [];
    const clock = manualTimers();
    const reader = createTurnSummaryReader(async (ids) => { reads.push([...ids]); return { summaries: {}, pending: false, available: true }; }, clock.timers);
    const release = reader.show("a", 1);
    await clock.fire();
    release();
    reader.show("a", 2);
    await clock.fire();
    expect(reads).toEqual([["a"], ["a"]]);
  });

  test("reads again while the server is writing, then stops", async () => {
    let reads = 0;
    const clock = manualTimers();
    const reader = createTurnSummaryReader(async (): Promise<FeedSummaries> => { reads += 1; return { summaries: {}, pending: true, available: true }; }, clock.timers);
    reader.show("a", 1);
    for (let i = 0; i < PENDING_READS + 5; i++) await clock.fire();
    expect(reads).toBe(PENDING_READS + 1);
  });

  test("a server with no model path is not asked again", async () => {
    let reads = 0;
    const clock = manualTimers();
    const reader = createTurnSummaryReader(async () => { reads += 1; return { summaries: {}, pending: false, available: false }; }, clock.timers);
    reader.show("a", 1);
    await clock.fire();
    reader.show("b", 1);
    await clock.fire();
    expect(reads).toBe(1);
  });

  test("listeners hear each read", async () => {
    const clock = manualTimers();
    const reader = createTurnSummaryReader(async () => ({ summaries: { a: { turnId: "a:1", gist: "g", ask: "Pick one" } }, pending: false, available: true }), clock.timers);
    let heard = 0;
    reader.subscribe(() => { heard += 1; });
    reader.show("a", 1);
    await clock.fire();
    expect(heard).toBe(1);
  });
});
