import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { memoryGuardLimits, MEMORY_GUARD_EXIT_CODE, startMemoryGuard } from "./memory-guard.ts";

const GB = 1024 ** 3;

function rig(dir = mkdtempSync(join(tmpdir(), "memory-guard-"))) {
  const state = { rss: 0.5 * GB, now: 1_000_000, exits: [] as number[], lines: [] as string[] };
  const stop = startMemoryGuard({
    dir, softBytes: 3 * GB, hardBytes: 4 * GB, intervalMs: 5,
    probes: { inFlight: () => ({ total: 2 }), broken: () => { throw new Error("no cache"); } },
    rss: () => state.rss, now: () => state.now,
    exit: (code) => state.exits.push(code), log: (line) => state.lines.push(line),
  });
  const tick = () => Bun.sleep(20);
  return { dir, state, stop, tick };
}

describe("memory guard", () => {
  test("stays quiet under the soft limit", async () => {
    const { state, stop, tick } = rig();
    await tick();
    stop();
    expect(state.lines).toEqual([]);
    expect(state.exits).toEqual([]);
  });

  test("over the soft limit it logs a snapshot at most once a minute, with every probe", async () => {
    const { dir, state, stop, tick } = rig();
    state.rss = 3.2 * GB;
    await tick(); await tick();
    expect(state.lines.length).toBe(1);
    expect(state.lines[0]).toContain("[memory-guard] soft rss=3277MB");
    const snapshot = JSON.parse(state.lines[0].slice(state.lines[0].indexOf("{")));
    expect(snapshot.probes.inFlight).toEqual({ total: 2 });
    expect(snapshot.probes.broken).toEqual({ error: "no cache" });
    state.now += 61_000;
    await tick();
    stop();
    expect(state.lines.length).toBe(2);
    expect(state.exits).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.endsWith("-soft.json")).length).toBe(2);
  });

  test("over the hard limit it notes the snapshot and exits, twice in 30 minutes at most", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-guard-"));
    for (let run = 0; run < 2; run++) {
      const { state, stop, tick } = rig(dir);
      state.rss = 4.5 * GB;
      state.now += run * 60_000;
      await tick();
      stop();
      expect(state.exits[0]).toBe(MEMORY_GUARD_EXIT_CODE);
      expect(state.lines[0]).toContain("[memory-guard] hard-exit");
    }
    // a third time inside the window: stay up and keep logging, rather than restart in a loop
    const { state, stop, tick } = rig(dir);
    state.rss = 4.5 * GB;
    state.now += 3 * 60_000;
    await tick();
    stop();
    expect(state.exits).toEqual([]);
    expect(state.lines[0]).toContain("[memory-guard] hard-held");
  });

  test("a failed exit-history write holds and retries rather than exiting unrecorded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "memory-guard-"));
    const history = join(dir, "memory-guard-exits.json");
    mkdirSync(history); // deterministic EISDIR, even when tests run with elevated permissions
    const { state, stop, tick } = rig(dir);
    try {
      state.rss = 4.5 * GB;
      await tick(); await tick();
      expect(state.exits).toEqual([]);
      expect(state.lines.filter((line) => line.includes("write failed")).length).toBe(1);
      expect(state.lines.some((line) => line.includes("hard-held"))).toBe(true);
      rmSync(history, { recursive: true });
      await tick();
      expect(state.exits).toEqual([MEMORY_GUARD_EXIT_CODE]);
    } finally { stop(); rmSync(dir, { recursive: true, force: true }); }
  });

  test("limits come from the environment, and 0 turns one off", () => {
    expect(memoryGuardLimits({})).toEqual({ softBytes: 3 * GB, hardBytes: 4 * GB });
    expect(memoryGuardLimits({ OPENSCOUT_WEB_MEMORY_SOFT_MB: "2048", OPENSCOUT_WEB_MEMORY_HARD_MB: "0" })).toEqual({ softBytes: 2 * GB, hardBytes: 0 });
    expect(memoryGuardLimits({ OPENSCOUT_WEB_MEMORY_HARD_MB: "lots" }).hardBytes).toBe(4 * GB);
  });
});
