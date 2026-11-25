import { expect, test } from "bun:test";
import { Hono } from "hono";
import { SCOUT_RUNTIME_CATALOG } from "@openscout/protocol";
import { mountScoutbotThreadRoutes, type ScoutbotThreadRouteDeps } from "./scoutbot-threads.ts";

test("Scoutbot can use bundled choices when the published catalog is offline", async () => {
  const created: unknown[] = [];
  const app = new Hono();
  mountScoutbotThreadRoutes(app, {
    currentDirectory: "/project",
    readRunnerOptions: async () => { throw new Error("not used"); },
    readRuntimeCatalog: async () => null,
    scoutbot: { runner: { createThread: async (input: unknown) => { created.push(input); return { threadId: "test" }; } } } as unknown as ScoutbotThreadRouteDeps["scoutbot"],
  });
  const response = await app.request("/api/scoutbot/threads", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-6-sol", reasoningEffort: "medium" }),
  });
  expect(response.status).toBe(201);
  expect(created).toEqual([expect.objectContaining({ model: "gpt-6-sol", reasoningEffort: "medium" })]);
});

test("Scoutbot submits a new published model and rejects disabled choices and unsupported effort", async () => {
  const catalog = structuredClone(SCOUT_RUNTIME_CATALOG);
  const codex = catalog.harnesses.find((harness) => harness.id === "codex")!;
  codex.models = codex.models.map((model) => ({ ...model, enabled: false, default: false }));
  codex.models.push({ id: "gpt-published-next", label: "Published Next", enabled: true, default: true, reasoningEfforts: ["high"] });
  const created: unknown[] = [];
  const app = new Hono();
  mountScoutbotThreadRoutes(app, {
    currentDirectory: "/project",
    readRunnerOptions: async () => { throw new Error("not used"); },
    readRuntimeCatalog: async () => ({ catalog, warnings: [] }),
    scoutbot: { runner: { createThread: async (input: unknown) => { created.push(input); return { threadId: "test" }; } } } as unknown as ScoutbotThreadRouteDeps["scoutbot"],
  });
  const request = (model: string, reasoningEffort: string) => app.request("/api/scoutbot/threads", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, reasoningEffort }),
  });
  expect((await request("gpt-6-sol", "medium")).status).toBe(400);
  expect((await request("gpt-published-next", "medium")).status).toBe(400);
  expect(created).toHaveLength(0);
  expect((await request("gpt-published-next", "high")).status).toBe(201);
  expect(created).toEqual([expect.objectContaining({ model: "gpt-published-next", reasoningEffort: "high" })]);
});

function messageApp(post: (input: unknown) => Promise<unknown>) {
  const app = new Hono();
  mountScoutbotThreadRoutes(app, {
    currentDirectory: "/project",
    readRunnerOptions: async () => { throw new Error("not used"); },
    scoutbot: {
      runner: null,
      waitForRunner: async () => ({ postOperatorMessage: post }),
    } as unknown as ScoutbotThreadRouteDeps["scoutbot"],
  });
  return app;
}

function postMessage(app: Hono, body: unknown) {
  return app.request("/api/scoutbot/messages", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

test("Dispatch investigation posts to Scout's default thread without an agent route", async () => {
  const posted: unknown[] = [];
  const app = messageApp(async (input) => {
    posted.push(input);
    return { usedBroker: true, conversationId: "chn-investigation", invokedTargets: [], unresolvedTargets: [] };
  });
  const page = { source: "scout-dispatch-investigate", originalDispatchId: "dispatch:failed-route" };
  const response = await postMessage(app, { body: "Investigate this dispatch", page });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ conversationId: "chn-investigation" });
  expect(posted).toEqual([expect.objectContaining({ threadId: undefined, body: "Investigate this dispatch", page })]);
});

test("an explicit Scout thread is still used and never replaced by the default", async () => {
  const posted: unknown[] = [];
  const app = messageApp(async (input) => {
    posted.push(input);
    return { usedBroker: true, conversationId: "chn-explicit" };
  });
  expect((await postMessage(app, { threadId: "thr-explicit", body: "Follow up" })).status).toBe(200);
  expect(posted).toEqual([expect.objectContaining({ threadId: "thr-explicit" })]);
});

test("an empty default-thread message is rejected before posting", async () => {
  const app = messageApp(async () => { throw new Error("must not post"); });
  expect((await postMessage(app, { body: "  " })).status).toBe(400);
});

test("Scout posting failures stay failures without a generic routing fallback", async () => {
  const app = messageApp(async () => ({ usedBroker: false }));
  const response = await postMessage(app, { body: "Investigate" });
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "broker unreachable" });
});

test("an unknown explicit thread does not fall back to the default", async () => {
  const app = messageApp(async () => { throw new Error("Unknown scoutbot thread thr-missing"); });
  expect((await postMessage(app, { threadId: "thr-missing", body: "Investigate" })).status).toBe(404);
});

for (const threadId of ["", " ", null, 42]) {
  test(`an invalid explicit Scout thread (${JSON.stringify(threadId)}) never posts to the default`, async () => {
    const app = messageApp(async () => { throw new Error("must not post"); });
    expect((await postMessage(app, { threadId, body: "Investigate" })).status).toBe(400);
  });
}

test("a disabled Scout runner reports unavailable instead of routing to an agent", async () => {
  const app = new Hono();
  mountScoutbotThreadRoutes(app, {
    currentDirectory: "/project",
    readRunnerOptions: async () => { throw new Error("not used"); },
    scoutbot: { runner: null, waitForRunner: async () => null } as unknown as ScoutbotThreadRouteDeps["scoutbot"],
  });
  expect((await postMessage(app, { body: "Investigate" })).status).toBe(503);
});
