/**
 * A unified diff body (from its first hunk, as GET /api/ops/canvas-file?as=diff answers) as rows for the file view:
 * a head per hunk, and per line its change and its line in the file after the change, which opens the editor there.
 */
export type DiffRow =
  | { kind: "hunk"; at: number; head: string }
  /** `code`: the line's index in the joined code, which is highlighted as one text */
  | { kind: "line"; op: "add" | "del" | "ctx"; n: number | null; text: string; code: number };

export function parseDiff(diff: string): { rows: DiffRow[]; code: string; add: number; del: number } {
  const rows: DiffRow[] = [], code: string[] = [];
  let n = 1, add = 0, del = 0, inHunk = false;
  for (const l of diff.split("\n")) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(l);
    if (h) {
      n = Number(h[1]); inHunk = true;
      rows.push({ kind: "hunk", at: Math.max(1, n), head: h[2].trim() });
      continue;
    }
    if (!inHunk || !l || l.startsWith("\\")) continue;
    const op = l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx";
    rows.push({ kind: "line", op, n: op === "del" ? null : n, text: l.slice(1), code: code.length });
    code.push(l.slice(1));
    if (op === "add") add++;
    else if (op === "del") del++;
    if (op !== "del") n++;
  }
  return { rows, code: code.join("\n"), add, del };
}
