import { describe, expect, test } from "bun:test";
import type { ActivityItem } from "../../lib/types.ts";
import {
  ACTIVITY_POLL_MS,
  ACTIVITY_REFRESH_COALESCE_MS,
  createActivityFeed,
  type ActivityFeedDeps,
} from "./activity-feed.ts";

const item = (id: string): ActivityItem => ({
  id,
  kind: "message_sent",
  ts: 1,
  actorName: null,
  title: null,
  summary: null,
  conversationId: null,
  workspaceRoot: null,
  agentId: null,
  agentName: null,
  flightId: null,
  invocationId: null,
  sessionId: null,
  messageId: null,
  recordId: null,
});

/** A feed over hand-driven fetches and timers. */
function harness(over: Partial<ActivityFeedDeps> = {}) {
  const fetches: { resolve: (items: ActivityItem[]) => void; reject: (error: Error) => void }[] = [];
  const timers = new Map<number, { run: () => void; ms: number }>();
  let nextTimer = 0;
  let visible = true;
  const feed = createActivityFeed({
    fetch: () => new Promise((resolve, reject) => fetches.push({ resolve, reject })),
    peek: () => null,
    now: () => 1_000,
    visible: () => visible,
    setTimer: (run, ms) => {
      const id = ++nextTimer;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    ...over,
  });
  const fire = (ms: number) => {
    for (const [id, timer] of [...timers]) {
      if (timer.ms !== ms) continue;
      timers.delete(id);
      timer.run();
    }
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { feed, fetches, timers, fire, settle, hide: () => (visible = false) };
}

describe("the shared activity loop", () => {
  test("nothing reads until a reader counts in; the first one reads and starts the poll", async () => {
    const { feed, fetches, timers } = harness();
    expect(fetches).toHaveLength(0);
    expect(feed.get().loading).toBe(true);
    feed.mount();
    expect(fetches).toHaveLength(1);
    expect([...timers.values()].map((timer) => timer.ms)).toEqual([ACTIVITY_POLL_MS]);
  });

  test("two readers share one read and one poll", async () => {
    const { feed, fetches, timers, settle } = harness();
    const a = feed.mount();
    const b = feed.mount();
    expect(fetches).toHaveLength(1);
    expect(timers.size).toBe(1);
    expect(feed.readers()).toBe(2);
    fetches[0]!.resolve([item("x")]);
    await settle();
    expect(feed.get()).toMatchObject({ items: [item("x")], loading: false, refreshing: false, error: null, loadedAt: 1_000 });
    a();
    a(); // twice releases once
    expect(feed.readers()).toBe(1);
    b();
    expect(feed.readers()).toBe(0);
    expect(timers.size).toBe(0);
  });

  test("a superseded answer is dropped", async () => {
    const { feed, fetches, settle } = harness();
    feed.mount();
    void feed.load("manual");
    fetches[1]!.resolve([item("new")]);
    await settle();
    fetches[0]!.resolve([item("old")]);
    await settle();
    expect(feed.get().items).toEqual([item("new")]);
  });

  test("a failed refresh keeps the last good list and says why", async () => {
    const { feed, fetches, settle } = harness();
    feed.mount();
    fetches[0]!.resolve([item("x")]);
    await settle();
    void feed.load("manual");
    expect(feed.get()).toMatchObject({ refreshing: true, loading: false });
    fetches[1]!.reject(new Error("broker down"));
    await settle();
    expect(feed.get()).toMatchObject({ items: [item("x")], error: "broker down", refreshing: false });
  });

  test("with nothing shown, a retry says it is reading; a background read stays quiet", async () => {
    const { feed, fetches, settle } = harness();
    feed.mount();
    fetches[0]!.reject(new Error("down"));
    await settle();
    expect(feed.get()).toMatchObject({ loading: false, error: "down", items: null });
    void feed.load("background");
    expect(feed.get()).toMatchObject({ loading: false, refreshing: true });
    void feed.load("manual");
    expect(feed.get()).toMatchObject({ loading: true, error: null });
  });

  test("a burst of broker events is one read per 250ms, and only while someone reads", async () => {
    const { feed, fetches, fire } = harness();
    feed.scheduleRefresh();
    expect(fetches).toHaveLength(0);
    feed.mount();
    feed.scheduleRefresh();
    feed.scheduleRefresh();
    feed.scheduleRefresh();
    fire(ACTIVITY_REFRESH_COALESCE_MS);
    expect(fetches).toHaveLength(2);
  });

  test("the poll reads every 15s while the window is visible, and skips a hidden tick", () => {
    const { feed, fetches, fire, hide } = harness();
    feed.mount();
    fire(ACTIVITY_POLL_MS);
    expect(fetches).toHaveLength(2);
    hide();
    fire(ACTIVITY_POLL_MS);
    expect(fetches).toHaveLength(2);
  });

  test("the last reader stops the poll and any pending refresh; an answer on its way is for nobody", async () => {
    const { feed, fetches, timers, settle } = harness();
    const release = feed.mount();
    feed.scheduleRefresh();
    expect(timers.size).toBe(2);
    release();
    expect(timers.size).toBe(0);
    fetches[0]!.resolve([item("late")]);
    await settle();
    expect(feed.get().items).toBeNull();
  });

  test("a remount paints the last read at once, then reads again", async () => {
    const { feed, fetches, settle } = harness();
    const release = feed.mount();
    fetches[0]!.resolve([item("x")]);
    await settle();
    release();
    feed.mount();
    expect(feed.get()).toMatchObject({ items: [item("x")], refreshing: true, loading: false });
    expect(fetches).toHaveLength(2);
  });

  test("a cached read under 30s old warms a cold start, once, and the snapshot holds still", () => {
    let peeks = 0;
    const { feed } = harness({ peek: () => (peeks++, [item("cached")]) });
    const first = feed.get();
    expect(first).toMatchObject({ items: [item("cached")], loading: false });
    expect(feed.get()).toBe(first);
    expect(peeks).toBe(1);
  });
});
