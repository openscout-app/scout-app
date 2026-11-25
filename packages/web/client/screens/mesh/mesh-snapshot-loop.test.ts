import { describe, expect, test } from "bun:test";

import type { MeshStatus } from "../../lib/types.ts";
import { createMeshLoop, MESH_READ_EVERY_MS, MESH_SWEEP_EVERY_MS, type MeshLoopDeps } from "./mesh-snapshot-loop.ts";

/*
 * The Network loop: one /api/mesh read and one sweep for every mesh panel on
 * the page. Timers and fetch are fakes, so the cadence is checked by hand.
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

const mesh = (meshId: string) => ({ meshId }) as unknown as MeshStatus;

function harness() {
  const reads: Deferred<MeshStatus>[] = [];
  const applied: MeshStatus[] = [];
  const intervals = new Map<number, { run: () => void; ms: number }>();
  let nextHandle = 1;
  let sweeps = 0;
  let visible = true;
  let now = 1_000;
  const deps: MeshLoopDeps = {
    fetch: () => {
      const read = deferred<MeshStatus>();
      reads.push(read);
      return read.promise;
    },
    apply: (value) => applied.push(value),
    sweep: () => {
      sweeps += 1;
    },
    now: () => now,
    visible: () => visible,
    setInterval: (run, ms) => {
      const handle = nextHandle++;
      intervals.set(handle, { run, ms });
      return handle;
    },
    clearInterval: (handle) => {
      intervals.delete(handle as number);
    },
  };
  const tick = (ms: number) => {
    for (const timer of [...intervals.values()]) if (timer.ms === ms) timer.run();
  };
  return {
    loop: createMeshLoop(deps),
    reads,
    applied,
    intervals,
    tick,
    sweeps: () => sweeps,
    hide: () => {
      visible = false;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createMeshLoop", () => {
  test("the first reader reads and sweeps at once, then every 10s and 15s", async () => {
    const h = harness();
    const release = h.loop.mount();
    expect(h.reads.length).toBe(1);
    expect(h.sweeps()).toBe(1);
    expect(h.loop.getState().loading).toBe(true);
    expect([...h.intervals.values()].map((timer) => timer.ms).sort((a, b) => a - b)).toEqual([MESH_READ_EVERY_MS, MESH_SWEEP_EVERY_MS]);

    h.reads[0]!.resolve(mesh("a"));
    await settle();
    expect(h.applied).toEqual([mesh("a")]);
    expect(h.loop.getState()).toMatchObject({ loading: false, refreshing: false, error: null, lastLoadedAt: 1_000 });

    h.tick(MESH_READ_EVERY_MS);
    expect(h.reads.length).toBe(2);
    expect(h.loop.getState().refreshing).toBe(true);
    h.tick(MESH_SWEEP_EVERY_MS);
    expect(h.sweeps()).toBe(2);
    release();
  });

  test("more readers share the one loop; the last unmount stops it", () => {
    const h = harness();
    const first = h.loop.mount();
    const second = h.loop.mount();
    expect(h.reads.length).toBe(1);
    expect(h.sweeps()).toBe(1);
    expect(h.intervals.size).toBe(2);
    first();
    first();
    expect(h.intervals.size).toBe(2);
    second();
    expect(h.intervals.size).toBe(0);

    const again = h.loop.mount();
    expect(h.reads.length).toBe(2);
    expect(h.sweeps()).toBe(2);
    again();
  });

  test("a hidden page skips the background read and the sweep", () => {
    const h = harness();
    const release = h.loop.mount();
    h.hide();
    h.tick(MESH_READ_EVERY_MS);
    h.tick(MESH_SWEEP_EVERY_MS);
    expect(h.reads.length).toBe(1);
    expect(h.sweeps()).toBe(1);
    release();
  });

  test("a newer read supersedes an older one", async () => {
    const h = harness();
    const release = h.loop.mount();
    void h.loop.load("manual");
    h.reads[1]!.resolve(mesh("new"));
    await settle();
    h.reads[0]!.resolve(mesh("old"));
    await settle();
    expect(h.applied).toEqual([mesh("new")]);
    release();
  });

  test("a failed read keeps the last snapshot and says why", async () => {
    const h = harness();
    const release = h.loop.mount();
    h.reads[0]!.resolve(mesh("a"));
    await settle();
    h.advance(5_000);
    void h.loop.load("manual");
    expect(h.loop.getState()).toMatchObject({ loading: false, refreshing: true });
    h.reads[1]!.reject(new Error("broker down"));
    await settle();
    expect(h.applied).toEqual([mesh("a")]);
    expect(h.loop.getState()).toMatchObject({ loading: false, refreshing: false, error: "broker down", lastLoadedAt: 1_000 });
    release();
  });

  test("subscribers hear every change", async () => {
    const h = harness();
    let heard = 0;
    const off = h.loop.subscribe(() => {
      heard += 1;
    });
    const release = h.loop.mount();
    h.reads[0]!.resolve(mesh("a"));
    await settle();
    expect(heard).toBeGreaterThanOrEqual(2);
    off();
    release();
  });
});
