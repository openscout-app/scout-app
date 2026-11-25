import { constants } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { safeComputerId as safeId } from "../shared/api/computer-use.ts";
import type { ComputerActivity, ComputerRun, ComputerRunState, ComputerStep } from "../shared/api/computer-use.ts";

type RecordValue = Record<string, unknown>;
const record = (v: unknown): RecordValue => typeof v === "object" && v !== null && !Array.isArray(v) ? v as RecordValue : {};
const timestamp = (v: unknown) => typeof v === "string" ? Date.parse(v) : NaN;
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
const MAX_RUNS = 40;
const MAX_STEPS = 64;
const fresh = (at: number, now: number) => at <= now && now - at < 90_000; // Action's drive idle expiry.

async function jsonFile(path: string, limit: number): Promise<unknown> {
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.size > limit) throw new Error("Record too large");
    const data = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await fd.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    return JSON.parse(data.toString("utf8", 0, offset));
  } finally { await fd.close(); }
}

function state(value: unknown, at: number, now: number): ComputerRunState {
  switch (value) {
    case "done": case "ok": case "success": case "completed": case "succeeded": return "Completed";
    case "failed": case "error": return "Failed";
    case "expired": case "cancelled": case "canceled": case "aborted": case "stopped": return "Cancelled";
    case "paused": return "Paused";
    case "driving": case "running": case "preflight": case "completing": return fresh(at, now) ? "Active" : "Last seen";
    default: return "Last seen";
  }
}

const actionKinds: Record<string, string> = {
  click: "Click", type: "Type text", "press-key": "Press key", "focus-window": "Focus window",
  "open-app": "Open app", drag: "Drag", scroll: "Scroll", "start-recording": "Start recording",
  "stop-recording": "Stop recording", "show-cue": "Show cue", "wait-for-condition": "Wait for condition",
  press: "Press", setValue: "Set value", screenshot: "Take screenshot",
};
const nativeSteps: Record<string, string> = {
  "run.created": "Run created", "run.completed": "Run completed", "run.failed": "Run failed",
  "computer.clicked": "Clicked", "computer.axPressed": "Pressed control", "computer.axElementAction": "Used control",
  "computer.keySent": "Sent key", "computer.dragged": "Dragged", "computer.typed": "Typed text",
  "computer.axElementTyped": "Entered text", "computer.scrolled": "Scrolled", "computer.focused": "Focused window",
  "capture.screenshot.saved": "Saved screenshot", "capture.screenshot.failed": "Screenshot failed",
  "capture.recording.started": "Started recording", "capture.recording.stopRequested": "Requested recording stop",
};
function labelOf(table: Record<string, string>, key: unknown) {
  return typeof key === "string" && Object.hasOwn(table, key) ? table[key] : undefined;
}
function actionStep(e: RecordValue): string | undefined {
  switch (e.type) {
    case "action.recorded": {
      const action = record(e.entry);
      const op = labelOf(actionKinds, record(action.action).kind) ?? "Action";
      return ["planned", "started", "completed", "failed"].includes(String(action.status)) ? op + " · " + action.status : op;
    }
    case "drive.act_tier": return (labelOf(actionKinds, e.actionKind) ?? "Computer interaction") + " · requested";
    case "drive.lease_began": return "Agent took control";
    case "drive.lease_ended": return "Control ended";
    case "drive.lease_released": return "Agent released control";
    case "drive.lease_expired": return "Control expired";
    case "observation.recorded": return "Observed screen";
    case "target.resolved": return "Located target";
    case "artifact.registered": return "Recorded artifact";
    case "session.state_changed": return typeof e.to === "string" && ["created", "preflight", "ready", "running", "paused", "completing", "completed", "failed", "cancelled"].includes(e.to) ? "Session · " + e.to : undefined;
  }
}
function projectSteps(input: unknown, source: "Action" | "Lattices"): ComputerStep[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap(value => {
    const e = record(value);
    const at = timestamp(source === "Action" ? e.at : e.time);
    const label = source === "Action" ? actionStep(e) : labelOf(nativeSteps, e.kind);
    return label && Number.isFinite(at) ? [{ at, label }] : [];
  }).sort((a, b) => a.at - b.at);
}

function projectLattices(value: unknown): { run: ComputerRun; steps: ComputerStep[] }[] {
  if (!Array.isArray(value)) throw new Error("Invalid Lattices index");
  return value.flatMap(raw => {
    const r = record(raw);
    const startedAt = timestamp(r.startedAt);
    if (!safeId(r.id) || !Number.isFinite(startedAt)) return [];
    const events = projectSteps(r.trace, "Lattices");
    const updatedAt = timestamp(r.completedAt) || events.at(-1)?.at || startedAt;
    // Run titles and trace data may contain operator input. Derive the display from the operation actually recorded.
    const operation = events.find(e => !["Run created", "Run completed", "Run failed", "Focused window"].includes(e.label));
    const run: ComputerRun = { id: "lattices/" + r.id, source: "Lattices", title: operation?.label ?? "Computer run",
      state: state(r.state, updatedAt, updatedAt), startedAt, updatedAt };
    return [{ run, steps: events }];
  }).sort((a, b) => b.run.updatedAt - a.run.updatedAt);
}

export function computerActivityReader(support = join(homedir(), "Library/Application Support")) {
  const actionRoot = join(support, "Action");
  const runsFile = join(support, "Lattices/Runs/runs.json");
  let cache: {version: string; rows: ReturnType<typeof projectLattices>} | undefined;
  return async (selected: string | null = null, now = Date.now(), before?: number, through?: number): Promise<ComputerActivity> => {
    const issues = new Set<string>();
    const result: ComputerActivity = { runs: [], steps: [], omittedSteps: 0, issues: [] };
    function page(events: ComputerStep[]) {
      const future = through === undefined ? -1 : events.findIndex(step => step.at > through);
      const end = Math.min(before ?? events.length, future < 0 ? events.length : future);
      result.omittedSteps = Math.max(0, end - MAX_STEPS);
      result.steps = events.slice(result.omittedSteps, end);
    }
    const actions = new Map<string, ComputerRun>();
    async function entries(path: string) {
      try { return await readdir(path, { withFileTypes: true }); }
      catch (e) { if (!missing(e)) issues.add("Action records could not be read."); return []; }
    }
    const sessionsDir = join(actionRoot, "sessions");
    const leasesDir = join(actionRoot, "runtime/drive/leases");
    const [sessions, leases] = selected?.startsWith("lattices/") ? [[], []] : await Promise.all([entries(sessionsDir), entries(leasesDir)]);
    // The producer names session folders by mode and timestamp. Read metadata in small batches.
    const directories = sessions.filter(e => e.isDirectory() && safeId(e.name) && (!selected || selected === "action/" + e.name));
    for (let start = 0; start < directories.length; start += 12) {
      await Promise.all(directories.slice(start, start + 12).map(async entry => {
        try {
          const s = record(await jsonFile(join(sessionsDir, entry.name, "session.json"), 2_000_000));
          const drive = record(s.drive);
          const startedAt = timestamp(drive.startedAt) || timestamp(s.createdAt);
          const updatedAt = timestamp(drive.releasedAt) || timestamp(drive.lastActAt) || timestamp(s.updatedAt) || startedAt;
          if (s.id !== entry.name || !Number.isFinite(startedAt)) return;
          actions.set(entry.name, { id: "action/" + entry.name, source: "Action",
            title: drive.leaseId ? "Computer drive" : s.mode === "inspection" ? "Screen inspection" : "Capture session",
            startedAt, updatedAt,
            state: state(drive.outcome ?? drive.status ?? s.state, updatedAt, now) });
        } catch (e) { if (!missing(e)) issues.add("Some Action sessions could not be read."); }
      }));
    }
    for (const f of leases.filter(e => e.isFile() && e.name.endsWith(".json"))) {
      try {
        const file = record(await jsonFile(join(leasesDir, f.name), 128_000));
        const lease = record(file.lease ?? file);
        const id = lease.sessionId;
        const at = timestamp(lease.lastActAt);
        const startedAt = timestamp(lease.startedAt);
        if (!safeId(id) || (selected && selected !== "action/" + id) || !Number.isFinite(startedAt) || lease.status !== "driving" || lease.releasedAt || !fresh(at, now)) continue;
        const existing = actions.get(id);
        if (existing && existing.updatedAt > at) continue;
        actions.set(id, { id: "action/" + id, source: "Action", title: "Computer drive",
          state: "Active", startedAt, updatedAt: at });
      } catch (e) { if (!missing(e)) issues.add("Some Action leases could not be read."); }
    }
    const actionRows = [...actions.values()].sort((a,b) => b.updatedAt - a.updatedAt).slice(0, MAX_RUNS);
    result.runs.push(...actionRows);
    const openRun = actionRows.find(r => r.id === selected);
    if (openRun && directories.some(d => openRun.id === "action/" + d.name)) {
      const dir = join(sessionsDir, openRun.id.slice("action/".length));
      const events: ComputerStep[] = [];
      for (const file of ["trace.json", "drive-trace.json"]) {
        try { events.push(...projectSteps(await jsonFile(join(dir, file), 16_000_000), "Action")); }
        catch (e) { if (!missing(e)) issues.add("Some Action steps could not be read."); }
      }
      events.sort((a,b) => a.at - b.at);
      page(events);
    }
    if (!selected?.startsWith("action/")) try {
      const info = await stat(runsFile);
      const version = [info.ino, info.mtimeMs, info.size].join("/");
      if (cache?.version !== version) cache = { version, rows: projectLattices(await jsonFile(runsFile, 32_000_000)) };
      for (const { run, steps } of selected ? cache.rows.filter(row => row.run.id === selected) : cache.rows.slice(0, MAX_RUNS)) {
        result.runs.push(run.state === "Active" && !fresh(run.updatedAt, now) ? { ...run, state: "Last seen" } : run);
        if (run.id === selected) page(steps);
      }
    } catch (e) { if (!missing(e)) issues.add("Lattices runs could not be read."); }
    result.runs.sort((a,b) => Number(b.state === "Active") - Number(a.state === "Active") || b.updatedAt - a.updatedAt);
    result.issues = [...issues];
    return result;
  };
}
