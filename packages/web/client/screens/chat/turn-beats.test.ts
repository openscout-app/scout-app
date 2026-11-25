import { describe, expect, test } from "bun:test";
import type { ObserveEvent } from "../../lib/types.ts";
import { beatSummary, commandName, readTurnBeats, shortCommand, stepVerb, testCounts } from "./turn-beats.ts";

const base = 1_700_000_000_000;
let clock = 0;
function at(seconds: number): Pick<ObserveEvent, "t" | "at"> {
  clock = seconds;
  return { t: seconds, at: base + seconds * 1000 };
}
const say = (id: string, seconds: number, text: string): ObserveEvent => ({ id, ...at(seconds), kind: "message", text });
const tool = (id: string, seconds: number, name: string, arg: string, extra: Partial<ObserveEvent> = {}): ObserveEvent => ({ id, ...at(seconds), kind: "tool", tool: name, arg, text: "", ...extra });
const res = (id: string, seconds: number, output: string, outcome = "success"): ObserveEvent => ({ id, ...at(seconds), kind: "tool", tool: "res", arg: output, text: "", result: { outcome } });

describe("turn beats", () => {
  test("the agent's lines lead and the calls after each line sit under it", () => {
    const view = readTurnBeats([
      tool("a", 0, "Read", "src/lead.ts", { result: { outcome: "success" } }),
      say("m1", 1, "Looking at the drawer."),
      tool("b", 2, "Grep", 'pattern: "drawerHead"', { result: { outcome: "success" } }),
      say("m2", 3, "Now the fix."),
      tool("c", 4, "Edit", "src/drawer.tsx", { diff: { add: 3, del: 1, preview: "-old\n+new" } }),
    ], { running: false });
    expect(view.beats.map((beat) => beat.say?.text ?? null)).toEqual([null, "Looking at the drawer.", "Now the fix."]);
    expect(view.beats.map((beat) => beat.steps.map((step) => step.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(view.beats[1]!.steps[0]!.target).toBe("drawerHead");
    expect(view.calls).toBe(3);
  });

  test("an output row pairs with its call, and its outcome fails the call", () => {
    const view = readTurnBeats([
      tool("call", 0, "Bash", "bun test src/a.test.ts"),
      res("out", 7, "12 pass\n1 fail\n(fail) drawer keeps its head", "error"),
    ], { running: false });
    expect(view.steps).toHaveLength(1);
    const step = view.steps[0]!;
    expect(step.state).toBe("fail");
    expect(step.output).toContain("(fail) drawer keeps its head");
    expect(step.tookS).toBe(7);
    expect(view.unrecovered).toBe(1);
  });

  test("a failed command that a later run passed is recovered, not open", () => {
    const view = readTurnBeats([
      tool("t1", 0, "Bash", "bun test src/a.test.ts", { stream: ["11 pass", "1 fail"] }),
      tool("e", 2, "Edit", "src/a.ts", { diff: { add: 1, del: 1, preview: "-a\n+b" } }),
      tool("t2", 4, "Bash", "bun test src/a.test.ts", { stream: ["12 pass", "0 fail"] }),
    ], { running: false });
    expect(view.failed).toBe(1);
    expect(view.unrecovered).toBe(0);
    expect(view.steps[0]!.recovered).toBe(true);
    const tests = view.artifacts.find((artifact) => artifact.kind === "tests");
    expect(tests?.kind === "tests" && tests.runs.map((run) => [run.pass, run.fail])).toEqual([[11, 1], [12, 0]]);
  });

  test("simple shell reads and searches read as Read and Searched; a pipe stays a command", () => {
    const view = readTurnBeats([
      tool("r", 0, "exec_command", "sed -n '1,40p' packages/web/client/app.ts"),
      tool("s", 1, "exec_command", "cd repo && rg -n -g '*.ts' needle src"),
      tool("p", 2, "exec_command", "rg needle src | head -5"),
    ], { running: false });
    expect(view.steps.map((step) => [step.family, step.target])).toEqual([
      ["read", "app.ts"],
      ["search", "needle"],
      ["run", "rg needle src | head -5"],
    ]);
    expect(stepVerb(view.steps[0]!)).toBe("Read");
  });

  test("the newest call with no answer yet is live while the turn runs, and only then", () => {
    const events = [tool("a", 0, "Read", "a.ts", { result: { outcome: "success" } }), tool("b", 1, "Bash", "bun run web:check")];
    expect(readTurnBeats(events, { running: true }).live?.id).toBe("b");
    expect(readTurnBeats(events, { running: false }).live).toBeNull();
    expect(stepVerb(readTurnBeats(events, { running: true }).live!)).toBe("Checking");
  });

  test("edits group by file and the turn totals their counts", () => {
    const view = readTurnBeats([
      tool("e1", 0, "edit", "src/a.ts", { diff: { add: 3, del: 1, preview: "+x" } }),
      tool("e2", 1, "edit", "src/a.ts", { diff: { add: 2, del: 0, preview: "+y" } }),
      tool("e3", 2, "write", "src/b.ts", { diff: { add: 10, del: 0, preview: "+z" } }),
    ], { running: false });
    expect(view.files.map((file) => [file.name, file.add, file.del, file.edits.length])).toEqual([["a.ts", 5, 1, 2], ["b.ts", 10, 0, 1]]);
    expect([view.add, view.del]).toEqual([15, 1]);
    // The larger change leads the tray.
    expect(view.artifacts.filter((artifact) => artifact.kind === "diff").map((artifact) => artifact.id)).toEqual(["diff:src/b.ts", "diff:src/a.ts"]);
  });

  test("a check that still fails leads the tray", () => {
    const view = readTurnBeats([
      tool("e", 0, "edit", "src/a.ts", { diff: { add: 1, del: 0, preview: "+x" } }),
      tool("c", 1, "Bash", "bun run web:check", { result: { outcome: "error" }, stream: ["error TS2322"] }),
    ], { running: false });
    expect(view.artifacts[0]!.kind).toBe("check");
    expect(view.artifacts[0]!.kind === "check" && view.artifacts[0]!.name).toBe("web:check");
  });

  test("a started row and its completed row are one call", () => {
    const view = readTurnBeats([
      tool("s", 0, "read_file", "started"),
      tool("c", 3, "read_file", "completed", { result: { outcome: "failed" } }),
    ], { running: false });
    expect(view.steps).toHaveLength(1);
    expect(view.steps[0]!.state).toBe("fail");
    expect(view.steps[0]!.tookS).toBe(3);
  });

  test("nothing fails without evidence: a command with no outcome and no counts is ok", () => {
    const view = readTurnBeats([tool("a", 0, "bash", "make build", { stream: ["error: nothing to do?"] })], { running: false });
    expect(view.steps[0]!.state).toBe("ok");
    expect(view.failed).toBe(0);
  });

  test("a folded beat names its calls by consequence and caps at four parts", () => {
    const view = readTurnBeats([
      say("m", 0, "Working through it."),
      tool("r", 1, "Read", "a.ts", { result: { outcome: "success" } }),
      tool("g", 2, "Grep", "x", { result: { outcome: "success" } }),
      tool("e", 3, "Edit", "a.ts", { diff: { add: 2, del: 1, preview: "+a" } }),
      tool("c", 4, "Bash", "bun run web:check", { result: { outcome: "error" } }),
      tool("w", 5, "WebFetch", "https://example.com", { result: { outcome: "success" } }),
      tool("x", 6, "mcp__scout__ask", "hello", { result: { outcome: "success" } }),
    ], { running: false });
    const summary = beatSummary(view.beats[0]!);
    expect(summary.text).toBe("1 edit · 1 check, 1 failed · 1 file read · 3 other calls");
    expect([summary.add, summary.del, summary.failed]).toEqual([2, 1, true]);
  });

  test("test counts read from the common runners", () => {
    expect(testCounts([" 12 pass", " 1 fail"])).toMatchObject({ pass: 12, fail: 1 });
    expect(testCounts(["Tests  1 failed | 11 passed (12)"])).toMatchObject({ pass: 11, fail: 1 });
    expect(testCounts(["===== 3 passed in 0.52s ====="])).toMatchObject({ pass: 3, fail: 0 });
    expect(testCounts(["test result: FAILED. 11 passed; 1 failed"])).toMatchObject({ pass: 11, fail: 1 });
    expect(testCounts(["(fail) drawer > keeps its head [1.2ms]"]).failing).toEqual(["drawer > keeps its head [1.2ms]"]);
    expect(testCounts(["no counts here"])).toMatchObject({ pass: null, fail: null });
  });

  test("a test or check is a runner, not a file with the word in its name", () => {
    const view = readTurnBeats([
      tool("log", 0, "Bash", "tail -40 /tmp/slack-test.log"),
      tool("cat", 1, "Bash", "node slack-board-check.ts > out.txt"),
      tool("t", 2, "Bash", "cd packages/web && bun test src/a.test.ts > /tmp/slack-test.log 2>&1; tail /tmp/slack-test.log"),
      tool("c", 3, "Bash", "S=web; bun run web:check"),
      tool("u", 4, "Bash", "node ./scripts/test.mjs"),
    ], { running: false });
    expect(view.steps.map((step) => step.family)).toEqual(["read", "run", "test", "check", "test"]);
    expect(commandName(view.steps[2]!.title)).toBe("a.test.ts");
    expect(commandName(view.steps[3]!.title)).toBe("web:check");
    // A leading cd is where it ran, not what it did.
    expect(view.steps[2]!.target.startsWith("bun test")).toBe(true);
  });

  test("an edit its tool refused fails and changes no file; a status line is not a diff", () => {
    const view = readTurnBeats([
      tool("e1", 0, "edit", "/repo/a.ts", { diff: { add: 0, del: 0, preview: "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>" } }),
      tool("w1", 1, "edit", "/repo/b.ts", { diff: { add: 0, del: 0, preview: "File created successfully at: /repo/b.ts" } }),
    ], { running: false });
    expect(view.steps[0]!.state).toBe("fail");
    expect(view.steps[0]!.output).toEqual(["File has not been read yet. Read it first before writing to it."]);
    expect(view.steps[1]!.state).toBe("ok");
    expect(view.steps[1]!.diff).toBeNull();
    expect(view.files.map((file) => [file.name, file.counted])).toEqual([["b.ts", false]]);
  });

  test("output drops terminal colour codes, even when the escape is gone", () => {
    const view = readTurnBeats([
      tool("t", 0, "Bash", "bun test src/a.test.ts", { stream: ["\u001b[31m(fail)\u001b[0m drawer keeps its head", "[0m [31m1 fail [0m", "11 pass"] }),
    ], { running: false });
    expect(view.steps[0]!.output).toEqual(["(fail) drawer keeps its head", " 1 fail", "11 pass"]);
    expect(view.steps[0]!.state).toBe("fail");
  });

  test("commands read short", () => {
    expect(shortCommand("bun test packages/web/client/screens/chat/SessionView.test.tsx")).toBe("bun test SessionView.test.tsx");
    expect(shortCommand("cat > /tmp/measure.ts <<'EOF'\nimport { load } from \"./a\";\nEOF\nbun /tmp/measure.ts")).toBe("cat > measure.ts <<'EOF' ; bun measure.ts");
    expect(shortCommand("cat <<< \"x\"\necho done")).toBe("cat <<< \"x\" ; echo done");
    expect(commandName("bun run web:check")).toBe("web:check");
    expect(commandName("bun test packages/web/client/a.test.tsx")).toBe("a.test.tsx");
    expect(commandName("bun test 'packages/*/src/*.test.ts'")).toBe("bun test");
    expect(commandName("tsc --noEmit -p design/studio/tsconfig.json")).toBe("tsc");
    void clock;
  });
});
