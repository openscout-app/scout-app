import { expect, test, mock } from "bun:test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildModel, beatIn, scopedArt, shellProject } from "./model.ts";
import { menuItems, pickKeyOf, type MenuActs } from "./menu.ts";
import type { ReviewData } from "../../../shared/review-window.ts";

const data: ReviewData = {
  from: 0, now: 100000, host: "", days: 1, kinds: ["e"],
  strs: ["~/app/a.ts", "app:a.ts", "Edit"], projects: { app: "~/app" },
  wts: [["app", "main", "~/app", 0], ["app", "b", "~/app-b", 0]],
  files: [[0, 0, 1]], calls: [[1, 0, 0, 2, 0, 0, 0, 1, 0], [2, 0, 0, 2, 1, 0, 0, 1, 0], [3, 0, 0, 2, 1, 0, 0, 1, 0]],
  sessions: [{ sid: "session", h: "claude", agent: -1, turns: [], colds: [], errs: [] }],
  actors: [], asks: [], commits: [], changes: [],
  current: { "app:a.ts": { path: "~/app-b/a.ts", w: 1, mt: 3 } },
  currentByWorktree: {
    '["app:a.ts",0]': { path: "~/app/a.ts", w: 0, mt: 1 },
    '["app:a.ts",1]': { path: "~/app-b/a.ts", w: 1, mt: 3 },
  },
};
test("worktree changes split beats so both focuses retain rail calls", () => {
  const m = buildModel(data);
  for (const w of [0, 1]) {
    const beats = m.BEATS.filter((b) => beatIn(m, { kind: "wt", w }, b));
    expect(beats.flatMap((b) => b.calls)).toEqual(w === 0 ? [0] : [1, 2]);
  }
});
test("Now resolves the focused worktree instead of the newest sibling", () => {
  const m = buildModel(data), a = m.ART.get("app:a.ts")!;
  expect(scopedArt(m, a, { kind: "wt", w: 0 }).cur?.path).toBe("~/app/a.ts");
  expect(scopedArt(m, a, { kind: "wt", w: 1 }).cur?.path).toBe("~/app-b/a.ts");
});
test("project shell arguments preserve tilde expansion and literal metacharacters", () => {
  for (const path of ["~/dev/My App", "~/dev/a' b;$HOME$(echo bad)", "/tmp/a; echo bad"]) {
    const out = execFileSync("/bin/sh", ["-c", "printf '%s' " + shellProject(path)], { encoding: "utf8", env: { HOME: "/home/test" } });
    expect(out).toBe(path.replace(/^~\//, "/home/test/"));
  }
});
test("disabled review gate wraps all effects and handlers in an unmounted child", () => {
  const source = readFileSync(new URL("./ReviewContent.tsx", import.meta.url), "utf8");
  const gate = source.slice(source.indexOf("export function ReviewContent"), source.indexOf("function EnabledReviewContent"));
  expect(gate).toContain('useOptionalFlag("surface.review", false)');
  expect(gate).toContain("enabled ? <EnabledReviewContent /> : null");
  expect(gate).not.toContain("useEffect");
});

test("same-second worktree changes have distinct selectable beat and menu keys", () => {
  const m = buildModel({ ...data, calls: data.calls.map((c) => [1, ...c.slice(1)]) });
  expect(m.BEATS.length).toBe(2);
  const ids = m.BEATS.map((b) => b.id);
  expect(new Set(ids).size).toBe(2);
  const noop = () => {};
  const acts: MenuActs = { focusOn: noop, clearFocus: noop, openArt: noop, openCommit: noop, openBeat: mock(() => {}),
    ask: noop, flyWt: noop, revealWt: noop, copy: noop, openMany: noop, clearPicks: noop };
  const keys = m.BEATS.map((b) => pickKeyOf({ type: "beat", id: b.id }));
  expect(new Set(keys).size).toBe(2);
  for (const b of m.BEATS) {
    const menu = menuItems(m, { kind: "all" }, new Map(), { type: "beat", id: b.id }, acts);
    const open = menu.find((x) => x.kind === "action" && x.label === "Open");
    if (open?.kind === "action") open.onSelect();
    expect(acts.openBeat).toHaveBeenLastCalledWith(b);
  }
});

test("span projection indexes 4000 current copies once, not on each artifact lookup", async () => {
  const { artInSpan } = await import("./model.ts");
  const n = 4000, strs: string[] = [], files: [number, number, number][] = [], calls: number[][] = [];
  const copies: NonNullable<ReviewData["currentByWorktree"]> = {};
  for (let i = 0; i < n; i++) {
    strs.push("~/app/" + i + ".ts", "app:" + i + ".ts");
    files.push([i * 2, 0, i * 2 + 1]);
    calls.push([i, 0, 0, 0, 0, i, 0, 1, 0]);
    copies[JSON.stringify([strs[i * 2 + 1], 0])] = { path: strs[i * 2], w: 0, mt: i };
  }
  let enumerations = 0;
  const tracked = new Proxy(copies, { ownKeys(target) { enumerations++; return Reflect.ownKeys(target); } });
  const m = buildModel({ ...data, strs, files, calls, currentByWorktree: tracked });
  expect(enumerations).toBe(1);
  const span = artInSpan(m, 0, n, { kind: "wt", w: 0 });
  expect(span.size).toBe(n);
  for (const x of span.values()) expect(x.a.cur?.path).toBe("~/app/" + x.a.rel);
  expect(enumerations).toBe(1);
});
