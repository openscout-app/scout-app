import { describe, expect, test } from "bun:test";
import type { ObserveEvent } from "../../lib/types.ts";
import { readTurnBeats } from "./turn-beats.ts";
import { changedFilesTable, fileFolder, listNames, runSummary, sessionComposerNote, sessionDayLabel, turnRuns } from "./turn-runs.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

const base = 1_700_000_000_000;
const at = (seconds: number): Pick<ObserveEvent, "t" | "at"> => ({ t: seconds, at: base + seconds * 1000 });
const say = (id: string, seconds: number, text: string): ObserveEvent => ({ id, ...at(seconds), kind: "message", text });
const tool = (id: string, seconds: number, name: string, arg: string, extra: Partial<ObserveEvent> = {}): ObserveEvent => ({ id, ...at(seconds), kind: "tool", tool: name, arg, text: "", ...extra });
const ok = { result: { outcome: "success" } };

describe("turn runs", () => {
  test("each run of calls between two of the agent's lines is one run, under the line before it", () => {
    const view = readTurnBeats([
      tool("a", 0, "Read", "src/lead.ts", ok),
      say("m1", 1, "I'll start where the card decides it is open."),
      tool("b", 2, "Grep", 'pattern: "requestState"', ok),
      tool("c", 3, "Read", "src/card.tsx", ok),
      say("m2", 4, "The card reads its state once."),
      say("m3", 5, "Fixing it now."),
      tool("d", 6, "Edit", "src/card.tsx", { diff: { add: 11, del: 4, preview: "-a\n+b" } }),
    ], { running: false });
    const runs = turnRuns(view);
    expect(runs.map((run) => run.say)).toEqual([null, "I'll start where the card decides it is open.", "The card reads its state once.", "Fixing it now."]);
    expect(runs.map((run) => run.steps.map((step) => step.id))).toEqual([["a"], ["b", "c"], [], ["d"]]);
  });

  test("a run with no calls and no line is dropped", () => {
    const view = readTurnBeats([say("m1", 0, "   "), say("m2", 1, "Done.")], { running: false });
    expect(turnRuns(view).map((run) => run.say)).toEqual(["Done."]);
  });

  test("a run reads as a plain sentence with its line counts", () => {
    const view = readTurnBeats([
      tool("e1", 0, "Edit", "packages/web/PinnedRequestCard.tsx", { diff: { add: 11, del: 4, preview: "-a\n+b" } }),
      tool("e2", 1, "Edit", "packages/web/use-queue-continuity.ts", { diff: { add: 7, del: 2, preview: "-a\n+b" } }),
    ], { running: false });
    const summary = runSummary(view.beats[0]!.steps);
    expect(summary.text).toBe("Edited PinnedRequestCard.tsx and use-queue-continuity.ts");
    expect([summary.add, summary.del]).toEqual([18, 6]);
    expect(summary.live).toBe(false);
  });

  test("changes lead, then checks with what still fails, then reading", () => {
    const view = readTurnBeats([
      tool("r1", 0, "Read", "src/a.ts", ok),
      tool("r2", 1, "Read", "src/b.ts", ok),
      tool("s", 2, "Grep", 'pattern: "requestState"', ok),
      tool("t", 3, "Bash", "bun test src/a.test.ts", { stream: ["46 pass", "1 fail"] }),
    ], { running: false });
    const summary = runSummary(view.beats[0]!.steps);
    expect(summary.text).toBe("Ran a.test.ts, read 2 files and searched for requestState, 1 failed");
    expect(summary.failed).toBe(true);
  });

  test("a failure no rerun passed is said once, at the end", () => {
    const view = readTurnBeats([
      tool("c1", 0, "Bash", "git status", { result: { outcome: "error" } }),
      tool("c2", 1, "Bash", "git log -1", ok),
    ], { running: false });
    expect(runSummary(view.beats[0]!.steps).text).toBe("Ran 2 commands, 1 failed");
  });

  test("past three kinds the rest fold into a count", () => {
    const view = readTurnBeats([
      tool("e", 0, "Edit", "src/a.ts", { diff: { add: 1, del: 0, preview: "+a" } }),
      tool("t", 1, "Bash", "bun run web:check", ok),
      tool("r", 2, "Read", "src/b.ts", ok),
      tool("s", 3, "Grep", 'pattern: "x"', ok),
      tool("f", 4, "WebFetch", "https://example.com", ok),
    ], { running: false });
    expect(runSummary(view.beats[0]!.steps).text).toBe("Edited a.ts, ran web:check, read b.ts and 2 other calls");
  });

  test("a run with a call still going says what it is doing now", () => {
    const view = readTurnBeats([
      tool("r", 0, "Read", "src/a.ts", ok),
      tool("t", 1, "Bash", "bun test screens/chat"),
    ], { running: true });
    const summary = runSummary(view.beats[0]!.steps);
    expect(summary.live).toBe(true);
    expect(summary.text).toBe("Running bun test");
  });

  test("a run of thinking alone says how long", () => {
    const view = readTurnBeats([
      { id: "k", ...at(0), kind: "think", text: "Weighing it." },
      say("m", 12, "Here is the plan."),
    ], { running: false });
    expect(runSummary(view.beats[0]!.steps).text).toBe("Thought for 12s");
  });

  test("an unnamed tool reads by its own name, not its arguments", () => {
    const view = readTurnBeats([tool("x", 0, "mcp__scout__invocations_get", '{"flightId":"flt-1"}', ok)], { running: false });
    expect(runSummary(view.beats[0]!.steps).text).toBe("Called scout invocations get");
  });

  test("names list two, then count the rest", () => {
    expect(listNames(["a"])).toBe("a");
    expect(listNames(["a", "b"])).toBe("a and b");
    expect(listNames(["a", "b", "c"])).toBe("a, b and c");
    expect(listNames(["a", "b", "c", "d"])).toBe("a, b and 2 more");
    expect(listNames(["a", "a"])).toBe("a");
  });
});

describe("changed files", () => {
  test("the table lists each file under the workspace, most lines first, with the total", () => {
    const view = readTurnBeats([
      tool("e1", 0, "Edit", "/repo/packages/web/a.ts", { diff: { add: 2, del: 1, preview: "-a\n+b" } }),
      tool("e2", 1, "Edit", "/repo/packages/web/b.ts", { diff: { add: 9, del: 3, preview: "-a\n+b" } }),
      tool("e3", 2, "Edit", "/repo/packages/web/a.ts", { diff: { add: 1, del: 0, preview: "+c" } }),
    ], { running: false });
    const table = changedFilesTable(view, "/repo");
    expect(table.rows.map((row) => [row.name, row.dir, row.add, row.del])).toEqual([
      ["b.ts", "packages/web", 9, 3],
      ["a.ts", "packages/web", 3, 1],
    ]);
    expect([table.add, table.del]).toEqual([12, 4]);
  });

  test("a file whose edits carried no counts shows none, and no total is made up", () => {
    const view = readTurnBeats([tool("w", 0, "Write", "/repo/notes.md", ok)], { running: false });
    const table = changedFilesTable(view, "/repo");
    expect(table.rows.map((row) => [row.name, row.add, row.del])).toEqual([["notes.md", null, null]]);
    expect([table.add, table.del]).toEqual([null, null]);
  });

  test("a folder outside the workspace keeps its last three folders", () => {
    expect(fileFolder(`${MAC_HOME_ROOT}/workstation-user/dev/other/packages/runtime/src/a.ts`, `${MAC_HOME_ROOT}/workstation-user/dev/scout`)).toBe("…/packages/runtime/src");
    expect(fileFolder(`${MAC_HOME_ROOT}/workstation-user/dev/a.ts`, null)).toBe("~/dev");
    expect(fileFolder("/repo/a.ts", "/repo")).toBe("");
  });
});

describe("around the composer and the day", () => {
  test("a message the runtime holds names the host it waits for", () => {
    expect(sessionComposerNote({ hostName: "mini.local", agentName: "Scout", queuedUntilOnline: true, notReady: false }))
      .toEqual({ lead: "mini can't be reached.", text: "Your message waits in the runtime and goes when the host is back." });
    expect(sessionComposerNote({ hostName: null, agentName: "Scout", queuedUntilOnline: false, notReady: true }))
      .toEqual({ lead: "Scout isn't ready.", text: "Sending will try to wake it." });
    expect(sessionComposerNote({ hostName: "mini", agentName: "Scout", queuedUntilOnline: false, notReady: false })).toBeNull();
  });

  test("the day separator says the day and the time", () => {
    const now = new Date(2026, 10, 9, 15, 0).getTime();
    const time = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const today = new Date(2026, 10, 9, 10, 12);
    const yesterday = new Date(2026, 10, 8, 21, 5);
    const monday = new Date(2026, 10, 4, 10, 12);
    expect(sessionDayLabel(today.getTime(), now)).toBe(`Today ${time(today)}`);
    expect(sessionDayLabel(yesterday.getTime(), now)).toBe(`Yesterday ${time(yesterday)}`);
    expect(sessionDayLabel(monday.getTime(), now)).toBe(`${monday.toLocaleDateString([], { weekday: "long" })} ${time(monday)}`);
    expect(sessionDayLabel(null, now)).toBe("");
  });
});
