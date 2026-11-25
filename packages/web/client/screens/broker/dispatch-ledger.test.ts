import { describe, expect, test } from "bun:test";
import type { BrokerDiagnostics, BrokerRouteAttempt } from "../../lib/types.ts";
import {
  createDispatchLedger,
  DISPATCH_REFRESH_COALESCE_MS,
  isDispatchLedgerEvent,
  mergeBrokerPage,
  refreshBrokerPage,
  type DispatchLedgerDeps,
} from "./dispatch-ledger.ts";

function attempt(id: string, ts: number): BrokerRouteAttempt {
  return {
    id,
    kind: "success",
    status: "sent",
    ts,
    actorName: "Arach",
    target: "opus",
    route: "dm",
    detail: id,
    conversationId: null,
    messageId: null,
    deliveryId: null,
    invocationId: null,
    metadata: null,
  };
}

function page(ids: Array<[string, number]>, cursor: string | null, hasMore: boolean): BrokerDiagnostics {
  return {
    generatedAt: 1,
    windowMs: 0,
    ledger: {
      mode: "latest",
      limit: 160,
      cursor: null,
      cursors: { attempts: cursor, failedQueries: null, failedDeliveries: null, dialogue: null },
      hasMore: { attempts: hasMore, failedQueries: false, failedDeliveries: false, dialogue: false },
    },
    totals: {
      successfulDispatches: 0,
      failedQueries: 0,
      failedDeliveries: 0,
      deliveryAttempts: 0,
      failedDeliveryAttempts: 0,
      dialogueMessages: 0,
    },
    rates: { messagesPerHour: 0, failedQueriesPerHour: 0, failedDeliveriesPerHour: 0, failureRate: 0 },
    attempts: ids.map(([id, ts]) => attempt(id, ts)),
    failedQueries: [],
    failedDeliveries: [],
    dialogue: [],
  };
}

const ids = (broker: BrokerDiagnostics | null) => broker?.attempts.map((a) => a.id) ?? [];

/** A fetch whose answers the test hands out by hand, in any order. */
function harness(warm: BrokerDiagnostics | null = null) {
  const calls: Array<{ cursor?: string; resolve: (b: BrokerDiagnostics) => void; reject: (e: Error) => void }> = [];
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const deps: DispatchLedgerDeps = {
    fetch: (cursor) => new Promise((resolve, reject) => calls.push({ cursor, resolve, reject })),
    peek: () => warm,
    setTimer: (run, ms) => {
      const t = { run, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
  };
  const ledger = createDispatchLedger(deps);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { ledger, calls, timers, flush };
}

describe("the dispatch ledger store", () => {
  test("first mount reads once; later mounts share it", async () => {
    const { ledger, calls, flush } = harness();
    const a = ledger.mount();
    const b = ledger.mount();
    expect(calls.length).toBe(1);
    expect(ledger.getState().loading).toBe(true);
    calls[0]!.resolve(page([["a", 3]], "c1", true));
    await flush();
    expect(ids(ledger.getState().broker)).toEqual(["a"]);
    expect(ledger.getState().loading).toBe(false);
    a();
    b();
  });

  test("a recent cached read paints at once, then refreshes in the background", async () => {
    const { ledger, calls, flush } = harness(page([["warm", 1]], null, false));
    // what a reader draws before it mounts is what the mount starts from
    const before = ledger.getState();
    expect(ids(before.broker)).toEqual(["warm"]);
    expect(ledger.getState()).toBe(before);
    ledger.mount();
    expect(ids(ledger.getState().broker)).toEqual(["warm"]);
    expect(ledger.getState().loading).toBe(false);
    expect(ledger.getState().refreshing).toBe(true);
    calls[0]!.resolve(page([["new", 2]], null, false));
    await flush();
    expect(ids(ledger.getState().broker)).toEqual(["new"]);
    expect(ledger.getState().refreshing).toBe(false);
  });

  test("a burst of events is one background read, and none once nobody reads", async () => {
    const { ledger, calls, timers, flush } = harness();
    const release = ledger.mount();
    calls[0]!.resolve(page([["a", 1]], null, false));
    await flush();
    ledger.scheduleRefresh();
    ledger.scheduleRefresh();
    ledger.scheduleRefresh();
    expect(timers.length).toBe(1);
    expect(timers[0]!.ms).toBe(DISPATCH_REFRESH_COALESCE_MS);
    timers[0]!.run();
    expect(calls.length).toBe(2);
    ledger.scheduleRefresh();
    release();
    expect(timers[1]!.cleared).toBe(true);
    ledger.scheduleRefresh();
    expect(timers.length).toBe(2);
  });

  test("a superseded answer is dropped, and the current one clears every flag", async () => {
    const { ledger, calls, flush } = harness();
    ledger.mount();
    calls[0]!.resolve(page([["a", 3], ["b", 2]], "c1", true));
    await flush();
    void ledger.loadOlder();
    expect(ledger.getState().loadingOlder).toBe(true);
    // traffic lands while the older page is out: the refresh supersedes it
    void ledger.load("background");
    calls[1]!.resolve(page([["z", 1]], null, false));
    await flush();
    expect(ids(ledger.getState().broker)).toEqual(["a", "b"]);
    calls[2]!.resolve(page([["c", 4], ["a", 3], ["b", 2]], "c1", true));
    await flush();
    expect(ids(ledger.getState().broker)).toEqual(["c", "a", "b"]);
    // the old screen left Load older spinning here forever
    expect(ledger.getState().loadingOlder).toBe(false);
    expect(ledger.getState().refreshing).toBe(false);
  });

  test("a failed read keeps the page and says why", async () => {
    const { ledger, calls, flush } = harness();
    ledger.mount();
    calls[0]!.resolve(page([["a", 1]], null, false));
    await flush();
    void ledger.load("manual");
    calls[1]!.reject(new Error("broker offline"));
    await flush();
    expect(ids(ledger.getState().broker)).toEqual(["a"]);
    expect(ledger.getState().error).toBe("broker offline");
  });

  test("Load older pages survive a refresh that overlaps them", async () => {
    const { ledger, calls, flush } = harness();
    ledger.mount();
    calls[0]!.resolve(page([["d", 4], ["c", 3]], "c1", true));
    await flush();
    void ledger.loadOlder();
    expect(calls[1]!.cursor).toBe("c1");
    calls[1]!.resolve(page([["b", 2], ["a", 1]], "c2", false));
    await flush();
    expect(ids(ledger.getState().broker)).toEqual(["d", "c", "b", "a"]);
    void ledger.load("background");
    calls[2]!.resolve(page([["e", 5], ["d", 4]], "c0", true));
    await flush();
    const after = ledger.getState().broker!;
    expect(ids(after)).toEqual(["e", "d", "c", "b", "a"]);
    expect(after.ledger.cursors.attempts).toBe("c2");
    expect(after.ledger.hasMore.attempts).toBe(false);
  });

  test("a remount starts fresh, like the screen's own mount did", async () => {
    const { ledger, calls, flush } = harness();
    const release = ledger.mount();
    calls[0]!.resolve(page([["a", 1]], null, false));
    await flush();
    release();
    ledger.mount();
    expect(ledger.getState().broker).toBeNull();
    expect(calls.length).toBe(2);
  });

  test("an answer that lands after the last reader left is dropped", async () => {
    const { ledger, calls, flush } = harness();
    const release = ledger.mount();
    release();
    calls[0]!.resolve(page([["late", 1]], null, false));
    await flush();
    expect(ledger.getState().broker).toBeNull();
  });
});

describe("page merging", () => {
  test("an older page appends to its history only", () => {
    const merged = mergeBrokerPage(page([["b", 2]], "c1", true), page([["a", 1]], "c2", false), "attempts");
    expect(ids(merged)).toEqual(["b", "a"]);
    expect(merged.ledger.cursors.attempts).toBe("c2");
    expect(merged.ledger.hasMore.attempts).toBe(false);
  });

  test("a refresh with nothing in common stands alone: no silent gap", () => {
    const loaded = page([["b", 2], ["a", 1]], "c2", false);
    const next = page([["y", 9], ["x", 8]], "c9", true);
    expect(refreshBrokerPage(loaded, next, true)).toBe(next);
  });

  test("without older pages a refresh simply replaces", () => {
    const loaded = page([["b", 2]], "c1", true);
    const next = page([["c", 3], ["b", 2]], "c1", true);
    expect(refreshBrokerPage(loaded, next, false)).toBe(next);
  });
});

test("the ledger refreshes on message and delivery events, not presence", () => {
  expect(isDispatchLedgerEvent("delivery.state.changed")).toBe(true);
  expect(isDispatchLedgerEvent("scout.dispatched")).toBe(true);
  expect(isDispatchLedgerEvent("presence.updated")).toBe(false);
});
