import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RoutineOperation } from "../shared/scoutbot-routines.ts";
import { readJsonFile, writeJsonFileDurably } from "./scoutbot/process/durable-json.ts";

export type RoutineOperationKind = "check" | "config" | "apply" | "run";
type Lock = { pid: number; kind: RoutineOperationKind; startedAt: number; token: string; paths?: string[] };
const queues = new Map<string, Promise<void>>();
export class ScoutbotRoutineError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
/** A personal routine's operations share one owner per control-home settings file. */
export function createScoutbotRoutineOwner(options: {
  filePath: string;
  now?: () => number;
  noun?: string;
  recoverableKinds?: RoutineOperationKind[];
  error?: (message: string, status: number) => Error;
}) {
  const now = options.now ?? Date.now;
  const noun = options.noun ?? "cleanup";
  const error = options.error ?? ((message, status) => new ScoutbotRoutineError(message, status));
  const recoverable = options.recoverableKinds ?? ["check", "config"];
  const lockPath = `${options.filePath}.lock`;
  const key = resolve(options.filePath);
  let stopped = false;
  const readLock = (): Lock | null => {
    try {
      const lock = readJsonFile(join(lockPath, "operation.json")) as Lock | undefined;
      return lock && Number.isInteger(lock.pid) && lock.pid > 0 && ["check", "config", "apply", "run"].includes(lock.kind) ? lock : null;
    } catch { return null; }
  };
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; }
    catch (e) { return (e as NodeJS.ErrnoException).code !== "ESRCH"; }
  };
  const operation = (): RoutineOperation | undefined => {
    if (!existsSync(lockPath)) return undefined;
    const lock = readLock(); const running = lock && alive(lock.pid);
    const activity = lock?.kind === "apply" ? "cleaning up selected copies" : lock?.kind === "run" ? "generating your briefing"
      : lock?.kind === "check" ? `checking ${noun === "cleanup" ? "cleanup opportunities" : "your briefing routine"}` : "saving routine settings";
    return { paths: lock?.paths, kind: lock?.kind ?? "unknown", state: running ? "running" : "interrupted",
      message: running ? `Scout is ${activity}.` : lock && recoverable.includes(lock.kind)
        ? lock.kind === "run" ? "An interrupted briefing run will be reconciled before another model call." : "An interrupted check will recover on the next run."
        : `A previous ${noun} needs inspection. Check the selected paths and process before removing the lock at ${lockPath}.` };
  };
  async function locked<T>(kind: RoutineOperationKind, action: () => Promise<T>): Promise<T> {
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    const recoveryPath = `${lockPath}.recovery`;
    if (existsSync(recoveryPath)) throw error("Routine lock recovery is busy or interrupted; inspect " + recoveryPath, 409);
    try { mkdirSync(lockPath, { mode: 0o700 }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const previous = readLock();
      if (!previous || !recoverable.includes(previous.kind) || alive(previous.pid)) throw error(operation()?.message ?? "Another routine operation is busy.", 409);
      try { mkdirSync(recoveryPath, { mode: 0o700 }); }
      catch { throw error("Another process is recovering the interrupted check.", 409); }
      try {
        const latest = readLock();
        if (!latest || latest.token !== previous.token || !recoverable.includes(latest.kind) || alive(latest.pid)) throw error("Routine operation changed; try again shortly.", 409);
        rmSync(lockPath, { recursive: true }); mkdirSync(lockPath, { mode: 0o700 });
      } finally { rmSync(recoveryPath, { recursive: true, force: true }); }
    }
    const owner: Lock = { kind, pid: process.pid, startedAt: now(), token: randomUUID() };
    let initialized = false;
    try {
      writeJsonFileDurably(join(lockPath, "operation.json"), owner); initialized = true;
      return await action();
    } finally {
      const current = readLock();
      if (current?.token === owner.token || (!initialized && current === null)) rmSync(lockPath, { recursive: true, force: true });
    }
  }
  return {
    operation,
    enqueue: <T>(kind: RoutineOperationKind, action: () => Promise<T>): Promise<T> => {
      if (stopped) return Promise.reject(error("Scout is stopping. Try again after restart.", 503));
      const result = (queues.get(key) ?? Promise.resolve()).then(() => locked(kind, action));
      const settled = result.then(() => {}, () => {}); queues.set(key, settled);
      void settled.then(() => { if (queues.get(key) === settled) queues.delete(key); });
      return result;
    },
    annotatePaths: (paths: string[]) => {
      const owner = readLock();
      if (!owner || owner.kind !== "apply" || owner.pid !== process.pid) throw error("Cleanup lock changed. Check again before retrying.", 409);
      writeJsonFileDurably(join(lockPath, "operation.json"), { ...owner, paths });
    },
    resume: () => { stopped = false; },
    stop: async () => {
      stopped = true; const pending = queues.get(key);
      if (pending) {
        let limit: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([pending, new Promise<void>((done) => { limit = setTimeout(done, 5000); })]);
        if (limit) clearTimeout(limit);
      }
    },
  };
}
