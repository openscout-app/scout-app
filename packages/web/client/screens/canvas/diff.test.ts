import { expect, test } from "bun:test";
import { parseDiff } from "./diff.ts";

test("a diff reads as hunks and lines, each line at its place in the file after the change", () => {
  const d = parseDiff("@@ -10,3 +12,4 @@ function run() {\n a\n-b\n+B\n+C\n\\ No newline at end of file\n@@ -40 +42 @@\n-x\n+y\n");
  expect(d.rows).toEqual([
    { kind: "hunk", at: 12, head: "function run() {" },
    { kind: "line", op: "ctx", n: 12, text: "a", code: 0 },
    { kind: "line", op: "del", n: null, text: "b", code: 1 },
    { kind: "line", op: "add", n: 13, text: "B", code: 2 },
    { kind: "line", op: "add", n: 14, text: "C", code: 3 },
    { kind: "hunk", at: 42, head: "" },
    { kind: "line", op: "del", n: null, text: "x", code: 4 },
    { kind: "line", op: "add", n: 42, text: "y", code: 5 },
  ]);
  expect(d.code).toBe("a\nb\nB\nC\nx\ny");
  expect([d.add, d.del]).toEqual([3, 2]);
  expect(parseDiff("").rows).toEqual([]);
});
