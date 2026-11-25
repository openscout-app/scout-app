/**
 * A session turn read as runs: the agent's own lines stay in the open, and
 * each run of calls between two of them folds to one plain line where it
 * happened ("Edited A.tsx and B.ts +18 −6"). The turn closes with the files
 * it changed.
 *
 * Built on the beats of turn-beats.ts, so a call is the same row everywhere.
 * Nothing here invents a fact: a count shows only when the feed carried it.
 */

import { baseName, commandName, formatSeconds, stepVerb, type TurnBeatsView, type TurnChangedFile, type TurnStepRow } from "./turn-beats.ts";
import { normalizeTimestampMs, type TimestampInput } from "../../lib/time.ts";

/** One stretch of a turn: what the agent said, then the calls it made before it spoke again. */
export type TurnRun = {
  id: string;
  /** The agent's line that opens the run, or null for calls made before it said anything. */
  say: string | null;
  steps: TurnStepRow[];
};

export type RunSummary = {
  /** A plain sentence: "Edited A.tsx and B.ts, ran web:check". */
  text: string;
  add: number;
  del: number;
  /** True while one of its calls failed and no later run of the same call passed. */
  failed: boolean;
  /** True while one of its calls is still running. */
  live: boolean;
};

/** The runs of a turn, in order. A line with no calls after it is a run with no steps. */
export function turnRuns(view: TurnBeatsView): TurnRun[] {
  return view.beats
    .map((beat): TurnRun => ({ id: beat.id, say: beat.say?.text.trim() || null, steps: beat.steps }))
    .filter((run) => run.say || run.steps.length > 0);
}

const isCall = (step: TurnStepRow) => step.family !== "think" && step.family !== "note";

/** "A", "A and B", "A, B and C", "A, B and 2 more". */
export function listNames(names: string[], max = 2): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  if (unique.length <= max + 1 && unique.length <= 3) return `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
  return `${unique.slice(0, max).join(", ")} and ${unique.length - max} more`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function fileNames(steps: TurnStepRow[]): string[] {
  return steps.map((step) => (step.path ? baseName(step.path) : step.target)).filter(Boolean);
}

/** Phrases for one kind of call, in the order they matter: changes, checks, commands, reading. */
function phrases(calls: TurnStepRow[]): string[] {
  const of = (...families: TurnStepRow["family"][]) => calls.filter((step) => families.includes(step.family));
  const out: string[] = [];

  const edits = of("edit");
  if (edits.length) out.push(`edited ${listNames(fileNames(edits))}`);
  const writes = of("write");
  if (writes.length) out.push(`wrote ${listNames(fileNames(writes))}`);

  // Checks and commands share one "ran": named while few, counted past that.
  const checks = of("test", "check");
  const runs = of("run");
  if (checks.length || runs.length) {
    const checkNames = [...new Set(checks.map((step) => commandName(step.title || step.target)))];
    const runNames = runs.length === 1 ? [clip(commandName(runs[0]!.title || runs[0]!.target), 40)] : [];
    const checkPart = checkNames.length <= 2 ? checkNames : [plural(checks.length, "check", "checks")];
    const runPart = runs.length === 1 ? runNames : runs.length > 1 ? [plural(runs.length, "command", "commands")] : [];
    out.push(`ran ${listNames([...checkPart, ...runPart], 3)}`);
  }

  const reads = of("read");
  if (reads.length) out.push(reads.length === 1 ? `read ${fileNames(reads)[0] ?? "a file"}` : `read ${plural(new Set(fileNames(reads)).size || reads.length, "file", "files")}`);

  const searches = of("search", "list");
  if (searches.length) {
    const only = searches[0]!;
    out.push(searches.length === 1
      ? only.family === "list" ? `listed ${clip(only.target, 40)}` : `searched for ${clip(only.target, 40)}`
      : `ran ${plural(searches.length, "search", "searches")}`);
  }

  const fetches = of("fetch");
  if (fetches.length) out.push(fetches.length === 1 ? `fetched ${clip(fetches[0]!.target, 48)}` : `fetched ${plural(fetches.length, "page", "pages")}`);

  const agents = of("agent");
  if (agents.length) out.push(`started ${plural(agents.length, "agent", "agents")}`);

  const asks = of("ask");
  if (asks.length) out.push(asks.length === 1 ? `asked ${asks[0]!.target}` : `asked ${plural(asks.length, "agent", "agents")}`);

  if (of("plan").length) out.push("updated the plan");

  const other = of("other");
  if (other.length) out.push(other.length === 1 ? `called ${clip(toolName(other[0]!), 40)}` : `made ${plural(other.length, "other call", "other calls")}`);
  return out;
}

/** A tool as a person would name it: "mcp__scout__invocations_get" → "scout invocations get". Its argument stays in the row. */
function toolName(step: TurnStepRow): string {
  const tool = step.tool.trim();
  if (!tool) return step.target;
  return tool.replace(/^mcp__/, "").replace(/__/g, " ").replace(/_/g, " ");
}

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A run in one plain line. While a call runs, the line says what it is doing
 * now ("Running web:check"); once done, what the run did, most consequential
 * first, three kinds at most.
 */
export function runSummary(steps: TurnStepRow[]): RunSummary {
  const calls = steps.filter(isCall);
  const edits = calls.filter((step) => step.family === "edit" || step.family === "write");
  const add = edits.reduce((sum, step) => sum + (step.diff?.add ?? 0), 0);
  const del = edits.reduce((sum, step) => sum + (step.diff?.del ?? 0), 0);
  const failed = calls.some((step) => step.state === "fail" && !step.recovered);
  const live = steps.find((step) => step.state === "live") ?? null;

  if (live) {
    const checking = live.family === "test" || live.family === "check";
    const verb = checking ? "Running" : stepVerb(live);
    const target = checking || live.family === "run" ? commandName(live.title || live.target) : live.target;
    const text = live.family === "think" ? "Thinking" : target ? `${verb} ${clip(target, 56)}` : verb;
    return { text, add, del, failed, live: true };
  }

  const parts = phrases(calls);
  const failedOther = calls.filter((step) => step.state === "fail" && !step.recovered).length;
  let shown = parts.slice(0, 3);
  if (parts.length > 3) {
    const rest = calls.length - countFor(calls, 3);
    shown = [...shown, rest > 0 ? `${plural(rest, "other call", "other calls")}` : ""].filter(Boolean);
  }
  if (shown.length === 0) {
    const thought = steps.filter((step) => step.family === "think").reduce((sum, step) => sum + (step.tookS ?? 0), 0);
    if (steps.some((step) => step.family === "think")) shown.push(thought >= 1 ? `thought for ${formatSeconds(thought)}` : "thought");
    else if (steps.length) shown.push(plural(steps.length, "note", "notes"));
  }
  const text = capital(joinPhrases(shown)) + (failedOther ? `, ${failedOther} failed` : "");
  return { text, add, del, failed, live: false };
}

/** How many calls the first `kinds` phrases cover, so the rest can be counted. */
function countFor(calls: TurnStepRow[], kinds: number): number {
  const order: TurnStepRow["family"][][] = [["edit"], ["write"], ["test", "check", "run"], ["read"], ["search", "list"], ["fetch"], ["agent"], ["ask"], ["plan"], ["other"]];
  let covered = 0, used = 0;
  for (const families of order) {
    if (used >= kinds) break;
    const n = calls.filter((step) => families.includes(step.family)).length;
    if (n === 0) continue;
    covered += n;
    used += 1;
  }
  return covered;
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/* ── changed files ──────────────────────────────────────────────────── */

export type ChangedFileRow = {
  path: string;
  name: string;
  /** The file's folder, under the workspace when the path is in it. */
  dir: string;
  /** Null when no edit to the file carried line counts. */
  add: number | null;
  del: number | null;
  file: TurnChangedFile;
};

export type ChangedFilesTable = {
  rows: ChangedFileRow[];
  /** Totals over the files that carried counts; null when none did. */
  add: number | null;
  del: number | null;
};

/** A file's folder as the table shows it: under the workspace when it is in it, home as ~. */
export function fileFolder(path: string, workspaceRoot?: string | null): string {
  const root = workspaceRoot?.replace(/\/+$/, "");
  const inside = Boolean(root && path.startsWith(`${root}/`));
  const relative = inside ? path.slice(root!.length + 1) : path.replace(/^\/Users\/[^/]+/, "~");
  const parts = relative.split("/").slice(0, -1);
  // Outside the workspace, the last three folders say enough; the full path is the row's title.
  if (!inside && parts.length > 4) return `…/${parts.slice(-3).join("/")}`;
  return parts.join("/") || (inside ? "" : ".");
}

/** The turn's changed files, most lines moved first, with their total. */
export function changedFilesTable(view: Pick<TurnBeatsView, "files">, workspaceRoot?: string | null): ChangedFilesTable {
  const rows = [...view.files]
    .sort((a, b) => Number(b.counted) - Number(a.counted) || b.add + b.del - (a.add + a.del))
    .map((file): ChangedFileRow => ({
      path: file.path,
      name: file.name,
      dir: fileFolder(file.path, workspaceRoot),
      add: file.counted ? file.add : null,
      del: file.counted ? file.del : null,
      file,
    }));
  const counted = rows.filter((row) => row.add != null);
  return {
    rows,
    add: counted.length ? counted.reduce((sum, row) => sum + (row.add ?? 0), 0) : null,
    del: counted.length ? counted.reduce((sum, row) => sum + (row.del ?? 0), 0) : null,
  };
}

/* ── the note above the composer ────────────────────────────────────── */

export type SessionComposerNote = { lead: string; text: string };

/**
 * What keeps a message from reaching the session now, from what the page
 * knows: the runtime holding the last message until the host is back, or an
 * agent the runtime reports as not ready. Nothing when neither holds.
 */
export function sessionComposerNote(input: {
  hostName: string | null;
  agentName: string;
  queuedUntilOnline: boolean;
  notReady: boolean;
}): SessionComposerNote | null {
  const host = input.hostName?.trim().replace(/\.local$/i, "") || null;
  if (input.queuedUntilOnline) {
    return {
      lead: `${host ?? "The host"} can't be reached.`,
      text: "Your message waits in the runtime and goes when the host is back.",
    };
  }
  if (input.notReady) {
    return { lead: `${input.agentName} isn't ready.`, text: "Sending will try to wake it." };
  }
  return null;
}

/* ── day separator ──────────────────────────────────────────────────── */

/**
 * The day and time a thread shows where the day changes: "Today 10:12 AM",
 * "Yesterday 9:05 PM", "Monday 10:12 AM" within the week, then "Nov 2, 10:12 AM".
 */
export function sessionDayLabel(value: TimestampInput, nowMs: number = Date.now()): string {
  const at = normalizeTimestampMs(value);
  if (at == null) return "";
  const date = new Date(at);
  const now = new Date(nowMs);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${date.toLocaleDateString([], { weekday: "long" })} ${time}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  return `${date.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" })}, ${time}`;
}
