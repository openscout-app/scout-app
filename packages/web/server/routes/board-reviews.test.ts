import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ScoutBrokerHttpError } from "@openscout/runtime/broker-api";
import { installScoutApiMiddleware, type ScoutApiTrustOptions } from "../server-core.ts";
import { mountBoardReviewRoutes } from "./board-reviews.ts";

const token = "review-operator-fixture";
const connectionId = "board-one";
const channel = "scout/work";
const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

function setup(peer = "127.0.0.1", answer: (path: string) => unknown = () => ({ ok: true })) {
  const app = new Hono();
  const trust: ScoutApiTrustOptions = { authToken: token, resolvePeerAddress: () => peer };
  const calls: Array<{ path: string; body: unknown }> = [];
  installScoutApiMiddleware(app, "board-review-test", { ...trust, memberAccess: () => true });
  mountBoardReviewRoutes(app, trust, async (path, body) => {
    calls.push({ path, body });
    return answer(path);
  });
  return { calls, request: (path: string, init?: RequestInit) => app.request(`http://localhost/api/manual-review/${path}`, init) };
}

describe("local Board reviews through the operator web UI", () => {
  test("forwards only the chosen room and the exact preview pins", async () => {
    const { calls, request } = setup();
    const listing = await request("board-routines?connectionId=board-one&channel=scout%2Fwork", { headers: auth });
    expect(listing.status).toBe(200);
    expect(listing.headers.get("cache-control")).toBe("no-store");
    const routine = { connectionId, channel, id: "reviewer", name: "API reviewer", projectPath: "/project", harness: "codex", enabled: true, expectedVersion: 0 };
    const item = { routineId: routine.id, itemId: "task-12" };
    const run = { ...item, requestId: "run-1", routineVersion: 2, inputVersion: "8", revision: "a".repeat(40) };
    for (const [path, body] of [["board-routines", routine], ["board-preview", item], ["board-runs", run]] as const) {
      expect((await request(path, { method: "POST", headers: auth, body: JSON.stringify(body) })).status).toBe(200);
    }
    expect(calls).toEqual([
      { path: "/v1/manual-review/board-routines?connectionId=board-one&channel=scout%2Fwork", body: undefined },
      { path: "/v1/manual-review/board-routines", body: routine }, { path: "/v1/manual-review/board-preview", body: item },
      { path: "/v1/manual-review/board-runs", body: run },
    ]);
  });
  test("reopens the pinned run and accepts the work ID from the operator's ticket", async () => {
    const { calls, request } = setup();
    const workId = "work-manual-review-" + "c".repeat(32);
    const lookup = "occurrences?scope=board-review%3Aapi&requestId=run-2";
    expect((await request(lookup, { headers: auth })).status).toBe(200);
    expect((await request("occurrences?scope=generic&requestId=run-2", { headers: auth })).status).toBe(400);
    expect((await request("board-tickets/unrelated", { headers: auth })).status).toBe(404);
    expect((await request(`board-tickets/${workId}`, { headers: auth })).status).toBe(200);
    expect((await request(`board-tickets/${workId}/accept`, { method: "POST", headers: auth })).status).toBe(200);
    expect(calls).toEqual([
      { path: "/v1/manual-review/" + lookup, body: undefined },
      { path: "/v1/manual-review/board-ticket?workId=" + workId, body: undefined },
      { path: "/v1/manual-review/board-accept", body: { workId } },
    ]);
  });
  test("refuses remote peers, forwarded requests and members before invoking the runtime", async () => {
    for (const [peer, headers] of [
      ["192.0.2.24", auth], ["127.0.0.1", { ...auth, "X-Openscout-Forwarded-Node-Id": "peer" }],
      ["127.0.0.1", { "Content-Type": "application/json" }],
    ] as const) {
      const { request, calls } = setup(peer);
      const response = await request("board-preview", { method: "POST", headers, body: JSON.stringify({ routineId: "one", itemId: "two" }) });
      expect([401, 403]).toContain(response.status);
      expect(calls).toHaveLength(0);
    }
  });
  test("preserves a runtime conflict and refuses a client-supplied identity", async () => {
    const reason = { error: "review_stale", detail: "The item was edited." };
    const { request, calls } = setup("127.0.0.1", path => { throw new ScoutBrokerHttpError(409, path, JSON.stringify(reason)); });
    const post = (body: unknown) => request("board-preview", { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect((await post({ routineId: "one", itemId: "two", requestedById: "operator" })).status).toBe(400);
    const reply = await post({ routineId: "one", itemId: "two" });
    expect(reply.status).toBe(409);
    expect(await reply.json()).toEqual({ code: reason.error, detail: reason.detail, error: reason.detail });
    expect(calls).toHaveLength(1);
  });
});
