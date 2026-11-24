/**
 * A session turn read as beats: the agent's lines lead, and the calls it made
 * after each line sit under that line as quiet rows. The chat thread and the
 * session slot read the same events through this, so a call is the same row
 * in both.
 *
 * Read from observe events alone. Nothing here invents a result: a call fails
 * only when its outcome or its own test counts say so, and a duration shows
 * only where two timestamps bound it.
 */

import { shellCommandFromArg } from "../../lib/code-mode-command.ts";
import { strReplaceDiffFromEdit, strReplaceEditFromObserveEvent } from "../../lib/lane-edit-display.ts";
import { filesFromObserveEvents } from "../../lib/lane-observe.ts";
import { laneToolOutputText, laneToolPartner } from "../../lib/lane-tool-detail.ts";
import { observeToolIsResult } from "../../lib/observe-trace-counts.ts";
import { normalizeTimestampMs } from "../../lib/time.ts";
import type { ObserveEvent } from "../../lib/types.ts";

export type StepFamily =
  | "think" | "search" | "fetch" | "read" | "list" | "edit" | "write"
  | "run" | "check" | "test" | "agent" | "plan" | "ask" | "note" | "other";

export type StepState = "live" | "ok" | "fail";

export type TurnStepRow = {
  id: string;
  family: StepFamily;
  state: StepState;
  /** What the verb acts on: a file name, a pattern, or a command with its paths cut to file names. */
  target: string;
  /** The full argument, for the row's title. */
  title: string;
  /** The one file a read or an edit touched, when the event names exactly one. */
  path: string | null;
  /** The call's output: its own stream, or the output row paired with it. */
  output: string[];
  diff: { add: number; del: number; lines: string[] } | null;
  /** A thought's text, or a note's. */
  text: string | null;
  /** The tool as the harness named it, for a call this reader has no verb for. */
  tool: string;
  atMs: number | null;
  /** Seconds between the call and its paired output, or a thought and what followed it. */
  tookS: number | null;
  /** What a rerun of the same call shares with this one. */
  key: string;
  /** A failed call that a later run of the same call passed. */
  recovered: boolean;
  /** The outcome the feed reported, or "" when it reported none. Only "success" says a call passed. */
  outcome: string;
};

export type TurnBeat = { id: string; say: ObserveEvent | null; steps: TurnStepRow[] };

export type TurnChangedFile = {
  path: string;
  name: string;
  add: number;
  del: number;
  /** False when no edit to the file carried counts, so `add` and `del` say nothing. */
  counted: boolean;
  edits: TurnStepRow[];
};

export type TurnTestRun = {
  step: TurnStepRow;
  /** Null when the output carried no counts this reader knows. */
  pass: number | null;
  fail: number | null;
  failing: string[];
};

export type TurnArtifact =
  | { id: string; kind: "diff"; file: TurnChangedFile }
  | { id: string; kind: "tests"; command: string; name: string; runs: TurnTestRun[] }
  | { id: string; kind: "check"; command: string; name: string; runs: TurnStepRow[] };

export type TurnBeatsView = {
  beats: TurnBeat[];
  steps: TurnStepRow[];
  live: TurnStepRow | null;
  lastSay: ObserveEvent | null;
  calls: number;
  failed: number;
  /** Failed calls no later run has passed. */
  unrecovered: number;
  files: TurnChangedFile[];
  /** Lines added and removed across every edit that carried counts. */
  add: number;
  del: number;
  artifacts: TurnArtifact[];
};

/* ── reading one call ─────────────────────────────────────────────────── */

const SHELL = new Set(["bash", "shell", "terminal", "exec", "run", "command", "exec_command", "shell_command", "local_shell", "container_exec", "container.exec"]);
const READ = new Set(["read", "read_file", "view", "view_file", "view_image", "open_file"]);
const EDIT = new Set(["edit", "multiedit", "strreplace", "str_replace", "str_replace_editor", "str_replace_based_edit_tool", "edit_file", "apply_patch", "patch", "notebookedit"]);
const WRITE = new Set(["write", "write_file", "create", "create_file"]);
const SEARCH = new Set(["grep", "glob", "search", "rg", "find", "codebase_search", "file_search", "grep_search", "web_search", "websearch", "web.run", "web"]);
const FETCH = new Set(["webfetch", "web_fetch", "fetch", "fetch_url"]);
const AGENT = new Set(["agent", "task", "spawn_agent", "subagent"]);
const PLAN = new Set(["todowrite", "todo_write", "update_plan", "todoread", "todo_read"]);

/*
 * A command runs tests or a check when one of its segments starts with a
 * runner. A file that only has "test" or "check" in its name is neither:
 * `tail slack-test.log` reads a log.
 */
const PACKAGE_SCRIPT = String.raw`(?:bun|npm|pnpm|yarn)\s+run\s+[\w:.-]*`;
const TEST_RUNNER = new RegExp(String.raw`^(?:(?:bunx|npx|pnpm\s+(?:exec|dlx))\s+)?(?:(?:bun|npm|pnpm|yarn|deno|cargo|go|swift|dotnet|mix)\s+test\b|${PACKAGE_SCRIPT}test[\w:.-]*|(?:vitest|jest|pytest|mocha|ava)\b|python3?\s+-m\s+pytest\b|playwright\s+test\b|xcodebuild\b.*\stest\b|node\s+(?:\S*\/)?test[\w.-]*\.m?[jt]s\b)`);
const CHECK_RUNNER = new RegExp(String.raw`^(?:(?:bunx|npx|pnpm\s+(?:exec|dlx))\s+)?(?:${PACKAGE_SCRIPT}(?:check|typecheck|lint)[\w:.-]*|(?:tsc|eslint|biome|mypy|pyright|ruff|swiftlint)\b|cargo\s+(?:check|clippy)\b|node\s+(?:\S*\/)?(?:check|typecheck|lint)[\w.-]*\.m?[jt]s\b)`);
const LEADING_CD = /^cd\s+\S+\s*(?:&&|;)\s*/;

/** The commands a shell line chains, without their environment assignments. */
function segments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => segment.trim().replace(/^(?:[A-Za-z_][\w]*=\S*\s+)+/, ""))
    .filter(Boolean);
}

function runnerSegment(command: string, runner: RegExp): string | null {
  return segments(command).find((segment) => runner.test(segment)) ?? null;
}

export const baseName = (path = "") => path.replace(/\/+$/, "").split("/").pop() || path;

/** Words of a shell command, quotes removed. Enough to find a file or a pattern, not a shell. */
function words(command: string): string[] {
  const out: string[] = [];
  let current = "", quote = "", started = false;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\s/.test(char)) {
      if (started || current) out.push(current);
      current = ""; started = false;
      continue;
    }
    current += char; started = true;
  }
  if (started || current) out.push(current);
  return out;
}

/** "cd repo && rg foo" is still one search. A pipe or a chain of real work is a command. */
function simpleCommand(command: string): string | null {
  const one = command.trim().replace(LEADING_CD, "");
  if (/[|;&<>`\n]|\$\(/.test(one)) return null;
  return one;
}

const SEARCH_VALUE_FLAGS = new Set(["-g", "--glob", "-t", "--type", "-T", "--type-not", "-A", "-B", "-C", "-m", "--max-count", "-M", "--max-columns", "--include", "--exclude"]);

function commandShape(command: string): { family: StepFamily; target: string; path: string | null } | null {
  const simple = simpleCommand(command);
  if (!simple) return null;
  const [head = "", ...rest] = words(simple);
  const plain = rest.filter((word) => !word.startsWith("-"));
  if (head === "cat" || head === "nl" || head === "head" || head === "tail" || head === "less" || (head === "sed" && rest[0] === "-n")) {
    const files = plain.filter((word) => !/^\d+(,\d+)?p?$/.test(word) && !/^'?\d+,\d+p'?$/.test(word));
    if (files.length === 0) return null;
    return { family: "read", target: files.map(baseName).slice(0, 2).join(", ") + (files.length > 2 ? ` +${files.length - 2}` : ""), path: files.length === 1 ? files[0]! : null };
  }
  if (head === "rg" || head === "grep" || (head === "git" && rest[0] === "grep")) {
    if (head === "rg" && rest.includes("--files")) return { family: "list", target: plain[0] ? baseName(plain[0]) : ".", path: null };
    const args = head === "git" ? rest.slice(1) : rest;
    const explicit = args.findIndex((word) => word === "-e" || word === "--regexp");
    if (explicit >= 0 && args[explicit + 1]) return { family: "search", target: args[explicit + 1]!, path: null };
    for (let index = 0; index < args.length; index++) {
      const word = args[index]!;
      if (SEARCH_VALUE_FLAGS.has(word)) { index++; continue; }
      if (word.startsWith("-")) continue;
      return { family: "search", target: word, path: null };
    }
    return null;
  }
  if (head === "ls" || head === "find" || head === "tree" || head === "fd") {
    return { family: "list", target: plain[0] ? baseName(plain[0]) : ".", path: null };
  }
  return null;
}

/** A command as a row shows it: one line, paths cut to their file names. The full command is the row's title. */
/** A command's lines without the bodies of its heredocs: `cat > a.ts <<'EOF'` reads as that line, not as the file it writes. */
function commandLines(command: string): string[] {
  const lines: string[] = [];
  let end: string | null = null;
  for (const raw of command.split("\n")) {
    const line = raw.trim();
    if (end !== null) { if (line === end) end = null; continue; }
    if (!line) continue;
    lines.push(line);
    end = line.match(/(?<!<)<<-?\s*(['"]?)([A-Za-z_]\w*)\1/)?.[2] ?? null;
  }
  return lines;
}

export function shortCommand(command: string): string {
  return commandLines(command).join(" ; ")
    .replace(/(?:\.{0,2}\/|~\/)?(?:[\w.@-]+\/)+([\w.@-]+)/g, "$1");
}

/** "bun run web:check" → "web:check"; "tsc --noEmit -p x" → "tsc"; a test file → its file name. */
export function commandName(command: string): string {
  const tests = runnerSegment(command, TEST_RUNNER);
  const segment = tests ?? runnerSegment(command, CHECK_RUNNER) ?? segments(command.replace(LEADING_CD, ""))[0] ?? command;
  // Where the output goes is not what ran.
  const list = words(segment.replace(/\s+\d?>>?.*$/, ""));
  // One named test file names the run; a glob is a pattern, not a name.
  const testFile = tests ? [...list].reverse().find((word) => !/[*?[{]/.test(word) && /(?:[._](?:test|spec)\.\w+|(?:^|\/)test_[\w-]+\.py)$/.test(word)) : undefined;
  if (testFile) return baseName(testFile);
  const trimmed = list.join(" ").replace(/^(?:bun run|bunx|npx|npm run|pnpm run|pnpm|yarn)\s+/, "");
  // A test run over paths or a pattern is named by its runner.
  const parts = trimmed.split(/\s+/).filter((word, index) => index === 0 || !tests || !/[*?[{/]/.test(word));
  const end = parts.findIndex((word) => word.startsWith("-"));
  return parts.slice(0, end < 0 ? Math.min(parts.length, 3) : Math.min(end, 3)).join(" ") || command;
}

function plainToolName(tool: string): string {
  return tool.replace(/^mcp__/, "").replace(/__/g, " ").replace(/_/g, " ");
}

function argOf(event: ObserveEvent): string {
  const arg = (event.arg ?? "").trim();
  return arg === "started" || arg === "completed" ? "" : arg;
}

function singlePath(event: ObserveEvent): string | null {
  const replace = strReplaceEditFromObserveEvent(event);
  if (replace?.path) return replace.path;
  const files = filesFromObserveEvents([event]);
  if (files.length === 1) return files[0]!.path;
  const arg = argOf(event);
  return arg && !/\s/.test(arg) && /[/.]/.test(arg) ? arg : null;
}

function diffOf(event: ObserveEvent): TurnStepRow["diff"] {
  const replace = !event.diff ? strReplaceEditFromObserveEvent(event) : null;
  const diff = event.diff ?? (replace ? strReplaceDiffFromEdit(replace) : undefined);
  if (!diff) return null;
  // An older feed passes an edit's answer ("File created successfully") as its diff: nothing counted, no patch lines.
  if (diff.add + diff.del === 0 && !/^(?:[+-]|@@)/m.test(diff.preview ?? "")) return null;
  const lines = (diff.preview ?? "").split("\n").filter((line) => line && !/^(diff --git|index |\+\+\+ |--- )/.test(line));
  return { add: diff.add, del: diff.del, lines };
}

/** The family, target and key of one call, from its tool and argument. */
function readCall(event: ObserveEvent): Pick<TurnStepRow, "family" | "target" | "title" | "path" | "key"> {
  const tool = (event.tool ?? "").trim();
  const name = tool.toLowerCase();
  const arg = argOf(event);
  if (SHELL.has(name)) {
    const command = shellCommandFromArg(arg || event.text).trim();
    const shape = commandShape(command);
    const key = command.replace(/\s+/g, " ");
    if (shape) return { ...shape, title: command, key: `${shape.family}:${key}` };
    const family: StepFamily = runnerSegment(command, TEST_RUNNER) ? "test" : runnerSegment(command, CHECK_RUNNER) ? "check" : "run";
    return { family, target: shortCommand(command.replace(LEADING_CD, "")), title: command, path: null, key: `run:${key}` };
  }
  if (READ.has(name)) {
    const path = singlePath(event);
    return { family: "read", target: path ? baseName(path) : arg, title: path ?? arg, path, key: `read:${path ?? arg}` };
  }
  if (EDIT.has(name) || WRITE.has(name)) {
    const path = singlePath(event);
    const many = filesFromObserveEvents([event]);
    const target = path ? baseName(path) : many.length > 1 ? `${many.length} files` : shortCommand(arg);
    return { family: WRITE.has(name) ? "write" : "edit", target, title: path ?? (many.map((file) => file.path).join("\n") || arg), path, key: `edit:${path ?? arg}` };
  }
  if (SEARCH.has(name)) {
    const pattern = arg.match(/"([^"]+)"/)?.[1] ?? arg.match(/'([^']+)'/)?.[1] ?? arg;
    return { family: "search", target: pattern, title: arg, path: null, key: `search:${arg}` };
  }
  if (FETCH.has(name)) {
    const url = arg.replace(/^https?:\/\//, "");
    return { family: "fetch", target: url, title: arg, path: null, key: `fetch:${arg}` };
  }
  if (AGENT.has(name)) return { family: "agent", target: arg, title: arg, path: null, key: `agent:${arg}` };
  if (PLAN.has(name)) return { family: "plan", target: "", title: arg, path: null, key: "plan" };
  const label = plainToolName(tool || "tool");
  return { family: "other", target: arg ? `${label} ${arg}` : label, title: arg ? `${tool} ${arg}` : tool, path: null, key: `other:${tool}:${arg}` };
}

/** The words a row leads with. Present tense while live, past once done. */
export function stepVerb(step: Pick<TurnStepRow, "family" | "state" | "tool">): string {
  const live = step.state === "live";
  switch (step.family) {
    case "think": return live ? "Thinking" : "Thought";
    case "search": return live ? "Searching" : "Searched";
    case "fetch": return live ? "Fetching" : "Fetched";
    case "read": return live ? "Reading" : "Read";
    case "list": return live ? "Listing" : "Listed";
    case "edit": return live ? "Editing" : "Edited";
    case "write": return live ? "Writing" : "Wrote";
    case "check":
    case "test": return live ? "Checking" : "Checked";
    case "run": return live ? "Running" : "Ran";
    case "agent": return live ? "Delegating" : "Delegated";
    case "plan": return live ? "Updating the plan" : "Updated the plan";
    case "ask": return "Asked";
    case "note": return "";
    default: return live ? "Calling" : "Called";
  }
}

/* ── test counts ──────────────────────────────────────────────────────── */

const COUNT_PATTERNS: Array<{ pass: RegExp; fail: RegExp }> = [
  // bun: " 12 pass" / " 1 fail"; vitest: "Tests  1 failed | 11 passed (12)"; jest: "Tests: 1 failed, 11 passed, 12 total";
  // pytest: "1 failed, 11 passed in 0.52s"; cargo: "test result: FAILED. 11 passed; 1 failed".
  { pass: /(\d+)\s+pass(?:ed|ing)?\b/i, fail: /(\d+)\s+fail(?:ed|ing|ures?)?\b/i },
];

const FAILING_PATTERNS = [/^\s*\(fail\)\s*(.+)$/, /^\s*(?:FAILED|FAIL)\s+(.+?)(?:\s+-\s+.*)?$/, /^\s*[✕×✗]\s+(.+)$/];

export function testCounts(lines: string[]): { pass: number | null; fail: number | null; failing: string[] } {
  let pass: number | null = null;
  let fail: number | null = null;
  for (const line of lines) {
    for (const pattern of COUNT_PATTERNS) {
      const p = line.match(pattern.pass);
      const f = line.match(pattern.fail);
      if (p) pass = Number(p[1]);
      if (f) fail = Number(f[1]);
    }
  }
  if (pass !== null && fail === null) fail = 0;
  if (fail !== null && pass === null) pass = 0;
  const failing: string[] = [];
  for (const line of lines) {
    for (const pattern of FAILING_PATTERNS) {
      const match = line.match(pattern);
      if (match?.[1] && !/^\d+\s/.test(match[1])) { failing.push(match[1].trim()); break; }
    }
  }
  return { pass, fail, failing: [...new Set(failing)] };
}

/* ── the turn ─────────────────────────────────────────────────────────── */

/** Claude's markup for a call its harness refused or that errored. */
const HARNESS_ERROR = /<\/?tool_use_error>/g;
// Terminal colour codes, with or without the escape a transcript may have dropped.
const TERMINAL_COLOUR = /\u001b?\[[0-9;]*m|\u001b\[[0-9;?]*[A-Za-z]/g;

function outputLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.replace(HARNESS_ERROR, "").replace(TERMINAL_COLOUR, "").trimEnd()).filter((line) => line.length > 0);
}

/**
 * Beats, rows, failures and what the turn made, from a turn's observe events.
 * `running` marks the newest unanswered call as live when the feed has not.
 */
export function readTurnBeats(events: readonly ObserveEvent[], { running }: { running: boolean }): TurnBeatsView {
  const rows: Array<{ row: TurnStepRow; event: ObserveEvent }> = [];
  const beats: TurnBeat[] = [];
  const openStarted = new Map<string, TurnStepRow>();
  const lastWork = [...events].reverse().find((event) => event.kind === "tool" && !observeToolIsResult(event.tool) || event.kind === "think");

  const place = (row: TurnStepRow) => {
    if (beats.length === 0) beats.push({ id: "lead", say: null, steps: [] });
    beats[beats.length - 1]!.steps.push(row);
  };

  for (const [index, event] of events.entries()) {
    const atMs = normalizeTimestampMs(event.at);
    if (event.kind === "message") {
      if (event.text.trim()) beats.push({ id: event.id, say: event, steps: [] });
      continue;
    }
    if (event.kind === "think") {
      const next = events.slice(index + 1).find((later) => normalizeTimestampMs(later.at) != null);
      const nextAt = normalizeTimestampMs(next?.at);
      const live = Boolean(event.live) || (running && event === lastWork && index === events.length - 1);
      const row: TurnStepRow = {
        id: event.id, family: "think", state: live ? "live" : "ok", target: "", title: "", path: null, output: [], diff: null,
        text: event.text.trim() || null, tool: "", atMs, tookS: !live && atMs != null && nextAt != null ? Math.max(0, (nextAt - atMs) / 1000) : null,
        key: `think:${event.id}`, recovered: false, outcome: "",
      };
      rows.push({ row, event });
      place(row);
      continue;
    }
    if (event.kind === "ask") {
      if (!event.to) continue;
      const row: TurnStepRow = {
        id: event.id, family: "ask", state: "ok", target: event.to, title: event.text, path: null, output: event.answer ? [event.answer] : [], diff: null,
        text: event.text, tool: "ask", atMs, tookS: null, key: `ask:${event.id}`, recovered: false, outcome: "",
      };
      rows.push({ row, event });
      place(row);
      continue;
    }
    if (event.kind === "note" || event.kind === "system") {
      if (!event.text.trim()) continue;
      const row: TurnStepRow = {
        id: event.id, family: "note", state: "ok", target: event.text.trim(), title: event.detail ? `${event.text}\n${event.detail}` : event.text, path: null,
        output: [], diff: null, text: event.text, tool: "", atMs, tookS: null, key: `note:${event.id}`, recovered: false, outcome: "",
      };
      rows.push({ row, event });
      place(row);
      continue;
    }
    if (event.kind !== "tool" || observeToolIsResult(event.tool)) continue;

    const toolKey = (event.tool ?? "").toLowerCase();
    // A "completed" row closes the "started" row of the same tool rather than adding a second call.
    if ((event.arg ?? "").trim() === "completed" && openStarted.has(toolKey)) {
      const started = openStarted.get(toolKey)!;
      openStarted.delete(toolKey);
      const outcome = event.result?.outcome;
      if (outcome != null && String(outcome).trim()) started.outcome = String(outcome).trim();
      if (started.outcome && started.outcome !== "success") started.state = "fail";
      else if (started.state === "live" && !event.live) started.state = "ok";
      if (event.stream?.length) started.output = event.stream;
      if (started.atMs != null && atMs != null) started.tookS = Math.max(0, (atMs - started.atMs) / 1000);
      continue;
    }

    const call = readCall(event);
    const partner = event.stream?.length ? undefined : laneToolPartner(events, event.id).output;
    const diff = diffOf(event);
    const answer = event.stream?.length ? event.stream.join("\n") : partner ? laneToolOutputText(partner) : event.diff && !diff ? event.diff.preview ?? "" : "";
    const output = outputLines(answer);
    const partnerAt = normalizeTimestampMs(partner?.at);
    const outcome = String(event.result?.outcome ?? partner?.result?.outcome ?? "").trim();
    const counts = call.family === "test" ? testCounts(output) : null;
    const failed = (outcome !== "" && outcome !== "success") || (counts?.fail ?? 0) > 0 || /<tool_use_error>/.test(answer);
    const answered = outcome !== "" || output.length > 0 || Boolean(event.diff);
    const live = !failed && (Boolean(event.live) || (running && event === lastWork && !answered));
    const row: TurnStepRow = {
      id: event.id,
      ...call,
      state: live ? "live" : failed ? "fail" : "ok",
      output,
      diff,
      text: null,
      tool: event.tool ?? "",
      atMs,
      tookS: atMs != null && partnerAt != null ? Math.max(0, (partnerAt - atMs) / 1000) : null,
      recovered: false,
      outcome,
    };
    if ((event.arg ?? "").trim() === "started") openStarted.set(toolKey, row);
    rows.push({ row, event });
    place(row);
  }

  const steps = rows.map((item) => item.row);
  const calls = steps.filter((step) => step.family !== "think" && step.family !== "note");
  for (const [index, step] of calls.entries()) {
    if (step.state !== "fail") continue;
    step.recovered = calls.slice(index + 1).some((later) => later.key === step.key && later.state === "ok");
  }

  /* What the turn changed: edits by file, from finished calls only. An edit its tool refused changed nothing. */
  const byPath = new Map<string, TurnChangedFile>();
  let add = 0, del = 0;
  for (const { row, event } of rows) {
    if ((row.family !== "edit" && row.family !== "write") || row.state !== "ok") continue;
    if (row.diff) { add += row.diff.add; del += row.diff.del; }
    const paths = row.path ? [row.path] : filesFromObserveEvents([event]).map((file) => file.path);
    for (const path of paths) {
      const file = byPath.get(path) ?? { path, name: baseName(path), add: 0, del: 0, counted: false, edits: [] };
      if (row.path && row.diff) { file.add += row.diff.add; file.del += row.diff.del; file.counted = true; }
      file.edits.push(row);
      byPath.set(path, file);
    }
  }
  const files = [...byPath.values()];

  /* Checks and tests group by command, so a failure and the rerun that passed sit together. */
  const tests = new Map<string, TurnTestRun[]>();
  const checks = new Map<string, TurnStepRow[]>();
  for (const step of calls) {
    if (step.state === "live") continue;
    if (step.family === "test") {
      const counts = testCounts(step.output);
      tests.set(step.key, [...(tests.get(step.key) ?? []), { step, ...counts }]);
    } else if (step.family === "check") {
      checks.set(step.key, [...(checks.get(step.key) ?? []), step]);
    }
  }

  const artifacts: TurnArtifact[] = [
    ...[...files]
      .sort((a, b) => Number(b.counted) - Number(a.counted) || b.add + b.del - (a.add + a.del))
      .map((file): TurnArtifact => ({ id: `diff:${file.path}`, kind: "diff", file })),
    ...[...tests].map(([key, runs]): TurnArtifact => ({ id: `tests:${key}`, kind: "tests", command: runs.at(-1)!.step.title, name: commandName(runs.at(-1)!.step.title), runs })),
    ...[...checks].map(([key, runs]): TurnArtifact => ({ id: `check:${key}`, kind: "check", command: runs.at(-1)!.title, name: commandName(runs.at(-1)!.title), runs })),
  ];
  // What still fails leads; the rest keep their order.
  artifacts.sort((a, b) => Number(artifactOpenFailure(b)) - Number(artifactOpenFailure(a)));

  const says = beats.map((beat) => beat.say).filter((say): say is ObserveEvent => say != null);
  return {
    beats,
    steps,
    live: steps.find((step) => step.state === "live") ?? null,
    lastSay: says.at(-1) ?? null,
    calls: calls.length,
    failed: calls.filter((step) => step.state === "fail").length,
    unrecovered: calls.filter((step) => step.state === "fail" && !step.recovered).length,
    files,
    add,
    del,
    artifacts,
  };
}

/** True while an artifact's newest run still fails. */
export function artifactOpenFailure(artifact: TurnArtifact): boolean {
  if (artifact.kind === "tests") return artifact.runs.at(-1)!.step.state === "fail";
  if (artifact.kind === "check") return artifact.runs.at(-1)!.state === "fail";
  return false;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One folded beat in words, most consequential first: "2 edits · 2 checks, 1 failed · 3 files read". */
export function beatSummary(beat: TurnBeat): { text: string; add: number; del: number; failed: boolean } {
  const calls = beat.steps.filter((step) => step.family !== "think" && step.family !== "note");
  const count = (...families: StepFamily[]) => calls.filter((step) => families.includes(step.family));
  const edits = count("edit", "write");
  const checks = count("check", "test");
  const failedChecks = checks.filter((step) => step.state === "fail").length;
  const failedOther = calls.filter((step) => step.state === "fail" && step.family !== "check" && step.family !== "test").length;
  const part = (n: number, text: string): [number, string] => [n, text];
  const parts = [
    part(edits.length, plural(edits.length, "edit", "edits")),
    part(checks.length, failedChecks ? `${plural(checks.length, "check", "checks")}, ${failedChecks} failed` : plural(checks.length, "check", "checks")),
    part(count("run").length, plural(count("run").length, "command", "commands")),
    part(count("read").length, plural(count("read").length, "file read", "files read")),
    part(count("search", "list").length, plural(count("search", "list").length, "search", "searches")),
    part(count("fetch").length, plural(count("fetch").length, "page fetched", "pages fetched")),
    part(count("agent").length, plural(count("agent").length, "delegation", "delegations")),
    part(count("ask").length, plural(count("ask").length, "question", "questions")),
    part(count("plan").length, "plan updated"),
    part(count("other").length, plural(count("other").length, "other call", "other calls")),
  ].filter(([n]) => n > 0);
  // Three kinds read at a glance; the rest fold into one count.
  const rest = parts.slice(3).reduce((sum, [n]) => sum + n, 0);
  const shown = parts.length > 4 ? [...parts.slice(0, 3).map(([, text]) => text), plural(rest, "other call", "other calls")] : parts.map(([, text]) => text);
  if (failedOther) shown.push(`${failedOther} failed`);
  if (shown.length === 0 && beat.steps.length) {
    const thought = beat.steps.reduce((sum, step) => sum + (step.tookS ?? 0), 0);
    shown.push(thought >= 1 ? `Thought for ${formatSeconds(thought)}` : "Thought");
  }
  const open = calls.filter((step) => step.state === "fail" && !step.recovered).length;
  return {
    text: shown.join(" · "),
    add: edits.reduce((sum, step) => sum + (step.diff?.add ?? 0), 0),
    del: edits.reduce((sum, step) => sum + (step.diff?.del ?? 0), 0),
    failed: open > 0,
  };
}

export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3_600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3_600)}h ${Math.floor((s % 3_600) / 60)}m`;
}

/** A live call's clock: "0:42", "12:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
