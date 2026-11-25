import { describe, expect, test } from "bun:test";

import type { ServiceGauge } from "../home/HomeHero.tsx";
import {
  BUDGETS_FRESH_AFTER_MS,
  BUDGETS_READ_EVERY_MS,
  createBudgetsLoop,
  type BudgetsDeps,
  type ServiceBudgets,
} from "./service-budgets-loop.ts";

/*
 * The Providers loop: one /api/service-budgets read for the Providers screen
 * and every plan panel. Fetch, cache and timers are fakes.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const gauge = (id: string, fill = 0.5): ServiceGauge => ({
  id,
  label: id,
  kind: "quota",
  fill,
  usedLabel: "",
  capLabel: "",
  unitLabel: "",
  resetAt: 0,
});

const T0 = 1_700_000_000_000;

const reading = (id: string, generatedAt = T0 + 5_000): ServiceBudgets => ({ generatedAt, gauges: [gauge(id)], cloudAccounts: [] });

function harness(options: { warm?: ServiceBudgets | null } = {}) {
  const reads: Array<{ force: boolean; read: Deferred<ServiceBudgets> }> = [];
  const timers = new Map<number, { run: () => void; ms: number; repeat: boolean }>();
  let nextHandle = 1;
  let visible = true;
  const deps: BudgetsDeps = {
    fetch: (force) => {
      const read = deferred<ServiceBudgets>();
      reads.push({ force, read });
      return read.promise;
    },
    peek: () => options.warm ?? null,
    now: () => T0 + 9_000,
    visible: () => visible,
    setTimer: (run, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { run, ms, repeat: false });
      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    setInterval: (run, ms) => {
      const handle = nextHandle++;
      timers.set(handle, { run, ms, repeat: true });
      return handle;
    },
    clearInterval: (handle) => {
      timers.delete(handle as number);
    },
  };
  const fire = (ms: number) => {
    for (const [handle, timer] of [...timers]) {
      if (timer.ms !== ms) continue;
      if (!timer.repeat) timers.delete(handle);
      timer.run();
    }
  };
  return {
    loop: createBudgetsLoop(deps),
    reads,
    timers,
    fire,
    hide: () => {
      visible = false;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createBudgetsLoop", () => {
  test("cold: loading until the first read lands, then every 30s", async () => {
    const h = harness();
    expect(h.loop.getState()).toMatchObject({ loading: true, gauges: [] });
    const release = h.loop.mount();
    expect(h.reads.map((r) => r.force)).toEqual([false]);
    h.reads[0]!.read.resolve(reading("claude"));
    await settle();
    expect(h.loop.getState()).toMatchObject({ loading: false, refreshing: false, generatedAt: T0 + 5_000 });
    expect(h.loop.getState().gauges.map((g) => g.id)).toEqual(["claude"]);

    h.fire(BUDGETS_READ_EVERY_MS);
    expect(h.reads.map((r) => r.force)).toEqual([false, false]);
    release();
  });

  test("warm: a recent cached reading draws at once, before and after mount", () => {
    const h = harness({ warm: reading("codex", T0 + 7_000) });
    const before = h.loop.getState();
    expect(before).toMatchObject({ loading: false, generatedAt: T0 + 7_000 });
    expect(h.loop.getState()).toBe(before);
    const release = h.loop.mount();
    expect(h.loop.getState()).toMatchObject({ loading: false, refreshing: true, generatedAt: T0 + 7_000 });
    expect(h.loop.getState().gauges.map((g) => g.id)).toEqual(["codex"]);
    release();
  });

  test("a fresh reader forces one read 600ms after the first read lands", async () => {
    const h = harness();
    const release = h.loop.mount({ fresh: true });
    const second = h.loop.mount({ fresh: true });
    await settle();
    expect([...h.timers.values()].some((t) => t.ms === BUDGETS_FRESH_AFTER_MS)).toBe(false);
    h.reads[0]!.read.resolve(reading("claude"));
    await settle();
    h.fire(BUDGETS_FRESH_AFTER_MS);
    expect(h.reads.map((r) => r.force)).toEqual([false, true]);
    second();
    release();
  });

  test("a plain reader never forces a read", async () => {
    const h = harness();
    const release = h.loop.mount();
    h.reads[0]!.read.resolve(reading("claude"));
    await settle();
    h.fire(BUDGETS_FRESH_AFTER_MS);
    expect(h.reads.map((r) => r.force)).toEqual([false]);
    release();
  });

  test("a forced read never lands in a later mount session", async () => {
    const h = harness();
    const release = h.loop.mount({ fresh: true });
    release();
    h.reads[0]!.read.resolve(reading("claude"));
    await settle();
    expect([...h.timers.values()].length).toBe(0);
    const again = h.loop.mount();
    h.reads[1]!.read.resolve(reading("codex"));
    await settle();
    h.fire(BUDGETS_FRESH_AFTER_MS);
    expect(h.reads.map((r) => r.force)).toEqual([false, false]);
    expect(h.loop.getState().gauges.map((g) => g.id)).toEqual(["codex"]);
    again();
  });

  test("a hidden page skips the 30s read", () => {
    const h = harness();
    const release = h.loop.mount();
    h.hide();
    h.fire(BUDGETS_READ_EVERY_MS);
    expect(h.reads.length).toBe(1);
    release();
  });

  test("a newer read supersedes an older one; a failure keeps the last good reading", async () => {
    const h = harness();
    const release = h.loop.mount();
    void h.loop.load(true);
    h.reads[1]!.read.resolve(reading("new"));
    await settle();
    h.reads[0]!.read.resolve(reading("old"));
    await settle();
    expect(h.loop.getState().gauges.map((g) => g.id)).toEqual(["new"]);

    void h.loop.load(false);
    h.reads[2]!.read.reject(new Error("offline"));
    await settle();
    expect(h.loop.getState()).toMatchObject({ refreshing: false, error: "offline" });
    expect(h.loop.getState().gauges.map((g) => g.id)).toEqual(["new"]);
    release();
  });

  test("the last unmount drops timers and the reading", async () => {
    const h = harness();
    const release = h.loop.mount();
    h.reads[0]!.read.resolve(reading("claude"));
    await settle();
    release();
    release();
    expect(h.timers.size).toBe(0);
    expect(h.loop.getState()).toMatchObject({ loading: true, gauges: [] });
  });
});
