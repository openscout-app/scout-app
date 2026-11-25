import { describe, expect, test } from "bun:test";

import type { BriefingSummary } from "./briefings-model.ts";
import { BRIEFINGS_EVERY_MS, BRIEFINGS_FRESH_MS, createBriefingListStore } from "./briefings-store.ts";

/* One archive read for the page and every Briefings panel: counted, polled while visible, shared. */

const row = (id: string): BriefingSummary => ({
  id,
  kind: "tour",
  title: id,
  summary: "",
  recommendation: null,
  preparedAt: 1,
  ttlMs: 0,
  observationCount: 0,
  createdAt: 1,
});

function harness(warm: BriefingSummary[] | null = null) {
  const clock = { now: 1_000_000 };
  const pending: Array<{ resolve: (items: BriefingSummary[]) => void; reject: (error: unknown) => void }> = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 1;
  const page = { visible: true };
  const store = createBriefingListStore({
    fetch: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    peek: () => warm,
    now: () => clock.now,
    every: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { run, ms });
      return id;
    },
    stop: (handle) => {
      timers.delete(handle as number);
    },
    visible: () => page.visible,
  });
  const settle = async (items: BriefingSummary[]) => {
    pending.shift()?.resolve(items);
    await Promise.resolve();
    await Promise.resolve();
  };
  const fail = async (message: string) => {
    pending.shift()?.reject(new Error(message));
    await Promise.resolve();
    await Promise.resolve();
  };
  const tick = () => {
    for (const timer of timers.values()) timer.run();
  };
  return { store, clock, pending, timers, page, settle, fail, tick };
}

describe("the shared archive read", () => {
  test("the first reader paints a warm read, reads fresh, and starts one poll", async () => {
    const h = harness([row("warm")]);
    h.store.mount();
    expect(h.store.get().items?.map((item) => item.id)).toEqual(["warm"]);
    expect(h.store.get().reading).toBe(true);
    expect(h.pending.length).toBe(1);
    expect([...h.timers.values()].map((timer) => timer.ms)).toEqual([BRIEFINGS_EVERY_MS]);

    await h.settle([row("b2"), row("b1")]);
    expect(h.store.get()).toMatchObject({ error: null, reading: false, at: 1_000_000 });
    expect(h.store.get().items?.map((item) => item.id)).toEqual(["b2", "b1"]);
  });

  test("a second reader shares the first's read and poll", async () => {
    const h = harness();
    h.store.mount();
    h.store.mount();
    expect(h.pending.length).toBe(1);
    expect(h.timers.size).toBe(1);
    expect(h.store.readers()).toBe(2);

    await h.settle([row("b1")]);
    // a reader arriving while the list is fresh paints it and reads nothing
    h.clock.now += BRIEFINGS_FRESH_MS - 1;
    h.store.mount();
    expect(h.pending.length).toBe(0);
    // once it is older, a new reader reads again
    h.clock.now += 2;
    h.store.mount();
    expect(h.pending.length).toBe(1);
  });

  test("the last reader stops the poll and keeps the list for the next one", async () => {
    const h = harness();
    const a = h.store.mount();
    const b = h.store.mount();
    await h.settle([row("b1")]);
    a();
    a(); // a release is counted once
    expect(h.timers.size).toBe(1);
    b();
    expect(h.timers.size).toBe(0);
    expect(h.store.get().items?.map((item) => item.id)).toEqual(["b1"]);

    // back within 30s: painted at once, nothing read, the poll back on
    h.store.mount();
    expect(h.pending.length).toBe(0);
    expect(h.timers.size).toBe(1);
  });

  test("the poll reads only while the page is in front", async () => {
    const h = harness();
    h.store.mount();
    await h.settle([row("b1")]);
    h.page.visible = false;
    h.tick();
    expect(h.pending.length).toBe(0);
    h.page.visible = true;
    h.tick();
    expect(h.pending.length).toBe(1);
  });

  test("Refresh during a read waits for that read", async () => {
    const h = harness();
    h.store.mount();
    const first = h.store.refresh();
    const second = h.store.refresh();
    expect(first).toBe(second);
    expect(h.pending.length).toBe(1);
    await h.settle([row("b1")]);
    await first;
    // settled: a new Refresh reads again
    void h.store.refresh();
    expect(h.pending.length).toBe(1);
  });

  test("a failed read keeps the last list and says why; the next good read clears it", async () => {
    const h = harness();
    h.store.mount();
    await h.fail("broker down");
    expect(h.store.get()).toMatchObject({ items: null, error: "broker down", reading: false, at: 0 });

    void h.store.refresh();
    await h.settle([row("b1")]);
    void h.store.refresh();
    await h.fail("timeout");
    expect(h.store.get().items?.map((item) => item.id)).toEqual(["b1"]);
    expect(h.store.get().error).toBe("timeout");

    void h.store.refresh();
    await h.settle([row("b2")]);
    expect(h.store.get().error).toBeNull();
  });

  test("subscribers hear every change, and stop hearing once they leave", async () => {
    const h = harness();
    let heard = 0;
    const leave = h.store.subscribe(() => {
      heard += 1;
    });
    h.store.mount(); // reading: true
    await h.settle([row("b1")]); // the list
    expect(heard).toBe(2);
    leave();
    void h.store.refresh();
    expect(heard).toBe(2);
  });
});
