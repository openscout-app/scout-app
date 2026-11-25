import { describe, expect, test } from "bun:test";
import type { FleetState } from "../../lib/types.ts";
import { createHomeFeed, HOME_CLOCK_EVERY_MS, HOME_GAUGES_EVERY_MS, HOME_TAIL_EVERY_MS, homeFleetPath, type HomeFeedDeps } from "./home-feed.ts";
import { LOOKBACK_WINDOWS } from "./home-derive.ts";

/*
 * The Home feed is one store for every Home panel on a view and for
 * HomeContent: these hold it to "two panels never read twice".
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const fleetOf = (tag: string) => ({ tag, activity: [], asks: [] }) as unknown as FleetState;
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(overrides: Partial<HomeFeedDeps> = {}, cache: Record<string, unknown> = {}) {
  const calls = { fleet: [] as string[], heartrate: 0, gauges: [] as boolean[], tail: 0, discover: 0 };
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 1;
  const nets = { started: 0, stopped: 0 };
  const listeners = { activated: 0, focus: 0 };
  const deps: HomeFeedDeps = {
    fetchFleet: async (query) => {
      calls.fleet.push(query);
      return fleetOf(`fleet-${calls.fleet.length}`);
    },
    fetchHeartrate: async () => {
      calls.heartrate += 1;
      return { windowLabel: "trailing 7d", bucketLabel: "3h buckets", buckets: [] };
    },
    fetchGauges: async (force) => {
      calls.gauges.push(force);
      return [];
    },
    fetchTailRecent: async () => {
      calls.tail += 1;
      return [];
    },
    fetchTailDiscovery: async () => {
      calls.discover += 1;
      return { transcripts: [], processes: [] } as never;
    },
    peek: <T,>(path: string) => (cache[path] as T | undefined) ?? null,
    retry: (_label, read) => read(),
    rememberedLookback: () => undefined,
    now: () => 1_000_000,
    visible: () => true,
    active: () => true,
    setInterval: (run, ms) => {
      const id = nextTimer++;
      timers.set(id, { run, ms });
      return id;
    },
    clearInterval: (handle) => void timers.delete(handle as number),
    watchBroker: () => {
      nets.started += 1;
      return { onEvent: () => {}, stop: () => void (nets.stopped += 1) };
    },
    onActivated: () => {
      listeners.activated += 1;
      return () => void (listeners.activated -= 1);
    },
    onFocus: () => {
      listeners.focus += 1;
      return () => void (listeners.focus -= 1);
    },
    ...overrides,
  };
  return { feed: createHomeFeed(deps), calls, timers, nets, listeners };
}

describe("the Home feed", () => {
  test("two readers share one set of reads, timers and one broker net", async () => {
    const h = harness();
    const a = h.feed.mount();
    const b = h.feed.mount();
    await flush();
    expect(h.calls.fleet.length).toBe(1);
    expect(h.calls.heartrate).toBe(1);
    expect(h.calls.gauges).toEqual([false]);
    expect(h.calls.tail).toBe(1);
    expect(h.nets.started).toBe(1);
    expect([...h.timers.values()].map((t) => t.ms).sort((x, y) => x - y)).toEqual(
      [HOME_CLOCK_EVERY_MS, HOME_TAIL_EVERY_MS, HOME_GAUGES_EVERY_MS].sort((x, y) => x - y),
    );
    expect(h.feed.readers()).toBe(2);
    a();
    b();
  });

  test("the last reader leaving stops every timer, listener and the net; a second release counts once", async () => {
    const h = harness();
    const a = h.feed.mount();
    const b = h.feed.mount();
    await flush();
    a();
    a();
    expect(h.feed.readers()).toBe(1);
    expect(h.timers.size).toBe(3);
    b();
    expect(h.feed.readers()).toBe(0);
    expect(h.timers.size).toBe(0);
    expect(h.nets.stopped).toBe(1);
    expect(h.listeners).toEqual({ activated: 0, focus: 0 });
  });

  test("a new visit reads again from the start", async () => {
    const h = harness();
    h.feed.mount()();
    await flush();
    const release = h.feed.mount();
    await flush();
    expect(h.calls.fleet.length).toBe(2);
    expect(h.nets.started).toBe(2);
    release();
  });

  test("a warm start paints from a recent read and is not loading", () => {
    // the auto window starts on the narrowest with nothing remembered
    const h = harness({}, { [homeFleetPath(LOOKBACK_WINDOWS[0]!.value)]: fleetOf("warm") });
    const state = h.feed.get();
    expect((state.fleet as unknown as { tag: string }).tag).toBe("warm");
    expect(state.loading).toBe(false);
  });

  test("a superseded fleet answer is dropped", async () => {
    const first = deferred<FleetState>();
    const second = deferred<FleetState>();
    const queue = [first, second];
    const h = harness({ fetchFleet: () => queue.shift()!.promise });
    const release = h.feed.mount();
    const later = h.feed.load("manual");
    second.resolve(fleetOf("newer"));
    await later;
    first.resolve(fleetOf("older"));
    await flush();
    expect((h.feed.get().fleet as unknown as { tag: string }).tag).toBe("newer");
    release();
  });

  test("broker events during a read keep its answer and add one read after it", async () => {
    const first = deferred<FleetState>();
    const second = deferred<FleetState>();
    const queue = [first, second];
    let reads = 0;
    const h = harness({ fetchFleet: () => { reads += 1; return queue.shift()!.promise; } });
    const release = h.feed.mount();
    void h.feed.load("background");
    void h.feed.load("background");
    expect(reads).toBe(1);
    first.resolve(fleetOf("first"));
    await flush();
    // the first answer is drawn, not dropped
    expect((h.feed.get().fleet as unknown as { tag: string }).tag).toBe("first");
    expect(reads).toBe(2);
    second.resolve(fleetOf("second"));
    await flush();
    expect((h.feed.get().fleet as unknown as { tag: string }).tag).toBe("second");
    expect(reads).toBe(2);
    release();
  });

  test("a failed fleet read keeps the last good fleet and says why", async () => {
    let fail = false;
    const h = harness({
      fetchFleet: async () => {
        if (fail) throw new Error("broker offline");
        return fleetOf("good");
      },
    });
    const release = h.feed.mount();
    await flush();
    fail = true;
    await h.feed.load("background");
    const state = h.feed.get();
    expect((state.fleet as unknown as { tag: string }).tag).toBe("good");
    expect(state.error).toContain("broker offline");
    release();
  });

  test("a window pick reads the fleet again once, for every panel", async () => {
    const h = harness();
    const a = h.feed.mount();
    const b = h.feed.mount();
    await flush();
    h.feed.setLookbackPick(LOOKBACK_WINDOWS[2]!.value);
    await flush();
    expect(h.calls.fleet.length).toBe(2);
    expect(h.calls.fleet[1]).toContain(`activityLookbackMs=${LOOKBACK_WINDOWS[2]!.value}`);
    // the same pick again is no change
    h.feed.setLookbackPick(LOOKBACK_WINDOWS[2]!.value);
    await flush();
    expect(h.calls.fleet.length).toBe(2);
    a();
    b();
  });

  test("the last reader leaving forgets the visit's window picks", async () => {
    const h = harness();
    const release = h.feed.mount();
    h.feed.setLookbackPick(LOOKBACK_WINDOWS[0]!.value);
    h.feed.setMovingPick("4h");
    await flush();
    release();
    expect(h.feed.get().lookbackPick).toBeNull();
    expect(h.feed.get().movingPick).toBeNull();
  });

  test("Refresh reads the fleet and forces every provider's quotas", async () => {
    const h = harness();
    const release = h.feed.mount();
    await flush();
    h.feed.refresh();
    await flush();
    expect(h.calls.fleet.length).toBe(2);
    expect(h.calls.gauges).toEqual([false, true]);
    release();
  });
});
