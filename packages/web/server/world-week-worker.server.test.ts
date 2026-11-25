import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorldWeekService } from "./world-week.ts";

test("worker builds coalesce, keep HTTP responsive, cache JSON and enforce preview policy", async () => {
  const home = await mkdtemp(join(tmpdir(), "world-worker-"));
  const previous = process.env.OPENSCOUT_CONTROL_HOME;
  process.env.OPENSCOUT_CONTROL_HOME = home;
  const db = new Database(join(home, "control-plane.sqlite"));
  db.exec(`
    create table invocations (id text, created_at integer, completed_at integer, state text, requester_id text, target_agent_id text, task text, error text);
    create table messages (created_at integer, actor_id text, class text);
    create table actors (id text, kind text, display_name text, metadata_json text);
    create table agents (id text, node_qualifier text, workspace_qualifier text, agent_class text, metadata_json text);
  `);
  const now = Date.now();
  db.transaction(() => {
    const insert = db.query("insert into messages values (?, 'worker', 'work')");
    for (let i = 0; i < 100000; i++) insert.run(now - i);
  })();
  db.close();
  const service = createWorldWeekService({ home });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
  let running = true, probes = 0, max = 0;
  const probe = (async () => {
    while (running) {
      const at = performance.now();
      await (await fetch(server.url)).text();
      max = Math.max(max, performance.now() - at); probes++;
      await Bun.sleep(5);
    }
  })();
  try {
    const [a, b] = await Promise.all([service.json(), service.json()]);
    expect(a).toBe(b);
    expect(JSON.parse(a).msgs).toHaveLength(100000);
    expect(service.metrics().builds).toBe(1);
    expect(await service.json()).toBe(a);
    expect((await service.get()).msgs).toHaveLength(100000);
    expect(await service.allowed()).toEqual(new Set());
    expect(await service.previewable(join(home, "control-plane.sqlite"))).toBeNull();
    expect(probes).toBeGreaterThan(1);
    expect(max).toBeLessThan(1000);
  } finally {
    running = false; await probe; server.stop(true);
    if (previous === undefined) delete process.env.OPENSCOUT_CONTROL_HOME; else process.env.OPENSCOUT_CONTROL_HOME = previous;
    await rm(home, { recursive: true, force: true });
  }
}, 30000);
