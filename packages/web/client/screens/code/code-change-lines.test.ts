import { describe, expect, test } from "bun:test";
import type { RepoDiffLayer } from "../../scout/repo-diff/types.ts";
import { filePatch, hasLineChanges, lineChangesForFile, lineChangesFromPatch } from "./code-change-lines.ts";

const PATCH = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,5 +1,6 @@",
  " one",
  "-two",
  "+TWO",
  "+two and a half",
  " three",
  "-four",
  " five",
  "@@ -20,2 +21,3 @@ function tail()",
  " twenty",
  "+twenty-one",
  " twenty-two",
  "diff --git a/src/b.ts b/src/b.ts",
  "--- a/src/b.ts",
  "+++ b/src/b.ts",
  "@@ -1 +1 @@",
  "-x",
  "+y",
  "",
].join("\n");

const layer = (kind: RepoDiffLayer["kind"], rawPatch: string | null, paths: string[]): RepoDiffLayer => ({
  kind,
  baseLabel: null,
  compareLabel: null,
  command: [],
  patchOid: "",
  rawPatch,
  rawPatchBytes: rawPatch?.length ?? 0,
  truncated: false,
  files: paths.map((path) => ({
    oldPath: path, newPath: path, status: "modified", oldOid: null, newOid: null, oldMode: null, newMode: null,
    similarity: null, binary: false, additions: null, deletions: null, hunks: [], truncated: false,
  })),
  shortstat: null,
});

describe("lines that changed on disk", () => {
  test("picks one file's section out of a layer's patch", () => {
    expect(filePatch(PATCH, "src/b.ts")).toContain("+y");
    expect(filePatch(PATCH, "src/b.ts")).not.toContain("TWO");
    expect(filePatch(PATCH, "src/c.ts")).toBeNull();
  });

  test("a replaced line is modified, an extra line is added, a dropped line marks where it was", () => {
    const changes = lineChangesFromPatch(filePatch(PATCH, "src/a.ts")!);
    expect([...changes.modified]).toEqual([2]);
    expect([...changes.added]).toEqual([3, 22]);
    // "four" went between new lines 4 (three) and 5 (five)
    expect([...changes.deletedAfter]).toEqual([4]);
    expect(changes.additions).toBe(3);
    expect(changes.deletions).toBe(2);
  });

  test("a deletion at the top of the file sits before line 1", () => {
    const changes = lineChangesFromPatch("@@ -1,2 +1 @@\n-gone\n kept\n");
    expect([...changes.deletedAfter]).toEqual([0]);
    expect(changes.added.size + changes.modified.size).toBe(0);
  });

  test("ignores the no-newline marker", () => {
    const changes = lineChangesFromPatch("@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n");
    expect([...changes.modified]).toEqual([1]);
  });

  test("reads the unstaged layer first, then staged, never branch", () => {
    const staged = layer("staged", PATCH, ["src/a.ts"]);
    const unstaged = layer("unstaged", "diff --git a/src/a.ts b/src/a.ts\n@@ -9 +9 @@\n-a\n+b\n", ["src/a.ts"]);
    const branch = layer("branch", PATCH, ["src/b.ts"]);
    expect(lineChangesForFile([staged, unstaged], "src/a.ts")?.layer).toBe("unstaged");
    expect(lineChangesForFile([staged], "src/a.ts")?.layer).toBe("staged");
    expect(lineChangesForFile([branch], "src/b.ts")).toBeNull();
    expect(hasLineChanges(lineChangesForFile([staged], "src/a.ts")!.changes)).toBe(true);
  });
});

describe("marks in Shiki's markup", () => {
  test("each changed line's span carries its mark, and a removal its place", async () => {
    const { markChangedLines } = await import("./ShikiPane.tsx");
    const html = '<pre><code><span class="line">a</span>\n<span class="line">b</span>\n<span class="line">c</span></code></pre>';
    const changes = lineChangesFromPatch("@@ -1,3 +1,3 @@\n a\n-B\n+b\n c\n-d\n");
    const marked = markChangedLines(html, changes);
    expect(marked).toContain('<span class="line">a</span>');
    expect(marked).toContain('<span class="line" data-change="modified">b</span>');
    expect(marked).toContain('<span class="line" data-deleted="after">c</span>');
    expect(markChangedLines(html, null)).toBe(html);
  });
});
