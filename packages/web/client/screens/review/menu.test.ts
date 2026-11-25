import { describe, expect, mock, test } from "bun:test";
import type { ReviewData } from "../../../shared/review-window.ts";
import { buildAtlas, type ANode } from "./atlas.ts";
import { menuItems, pickKeyOf, picksMenuItems, type MenuActs, type MenuOf } from "./menu.ts";
import { ALL, artInSpan, beatIn, buildModel, callIn, commitIn, scopeName, unionOf, type Scope } from "./model.ts";

/* two projects; app has a main checkout and a feature worktree. Session 0 is unnamed and works in app; session 1
 * serves the Scout agent web-bot in web. One commit, made by session 0 on the feature branch. */
const strs = ["Edit", "Read", "", "~/dev/app/a.ts", "app:a.ts", "~/dev/app-feature/b.ts", "app:b.ts", "~/dev/web/c.ts", "web:c.ts"];
const D: ReviewData = {
  from: 0, now: 1_000_000, host: "h", days: 2, kinds: ["r", "e"], strs,
  wts: [["app", "main", "~/dev/app", 0], ["app", "feature", "~/dev/app-feature", 0], ["web", "main", "~/dev/web", 0]],
  projects: { app: "~/dev/app", web: "~/dev/web" },
  files: [[3, 0, 4], [5, 1, 6], [7, 2, 8]],
  calls: [
    [100, 0, 1, 0, 1, 1, 2, 5, 1],
    [200, 0, 0, 1, 0, 0, 2, 0, 0],
    [300, 1, 1, 0, 2, 2, 2, 3, 0],
  ],
  sessions: [
    { sid: "aaaa1111", h: "claude", agent: -1, turns: [], colds: [], errs: [] },
    { sid: "bbbb2222", h: "codex", agent: 0, turns: [], colds: [], errs: [] },
  ],
  actors: [["web-bot", "agent", "web", "codex", "agent-web-1"]],
  asks: [],
  commits: [{ id: "c1", repo: "app", t: 250, subj: "Add b", branch: "feature", merged: "", s: 0, w: 1, how: "commit" }],
  changes: [{ id: "x1", c: "c1", key: "app:b.ts", path: "b.ts", add: 5, del: 1, isNew: true, isGone: false, kind: "code", hunks: 1, shape: 0.5, shapeWhy: "", patch: "", cut: 0 }],
  current: { "app:b.ts": { path: "~/dev/app-feature/b.ts", mt: 260, w: 1 } },
};
const m = buildModel(D);
const WT_FEATURE: Scope = { kind: "wt", w: 1 };
const SES_WEB: Scope = { kind: "session", s: 1 };

function acts() {
  return {
    focusOn: mock(() => {}), clearFocus: mock(() => {}), openArt: mock(() => {}), openCommit: mock(() => {}), openBeat: mock(() => {}),
    ask: mock(() => {}), flyWt: mock(() => {}), revealWt: mock(() => {}), copy: mock(() => {}), openMany: mock(() => {}), clearPicks: mock(() => {}),
  } satisfies MenuActs;
}
const menu = (x: MenuOf, scope: Scope = ALL, a = acts()) => menuItems(m, scope, artInSpan(m, 0, 1000, scope), x, a);
const labels = (x: MenuOf, scope: Scope = ALL) => menu(x, scope).map((it) => (it.kind === "separator" ? "—" : it.label));
const pick = (x: MenuOf, label: string, scope: Scope = ALL) => {
  const a = acts(), it = menu(x, scope, a).find((i) => i.kind === "action" && i.label === label);
  if (!it || it.kind !== "action") throw new Error(`no "${label}"`);
  it.onSelect();
  return a;
};
const leaves = (n: ANode): string[] => (n.art ? [n.art] : n.kids.flatMap(leaves));

describe("Review scope", () => {
  test("a worktree, a session and a project each narrow the calls, commits and beats", () => {
    expect(m.C.map((c) => callIn(m, WT_FEATURE, c))).toEqual([true, false, false]);
    expect(m.C.map((c) => callIn(m, SES_WEB, c))).toEqual([false, false, true]);
    expect(m.C.map((c) => callIn(m, { kind: "project", p: "app" }, c))).toEqual([true, true, false]);
    const c1 = m.COMMITS[0];
    expect([commitIn(m, WT_FEATURE, c1), commitIn(m, { kind: "wt", w: 0 }, c1), commitIn(m, { kind: "session", s: 0 }, c1), commitIn(m, SES_WEB, c1)]).toEqual([true, false, true, false]);
    expect(m.BEATS.map((b) => [b.s, beatIn(m, SES_WEB, b), beatIn(m, { kind: "project", p: "app" }, b)])).toEqual([[0, false, true], [0, false, true], [1, true, false]]);
  });

  test("the Atlas under a focus holds only what that focus touched", () => {
    // "everything" so the file session 0 only read shows too; every call here names a file, so no command tiles
    const atlas = (scope: Scope) => leaves(buildAtlas(m, { A: 0, B: 1000, scope, show: "everything", surfaced: false, search: "" })).sort();
    expect(atlas(ALL)).toEqual(["app:a.ts", "app:b.ts", "web:c.ts"]);
    expect(atlas(WT_FEATURE)).toEqual(["app:b.ts"]);
    expect(atlas(SES_WEB)).toEqual(["web:c.ts"]);
    expect(atlas({ kind: "session", s: 0 })).toEqual(["app:a.ts", "app:b.ts"]);
  });

  test("a focus on several things holds what any of them touched", () => {
    const both = unionOf([WT_FEATURE, SES_WEB]);
    expect(both.kind).toBe("many");
    expect(m.C.map((c) => callIn(m, both, c))).toEqual([true, false, true]);
    expect(leaves(buildAtlas(m, { A: 0, B: 1000, scope: both, show: "everything", surfaced: false, search: "" })).sort()).toEqual(["app:b.ts", "web:c.ts"]);
    expect(scopeName(m, both)).toBe("feature, web-bot");
    expect(unionOf([WT_FEATURE])).toEqual(WT_FEATURE);
    expect(unionOf([])).toEqual(ALL);
  });
});

describe("Review right-click menu", () => {
  test("a worktree leads with Focus, then its project, then what it offers", () => {
    expect(labels({ type: "wt", w: 1 })).toEqual(["Focus on feature", "Focus on app", "—", "Open in the Atlas", "Show in Tracks", "Ask about this worktree", "Copy path"]);
    expect(pick({ type: "wt", w: 1 }, "Focus on feature").focusOn).toHaveBeenCalledWith({ kind: "wt", w: 1 });
    expect(pick({ type: "wt", w: 1 }, "Copy path").copy).toHaveBeenCalledWith("~/dev/app-feature");
  });

  test("what the window is focused on drops its own Focus and offers Clear focus", () => {
    expect(labels({ type: "wt", w: 1 }, WT_FEATURE)).toEqual(["Focus on app", "—", "Open in the Atlas", "Show in Tracks", "Ask about this worktree", "Copy path", "—", "Clear focus"]);
    expect(pick({ type: "wt", w: 1 }, "Clear focus", WT_FEATURE).clearFocus).toHaveBeenCalled();
  });

  test("a session's lane offers its agent by name", () => {
    expect(labels({ type: "session", s: 1, w: 2 })).toEqual(["Focus on web-bot", "Focus on web (main)", "—", "Ask web-bot", "Copy session id"]);
    expect(labels({ type: "session", s: 0 })).toEqual(["Focus on session aaaa1111", "—", "Ask about this session", "Copy session id"]);
    expect(pick({ type: "session", s: 1, w: 2 }, "Focus on web-bot").focusOn).toHaveBeenCalledWith({ kind: "session", s: 1 });
  });

  test("a file opens, focuses where it was worked on, and copies the path it was read from", () => {
    expect(labels({ type: "art", key: "app:b.ts" })).toEqual(["Open", "Focus on feature", "Focus on session aaaa1111", "—", "Ask about this file", "Copy path"]);
    expect(pick({ type: "art", key: "app:b.ts" }, "Copy path").copy).toHaveBeenCalledWith("~/dev/app-feature/b.ts");
  });

  test("a commit and a beat offer their worktree and session", () => {
    expect(labels({ type: "commit", id: "c1" })).toEqual(["Open", "Focus on feature", "Focus on session aaaa1111", "—", "Copy commit id"]);
    const beat = m.BEATS.find((b) => b.s === 1)!;
    expect(labels({ type: "beat", id: beat.id })).toEqual(["Open", "Focus on web-bot", "Focus on web (main)", "—", "Ask web-bot"]);
  });

  test("empty ground offers Clear focus only when something is focused", () => {
    expect(labels({ type: "root" })).toEqual([]);
    expect(labels({ type: "root" }, { kind: "project", p: "app" })).toEqual(["Clear focus"]);
    expect(labels({ type: "project", p: "app" }, { kind: "project", p: "app" })).toEqual(["Ask about this project", "—", "Clear focus"]);
  });

  test("a right-click on one of several picks acts on all of them", () => {
    expect(pickKeyOf({ type: "wt", w: 1 })).toBe("w:1");
    const keys = ["w:1", "s:1", "a:app:b.ts", "c:c1"], a = acts();
    const items = picksMenuItems(m, ALL, keys, a);
    expect(items.map((it) => (it.kind === "separator" ? "—" : it.label))).toEqual(["Focus on both", "—", "Open 1 file and 1 commit", "Copy 2 paths", "—", "Deselect all 4"]);
    const go = (label: string) => { const it = items.find((i) => i.kind === "action" && i.label === label); if (it?.kind === "action") it.onSelect(); };
    go("Focus on both"); go("Open 1 file and 1 commit"); go("Copy 2 paths");
    expect(a.focusOn).toHaveBeenCalledWith({ kind: "many", parts: [{ kind: "wt", w: 1 }, { kind: "session", s: 1 }] });
    expect(a.openMany).toHaveBeenCalledWith(["a:app:b.ts", "c:c1"]);
    expect(a.copy).toHaveBeenCalledWith("~/dev/app-feature\n~/dev/app-feature/b.ts");
    const wts = picksMenuItems(m, ALL, ["w:0", "w:1"], acts()).map((it) => (it.kind === "separator" ? "—" : it.label));
    expect(wts).toEqual(["Focus on these 2 worktrees", "—", "Copy 2 paths", "—", "Deselect 2 worktrees"]);
  });
});
