import { BriefingArchiveUnconfirmedError } from "./scoutbot-briefing-outcome.ts";
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBriefingRoutine, validateBriefingRoutineConfig } from "./scoutbot-briefing-routine.ts";
import type { BriefingRoutineResult } from "../shared/scoutbot-routines.ts";
import { readJsonFile, writeJsonFileDurably } from "./scoutbot/process/durable-json.ts";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "personal-brief-routine-")); dirs.push(directory);
  let time = 1_000_000; let fail = false;
  const calls: { id: string; model: string; focus: string }[] = [];
  const archive = new Map<string, BriefingRoutineResult>();
  const options = { filePath: join(directory, "routine.json"), now: () => time,
    lookup: async (id: string) => archive.get(id) ?? null,
    generate: async (config: { model: string; focus: string; name: string }, id: string) => {
      calls.push({ id, model: config.model, focus: config.focus });
      if (fail) throw new Error("Provider unavailable");
      const saved = { briefId: id, model: config.model, title: config.name, preparedAt: time }; archive.set(id, saved); return saved;
    },
  };
  const routine = createBriefingRoutine(options);
  return { routine, options, archive, calls, advance: (ms: number) => { time += ms; }, fail: () => { fail = true; } };
}
test("personal and off by default; enabling schedules a future Luna run", async () => {
  const f = fixture(); expect(f.routine.state()).toMatchObject({ owner: "personal", config: { enabled: false, model: "gpt-6-luna" }, nextRunAt: null });
  await f.routine.tick(); expect(f.calls).toHaveLength(0);
  const enabled = await f.routine.configure({ ...f.routine.state().config, enabled: true, intervalMinutes: 60 });
  await f.routine.tick(); expect(f.calls).toHaveLength(0); expect(enabled.nextRunAt).toBe(4_600_000);
  f.advance(3_600_000); const result = await f.routine.tick();
  expect(result.lastRun?.status).toBe("complete"); expect(f.calls[0]?.model).toBe("gpt-6-luna");
  await createBriefingRoutine(f.options).tick(); expect(f.calls).toHaveLength(1);
});
test("manual runs work while off and a retried request ID never spends twice", async () => {
  const f = fixture(); const first = await f.routine.runNow("manual-request-one");
  const retry = await createBriefingRoutine(f.options).runNow("manual-request-one");
  expect(first.lastRun).toEqual(retry.lastRun); expect(f.calls).toHaveLength(1); expect(first.nextRunAt).toBeNull();
  expect(f.calls[0]?.focus).toContain("Recent progress");
});
test("two web instances share one scheduled occurrence", async () => {
  const f = fixture(); await f.routine.configure({ ...f.routine.state().config, enabled: true, intervalMinutes: 15 }); f.advance(900_000);
  await Promise.all([f.routine.tick(), createBriefingRoutine(f.options).tick()]); expect(f.calls).toHaveLength(1);
});
test("disabling prevents future runs, and edits preserve an existing due time", async () => {
  const f = fixture(); const first = await f.routine.configure({ ...f.routine.state().config, enabled: true }); f.advance(300_000);
  const edited = await f.routine.configure({ ...first.config, focus: "Blocked work" }); expect(edited.nextRunAt).toBe(first.nextRunAt);
  await f.routine.configure({ ...edited.config, enabled: false }); f.advance(86400_000); await f.routine.tick(); expect(f.calls).toHaveLength(0);
});
test("provider failures are recorded once per interval, without automatic immediate retry", async () => {
  const f = fixture(); await f.routine.configure({ ...f.routine.state().config, enabled: true, intervalMinutes: 15 }); f.fail(); f.advance(900_000);
  expect((await f.routine.tick()).lastRun?.error).toBe("Provider unavailable"); await f.routine.tick(); expect(f.calls).toHaveLength(1);
});
function interrupted(f: ReturnType<typeof fixture>, saved: boolean) {
  const state = f.routine.state();
  writeJsonFileDurably(f.options.filePath, { ...state, config: { ...state.config, enabled: true }, version: 1, revision: 1, pending: { id: "interrupted-occurrence", startedAt: 1 }, recentRuns: [], lastRun: { id: "interrupted-occurrence", startedAt: 1, finishedAt: null, status: "running" } });
  mkdirSync(`${f.options.filePath}.lock`); writeFileSync(`${f.options.filePath}.lock/operation.json`, JSON.stringify({ kind: "run", pid: 99999999, startedAt: 1, token: "old-owner" }));
  if (saved) f.archive.set("interrupted-occurrence", { briefId: "interrupted-occurrence", title: "Already saved", model: "gpt-6-luna", preparedAt: 1 });
}
test("restart recovers an archived result without another model call", async () => {
  const f = fixture(); interrupted(f, true); const recovered = await createBriefingRoutine(f.options).tick();
  expect(recovered.lastRun?.status).toBe("complete"); expect(f.calls).toHaveLength(0);
});
test("uncertain interrupted work pauses until the user explicitly resumes", async () => {
  const f = fixture(); interrupted(f, false); const recovered = await createBriefingRoutine(f.options).tick();
  expect(recovered.paused).toBe(true); expect(recovered.lastRun?.status).toBe("interrupted");
  f.advance(86400_000); await f.routine.tick(); expect(f.calls).toHaveLength(0);
  const retry = await f.routine.runNow("explicit-retry-request"); expect(retry.paused).toBe(false); expect(f.calls).toHaveLength(1);
});
test("only version 6 or newer Luna models and valid personal intervals are accepted", async () => {
  const f = fixture(); const c = f.routine.state().config;
  for (const model of ["gpt-5.6-luna", "gpt-6-sol", "gpt-6.1-astra", "anything"]) expect(() => validateBriefingRoutineConfig({ ...c, model })).toThrow("GPT-6 Luna");
  expect(validateBriefingRoutineConfig({ ...c, model: "gpt-6.1-luna" }).model).toBe("gpt-6.1-luna");
  expect(() => validateBriefingRoutineConfig({ ...c, intervalMinutes: 0 })).toThrow("interval");
  await expect(f.routine.runNow("bad")).rejects.toThrow("stable request ID");
});
test("pending occurrence is durable before inference and cleanup ownership remains separate", async () => {
  const f = fixture(); let reserved = false;
  const routine = createBriefingRoutine({ ...f.options, generate: async (config, id) => {
    const stored = readJsonFile(f.options.filePath) as { pending: { id: string } }; reserved = stored.pending.id === id;
    return f.options.generate(config, id);
  } });
  await routine.runNow("durable-reservation"); expect(reserved).toBe(true);
});

test("archive uncertainty pauses recovery without losing its pending occurrence", async () => {
  const f = fixture(); interrupted(f, false);
  const routine = createBriefingRoutine({ ...f.options, lookup: async () => { throw new Error("Archive unavailable"); } });
  const state = await routine.tick(); expect(state.paused).toBe(true); expect(state.lastRun?.error).toContain("No new model call");
  const stored = readJsonFile(f.options.filePath) as { pending: unknown }; expect(stored.pending).not.toBeNull();
  await routine.runNow("retry-while-archive-down"); expect(f.calls).toHaveLength(0);
  await expect(routine.configure({ ...state.config, enabled: true })).rejects.toThrow("archive");
  expect((await routine.configure({ ...state.config, enabled: false })).config.enabled).toBe(false);
});
test("an unavailable archive prevents a new model run and records the failure", async () => {
  const f = fixture(); const routine = createBriefingRoutine({ ...f.options, lookup: async () => { throw new Error("DB unavailable"); } });
  const result = await routine.runNow("cannot-read-archive"); expect(result.lastRun?.status).toBe("failed"); expect(f.calls).toHaveLength(0);
});

test("a slow run skips missed slots rather than generating catch-up briefs", async () => {
  const f = fixture(); const routine = createBriefingRoutine({ ...f.options, generate: async (config, id) => { f.advance(900_001); return f.options.generate(config, id); } });
  await routine.configure({ ...routine.state().config, enabled: true, intervalMinutes: 15 }); f.advance(900_000);
  await routine.tick(); await routine.tick(); expect(f.calls).toHaveLength(1);
});

test("an unconfirmed archive write preserves its occurrence and prevents later quota spend", async () => {
  const f = fixture(); let attempted = 0;
  const routine = createBriefingRoutine({ ...f.options, generate: async () => { attempted++; throw new BriefingArchiveUnconfirmedError("Archive disk full"); } });
  await routine.configure({ ...routine.state().config, enabled: true, intervalMinutes: 15 }); f.advance(900_000);
  const first = await routine.tick(); expect(first.paused).toBe(true); expect(first.lastRun?.status).toBe("interrupted");
  const stored = readJsonFile(f.options.filePath) as { pending: { id: string } }; expect(stored.pending.id).toBe(first.lastRun!.id);
  f.advance(86400_000); await routine.tick(); await routine.tick(); expect(attempted).toBe(1);
  expect(routine.state().paused).toBe(true);
});
test("an archive-confirmation failure recovers the already saved result without re-inference", async () => {
  const f = fixture(); let attempted = 0;
  const routine = createBriefingRoutine({ ...f.options, generate: async (config, id) => {
    attempted++; await f.options.generate(config, id); throw new BriefingArchiveUnconfirmedError("Read-back interrupted");
  } });
  await routine.runNow("saved-before-readback-failed"); expect(routine.state().paused).toBe(true);
  const recovered = await createBriefingRoutine(f.options).tick();
  expect(recovered.lastRun?.status).toBe("complete"); expect(recovered.paused).toBe(false); expect(attempted).toBe(1); expect(f.calls).toHaveLength(1);
});
