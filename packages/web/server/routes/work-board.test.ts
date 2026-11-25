import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mountWorkBoardRoutes, type WorkContinue } from "./work-board.ts";

function app(continueWork: WorkContinue) {
  const a = new Hono();
  mountWorkBoardRoutes(a, continueWork);
  return a;
}

const post = (a: Hono, path: string, body: unknown) =>
  a.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("POST /api/work/:id/continue", () => {
  test("asks the runtime for a successor to the work, with the request id", async () => {
    const calls: Parameters<WorkContinue>[0][] = [];
    const res = await post(app(async (input) => { calls.push(input); return { usedBroker: true, flightId: "flt-1", conversationId: "c-1", targetAgentId: "agent-ada" }; }),
      "/api/work/work-1/continue", { body: "Add the tests.", requestId: "feed-0123456789" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ flightId: "flt-1" });
    // As the runtime's operator actor, not the operator's name: the runtime refuses a follow-up from any other sender.
    expect(calls[0]).toMatchObject({ workId: "work-1", body: "Add the tests.", requestId: "feed-0123456789", senderId: "operator" });
  });

  test("a refusal, an unreachable runtime and a bad body each say so", async () => {
    const refused = await post(app(async () => ({ usedBroker: true, rejected: "unknown_target" })), "/api/work/work-1/continue", { body: "x", requestId: "feed-0123456789" });
    expect(refused.status).toBe(409);
    expect((await refused.json()).error).toContain("unknown_target");
    const down = await post(app(async () => ({ usedBroker: false })), "/api/work/work-1/continue", { body: "x", requestId: "feed-0123456789" });
    expect(down.status).toBe(502);
    const thrown = await post(app(async () => { throw Object.assign(new Error("task work-1 is unfinished"), { status: 400 }); }), "/api/work/work-1/continue", { body: "x", requestId: "feed-0123456789" });
    expect(thrown.status).toBe(400);
    expect((await thrown.json()).error).toContain("unfinished");
    const blank = await post(app(async () => { throw new Error("not called"); }), "/api/work/work-1/continue", { body: "   ", requestId: "feed-0123456789" });
    expect(blank.status).toBe(400);
    const badId = await post(app(async () => { throw new Error("not called"); }), "/api/work/work-1/continue", { body: "x", requestId: "no" });
    expect(badId.status).toBe(400);
  });
});
