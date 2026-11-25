import { describe, expect, test } from "bun:test";
import type { SessionEntry, TailDiscoverySnapshot, TailEvent } from "../../lib/types.ts";
import {
  SESSION_BOARD_EVENT_REFRESH_MS,
  SESSION_BOARD_LIVE_BATCH_MS,
  SESSION_BOARD_POLL_MS,
  SESSION_BOARD_SOURCES_ERROR,
  appendLiveEvents,
  createSessionBoardStore,
  mergeConversations,
  mergeRecentEvents,
  type SessionBoardDeps,
} from "./session-board-store.ts";

const session = (id: string, patch: Partial<SessionEntry> = {}) => ({ id, title: id, ...patch }) as SessionEntry;
const event = (id: string, ts: number, patch: Partial<TailEvent> = {}) => ({ id, ts, sessionId: "s", ...patch }) as TailEvent;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Timers the test runs by hand, and reads that count themselves. */
function harness(over: Partial<SessionBoardDeps> = {}) {
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 0;
  let clock = 1_000;
  const calls = { legacy: 0, conversations: 0, discover: 0, recent: 0, mesh: 0 };
  let visible = true;
  const deps: SessionBoardDeps = {
    legacy: async () => (calls.legacy++, [session("a")]),
    conversations: async () => (calls.conversations++, [session("a", { title: "A from comms" }), session("b")]),
    discover: async () => (calls.discover++, { transcripts: [] } as unknown as TailDiscoverySnapshot),
    recent: async () => (calls.recent++, { events: [event("e1", 10)] }),
    localNode: async () => (calls.mesh++, "node-here"),
    setTimer: (run, ms) => {
      const id = ++next;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
    },
    visible: () => visible,
    now: () => clock,
    ...over,
  };
  const fire = (ms: number) => {
    for (const [id, timer] of [...timers]) {
      if (timer.ms !== ms) continue;
      timers.delete(id);
      timer.run();
    }
  };
  return {
    store: createSessionBoardStore(deps),
    calls,
    timers,
    fire,
    tick: (ms: number) => (clock += ms),
    hide: (hidden: boolean) => (visible = !hidden),
  };
}

describe("the session board store", () => {
  test("the first reader reads every source and the node once; more readers add no reads", async () => {
    const { store, calls } = harness();
    const releases = [store.mount(), store.mount(), store.mount()];
    await flush();
    expect(calls).toEqual({ legacy: 1, conversations: 1, discover: 1, recent: 1, mesh: 1 });
    expect(store.readers()).toBe(3);
    const snap = store.get();
    expect(snap.loading).toBe(false);
    expect(snap.localNodeId).toBe("node-here");
    expect(snap.conversations.map((s) => s.title)).toEqual(["A from comms", "b"]);
    expect(snap.events.map((e) => e.id)).toEqual(["e1"]);
    releases.forEach((release) => release());
  });

  test("one poll for every reader, skipped while hidden, stopped by the last release", async () => {
    const { store, calls, timers, fire, hide } = harness();
    const one = store.mount();
    const two = store.mount();
    await flush();
    expect([...timers.values()].filter((t) => t.ms === SESSION_BOARD_POLL_MS)).toHaveLength(1);
    fire(SESSION_BOARD_POLL_MS);
    await flush();
    expect(calls.recent).toBe(2);
    hide(true);
    fire(SESSION_BOARD_POLL_MS);
    await flush();
    expect(calls.recent).toBe(2);
    one();
    expect(timers.size).toBe(1);
    two();
    expect(timers.size).toBe(0);
  });

  test("a refresh during a read joins it", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { store, calls } = harness({ recent: async () => (await gate, { events: [] }) });
    const done = store.mount();
    const a = store.refresh();
    const b = store.refresh();
    expect(a).toBe(b);
    expect(store.get().reading).toBe(true);
    release();
    await a;
    expect(calls.legacy).toBe(1);
    expect(store.get().reading).toBe(false);
    done();
  });

  test("a failed source keeps its last value and says some sources are unavailable", async () => {
    let fail = false;
    const { store } = harness({
      discover: async () => {
        if (fail) throw new Error("down");
        return { transcripts: [{ sessionId: "t" }] } as unknown as TailDiscoverySnapshot;
      },
    });
    const done = store.mount();
    await flush();
    const before = store.get().discovery;
    expect(store.get().error).toBeNull();
    fail = true;
    await store.refresh();
    expect(store.get().discovery).toBe(before);
    expect(store.get().error).toBe(SESSION_BOARD_SOURCES_ERROR);
    fail = false;
    await store.refresh();
    expect(store.get().error).toBeNull();
    done();
  });

  test("a burst of broker events asks for one read", async () => {
    const { store, calls, fire } = harness();
    const done = store.mount();
    await flush();
    for (let i = 0; i < 20; i++) store.requestRefresh();
    fire(SESSION_BOARD_EVENT_REFRESH_MS);
    await flush();
    expect(calls.recent).toBe(2);
    done();
    // nobody reading: events ask for nothing
    store.requestRefresh();
    fire(SESSION_BOARD_EVENT_REFRESH_MS);
    await flush();
    expect(calls.recent).toBe(2);
  });

  test("a live event passed on by every reader lands once, in one change", async () => {
    const { store, fire } = harness();
    const releases = [store.mount(), store.mount()];
    await flush();
    let changes = 0;
    const off = store.subscribe(() => changes++);
    const live = event("e2", 20);
    store.pushLive(live);
    store.pushLive(live);
    store.pushLive(event("e3", 30));
    expect(changes).toBe(0);
    fire(SESSION_BOARD_LIVE_BATCH_MS);
    expect(changes).toBe(1);
    expect(store.get().events.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    off();
    releases.forEach((release) => release());
  });

  test("what was read stays for the next reader, who reads again", async () => {
    const { store, calls } = harness();
    store.mount()();
    await flush();
    const kept = store.get();
    expect(kept.conversations).toHaveLength(2);
    const again = store.mount();
    expect(store.get().conversations).toBe(kept.conversations);
    await flush();
    expect(calls.recent).toBe(2);
    // the node is known: not asked again
    expect(calls.mesh).toBe(1);
    again();
  });
});

describe("board merges", () => {
  test("conversations lie over the legacy list by id", () => {
    expect(mergeConversations([session("a", { title: "old" }), session("c")], [session("a", { title: "new" })]).map((s) => [s.id, s.title]))
      .toEqual([["a", "new"], ["c", "c"]]);
    expect(mergeConversations(null, [session("b")]).map((s) => s.id)).toEqual(["b"]);
  });

  test("a follow-up to a session never inherits the sender's endpoint or another execution of the same agent", () => {
    const old = session("chat", { harness: "claude", agentId: "sender", sessionId: "first", harnessSessionId: "sender-thread" });
    const current = session("chat", { agentId: "session-2", harness: "codex", sessionId: "second" });
    expect(mergeConversations([old], [current])[0]).toEqual(current);
    expect(mergeConversations([{ ...old, agentId: current.agentId, harness: "codex" }], [current])[0]).toEqual(current);
    expect(mergeConversations([{ ...current, harnessSessionId: "correct-thread" }], [current])[0].harnessSessionId).toBe("correct-thread");
  });

  test("a recent read joins what is held, oldest first, capped", () => {
    const held = [event("x", 5, { summary: "held" })];
    const merged = mergeRecentEvents(held, [event("x", 5), event("y", 1)], 10);
    expect(merged.map((e) => e.id)).toEqual(["y", "x"]);
    expect(merged[1].summary).toBe("held");
    expect(mergeRecentEvents([], [event("a", 1), event("b", 2), event("c", 3)], 2).map((e) => e.id)).toEqual(["b", "c"]);
  });

  test("live events append, each replacing its older copy", () => {
    const current = [event("a", 1), event("b", 2)];
    expect(appendLiveEvents(current, [event("a", 3)]).map((e) => e.id)).toEqual(["b", "a"]);
    expect(appendLiveEvents(current, [])).toBe(current);
    expect(appendLiveEvents(current, [event("c", 3)], 2).map((e) => e.id)).toEqual(["b", "c"]);
  });
});
