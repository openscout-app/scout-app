import { BriefingArchiveUnconfirmedError } from "./scoutbot-briefing-outcome.ts";
import { createHash } from "node:crypto";
import { DEFAULT_BRIEFING_MODEL, isBriefingLunaModel, type BriefingRoutineConfig, type BriefingRoutineResult, type BriefingRoutineRun, type BriefingRoutineState } from "../shared/scoutbot-routines.ts";
import { createScoutbotRoutineOwner, ScoutbotRoutineError } from "./scoutbot-routine-owner.ts";
import { readJsonFile, writeJsonFileDurably } from "./scoutbot/process/durable-json.ts";

type Stored = Omit<BriefingRoutineState, "operation"> & { version: 1; revision: number; pending: { id: string; startedAt: number } | null; recentRuns: BriefingRoutineRun[] };
export function validateBriefingRoutineConfig(value: unknown): BriefingRoutineConfig {
  const c = value as Partial<BriefingRoutineConfig> | null;
  if (!c || typeof c.enabled !== "boolean") throw new ScoutbotRoutineError("Choose whether the briefing routine is enabled.");
  if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 80) throw new ScoutbotRoutineError("Routine name must contain 1–80 characters.");
  if (typeof c.focus !== "string" || c.focus.length > 2000) throw new ScoutbotRoutineError("Briefing focus must be at most 2000 characters.");
  if (!Number.isInteger(c.intervalMinutes) || c.intervalMinutes! < 15 || c.intervalMinutes! > 10080) throw new ScoutbotRoutineError("Choose an interval from 15 minutes to 7 days.");
  if (typeof c.model !== "string" || !isBriefingLunaModel(c.model)) throw new ScoutbotRoutineError("Briefings require GPT-6 Luna or a newer Luna model.");
  return { enabled: c.enabled, name: c.name.trim(), focus: c.focus.trim(), intervalMinutes: c.intervalMinutes!, model: c.model };
}
const idFor = (key: string) => `brf-routine-${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
export function createBriefingRoutine(options: {
  filePath: string;
  now?: () => number;
  generate: (config: BriefingRoutineConfig, id: string) => Promise<BriefingRoutineResult>;
  lookup: (id: string) => Promise<BriefingRoutineResult | null>;
}) {
  const now = options.now ?? Date.now;
  const owner = createScoutbotRoutineOwner({ filePath: options.filePath, now, noun: "briefing", recoverableKinds: ["check", "config", "run"] });
  const read = (): Stored => {
    const value = readJsonFile(options.filePath) as Stored | undefined;
    if (!value) return { version: 1, owner: "personal", revision: 1, config: { enabled: false, name: "My briefing", focus: "Recent progress, blockers, and what to do next.", intervalMinutes: 1440, model: DEFAULT_BRIEFING_MODEL }, nextRunAt: null, paused: false, lastRun: null, pending: null, recentRuns: [] };
    if (value.version !== 1 || value.owner !== "personal") throw new Error("Unsupported personal briefing routine settings.");
    validateBriefingRoutineConfig(value.config);
    return value;
  };
  const save = (s: Stored) => writeJsonFileDurably(options.filePath, s);
  const view = (s: Stored): BriefingRoutineState => ({ owner: "personal", config: s.config, nextRunAt: s.nextRunAt, paused: s.paused, lastRun: s.lastRun });
  const finish = (s: Stored, run: BriefingRoutineRun) => {
    s.lastRun = run; s.pending = null;
    // Skip missed slots after slow/recovered runs; never backfill model calls.
    if (s.config.enabled && !s.paused && s.nextRunAt !== null && s.nextRunAt <= now()) s.nextRunAt = now() + s.config.intervalMinutes * 60_000;
    s.recentRuns = [...s.recentRuns.filter((r) => r.id !== run.id), run].slice(-20); save(s);
  };
  const reconcile = async (s: Stored): Promise<boolean> => {
    if (!s.pending) return false;
    // A prior owner may have archived the result before its final settings write.
    // If it did not, do not spend model quota again on an uncertain occurrence.
    const pending = s.pending;
    let saved: BriefingRoutineResult | null;
    try { saved = await options.lookup(pending.id); }
    catch (error) {
      s.paused = true;
      s.lastRun = { ...pending, finishedAt: now(), status: "interrupted", error: `The previous run cannot be checked in Briefings: ${error instanceof Error ? error.message : String(error)}. No new model call was made.` };
      save(s); return true; // Keep pending until the archive can answer definitively.
    }
    if (saved) { s.paused = false; finish(s, { ...pending, status: "complete", finishedAt: now(), result: saved }); }
    else {
      s.paused = true;
      finish(s, { ...pending, status: "interrupted", finishedAt: now(), error: "The previous run was interrupted. No automatic retry was made. Run now or save the routine to resume its schedule." });
    }
    return true;
  };
  const execute = async (s: Stored, id: string): Promise<BriefingRoutineState> => {
    if (s.recentRuns.some((r) => r.id === id)) return view(s);
    let existing: BriefingRoutineResult | null;
    try { existing = await options.lookup(id); }
    catch (error) {
      s.nextRunAt = s.config.enabled ? now() + s.config.intervalMinutes * 60_000 : null;
      finish(s, { id, startedAt: now(), finishedAt: now(), status: "failed", error: `Briefings cannot be checked: ${error instanceof Error ? error.message : String(error)}. No model call was made.` });
      return view(s);
    }
    if (existing) { finish(s, { id, startedAt: existing.preparedAt, finishedAt: now(), status: "complete", result: existing }); return view(s); }
    const startedAt = now();
    s.paused = false; s.pending = { id, startedAt }; s.lastRun = { id, startedAt, finishedAt: null, status: "running" };
    s.nextRunAt = s.config.enabled ? startedAt + s.config.intervalMinutes * 60_000 : null;
    save(s); // Reserve this occurrence before the model call.
    try {
      const result = await options.generate({ ...s.config }, id);
      if (result.briefId !== id || result.model !== s.config.model) throw new Error("Briefing result did not match the reserved occurrence and Luna model.");
      finish(s, { id, startedAt, finishedAt: now(), status: "complete", result });
    } catch (error) {
      if (error instanceof BriefingArchiveUnconfirmedError) {
        s.paused = true;
        s.lastRun = { id, startedAt, finishedAt: now(), status: "interrupted", error: `${error.message}. The schedule is paused while Scout checks for the saved result; no automatic inference retry will run.` };
        save(s); // Preserve pending for read-only reconciliation, including across restart.
      } else finish(s, { id, startedAt, finishedAt: now(), status: "failed", error: error instanceof Error ? error.message : String(error) });
    }
    return view(s);
  };
  const due = (s: Stored) => s.config.enabled && !s.paused && s.nextRunAt !== null && s.nextRunAt <= now();
  const tick = async () => {
    const preview = read(); if (!preview.pending && !due(preview)) return view(preview);
    return owner.enqueue("run", async () => {
      const s = read();
      if (await reconcile(s)) return view(s);
      if (!due(s)) return view(s);
      return execute(s, idFor(`scheduled:${s.revision}:${s.nextRunAt}`));
    });
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    state: (): BriefingRoutineState => ({ ...view(read()), operation: owner.operation() }),
    configure: (value: unknown) => owner.enqueue("config", async () => {
      const config = validateBriefingRoutineConfig(value); const s = read();
      await reconcile(s);
      if (s.pending) {
        if (config.enabled) throw new ScoutbotRoutineError("The previous briefing must be checked in the archive before its schedule can resume.", 409);
        s.config = config; s.revision += 1; s.paused = true; s.nextRunAt = null; save(s); return view(s);
      }
      const keepNext = s.config.enabled && config.enabled && !s.paused && s.config.intervalMinutes === config.intervalMinutes;
      s.config = config; s.revision += 1; s.paused = false;
      s.nextRunAt = config.enabled ? keepNext && s.nextRunAt !== null ? s.nextRunAt : now() + config.intervalMinutes * 60_000 : null;
      save(s); return view(s);
    }),
    runNow: (requestId: unknown) => {
      if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) return Promise.reject(new ScoutbotRoutineError("Run now requires a stable request ID."));
      return owner.enqueue("run", async () => {
        const s = read(); if (await reconcile(s)) return view(s);
        return execute(s, idFor(`manual:${requestId}`));
      });
    },
    tick,
    start: () => {
      owner.resume();
      if (!timer) { timer = setInterval(() => { void tick().catch(() => {}); }, 60_000); timer.unref(); void tick().catch(() => {}); }
    },
    stop: async () => { if (timer) clearInterval(timer); timer = null; await owner.stop(); },
  };
}
