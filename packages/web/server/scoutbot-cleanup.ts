import { createHash, randomUUID } from "node:crypto";
import { statfs } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createScoutbotRoutineOwner } from "./scoutbot-routine-owner.ts";
import type { CleanupConfig, CleanupCopy, CleanupResult, CleanupReview, CleanupState } from "../shared/scoutbot-routines.ts";
import { readJsonFile, writeJsonFileDurably } from "./scoutbot/process/durable-json.ts";

type Report = { copies: Omit<CleanupCopy, "id">[]; outcomes: CleanupResult["outcomes"] };
type Notice = { id: string; key: string; body: string };
type Stored = CleanupState & { version: 1; noticeKey: string | null; notifiedAt: number; pending: Notice | null };
export class CleanupError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export function validateCleanupConfig(value: unknown): CleanupConfig {
  const c = value as Partial<CleanupConfig> | null;
  if (!c || typeof c.enabled !== "boolean") throw new CleanupError("Choose whether background checks are enabled.");
  if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 80) throw new CleanupError("Routine name must contain 1–80 characters.");
  if (typeof c.repository !== "string" || !isAbsolute(c.repository) || c.repository.length > 4096 || c.repository.includes("\0")) throw new CleanupError("Repository must be an absolute filesystem path.");
  if (!Number.isInteger(c.intervalMinutes) || c.intervalMinutes! < 15 || c.intervalMinutes! > 1440) throw new CleanupError("Check interval must be a whole number from 15 to 1440 minutes.");
  if (typeof c.warningGiB !== "number" || !Number.isFinite(c.warningGiB) || c.warningGiB < 1 || c.warningGiB > 1024) throw new CleanupError("Warning threshold must be from 1 to 1024 GiB.");
  return { enabled: c.enabled, name: c.name.trim(), repository: resolve(c.repository), intervalMinutes: c.intervalMinutes!, warningGiB: c.warningGiB };
}
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
/** Private worktree maintenance is not part of this distribution. */
export async function runCleanupChecker(_repository: string, _protectedPath: string, _plan?: CleanupCopy[]): Promise<Report> {
  throw new CleanupError("Worktree cleanup is not included in the local web app.", 501);
}

export function createCleanupRoutine(options: {
  filePath: string;
  currentDirectory: string;
  now?: () => number;
  inspect?: typeof runCleanupChecker;
  disk?: (path: string) => Promise<{ availableBytes: number; totalBytes: number }>;
  notify?: (notice: { id: string; body: string }) => Promise<void>;
}) {
  const now = options.now ?? Date.now;
  const inspect = options.inspect ?? runCleanupChecker;
  const disk = options.disk ?? (async (path) => {
    const s = await statfs(path);
    return { availableBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
  });
  const defaults = (): Stored => ({ version: 1, config: { enabled: false, name: "Cleanup opportunities", repository: options.currentDirectory,
    intervalMinutes: 60, warningGiB: 15 }, disk: null, review: null, result: null, error: null, notificationError: null, lastAttemptAt: null,
    noticeKey: null, notifiedAt: 0, pending: null });
  const read = (): Stored => {
    const stored = readJsonFile(options.filePath) as Stored | undefined;
    if (!stored) return defaults();
    if (stored.version !== 1) throw new Error("Unsupported routine settings version.");
    validateCleanupConfig(stored.config);
    return stored;
  };
  const save = (state: Stored) => writeJsonFileDurably(options.filePath, state);
  const publicState = (s: Stored): CleanupState => ({ config: s.config, disk: s.disk, review: s.review, result: s.result,
    error: s.error, notificationError: s.notificationError, lastAttemptAt: s.lastAttemptAt });
  const owner = createScoutbotRoutineOwner({ filePath: options.filePath, now, error: (message, status) => new CleanupError(message, status) });
  const { enqueue, operation } = owner;
  const inspectReview = async (state: Stored) => {
    state.disk = null;
    const sample = await disk(state.config.repository);
    const time = now();
    state.disk = { ...sample, checkedAt: time };
    const report = await inspect(state.config.repository, options.currentDirectory);
    state.review = { id: randomUUID(), checkedAt: time, expiresAt: time + 10 * 60_000, repository: state.config.repository,
      ...sample, copies: report.copies.map((copy) => ({ ...copy, id: digest(`${copy.path}\n${copy.head}`) })) };
    state.error = null;
    return state.review;
  };
  const notify = async (state: Stored) => {
    if (!state.config.enabled || !options.notify || !state.disk) return;
    const r = state.disk;
    const eligible = (state.review?.copies ?? []).filter((c) => c.decision === "reap:eligible");
    const pressure = r.availableBytes < state.config.warningGiB * 2 ** 30;
    const critical = r.availableBytes < Math.min(2, state.config.warningGiB) * 2 ** 30;
    const key = pressure || eligible.length ? digest(JSON.stringify([state.config.repository, pressure, critical, !!state.review, eligible.map((c) => c.id).sort()])) : null;
    if (!key) { state.noticeKey = null; state.pending = null; state.notificationError = null; save(state); return; }
    if (state.pending?.key !== key) state.pending = null;
    if (!state.pending && (state.noticeKey === key || (!critical && state.notifiedAt > 0 && now() - state.notifiedAt < 6 * 3_600_000))) return;
    state.pending ??= { id: randomUUID(), key, body: `${state.config.name}: ${(r.availableBytes / 2 ** 30).toFixed(1)} GiB available on this host. ${eligible.length ? `${eligible.length} registered, merged ${eligible.length === 1 ? "copy is" : "copies are"} eligible for review.` : state.review ? "No copies are eligible for retirement." : "Cleanup inventory is unavailable; open the routine for details."}\n[Review cleanup](/settings/scoutbot#routines)` };
    save(state); // Retry the same delivery ID after an uncertain response/restart.
    try {
      await options.notify(state.pending);
      state.noticeKey = key; state.notifiedAt = now(); state.pending = null; state.notificationError = null;
    } catch (e) { state.notificationError = e instanceof Error ? e.message : String(e); }
    save(state);
  };
  const due = (s: Stored) => s.config.enabled && (s.lastAttemptAt === null || now() - s.lastAttemptAt >= s.config.intervalMinutes * 60_000);
  const check = async (scheduled = false): Promise<CleanupState> => {
    // Disabled/not-due ticks never contend with an interactive operation.
    if (scheduled && !due(read())) return Promise.resolve(publicState(read()));
    return enqueue("check", async () => {
      const state = read();
      if (scheduled && !due(state)) return publicState(state);
      state.lastAttemptAt = now(); save(state);
      try { await inspectReview(state); save(state); }
      catch (e) { state.error = e instanceof Error ? e.message : String(e); state.review = null; save(state); }
      await notify(state);
      return publicState(state);
    });
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    state: () => ({ ...publicState(read()), operation: operation() }),
    configure: (value: unknown) => enqueue("config", async () => {
      const config = validateCleanupConfig(value); const state = read();
      state.config = config; state.review = null; state.error = null; state.lastAttemptAt = null; state.notificationError = null; state.disk = null; save(state);
      return publicState(state);
    }),
    check,
    cleanup: (value: unknown) => enqueue("apply", async () => {
      const input = value as { reviewId?: unknown; selectedIds?: unknown } | null;
      const state = read(); const review = state.review;
      if (!review || input?.reviewId !== review.id || review.expiresAt <= now() || review.repository !== state.config.repository) throw new CleanupError("This review expired or changed. Check again before cleanup.", 409);
      if (!Array.isArray(input.selectedIds) || !input.selectedIds.length || input.selectedIds.length > 100 || new Set(input.selectedIds).size !== input.selectedIds.length) throw new CleanupError("Select one to 100 eligible copies.");
      const selected = input.selectedIds.map((id) => review.copies.find((copy) => copy.id === id));
      if (selected.some((copy) => !copy || copy.decision !== "reap:eligible")) throw new CleanupError("Selection includes an unknown or protected copy.");
      owner.annotatePaths(selected.map((copy) => copy!.path));
      // Consume approval durably before destructive work; retries require a new review.
      state.review = null; state.result = null; save(state);
      try {
        const before = await disk(state.config.repository);
        const report = await inspect(state.config.repository, options.currentDirectory, selected as CleanupCopy[]);
        const after = await disk(state.config.repository);
        state.disk = { ...after, checkedAt: now() };
        state.result = { outcomes: report.outcomes, availableBefore: before.availableBytes, availableAfter: after.availableBytes, finishedAt: now() };
        state.error = null; save(state);
      } catch (e) { state.error = `Cleanup could not be confirmed: ${e instanceof Error ? e.message : String(e)} Check again before retrying.`; save(state); }
      return publicState(state);
    }),
    start: () => { owner.resume(); if (!timer) { timer = setInterval(() => { void check(true).catch(() => {}); }, 60_000); timer.unref(); } },
    stop: async () => { if (timer) clearInterval(timer); timer = null; await owner.stop(); },
  };
}
