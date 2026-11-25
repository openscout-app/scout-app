import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewData } from "../shared/review-window.ts";
import { aboutOf, byteRange, createCanvasService, htmlText, patchExcerpt, patchExcerptAt } from "./canvas.ts";
import { CANVAS_REACH_DAYS, canvasAgentName, canvasEarliestEnd, cleanPrompt } from "../shared/canvas.ts";
import type { RuntimeShow } from "./canvas-shows.ts";

const roots: string[] = [];
afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

/** A home with one project, one worktree and the files one session touched. */
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "canvas-test-"));
  roots.push(home);
  const wt = join(home, "dev", "proj-wt");
  mkdirSync(join(wt, "src"), { recursive: true });
  mkdirSync(join(home, "dev", "proj"), { recursive: true });
  writeFileSync(join(wt, "shot.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  writeFileSync(join(wt, "README.md"), "# Proj\n\nNotes.\n");
  writeFileSync(join(wt, "src", "a.ts"), "/** The a module. */\nexport const a = 1;\n");
  writeFileSync(join(wt, ".env"), "TOKEN=x\n");
  return { home, wt };
}

function review(from: number, extra?: Partial<ReviewData>): ReviewData {
  const strs = ["", "~/dev/proj-wt/shot.png", "proj:shot.png", "~/dev/proj-wt/README.md", "proj:README.md", "~/dev/proj-wt/src/a.ts", "proj:src/a.ts", "Edit", "Read", "~/dev/proj-wt/.env", "proj:.env", "make a"];
  const E = 0, R = 1;
  return {
    from, now: from + 60_000, host: "h", days: 2,
    kinds: ["e", "r", "c", "b", "o"], strs,
    wts: [["proj", "wt", "~/dev/proj-wt", 0]],
    projects: { proj: "~/dev/proj" },
    files: [[1, 0, 2], [3, 0, 4], [5, 0, 6], [9, 0, 10]],
    calls: [
      [10, 0, E, 7, 0, 2, 0, 20, 5],
      [20, 0, R, 8, 0, 0, 0, 0, 0],
      [25, 0, R, 8, 0, 3, 0, 0, 0],
      [30, 0, E, 7, 0, 1, 0, 4, 0],
      [40, 0, R, 8, 0, 2, 0, 0, 0],
    ],
    sessions: [{ sid: "s1", id: "11111111-2222-3333-4444-555555555555", h: "claude", agent: -1, turns: [[5, 11]], colds: [], errs: [] }],
    actors: [], asks: [],
    commits: [{ id: "c1", repo: "proj", t: 35, subj: "Add a", branch: "wt", merged: "", s: 0, w: 0, how: "commit" }],
    changes: [{
      id: "x", c: "c1", key: "proj:src/a.ts", path: "src/a.ts", add: 20, del: 5, isNew: true, isGone: false, kind: "code", hunks: 1,
      shape: 0, shapeWhy: "", cut: 0, patch: "@@ -0,0 +1,3 @@\n+import { b } from \"./b\";\n+\n+export const a = 1;",
    }],
    current: { "proj:src/a.ts": { path: "~/dev/proj-wt/src/a.ts", mt: 30, w: 0 } },
    ...extra,
  } as ReviewData;
}

describe("patchExcerpt", () => {
  test("starts after a new file's imports, whole import blocks included", () => {
    const p = "@@ -0,0 +1,8 @@\n+import { spawn } from \"node:child_process\";\n+import {\n+  a,\n+} from \"./b.js\";\n+\n+/** The helper. */\n+export function run() {\n+}";
    expect(patchExcerpt(p)).toBe("+/** The helper. */\n+export function run() {\n+}");
  });

  test("keeps one line of context before the first change and stops at the last change", () => {
    expect(patchExcerpt("@@ -1,4 +1,4 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;")).toBe(" const a = 1;\n-const b = 2;\n+const b = 3;");
  });

  test("reads the first hunk only, and nothing from a patch with no change", () => {
    expect(patchExcerpt("@@ -1 +1 @@\n-a\n+b\n@@ -9 +9 @@\n-c\n+d")).toBe("-a\n+b");
    expect(patchExcerpt("@@ -1,2 +1,2 @@\n x\n y")).toBe("");
    expect(patchExcerpt("")).toBe("");
  });

  test("caps the lines", () => {
    const p = "@@ -0,0 +1,40 @@\n" + Array.from({ length: 40 }, (_, i) => `+line ${i}`).join("\n");
    expect(patchExcerpt(p, 5).split("\n")).toHaveLength(5);
  });
});

describe("patchExcerptAt", () => {
  test("names the line, in the file after the change, of the excerpt's first change", () => {
    expect(patchExcerptAt("@@ -10,4 +12,5 @@ fn\n a\n b\n-c\n+C\n+D\n e")).toEqual({ text: " b\n-c\n+C\n+D", line: 14 });
    // imports at the hunk's top are left out, and so is their place
    expect(patchExcerptAt("@@ -1,3 +1,4 @@\n+import { x } from \"x\";\n import { y } from \"y\";\n+\n+export const z = 1;").line).toBe(4);
    expect(patchExcerptAt("@@ -1 +1 @@\n a")).toEqual({ text: "", line: null });
  });
});

describe("aboutOf", () => {
  test("reads a file's opening doc comment, past its imports", () => {
    const src = 'import { a } from "./a";\nimport {\n  b,\n} from "./b";\n\n/**\n * The menu helper\'s supervisor: it keeps\n * one helper running.\n *\n * More detail here.\n */\nexport function run() {}\n';
    expect(aboutOf(src)).toBe("The menu helper's supervisor: it keeps one helper running.");
  });

  test("reads line comments, docstrings and HTML comments, and skips licence text", () => {
    expect(aboutOf("// Copyright 2026 Someone. MIT licence.\n//\n// Parses the week.\nconst x = 1;\n")).toBe("Parses the week.");
    expect(aboutOf('#!/usr/bin/env python3\n"""Reap idle worktrees.\n\nMore."""\nimport os\n')).toBe("Reap idle worktrees.");
    expect(aboutOf("<!-- The page shell. -->\n<html></html>")).toBe("The page shell.");
  });

  test("finds the first doc comment when the file opens with code, and says nothing when it has none", () => {
    expect(aboutOf("const A = 1;\n\n/** Turns a call into a line. */\nexport function line() {}\n")).toBe("Turns a call into a line.");
    expect(aboutOf("const a = 1;\nexport const b = 2;\n")).toBe("");
  });

  test("keeps to its length at a sentence or a word", () => {
    const long = "/** " + "Word ".repeat(80) + "*/";
    const out = aboutOf(long, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("htmlText", () => {
  test("drops tags, scripts and styles", () => {
    expect(htmlText("<p>Hi <b>there</b></p><script>x<1</script><style>p{}</style>end").replace(/\s+/g, " ").trim()).toBe("Hi there end");
  });

  test("stays quick on a run of unclosed brackets", () => {
    const t = performance.now();
    htmlText("<".repeat(200_000));
    htmlText("<script".repeat(30_000));
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("names", () => {
  const base = { harness: "claude", id: "0f10496b", name: "", title: null, asked: null } as const;
  test("an area takes the session's title, its agent, its branch, the latest prompt, then its harness and id", () => {
    expect(canvasAgentName({ ...base, title: "Board view brief", name: "scout-x-1" })).toBe("Board view brief");
    expect(canvasAgentName({ ...base, title: "session-mw6p3qyy-3a039w-relay-agent", name: "scout-x-1" })).toBe("scout-x-1");
    expect(canvasAgentName({ ...base, name: "session-mw8koxss-hixp0n-relay-agent", worktree: "interconnection-architecture" })).toBe("interconnection-architecture");
    expect(canvasAgentName({ ...base, worktree: "canvas-web", asked: "fix it" })).toBe("canvas-web");
    expect(canvasAgentName({ ...base, worktree: "main", asked: "fix it" })).toBe("fix it");
    expect(canvasAgentName({ ...base, worktree: "main" })).toBe("Claude 0f10496b");
    expect(canvasAgentName({ ...base, name: "grok-a.main.studio-film" })).toBe("grok-a");
    expect(canvasAgentName({ ...base, name: "Codex B" })).toBe("Codex B");
  });

  test("a prompt leaves out attachment markers and relayed messages", () => {
    expect(cleanPrompt("[Image: original 2064x2752, displayed at 1659x2212.] go with B")).toBe("go with B");
    expect(cleanPrompt("Another Claude session sent a message: <x>hi</x>")).toBe("");
  });
});

describe("byteRange", () => {
  test("reads the forms a video element sends", () => {
    expect(byteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
    expect(byteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
    expect(byteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
    expect(byteRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  test("refuses ranges past the end, and ignores what it cannot read", () => {
    expect(byteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
    expect(byteRange("bytes=-0", 1000)).toBe("unsatisfiable");
    expect(byteRange("bytes=9-3", 1000)).toBeNull(); // not a range: the whole file
    expect(byteRange(null, 1000)).toBeNull();
    expect(byteRange("bytes=-", 1000)).toBeNull();
    expect(byteRange("bytes=0-1,4-5", 1000)).toBeNull();
    expect(byteRange("items=0-1", 1000)).toBeNull();
  });
});

describe("createCanvasService", () => {
  test("builds an agent's cards and files from what its session touched", async () => {
    const { home } = fixture();
    const from = Date.now() - 60_000;
    const svc = createCanvasService({ review: { data: async () => review(from) }, home, tempRoots: [], titleOf: async (ref) => (ref.endsWith("5555") ? "Proj work" : null) });
    const d = await svc.data(2);

    expect(d.agents).toHaveLength(1);
    expect(d.agents[0]).toMatchObject({
      id: "s1", project: "proj", worktree: "wt", state: "working", nowFile: "proj:src/a.ts",
      ref: "session:claude:11111111-2222-3333-4444-555555555555", title: "Proj work", asked: "make a",
    });
    expect(d.projects.map((p) => p.name)).toEqual(["proj"]);

    // the screenshot it looked at and the document it wrote are cards; .env is never one
    expect(d.items.map((it) => [it.name, it.kind, it.how])).toEqual([["README.md", "doc", "wrote"], ["shot.png", "image", "read"]]);
    // the code it worked is a file, with the newest change its session committed, imports left out
    expect(d.work).toEqual([{
      agent: 0, key: "proj:src/a.ts", rel: "src/a.ts", edits: 1, reads: 1, add: 20, del: 5, work: 6.5, last: from + 40_000,
      patch: "+export const a = 1;", commit: "Add a", line: 3, since: "c1", path: "~/dev/proj-wt/src/a.ts", tree: "wt", root: join(home, "dev", "proj-wt"), about: "The a module.",
    }]);
    // the file view reads the copy the agent worked, as it is now
    expect((await svc.text("~/dev/proj-wt/src/a.ts"))?.text).toContain("export const a = 1;");
    expect(await svc.text("~/dev/proj-wt/shot.png")).toBeNull();
    // the Overview counts every repo file, documents too
    expect(d.files.map((f) => f.key).sort()).toEqual(["proj:.env", "proj:README.md", "proj:shot.png", "proj:src/a.ts"]);

    expect(await svc.real("~/dev/proj-wt/shot.png")).toEndWith("/dev/proj-wt/shot.png");
    expect(await svc.real("~/dev/proj-wt/.env")).toBeNull();
    expect((await svc.head("~/dev/proj-wt/README.md"))?.head).toContain("# Proj");
  });

  test("an Arc diagram the agent wrote is a card, and its source reads as it is now, unchanged versions without the text", async () => {
    const { home, wt } = fixture();
    mkdirSync(join(wt, "docs"), { recursive: true });
    writeFileSync(join(wt, "docs", "overview.arc.json"), "{\"layout\":{}}");
    const from = Date.now() - 60_000;
    const r = review(from);
    r.strs.push("~/dev/proj-wt/docs/overview.arc.json", "proj:docs/overview.arc.json");
    r.files.push([r.strs.length - 2, 0, r.strs.length - 1]);
    r.calls.push([45, 0, 0, 7, 0, r.files.length - 1, 0, 1, 0]);
    const svc = createCanvasService({ review: { data: async () => r }, home, tempRoots: [] });
    const d = await svc.data(2);
    expect(d.items.find((it) => it.name === "overview.arc.json")).toMatchObject({ kind: "embed", embed: { provider: "arc" }, how: "wrote", fileKey: "proj:docs/overview.arc.json" });

    const first = await svc.arc("~/dev/proj-wt/docs/overview.arc.json");
    expect(first?.text).toBe("{\"layout\":{}}");
    expect(await svc.arc("~/dev/proj-wt/docs/overview.arc.json", first!.version)).toEqual({ version: first!.version, path: "~/dev/proj-wt/docs/overview.arc.json", mt: first!.mt });
    // the agent saves again: a new version, with its text
    writeFileSync(join(wt, "docs", "overview.arc.json"), "{\"layout\":{\"width\":1}}");
    const next = await svc.arc("~/dev/proj-wt/docs/overview.arc.json", first!.version);
    expect(next?.text).toBe("{\"layout\":{\"width\":1}}");
    expect(next?.version).not.toBe(first!.version);
    // never another listed file, and never one the build did not list
    expect(await svc.arc("~/dev/proj-wt/README.md")).toBeNull();
    expect(await svc.arc("~/dev/proj-wt/docs/other.arc.json")).toBeNull();
  });

  test("a shown Arc diagram reads the newest version of its item", async () => {
    const { home } = fixture();
    const from = Date.now() - 60_000;
    const root = realpathSync(join(home, "dev", "proj"));
    const show = (id: string, createdAt: number) => ({
      id, itemId: "item1", agentId: "a", projectRoot: root, worktree: root, sourcePath: join(root, "overview.arc.json"),
      kind: "document" as const, mediaType: "application/json", byteSize: 20, createdAt,
    });
    let shows = [show("v1", from + 1000)];
    const svc = createCanvasService({
      review: { data: async () => review(from) }, home, tempRoots: [],
      shows: { list: async () => shows, bytes: async (id) => new Response(`{"v":"${id}"}`) },
    });
    const d = await svc.data(2);
    const card = d.items.find((it) => it.how === "shown");
    expect(card?.path).toBe("show:v1");
    // the runtime files it as a document; the canvas embeds it
    expect(card).toMatchObject({ kind: "embed", embed: { provider: "arc" } });
    expect((await svc.arc("show:v1"))?.text).toBe('{"v":"v1"}');
    // the agent shows it again: the open card's old path reads the new version, once the item is listed again
    shows = [show("v1", from + 1000), show("v2", from + 2000)];
    await new Promise((r) => setTimeout(r, 1100));
    const newer = await svc.arc("show:v1", "\"show-v1\"");
    expect(newer).toMatchObject({ version: "\"show-v2\"", path: "show:v2", text: '{"v":"v2"}' });
    // a past window does not follow: it reads the version its card names, though a newer one is listed
    expect(await svc.arc("show:v1", null, false)).toMatchObject({ version: "\"show-v1\"", path: "show:v1", text: '{"v":"v1"}' });
    expect(await svc.arc("show:v1", "\"show-v1\"", false)).toEqual({ version: "\"show-v1\"", path: "show:v1", mt: from + 1000 });
    // a version the canvas never listed is not read
    expect(await svc.arc("show:v9", null, false)).toBeNull();
  });

  test("a window of hours reads the day around it and keeps only the calls since its start", async () => {
    const { home } = fixture();
    // the session's calls: the document 3 hours back, the screenshot 1 hour back, the code 10 minutes back
    const now = Date.now(), from = now - 24 * 3_600_000, at = (ago: number) => Math.round((now - ago - from) / 1000);
    const asked: number[] = [];
    const base = review(from);
    const r = { ...base, now, calls: [
      [at(3 * 3_600_000), 0, 0, 7, 0, 1, 0, 2, 0],
      [at(3_600_000 - 1_000), 0, 1, 8, 0, 0, 0, 0, 0],
      [at(10 * 60_000), 0, 0, 7, 0, 2, 0, 20, 5],
    ] } as ReviewData;
    const svc = createCanvasService({ review: { data: async (d) => { asked.push(d); return r; } }, home, tempRoots: [] });
    const one = await svc.data(1), four = await svc.data(4);
    expect(asked).toEqual([1, 1]);
    expect([one.hours, one.from]).toEqual([1, now - 3_600_000]);
    expect(one.items.map((it) => it.name)).toEqual(["shot.png"]);
    expect(four.items.map((it) => it.name)).toEqual(["shot.png", "README.md"]);
    expect(one.work.map((w) => w.key)).toEqual(["proj:src/a.ts"]);
    await svc.data(48);
    expect(asked).toEqual([1, 1, 2]);
  });

  test("a past window keeps only what falls between its start and its end, its agents quiet", async () => {
    const { home } = fixture();
    // the code a minute back, the document 3 hours back, the screenshot 5 hours back; the asked prompt 2 hours back
    const now = Date.now(), from = now - 24 * 3_600_000, at = (ago: number) => Math.round((now - ago - from) / 1000);
    const base = review(from);
    const r = { ...base, now, calls: [
      [at(5 * 3_600_000), 0, 1, 8, 0, 0, 0, 0, 0],
      [at(3 * 3_600_000), 0, 0, 7, 0, 1, 0, 2, 0],
      [at(60_000), 0, 0, 7, 0, 2, 0, 20, 5],
    ], sessions: [{ ...base.sessions[0], turns: [[at(6 * 3_600_000), 0], [at(2 * 3_600_000), 11]] }],
    commits: [{ ...base.commits[0], t: at(60_000) }] } as ReviewData;
    const root = realpathSync(join(home, "dev", "proj"));
    const show = (id: string, ago: number): RuntimeShow => ({
      id, itemId: id, agentId: "a", sessionId: "11111111-2222-3333-4444-555555555555", harness: "claude", projectRoot: root, worktree: root,
      sourcePath: `/x/${id}.png`, kind: "image", mediaType: "image/png", byteSize: 1, createdAt: now - ago,
    });
    const since: number[] = [];
    const asked: number[] = [];
    const svc = createCanvasService({
      review: { data: async (d) => { asked.push(d); return r; } }, home, tempRoots: [],
      // the runtime lists from `since`; the show before it stands for one the runtime would not list
      shows: { list: async (_root, s) => { since.push(s); return [show("inside", 6 * 3_600_000), show("later", 2 * 3_600_000)]; }, bytes: async () => new Response(null) },
    });
    const end = now - 4 * 3_600_000, minute = Math.floor(end / 60_000) * 60_000;
    const past = await svc.data(4, end);
    expect([past.live, past.end, past.from, past.hours]).toEqual([false, minute, minute - 4 * 3_600_000, 4]);
    // the screenshot is in; the document and the code came after the window's end, and so did the later show
    expect(past.items.filter((it) => it.how !== "shown").map((it) => it.name)).toEqual(["shot.png"]);
    expect(since).toEqual([minute - 4 * 3_600_000]);
    expect(past.items.filter((it) => it.how === "shown").map((it) => it.shown?.id)).toEqual(["inside"]);
    expect(past.work).toEqual([]);
    // presence is off in a past window, and what it was asked is what it had been asked by the window's end
    expect(past.agents[0]).toMatchObject({ state: "quiet", asked: null });

    // the live window is a build of its own, with everything since its start
    const live = await svc.data(4);
    expect([live.live, live.end]).toEqual([true, now]);
    expect(live.items.filter((it) => it.how !== "shown").map((it) => it.name)).toEqual(["README.md"]);
    expect(live.agents[0]).toMatchObject({ state: "working", asked: "make a" });
    expect(asked).toEqual([1, 1]);
  });

  test("a window's end is clamped: not after now, not before the reach of the Review window", async () => {
    const { home } = fixture();
    const asked: number[] = [];
    const svc = createCanvasService({ review: { data: async (d) => { asked.push(d); return review(Date.now() - 60_000); } }, home, tempRoots: [] });
    const now = Date.now();
    expect((await svc.data(4, now + 3_600_000)).live).toBe(true);
    expect((await svc.data(4, "soon")).live).toBe(true);
    const far = await svc.data(4, now - 30 * 86_400_000);
    expect(far.live).toBe(false);
    expect(Math.abs(far.end - canvasEarliestEnd(4, now))).toBeLessThanOrEqual(60_000);
    expect(asked).toEqual([1, CANVAS_REACH_DAYS]);
    // a past window is kept and served again without a read
    await svc.data(4, far.end);
    expect(asked).toHaveLength(2);
  });

  test("a worked file's diff runs from before the session's first commit to now, uncommitted edits included", async () => {
    const { home } = fixture();
    const wt = join(home, "dev", "proj-wt"), a = join(wt, "src", "a.ts"), p = "~/dev/proj-wt/src/a.ts";
    const g = (...args: string[]) => execFileSync("git", ["-C", wt, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t", ...args]).toString().trim();
    const svc = createCanvasService({ review: { data: async () => review(Date.now() - 60_000) }, home, tempRoots: [] });
    await svc.data(2);
    g("init", "-q"); g("add", "README.md"); g("commit", "-qm", "base");
    writeFileSync(a, "one\ntwo\n");
    // not in git yet: all of it is new
    expect(await svc.diff(p)).toEqual({ path: p, from: "new", diff: "@@ -0,0 +1,2 @@\n+one\n+two", cut: 0 });
    g("add", "src/a.ts"); g("commit", "-qm", "Add a");
    writeFileSync(a, "one\nTWO\n"); g("commit", "-qam", "Change a");
    const first = g("rev-parse", "HEAD");
    writeFileSync(a, "one\nTWO\nthree\n");
    expect(await svc.diff(p, first)).toEqual({ path: p, from: "since", diff: "@@ -1,2 +1,3 @@\n one\n-two\n+TWO\n+three", cut: 0 });
    expect(await svc.diff(p)).toEqual({ path: p, from: "uncommitted", diff: "@@ -1,2 +1,3 @@\n one\n TWO\n+three", cut: 0 });
    // a commit git does not have, or something that is not a commit id, reads against HEAD
    expect((await svc.diff(p, "0".repeat(40)))?.from).toBe("uncommitted");
    expect((await svc.diff(p, "--output=/dev/null"))?.from).toBe("uncommitted");
    expect(await svc.diff("~/dev/proj-wt/shot.png")).toBeNull();
    expect(await svc.diff("~/dev/proj-wt/.env")).toBeNull();
  });

  test("a worked file whose copy is gone diffs its session's commits, read from the project's main checkout", async () => {
    const { home } = fixture();
    const main = join(home, "dev", "proj");
    const g = (...args: string[]) => execFileSync("git", ["-C", main, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "-c", "user.name=t", "-c", "user.email=t@t", ...args]).toString().trim();
    g("init", "-q"); writeFileSync(join(main, "README.md"), "# Proj\n"); g("add", "README.md"); g("commit", "-qm", "base");
    mkdirSync(join(main, "src")); writeFileSync(join(main, "src", "a.ts"), "one\ntwo\n"); g("add", "src/a.ts"); g("commit", "-qm", "Add a");
    const c1 = g("rev-parse", "HEAD");
    writeFileSync(join(main, "src", "a.ts"), "one\nTWO\n"); g("commit", "-qam", "Change a");
    const c2 = g("rev-parse", "HEAD");
    writeFileSync(join(main, "src", "a.ts"), "one\nTWO\nlater, not the session's\n"); g("commit", "-qam", "Someone else");
    const change = { id: "x", key: "proj:src/a.ts", path: "src/a.ts", add: 1, del: 0, isNew: false, isGone: false, kind: "code", hunks: 1, shape: 0, shapeWhy: "", cut: 0, patch: "@@ -1 +1 @@\n-two\n+TWO" };
    const data = review(Date.now() - 60_000, {
      commits: [
        { id: c1, repo: "proj", t: 35, subj: "Add a", branch: "wt", merged: "", s: 0, w: 0, how: "commit" },
        { id: c2, repo: "proj", t: 38, subj: "Change a", branch: "wt", merged: "", s: 0, w: 0, how: "commit" },
      ],
      changes: [{ ...change, c: c1 }, { ...change, id: "y", c: c2 }],
      current: {},
    } as Partial<ReviewData>);
    const svc = createCanvasService({ review: { data: async () => data }, home, tempRoots: [] });
    const d = await svc.data(2);
    expect(d.work[0]).toMatchObject({ key: "proj:src/a.ts", since: c1 });
    expect(d.work[0].path).toBeUndefined();
    // first to last of the session's commits, no further
    expect(await svc.commitDiff("proj:src/a.ts", c1)).toEqual({ path: "proj:src/a.ts", from: "commits", diff: "@@ -0,0 +1,2 @@\n+one\n+TWO", cut: 0 });
    // only a file and first commit the canvas listed
    expect(await svc.commitDiff("proj:src/a.ts", c2)).toBeNull();
    expect(await svc.commitDiff("proj:README.md", c1)).toBeNull();
  });

  test("a file the agent only read is not in its files", async () => {
    const { home } = fixture();
    const from = Date.now() - 60_000;
    const r = review(from);
    r.calls = r.calls.filter((c) => !(c[2] === 0 && c[5] === 2));
    const d = await createCanvasService({ review: { data: async () => r }, home, tempRoots: [] }).data(2);
    expect(d.work).toEqual([]);
  });

  test("serves the last result while the next one builds", async () => {
    const { home } = fixture();
    let t = 1_000_000, builds = 0;
    let release: () => void = () => {};
    const base = Date.now() - 60_000;
    const svc = createCanvasService({
      home, tempRoots: [], clock: () => t,
      review: {
        data: async () => {
          builds++;
          if (builds > 1) await new Promise<void>((r) => { release = r; });
          return review(base + builds);
        },
      },
    });
    const first = await svc.data(2);
    expect(builds).toBe(1);

    t += 10_000; // fresh: no build
    expect(await svc.data(2)).toBe(first);
    expect(builds).toBe(1);

    t += 15_000; // stale: the old result at once, one build behind it
    expect(await svc.data(2)).toBe(first);
    expect(await svc.data(2)).toBe(first);
    expect(builds).toBe(2);

    release();
    await new Promise((r) => setTimeout(r, 20));
    const second = await svc.data(2);
    expect(second).not.toBe(first);
    expect(second.from).toBe(first.from + 1);
  });

  test("waits for a build when the last result is too old to show", async () => {
    const { home } = fixture();
    let t = 1_000_000, builds = 0;
    const svc = createCanvasService({ home, tempRoots: [], clock: () => t, review: { data: async () => { builds++; return review(Date.now() - 60_000); } } });
    const first = await svc.data(2);
    t += 11 * 60_000;
    expect(await svc.data(2)).not.toBe(first);
    expect(builds).toBe(2);
  });
});
