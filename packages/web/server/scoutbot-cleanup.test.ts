import { afterEach, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as durableJson from "./scoutbot/process/durable-json.ts";
import { createCleanupRoutine, validateCleanupConfig } from "./scoutbot-cleanup.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "scout-routine-test-")); dirs.push(dir);
  let time = 1_000_000;
  let free = 10 * 2 ** 30;
  const invocations: unknown[] = []; const notices: { id: string; body: string }[] = [];
  let failNotify = false; let failInspect = false;
  const copy = { path: "/work/old", head: "abc", branch: "fix", kind: "worktree", mergedIntoMain: true, decision: "reap:eligible", decisionReasons: ["owner requested retirement"] };
  const options = { filePath: join(dir, "routine.json"), currentDirectory: "/work/main", now: () => time,
    disk: async () => ({ availableBytes: free, totalBytes: 100 * 2 ** 30 }),
    inspect: async (_repo: string, _protect: string, plan?: unknown[]) => {
      invocations.push(plan);
      if (failInspect) throw new Error("Python unavailable");
      if (plan) free += 2 ** 30;
      return { copies: [copy, { ...copy, path: "/work/dirty", decision: "keep:dirty" }], outcomes: plan ? [{ path: copy.path, removed: true }] : [] };
    },
    notify: async (notice: { id: string; body: string }) => { notices.push({ ...notice }); if (failNotify) throw new Error("ack lost"); },
  };
  const routine = createCleanupRoutine(options);
  return { routine, options, invocations, notices, copy, advance: (ms: number) => { time += ms; },
    failNotify: () => { failNotify = true; }, recoverNotify: () => { failNotify = false; }, failInspect: () => { failInspect = true; } };
}

test("disabled by default, scheduled checks do no work; manual inspection never deletes or notifies", async () => {
  const f = fixture();
  expect(f.routine.state().config.enabled).toBe(false);
  await f.routine.check(true); expect(f.invocations).toHaveLength(0);
  const state = await f.routine.check();
  expect(state.review?.copies).toHaveLength(2); expect(f.invocations).toEqual([undefined]); expect(f.notices).toHaveLength(0);
});
test("only an unexpired review and eligible opaque selection can delete; approval is consumed", async () => {
  const f = fixture(); const state = await f.routine.check(); const r = state.review!;
  await expect(f.routine.cleanup({ reviewId: r.id, selectedIds: ["/arbitrary/path"] })).rejects.toThrow("unknown or protected");
  await expect(f.routine.cleanup({ reviewId: r.id, selectedIds: [r.copies[1]!.id] })).rejects.toThrow("unknown or protected");
  await expect(f.routine.cleanup({ reviewId: r.id, selectedIds: [r.copies[0]!.id, r.copies[0]!.id] })).rejects.toThrow("Select one");
  const result = await f.routine.cleanup({ reviewId: r.id, selectedIds: [r.copies[0]!.id] });
  expect(result.result?.outcomes[0]?.removed).toBe(true);
  expect(result.result!.availableAfter - result.result!.availableBefore).toBe(2 ** 30);
  expect(result.review).toBeNull();
  expect(f.invocations[1]).toEqual([r.copies[0]]);
  await expect(f.routine.cleanup({ reviewId: r.id, selectedIds: [r.copies[0]!.id] })).rejects.toThrow("expired or changed");
});
test("expiry and configuration changes invalidate approval", async () => {
  const f = fixture(); const r = (await f.routine.check()).review!;
  f.advance(600_001);
  await expect(f.routine.cleanup({ reviewId: r.id, selectedIds: [r.copies[0]!.id] })).rejects.toThrow("expired or changed");
  const next = (await f.routine.check()).review!;
  await f.routine.configure({ ...f.routine.state().config, repository: "/other/repo" });
  await expect(f.routine.cleanup({ reviewId: next.id, selectedIds: [next.copies[0]!.id] })).rejects.toThrow("expired or changed");
  expect(f.invocations.every((plan) => plan === undefined)).toBe(true);
});
test("scheduled checks respect interval; notices dedupe across restarts and byte fluctuations", async () => {
  const f = fixture(); await f.routine.configure({ ...f.routine.state().config, enabled: true });
  await f.routine.check(true); await f.routine.check(true);
  expect(f.invocations).toHaveLength(1); expect(f.notices).toHaveLength(1);
  f.advance(3_600_001); await createCleanupRoutine(f.options).check(true);
  expect(f.invocations).toHaveLength(2); expect(f.notices).toHaveLength(1);
});
test("uncertain notification retries the identical request after restart", async () => {
  const f = fixture(); await f.routine.configure({ ...f.routine.state().config, enabled: true }); f.failNotify();
  expect((await f.routine.check()).notificationError).toBe("ack lost");
  f.recoverNotify(); await createCleanupRoutine(f.options).check();
  expect(f.notices).toHaveLength(2); expect(f.notices[1]).toEqual(f.notices[0]);
});
test("checker failure is visible and clears stale approval", async () => {
  const f = fixture(); await f.routine.check(); f.failInspect();
  const state = await f.routine.check(); expect(state.review).toBeNull(); expect(state.error).toBe("Python unavailable");
});
test("operations in the same process queue instead of colliding", async () => {
  const f = fixture(); let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const routine = createCleanupRoutine({ ...f.options, inspect: async (...args) => { await barrier; return f.options.inspect(...args); } });
  const running = routine.check();
  await Promise.resolve();
  const saving = createCleanupRoutine(f.options).configure({ ...f.routine.state().config, name: "Queued settings" });
  expect(f.routine.state().operation?.state).toBe("running");
  release(); await running; await saving;
  expect(f.routine.state().config.name).toBe("Queued settings");
  expect(f.routine.state().operation).toBeUndefined();
});
test("configuration rejects relative paths, arbitrary types and invalid bounds", () => {
  const c = fixture().routine.state().config;
  for (const patch of [{ repository: "relative" }, { enabled: "true" }, { name: "" }, { intervalMinutes: 0 }, { intervalMinutes: 30.5 }, { warningGiB: NaN }]) {
    expect(() => validateCleanupConfig({ ...c, ...patch })).toThrow();
  }
});

test("disk heads-up still works when the inventory adapter is unavailable", async () => {
  const f = fixture(); await f.routine.configure({ ...f.routine.state().config, enabled: true }); f.failInspect();
  const state = await f.routine.check();
  expect(state.disk?.availableBytes).toBe(10 * 2 ** 30); expect(state.review).toBeNull();
  expect(state.error).toBe("Python unavailable"); expect(f.notices).toHaveLength(1);
  expect(f.notices[0]!.body).toContain("inventory is unavailable");
});

function interruptedLock(file: string, kind: "check" | "config" | "apply", pid = 99999999) {
  mkdirSync(`${file}.lock`);
  writeFileSync(`${file}.lock/operation.json`, JSON.stringify({ pid, kind, startedAt: 1, token: "previous-owner" }));
}
test("dead read-only locks recover, while interrupted cleanup stays visible and protected", async () => {
  const f = fixture(); interruptedLock(f.options.filePath, "check");
  expect(f.routine.state().operation?.state).toBe("interrupted");
  expect((await f.routine.check()).review).not.toBeNull();
  expect(f.routine.state().operation).toBeUndefined();
  interruptedLock(f.options.filePath, "apply");
  expect(f.routine.state().operation?.message).toContain("needs inspection");
  await expect(f.routine.check()).rejects.toThrow("needs inspection");
  expect(f.invocations).toHaveLength(1);
});
test("disabled scheduled ticks do not acquire or disturb an existing operation lock", async () => {
  const f = fixture(); interruptedLock(f.options.filePath, "apply", process.pid);
  await f.routine.check(true);
  expect(f.routine.state().operation?.state).toBe("running");
  await expect(f.routine.check()).rejects.toThrow("cleaning up selected copies");
  expect(f.invocations).toHaveLength(0);
});
test("graceful stop waits for accepted work and refuses new operations", async () => {
  const f = fixture(); let release!: () => void;
  const barrier = new Promise<void>((done) => { release = done; });
  const routine = createCleanupRoutine({ ...f.options, inspect: async (...args) => { await barrier; return f.options.inspect(...args); } });
  const checking = routine.check(); await Promise.resolve();
  const stopping = routine.stop();
  await expect(routine.configure(f.routine.state().config)).rejects.toThrow("stopping");
  release(); await checking; await stopping;
  expect(f.routine.state().operation).toBeUndefined();
});
test("editing routine settings preserves an uncertain notification's stable ID", async () => {
  const f = fixture(); await f.routine.configure({ ...f.routine.state().config, enabled: true }); f.failNotify();
  await f.routine.check();
  await f.routine.configure({ ...f.routine.state().config, intervalMinutes: 30 }); f.recoverNotify();
  await f.routine.check(); expect(f.notices[1]).toEqual(f.notices[0]);
});

test("approved paths remain inspectable in the operation lock during cleanup", async () => {
  const f = fixture(); let observed: string[] | undefined;
  const routine = createCleanupRoutine({ ...f.options, inspect: async (...args) => {
    if (args[2]) observed = routine.state().operation?.paths;
    return f.options.inspect(...args);
  } });
  const r = (await routine.check()).review!;
  await routine.cleanup({ reviewId: r.id, selectedIds: [r.copies[0]!.id] });
  expect(observed).toEqual([r.copies[0]!.path]);
});

test("a full disk during lock initialization leaves no permanent empty lock", async () => {
  const f = fixture(); const original = durableJson.writeJsonFileDurably;
  const write = spyOn(durableJson, "writeJsonFileDurably").mockImplementation((path, value) => {
    if (path.endsWith("operation.json")) throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    return original(path, value);
  });
  try {
    await expect(f.routine.check()).rejects.toThrow("disk full");
    expect(existsSync(`${f.options.filePath}.lock`)).toBe(false);
  } finally { write.mockRestore(); }
  expect((await f.routine.check()).review).not.toBeNull();
});
