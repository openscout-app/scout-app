import { describe, expect, test } from "bun:test";
import { createRefreshingRead } from "./refreshing-read.ts";

function harness(results: Array<number | Error>) {
  let clock = 0;
  let calls = 0;
  const gates: Array<() => void> = [];
  const read = () => {
    const result = results[Math.min(calls, results.length - 1)];
    calls += 1;
    return new Promise<number>((resolve, reject) => {
      gates.push(() => (result instanceof Error ? reject(result) : resolve(result)));
    });
  };
  const cache = createRefreshingRead(read, { maxAgeMs: 10_000, now: () => clock });
  return {
    cache,
    calls: () => calls,
    advance: (ms: number) => { clock += ms; },
    settle: async () => {
      while (gates.length) gates.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("createRefreshingRead", () => {
  test("the first get waits; later gets within maxAge never read again", async () => {
    const h = harness([1]);
    const first = h.cache.get();
    await h.settle();
    expect(await first).toBe(1);
    h.advance(5_000);
    expect(await h.cache.get()).toBe(1);
    expect(await h.cache.get()).toBe(1);
    expect(h.calls()).toBe(1);
  });

  test("past maxAge: serves the old value at once and refreshes once in the background", async () => {
    const h = harness([1, 2]);
    const first = h.cache.get();
    await h.settle();
    await first;
    h.advance(10_001);
    expect(await h.cache.get()).toBe(1);
    expect(await h.cache.get()).toBe(1);
    expect(h.calls()).toBe(2);
    await h.settle();
    expect(await h.cache.get()).toBe(2);
  });

  test("a failed refresh keeps the last value and waits out maxAge before trying again", async () => {
    const h = harness([1, new Error("herdr down"), 3]);
    const first = h.cache.get();
    await h.settle();
    await first;
    h.advance(10_001);
    expect(await h.cache.get()).toBe(1);
    await h.settle();
    expect(await h.cache.get()).toBe(1);
    expect(h.calls()).toBe(2);
    h.advance(10_001);
    await h.cache.get();
    expect(h.calls()).toBe(3);
  });

  test("with nothing cached, a recent failure is returned without another read", async () => {
    const h = harness([new Error("herdr down"), 5]);
    const first = h.cache.get();
    await h.settle();
    await expect(first).rejects.toThrow("herdr down");
    await expect(h.cache.get()).rejects.toThrow("herdr down");
    expect(h.calls()).toBe(1);
  });

  test("fresh waits for a new read", async () => {
    const h = harness([1, 2]);
    const first = h.cache.get();
    await h.settle();
    await first;
    const forced = h.cache.get({ fresh: true });
    await h.settle();
    expect(await forced).toBe(2);
  });
});
