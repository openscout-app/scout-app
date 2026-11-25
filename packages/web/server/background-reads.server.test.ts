import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteControlPlaneStore } from "@openscout/runtime";
import type { ScoutBrokerContext } from "./core/broker/service.ts";
import { queryBrokerFlightsForWeb } from "./web-flights.ts";
import { createBackgroundReads } from "./background-reads.ts";

test("real read worker preserves run/fleet/session projections, coalesces reads and leaves HTTP responsive", async () => {
  const home = await mkdtemp(join(tmpdir(), "background-reads-"));
  const path = join(home, "control-plane.sqlite");
  const store = new SQLiteControlPlaneStore(path);
  store.upsertNode({ id: "node-1", meshId: "mesh-1", name: "Test", advertiseScope: "local", registeredAt: Date.now() });
  store.upsertActor({ id: "operator", kind: "person", displayName: "Operator" });
  store.upsertActor({ id: "agent-1", kind: "agent", displayName: "Agent" });
  const now = Date.now();
  for (let i = 0; i < 1000; i++) store.recordInvocation({
    id: `inv-${i}`, requesterId: "operator", requesterNodeId: "node-1", targetAgentId: "agent-1", action: "consult",
    task: "inspect ".repeat(1000), ensureAwake: false, stream: false, createdAt: now - i,
  });
  store.recordFlight({ id: "flight-0", invocationId: "inv-0", requesterId: "operator", targetAgentId: "agent-1", state: "running", startedAt: now });
  store.close();
  const reads = createBackgroundReads({ dbPath: path });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
  let running = true, probes = 0, maxMs = 0;
  const probe = (async () => {
    while (running) {
      const at = performance.now(); await (await fetch(server.url)).text();
      probes++; maxMs = Math.max(maxMs, performance.now() - at); await Bun.sleep(5);
    }
  })();
  try {
    const a = reads.runs({ active: false, limit: 3 });
    const b = reads.runs({ active: false, limit: 3 });
    expect(a).toBe(b);
    const [runs, fleet, sessions] = await Promise.all([a, reads.fleet({ limit: 3 }), reads.sessions(3)]);
    expect(runs).toHaveLength(3);
    expect(runs[0].invocationId).toBe("inv-0");
    expect(fleet.generatedAt).toBeGreaterThan(0);
    expect(Array.isArray(sessions)).toBe(true);
    const context = { baseUrl: "http://broker.test", node: { id: "node-1" }, snapshot: {
      nodes: {}, actors: {}, agents: {}, endpoints: {}, conversations: {}, messages: {}, invocations: {}, flights: {},
      // Worker messages support structured clone; the dedupe key must not stringify this snapshot.
      unusedTestCounter: 1n,
    } } as unknown as ScoutBrokerContext;
    const conversations = reads.conversations({}, context);
    expect(reads.conversations({}, context)).toBe(conversations);
    expect(await conversations).toEqual([]);
    const durableFlights = await reads.flights({ activeOnly: false });
    expect(durableFlights.map(flight => flight.id)).toEqual(["flight-0"]);
    context.snapshot.flights = { "flight-0": { id: "flight-0", invocationId: "inv-0", requesterId: "operator", targetAgentId: "agent-1", state: "completed", startedAt: now, completedAt: now + 1 } };
    expect(queryBrokerFlightsForWeb(context, { activeOnly: true }, durableFlights)).toEqual([]);
    expect(await reads.workItems({})).toEqual([]);
    expect(probes).toBeGreaterThan(1);
    expect(maxMs).toBeLessThan(1000);
  } finally { running = false; await probe; server.stop(true); reads.close(); await rm(home, { recursive: true, force: true }); }
}, 30000);

test("worker initialization failures reject all callers instead of hanging", async () => {
  const reads = createBackgroundReads({ dbPath: "/nonexistent/scout-read-test.sqlite" });
  try {
    await expect(reads.runs()).rejects.toThrow();
    // A failed worker is discarded; the next call must reject too, not join an orphaned flight.
    await expect(reads.fleet()).rejects.toThrow();
  } finally { reads.close(); }
}, 10000);


test("a multi-second synchronous read cannot occupy the HTTP event loop", async () => {
  const home = await mkdtemp(join(tmpdir(), "background-block-"));
  const workerPath = join(home, "blocking-worker.ts");
  await writeFile(workerPath, `self.onmessage = event => {
    if (event.data.dbPath) return;
    const until = performance.now() + 1500;
    while (performance.now() < until) {}
    self.postMessage({ id: event.data.id, result: [] });
  };`);
  const reads = createBackgroundReads({ workerUrl: new URL("file://" + workerPath) });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
  let running = true, probes = 0, maxMs = 0;
  const probe = (async () => {
    while (running) {
      const at = performance.now(); await (await fetch(server.url)).text();
      probes++; maxMs = Math.max(maxMs, performance.now() - at); await Bun.sleep(10);
    }
  })();
  try {
    expect(await Promise.all([reads.runs(), reads.flights({}), reads.workItems({})])).toEqual([[], [], []]);
    expect(probes).toBeGreaterThan(20);
    expect(maxMs).toBeLessThan(500);
  } finally { running = false; await probe; server.stop(true); reads.close(); await rm(home, { recursive: true, force: true }); }
}, 10000);
