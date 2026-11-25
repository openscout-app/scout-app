import { describe, expect, test } from "bun:test";
import { createWorkMaterialPicks, createWorkStore, WORK_REFRESH_COALESCE_MS } from "./work-store.ts";

type Detail = { id: string; v: number };

function harness(peeked: Record<string, Detail> = {}) {
  const calls: string[] = [];
  const pending: { key: string; resolve: (d: Detail) => void; reject: (e: unknown) => void }[] = [];
  const timers: { run: () => void; ms: number; live: boolean }[] = [];
  const store = createWorkStore<Detail>({
    fetch: (key) => {
      calls.push(key);
      return new Promise((resolve, reject) => pending.push({ key, resolve, reject }));
    },
    peek: (key) => peeked[key] ?? null,
    setTimer: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { live: boolean }).live = false;
    },
  });
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const fire = () => {
    for (const timer of timers.splice(0)) if (timer.live) timer.run();
  };
  return { store, calls, pending, timers, settle, fire };
}

describe("the work detail store", () => {
  test("an empty id reads nothing and is never loading", () => {
    const { store, calls } = harness();
    const release = store.mount("");
    expect(store.get("")).toEqual({ value: null, error: null, loaded: true });
    expect(calls).toEqual([]);
    release();
  });

  test("before it mounts a reader sees the warm read, held still", () => {
    const warm = { id: "w1", v: 1 };
    const { store, calls } = harness({ w1: warm });
    const first = store.get("w1");
    expect(first).toEqual({ value: warm, error: null, loaded: true });
    expect(store.get("w1")).toBe(first);
    expect(calls).toEqual([]);
  });

  test("a cold mount is loading until its read lands; a warm one paints at once and refreshes", async () => {
    const { store, calls, pending, settle } = harness({ warm: { id: "warm", v: 1 } });
    store.mount("cold");
    expect(store.get("cold").loaded).toBe(false);
    store.mount("warm");
    expect(store.get("warm").value?.v).toBe(1);
    expect(calls).toEqual(["cold", "warm"]);
    pending[0]!.resolve({ id: "cold", v: 7 });
    pending[1]!.resolve({ id: "warm", v: 2 });
    await settle();
    expect(store.get("cold")).toEqual({ value: { id: "cold", v: 7 }, error: null, loaded: true });
    expect(store.get("warm").value?.v).toBe(2);
  });

  test("five readers of one item make one read", () => {
    const { store, calls } = harness();
    const releases = [1, 2, 3, 4, 5].map(() => store.mount("w1"));
    expect(calls).toEqual(["w1"]);
    expect(store.mounted()).toEqual(["w1"]);
    for (const release of releases) release();
    expect(store.mounted()).toEqual([]);
  });

  test("a superseded answer is dropped", async () => {
    const { store, pending, settle } = harness();
    store.mount("w1");
    void store.load("w1");
    pending[1]!.resolve({ id: "w1", v: 2 });
    await settle();
    pending[0]!.resolve({ id: "w1", v: 1 });
    await settle();
    expect(store.get("w1").value?.v).toBe(2);
  });

  test("a failed refresh keeps the last good item and says why; a 404 clears it", async () => {
    const { store, pending, settle } = harness();
    store.mount("w1");
    pending[0]!.resolve({ id: "w1", v: 1 });
    await settle();
    void store.load("w1");
    pending[1]!.reject(new Error("broker unreachable"));
    await settle();
    expect(store.get("w1")).toEqual({ value: { id: "w1", v: 1 }, error: "broker unreachable", loaded: true });
    void store.load("w1");
    pending[2]!.reject(Object.assign(new Error("not found"), { status: 404 }));
    await settle();
    expect(store.get("w1")).toEqual({ value: null, error: "not found", loaded: true });
  });

  test("a first read that fails settles with nothing to show", async () => {
    const { store, pending, settle } = harness();
    store.mount("w1");
    pending[0]!.reject(new Error("boom"));
    await settle();
    expect(store.get("w1")).toEqual({ value: null, error: "boom", loaded: true });
  });

  test("a burst of broker events is one read of every mounted item", async () => {
    const { store, calls, pending, timers, fire, settle } = harness();
    store.scheduleRefresh();
    expect(timers).toEqual([]);
    store.mount("a");
    store.mount("b");
    for (const read of pending.splice(0)) read.resolve({ id: read.key, v: 1 });
    await settle();
    calls.length = 0;
    store.scheduleRefresh();
    store.scheduleRefresh();
    store.scheduleRefresh();
    expect(timers.length).toBe(1);
    expect(timers[0]!.ms).toBe(WORK_REFRESH_COALESCE_MS);
    fire();
    expect(calls).toEqual(["a", "b"]);
  });

  test("events while a read is out wait for it, then make one more read", async () => {
    const { store, calls, pending, fire, settle } = harness();
    store.mount("w1");
    for (let i = 0; i < 8; i += 1) {
      store.scheduleRefresh();
      fire();
    }
    expect(calls).toEqual(["w1"]);
    pending[0]!.resolve({ id: "w1", v: 1 });
    await settle();
    expect(store.get("w1").value?.v).toBe(1);
    expect(calls).toEqual(["w1", "w1"]);
    pending[1]!.resolve({ id: "w1", v: 2 });
    await settle();
    expect(store.get("w1").value?.v).toBe(2);
    expect(calls).toEqual(["w1", "w1"]);
  });

  test("refreshing one key reads only it, and waits for a read still out", async () => {
    const { store, calls, pending, settle } = harness();
    store.mount("a");
    store.mount("b");
    calls.length = 0;
    store.refresh("a");
    expect(calls).toEqual([]);
    pending[0]!.resolve({ id: "a", v: 1 });
    await settle();
    expect(calls).toEqual(["a"]);
    store.refresh("nobody");
    expect(calls).toEqual(["a"]);
  });

  test("a reader back after leaving mid-read reads at once", () => {
    const { store, calls } = harness();
    const release = store.mount("w1");
    release();
    store.mount("w1");
    expect(calls).toEqual(["w1", "w1"]);
  });

  test("the last reader leaving drops the entry, the pending timer and any answer on its way", async () => {
    const { store, pending, timers, settle } = harness();
    const release = store.mount("w1");
    store.scheduleRefresh();
    release();
    expect(timers[0]!.live).toBe(false);
    pending[0]!.resolve({ id: "w1", v: 1 });
    await settle();
    expect(store.get("w1").loaded).toBe(false);
    release();
    expect(store.mounted()).toEqual([]);
  });

  test("subscribers hear every change", async () => {
    const { store, pending, settle } = harness();
    let heard = 0;
    const off = store.subscribe(() => heard++);
    store.mount("w1");
    pending[0]!.resolve({ id: "w1", v: 1 });
    await settle();
    expect(heard).toBe(1);
    off();
  });
});

describe("the material picks", () => {
  test("a pick is per work item, and quiet when nothing changes", () => {
    const picks = createWorkMaterialPicks();
    let heard = 0;
    picks.subscribe(() => heard++);
    picks.pick("w1", "m1");
    picks.pick("w1", "m1");
    expect(picks.picked("w1")).toBe("m1");
    expect(picks.picked("w2")).toBeNull();
    expect(heard).toBe(1);
  });

  test("Files panels count themselves in; the last one out clears the pick", () => {
    const picks = createWorkMaterialPicks();
    expect(picks.filesShown("w1")).toBe(false);
    const a = picks.showFiles("w1");
    const b = picks.showFiles("w1");
    picks.pick("w1", "m1");
    a();
    a();
    expect(picks.filesShown("w1")).toBe(true);
    b();
    expect(picks.filesShown("w1")).toBe(false);
    expect(picks.picked("w1")).toBeNull();
  });
});
