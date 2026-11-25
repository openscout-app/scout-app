import { afterEach, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computerActivityReader } from "./computer-use.ts";
import { mountComputerUseRoute } from "./routes/computer-use.ts";
import { computerOrigin } from "./core/observe/computer-calls.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const time = (i: number) => new Date(1700000000000 + i * 1000).toISOString();
test("a selected receipt survives the recent list and pages only its own native steps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-native-receipts-")); dirs.push(dir);
  const path = join(dir, "Lattices", "Runs");
  await mkdir(path, { recursive: true });
  const trace = Array.from({ length: 75 }, (_, i) => ({ time: time(i), kind: "computer.clicked", data: "PRIVATE" }));
  const runs = Array.from({ length: 42 }, (_, i) => ({ id: "run-" + i, startedAt: time(100 + i), completedAt: time(100 + i), state: "completed", trace: i === 0 ? trace : [] }));
  await writeFile(join(path, "runs.json"), JSON.stringify(runs));
  const read = computerActivityReader(dir);
  expect((await read()).runs).toHaveLength(40);
  const latest = await read("lattices/run-0");
  expect(latest.runs.map(r => r.id)).toEqual(["lattices/run-0"]);
  expect(latest.omittedSteps).toBe(11);
  expect(latest.steps.length).toBe(64);
  const earlier = await read("lattices/run-0", Date.now(), latest.omittedSteps);
  expect(earlier.steps).toHaveLength(11);
  expect(earlier.steps.at(-1)!.at).toBeLessThan(latest.steps[0]!.at);
  const replay = await read("lattices/run-0", Date.now(), undefined, Date.parse(time(4)));
  expect(replay.steps).toHaveLength(5);
  expect(replay.omittedSteps).toBe(0);
  expect(JSON.stringify(latest)).not.toContain("PRIVATE");
});

test("a lease without a real session directory cannot follow a linked trace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scout-native-receipts-")); dirs.push(dir);
  const sessions = join(dir, "Action/sessions");
  const leases = join(dir, "Action/runtime/drive/leases");
  const elsewhere = join(dir, "other");
  for (const path of [sessions, leases, elsewhere]) await mkdir(path, { recursive: true });
  const at = Date.parse(time(1));
  await symlink(elsewhere, join(sessions, "bad"));
  await writeFile(join(elsewhere, "trace.json"), JSON.stringify([{ at: time(1), type: "observation.recorded" }]));
  await writeFile(join(leases, "a.json"), JSON.stringify({ lease: { sessionId: "bad", status: "driving", startedAt: time(0), lastActAt: time(1) } }));
  const result = await computerActivityReader(dir)("action/bad", at);
  expect(result.runs[0]?.state).toBe("Active");
  expect(result.steps).toEqual([]);
});

test("host, origin and selection are checked before any native file read", async () => {
  const app = new Hono();
  let reads = 0;
  mountComputerUseRoute(app, { resolvePeerAddress: () => "127.0.0.1" }, async () => {
    reads++; return { runs: [], steps: [], issues: [], omittedSteps: 0 };
  });
  const get = (query: string, headers?: Record<string, string>) => app.request("http://localhost/api/computer-use" + query, { headers });
  expect((await get("", { "x-forwarded-for": "203.0.113.2" })).status).toBe(403);
  expect((await get("?run=action/../other")).status).toBe(400);
  expect((await get("?origin=elsewhere&run=action/local")).status).toBe(404);
  expect((await get("?before=4")).status).toBe(400);
  expect(reads).toBe(0);
  const missing = await get("?origin=" + computerOrigin + "&run=action/local");
  expect(missing.status).toBe(404);
  expect(missing.headers.get("cache-control")).toBe("no-store");
  expect(reads).toBe(1);
});
