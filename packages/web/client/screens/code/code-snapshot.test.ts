import { afterAll, describe, expect, mock, test } from "bun:test";
import type * as ReactModule from "react";

// @ts-expect-error -- the relative .js path keeps bun's runtime resolution to the real react module
const React = (await import("../../../node_modules/react/index.js")) as typeof ReactModule;
mock.module("react", () => React);

let reads = 0;
mock.module("../../scout/repo-watch/api.ts", () => ({
  fetchRepoWatchSnapshot: async () => {
    reads += 1;
    return null;
  },
  getCachedRepoWatchSnapshot: () => null,
}));

type Timer = { fn: () => void; ms: number; next: number };
const timers: Timer[] = [];
let clock = 0;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setInterval = ((fn: () => void, ms: number) => {
  const timer = { fn, ms, next: clock + ms };
  timers.push(timer);
  return timer;
}) as unknown as typeof setInterval;
globalThis.clearInterval = ((timer: Timer) => {
  const at = timers.indexOf(timer);
  if (at >= 0) timers.splice(at, 1);
}) as unknown as typeof clearInterval;
(globalThis as { document?: unknown }).document ??= { visibilityState: "visible" };

const { pollCodeSnapshot } = await import("./code-snapshot.ts");

async function advanceTo(to: number) {
  for (clock += 5_000; clock <= to; clock += 5_000) {
    for (const timer of [...timers]) {
      if (timer.next <= clock) {
        timer.next += timer.ms;
        timer.fn();
      }
    }
    await Bun.sleep(0);
  }
  clock = to;
}

describe("pollCodeSnapshot", () => {
  test("two holders mounted apart share one timer, and the last release stops it", async () => {
    const first = pollCodeSnapshot(30_000);
    await Bun.sleep(0);
    await advanceTo(5_000);
    const second = pollCodeSnapshot(30_000);
    await Bun.sleep(0);
    const start = reads;
    await advanceTo(65_000);
    expect({ timers: timers.length, reads: reads - start }).toEqual({ timers: 1, reads: 2 });

    first();
    first();
    expect(timers.length).toBe(1);
    second();
    expect(timers.length).toBe(0);
  });
});

afterAll(() => {
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
});
