import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installScoutApiMiddleware } from "../server-core.ts";
import { createCleanupRoutine } from "../scoutbot-cleanup.ts";
import { mountCleanupRoutineRoutes } from "./scoutbot-routines.ts";
const directories: string[] = [];
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
test("routine API inherits operator and origin checks, validates input and surfaces checker failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "routine-api-test-")); directories.push(dir);
  const routine = createCleanupRoutine({ filePath: join(dir, "settings.json"), currentDirectory: "/repo", disk: async () => ({ availableBytes: 1, totalBytes: 100 }), inspect: async () => { throw new Error("checker unavailable"); } });
  const app = new Hono();
  installScoutApiMiddleware(app, "routine-test", { authToken: "operator-token", resolvePeerAddress: () => "127.0.0.1" });
  mountCleanupRoutineRoutes(app, routine);
  const url = "http://127.0.0.1/api/scoutbot/routines/cleanup";
  const request = (suffix: string, body?: unknown, headers: Record<string, string> = {}) => app.request(url + suffix, {
    method: body === undefined ? "GET" : "POST", headers: { authorization: "Bearer operator-token", "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect((await request("", undefined, { authorization: "Bearer stranger" })).status).toBe(401);
  expect((await request("/check", {}, { origin: "https://evil.invalid" })).status).toBe(403);
  expect((await request("/config", { enabled: true })).status).toBe(400);
  const check = await request("/check", {});
  expect(check.status).toBe(200); expect((await check.json()).error).toBe("checker unavailable");
  expect((await request("/apply", { reviewId: "unknown", selectedIds: ["path"] })).status).toBe(409);
});

test("personal briefing API requires operator access and stable model-run IDs", async () => {
  const { createBriefingRoutine } = await import("../scoutbot-briefing-routine.ts");
  const { mountBriefingRoutineRoutes } = await import("./scoutbot-briefing-routine.ts");
  const dir = mkdtempSync(join(tmpdir(), "briefing-api-test-")); directories.push(dir);
  let calls = 0;
  const routine = createBriefingRoutine({ filePath: join(dir, "settings.json"), lookup: async () => null,
    generate: async (config, id) => { calls++; return { briefId: id, title: config.name, model: config.model, preparedAt: Date.now() }; },
  });
  const app = new Hono(); installScoutApiMiddleware(app, "briefing-test", { authToken: "operator-token", resolvePeerAddress: () => "127.0.0.1" }); mountBriefingRoutineRoutes(app, routine);
  const url = "http://127.0.0.1/api/scoutbot/routines/briefings";
  const request = (suffix: string, body?: unknown, headers: Record<string, string> = {}) => app.request(url + suffix, { method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer operator-token", "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  expect((await request("/run", { requestId: "no-permission-request" }, { authorization: "Bearer stranger" })).status).toBe(401);
  expect((await request("/run", { requestId: "cross-origin-request" }, { origin: "https://evil.invalid" })).status).toBe(403);
  expect((await request("/run", {})).status).toBe(400); expect(calls).toBe(0);
  const state = await (await request("")).json(); expect(state.owner).toBe("personal"); expect(state.config.model).toBe("gpt-6-luna");
  expect((await request("/config", { ...state.config, model: "gpt-5.6-luna" })).status).toBe(400);
  const result = await (await request("/run", { requestId: "one-personal-briefing" })).json(); expect(result.lastRun.status).toBe("complete");
  await request("/run", { requestId: "one-personal-briefing" }); expect(calls).toBe(1);
});
