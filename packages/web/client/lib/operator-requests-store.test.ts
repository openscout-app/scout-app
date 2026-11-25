import { expect, mock, test } from "bun:test";
import type { OperatorAttentionItem, OperatorAttentionState } from "./types.ts";
import type { BrokerEvent } from "./sse.ts";
let calls: string[] = [];
let load: () => Promise<OperatorAttentionState>;
let deliver: ((event: BrokerEvent) => void) | null = null;
mock.module("./api.ts", () => ({ api: (path: string) => { calls.push(path); return load(); } }));
mock.module("./sse.ts", () => ({
  subscribeBrokerEvents: (handler: (event: BrokerEvent) => void) => { deliver = handler; return () => { deliver = null; }; },
  isBrokerEventStreamLive: () => true,
  isBrokerReconcileEvent: (event: BrokerEvent) => event.kind === "unknown" && (event.payload as { reason?: string } | undefined)?.reason === "control_subscription_started",
}));
const { getRequestsSnapshot, holdRequest, receiveRequests, refreshRequests, releaseRequest, settleRequests, subscribeRequests } = await import("./operator-requests-store.ts");
const state = (all: number): OperatorAttentionState => ({ generatedAt: 1, totals: { all, approvals: 0, configuration: 0, collaboration: all }, items: [] });

test("sidebar and page share one in-flight read from the canonical API", async () => {
  calls = [];
  let resolve!: (value: OperatorAttentionState) => void;
  load = () => new Promise(done => { resolve = done; });
  const first = refreshRequests(); const second = refreshRequests();
  expect(first).toBe(second);
  expect(calls).toEqual(["/api/operator-attention"]);
  resolve(state(2)); await first;
  expect(getRequestsSnapshot().state?.totals.all).toBe(2);
});
test("a GET begun before a decision cannot resurrect an already decided item", async () => {
  let resolve!: (value: OperatorAttentionState) => void;
  load = () => new Promise(done => { resolve = done; });
  const stale = refreshRequests();
  receiveRequests(state(0));
  resolve(state(3)); await stale;
  expect(getRequestsSnapshot().state?.totals.all).toBe(0);
});
test("an outage keeps the last known count and records an error instead of false clearing", async () => {
  receiveRequests(state(4));
  load = () => Promise.reject(new Error("Source offline"));
  await refreshRequests();
  expect(getRequestsSnapshot().state?.totals.all).toBe(4);
  expect(getRequestsSnapshot().error).toBe("Source offline");
  expect(getRequestsSnapshot().loading).toBe(false);
});

const permission = (recordId: string) => ({ id: `permission:${recordId}`, kind: "question", title: "Permission request", sourceLabel: "Permission request" }) as OperatorAttentionItem;
const withItems = (...items: OperatorAttentionItem[]): OperatorAttentionState => ({ ...state(items.length), items });
const upserted = (id: string, recordState: string): BrokerEvent => ({ kind: "collaboration.upserted", payload: { record: { id, state: recordState, metadata: { permissionRequest: { sessionId: "s" } } } } }) as unknown as BrokerEvent;
const ids = () => getRequestsSnapshot().state?.items.map(item => item.id);

test("a request settled elsewhere leaves on the runtime's event, and no older read brings it back", async () => {
  receiveRequests(withItems(permission("decided"), permission("waiting")));
  calls = [];
  let resolveStale!: (value: OperatorAttentionState) => void;
  load = () => new Promise(done => { resolveStale = done; });
  const stop = subscribeRequests(() => {});
  expect(calls).toEqual(["/api/operator-attention"]);

  // Decided from a phone: the runtime's record closed. Gone before any read.
  deliver!(upserted("decided", "closed"));
  expect(ids()).toEqual(["permission:waiting"]);

  // The read that began before the decision lands, and so does a lagging server cache.
  resolveStale(withItems(permission("decided"), permission("waiting")));
  await Promise.resolve(); await Promise.resolve();
  expect(ids()).toEqual(["permission:waiting"]);
  receiveRequests(withItems(permission("decided"), permission("waiting")));
  expect(ids()).toEqual(["permission:waiting"]);

  // One fresh read follows the event, past the server's caches.
  load = async () => withItems(permission("waiting"));
  await new Promise(done => setTimeout(done, 300));
  expect(calls).toContain("/api/operator-attention?fresh=1");
  stop();
  expect(deliver).toBeNull();
});

test("an open request event reads fresh without dropping anything; other records are ignored", async () => {
  receiveRequests(withItems(permission("waiting")));
  load = async () => withItems(permission("waiting"));
  const stop = subscribeRequests(() => {});
  await new Promise(done => setTimeout(done, 20));
  load = async () => withItems(permission("waiting"), permission("new"));
  calls = [];
  deliver!({ kind: "collaboration.upserted", payload: { record: { id: "work-1", state: "done", metadata: {} } } } as unknown as BrokerEvent);
  await new Promise(done => setTimeout(done, 300));
  expect(calls).toEqual([]);
  deliver!(upserted("new", "open"));
  expect(ids()).toEqual(["permission:waiting"]);
  await new Promise(done => setTimeout(done, 300));
  expect(calls).toEqual(["/api/operator-attention?fresh=1"]);
  expect(ids()).toEqual(["permission:waiting", "permission:new"]);
  stop();
});

test("a request the operator just decided stays in place until its card lets go, then leaves as settled", () => {
  receiveRequests(withItems(permission("first"), permission("mine"), permission("last")));
  const mine = getRequestsSnapshot().state!.items[1]!;
  holdRequest(mine);
  // The runtime's settle event and a read without it both land while the card still shows the outcome.
  settleRequests(["permission:mine"]);
  receiveRequests(withItems(permission("first"), permission("last")));
  expect(ids()).toEqual(["permission:first", "permission:mine", "permission:last"]);
  releaseRequest("permission:mine");
  expect(ids()).toEqual(["permission:first", "permission:last"]);
});

test("a held request the runtime did not settle stays listed once let go, when the server still lists it", () => {
  receiveRequests(withItems(permission("open")));
  const open = getRequestsSnapshot().state!.items[0]!;
  holdRequest(open);
  releaseRequest("permission:open");
  expect(ids()).toEqual(["permission:open"]);
});
