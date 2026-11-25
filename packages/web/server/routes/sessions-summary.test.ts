import { afterAll, expect, mock, test } from "bun:test";
import { Hono } from "hono";

const calls: Array<{ refId: string; options: unknown }> = [];
mock.module("../core/observe/service.ts", () => ({
  loadSessionRefObservePayload: async (refId: string, options: unknown) => {
    calls.push({ refId, options });
    return { kind: "history", refId, agentId: null, data: { events: [], files: [], summary: { schema: "openscout.session.summary/v1", turns: [] } } };
  },
  loadAgentObservePayload: async () => null,
}));
const actualDb = await import("../db-queries.ts");
mock.module("../db-queries.ts", () => ({
  ...actualDb,
  querySessions: () => [], querySessionById: () => null,
}));
const { mountSessionRoutes } = await import("./sessions.ts");
afterAll(() => mock.restore());
const app = new Hono();
mountSessionRoutes(app, { scoutbot: {} as Parameters<typeof mountSessionRoutes>[1]["scoutbot"] });

test("summary read forwards view/turn count and preserves the session-ref envelope", async () => {
  const response = await app.request("http://localhost/api/session-ref/session:claude:native?view=summary&turns=3");
  expect(response.status).toBe(200);
  expect(calls.at(-1)).toEqual({ refId: "session:claude:native", options: { summary: true, turns: 3 } });
  expect(await response.json()).toMatchObject({ kind: "observe", refId: "session:claude:native", session: null,
    observe: { data: { summary: { schema: "openscout.session.summary/v1" } } } });
});
test("default lookup stays full, summary defaults to 3, and zero turns is supported", async () => {
  await app.request("http://localhost/api/session-ref/session:claude:native");
  expect(calls.at(-1)?.options).toBeUndefined();
  await app.request("http://localhost/api/session-ref/session:claude:native?view=summary");
  expect(calls.at(-1)?.options).toEqual({ summary: true, turns: 3 });
  await app.request("http://localhost/api/session-ref/session:claude:native?view=summary&turns=0");
  expect(calls.at(-1)?.options).toEqual({ summary: true, turns: 0 });
});
test("invalid summary turn budgets fail before observe loading", async () => {
  for (const turns of ["-1", "11", "1.5", "nope", "Infinity"]) {
    const count = calls.length;
    const response = await app.request("http://localhost/api/session-ref/session:claude:native?view=summary&turns=" + turns);
    expect(response.status).toBe(400);
    expect(calls.length).toBe(count);
  }
});
