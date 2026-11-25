import { describe, expect, test } from "bun:test";
import type { ObserveData, ObserveEvent } from "../../lib/types.ts";
import { lastLines, MAX_STEPS, mergeDiffFiles, newLines, patchFiles, readSession, turnAt } from "./post-session-model.ts";
import { observedSessionTurns } from "../sessions/session-turns.ts";

const BASE = 1_800_000_000_000;
const ev = (id: string, s: number, e: Partial<ObserveEvent>): ObserveEvent => ({ id, t: s, at: BASE + s * 1000, kind: "message", text: "", ...e });
const ask = (id: string, s: number, text: string) => ev(id, s, { kind: "ask", text });
const say = (id: string, s: number, text: string) => ev(id, s, { kind: "message", text });
const edit = (id: string, s: number, path: string, preview: string, add: number, del: number) =>
  ev(id, s, { kind: "tool", tool: "Edit", arg: path, diff: { add, del, preview } });
const data = (events: ObserveEvent[]) => ({ events, files: [] }) as unknown as ObserveData;

const session = data([
  ask("p1", 0, "Fix the drawer."),
  say("m1", 1, "Looking at the drawer."),
  edit("e1", 2, "src/drawer.tsx", "-old\n+new", 1, 1),
  say("m2", 3, "Fixed. The drawer opens."),
  ask("p2", 600, "Now the footer."),
  say("m3", 601, "On the footer."),
  edit("e2", 602, "src/footer.tsx", "@@ -1 +1 @@\n-a\n+b\n+c", 2, 1),
  say("m4", 603, "Footer done.\nChecks pass.\n\nPushed."),
]);

describe("reading the session for an L item", () => {
  test("the post's turn: the newest that ended by the post's time; else the newest", () => {
    const turns = observedSessionTurns(session, false);
    expect(turnAt(turns, BASE + 10_000)?.prompt[0]?.id).toBe("p1");
    expect(turnAt(turns, BASE + 700_000)?.prompt[0]?.id).toBe("p2");
    // A post before the trace began reads the newest turn.
    expect(turnAt(turns, BASE - 600_000)?.prompt[0]?.id).toBe("p2");
    expect(turnAt([], BASE)).toBeNull();
  });

  test("steps in brief, and each edited file with its diff lines", () => {
    const read = readSession(session, BASE + 10_000);
    expect(read.steps.map((s) => s.say)).toEqual(["Looking at the drawer."]);
    expect(read.steps[0]!.did).toBe("1 edit");
    expect(read.files).toEqual([{ path: "src/drawer.tsx", name: "drawer.tsx", add: 1, del: 1, lines: ["-old", "+new"] }]);
    const later = readSession(session, BASE + 700_000);
    expect(later.files[0]!.lines).toEqual(["@@ -1 +1 @@", "-a", "+b", "+c"]);
  });

  test("the session's last lines: the agent's words, newest last, blank lines dropped", () => {
    expect(lastLines(session.events, 3)).toEqual(["Footer done.", "Checks pass.", "Pushed."]);
    expect(lastLines(session.events, 5)).toEqual(["Fixed. The drawer opens.", "On the footer.", "Footer done.", "Checks pass.", "Pushed."]);
    expect(lastLines([ask("p", 0, "Hi")])).toEqual([]);
  });

  test("since then: only what the session said after the post's turn", () => {
    // The post came from the first turn; the second turn is what came since.
    expect(readSession(session, BASE + 10_000).last).toEqual(["On the footer.", "Footer done.", "Checks pass.", "Pushed."]);
    // The post came from the newest turn: nothing came since, and earlier turns are not "since".
    expect(readSession(session, BASE + 700_000).last).toEqual([]);
  });

  test("a long turn shows its first steps and counts the rest", () => {
    const events = [ask("p", 0, "Go.")];
    for (let i = 0; i < MAX_STEPS + 3; i += 1) events.push(say(`m${i}`, i * 2 + 1, `Step ${i}.`), edit(`e${i}`, i * 2 + 2, `f${i}.ts`, "+x", 1, 0));
    events.push(say("end", 100, "Done."));
    const read = readSession(data(events), BASE + 200_000);
    expect(read.steps).toHaveLength(MAX_STEPS);
    expect(read.moreSteps).toBe(3);
  });

  test("last lines the post already says drop out, markup and case aside", () => {
    const lines = ["Inspected app `7053fc9d`.", "**41 passed**, 0 failed.", "Now on the next fix."];
    expect(newLines(lines, ["Inspected app 7053fc9d. All clear.", "41 passed, 0 failed.", null])).toEqual(["Now on the next fix."]);
    expect(newLines(lines, [])).toEqual(lines);
  });

  test("drawn rules and frame labels drop out of the last lines", () => {
    const framed = say("f", 700, "`\u2605 Insight \u2500\u2500\u2500\u2500`\n- One point here.\n`\u2500\u2500\u2500\u2500`");
    expect(lastLines([framed])).toEqual(["- One point here."]);
    expect(lastLines([say("b", 701, "- **What held it:** a server.")])).toEqual(["- What held it: a server."]);
  });

});

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 111..222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "-old",
  "+new",
  "+more",
  "\\ No newline at end of file",
  "diff --git a/gone.ts b/gone.ts",
  "deleted file mode 100644",
  "--- a/gone.ts",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "diff --git a/logo.png b/logo.png",
  "Binary files a/logo.png and b/logo.png differ",
  "",
].join("\n");

describe("files changed from git's patch", () => {
  test("one entry per file, headers dropped, a deletion named by its old path, binaries left out", () => {
    expect(patchFiles(PATCH)).toEqual([
      { path: "src/a.ts", name: "a.ts", add: 2, del: 1, lines: ["@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+more"] },
      { path: "gone.ts", name: "gone.ts", add: 0, del: 1, lines: ["@@ -1 +0,0 @@", "-bye"] },
    ]);
  });

  test("a long file shows its first lines and counts the rest", () => {
    const [file] = patchFiles(PATCH, 3);
    expect(file!.lines).toHaveLength(3);
    expect(file!.cut).toBe(2);
  });

  test("layers join per path: committed hunks, then working ones", () => {
    const branch = patchFiles(PATCH);
    const working = patchFiles("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -9 +9 @@\n-x\n+y\n");
    const merged = mergeDiffFiles([branch, working]);
    expect(merged.map((f) => f.path)).toEqual(["src/a.ts", "gone.ts"]);
    expect(merged[0]).toMatchObject({ add: 3, del: 2 });
    expect(merged[0]!.lines.slice(-3)).toEqual(["@@ -9 +9 @@", "-x", "+y"]);
  });
});
