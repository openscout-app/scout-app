import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorldWeekPayload } from "./world-week.ts";
import {
  branchOf, createReviewWindowService, parseLog, parseNumstat, parseShow, parseWorktrees, Places, reviewDays, shapeOf, worktreeName,
  LOG_FORMAT, BUILD_ROOTS_CAP, BUILD_GIT_CALLS_CAP, type Git,
} from "./review-window.ts";

const HOME = realpathSync(mkdtempSync(join(tmpdir(), "review-window-")));
afterAll(() => rmSync(HOME, { recursive: true, force: true }));

test("review days default to 2 and stay within 1 to 7", () => {
  expect([reviewDays(undefined), reviewDays("0"), reviewDays("3"), reviewDays("30"), reviewDays("x")]).toEqual([2, 2, 3, 7, 2]);
});

test("worktree names: main, the branch of a repo-branch sibling, the task folder of a harness worktree", () => {
  expect(worktreeName("/h/dev/app", "/h/dev/app")).toBe("main");
  expect(worktreeName("/h/dev/app-feature-x", "/h/dev/app")).toBe("feature-x");
  expect(worktreeName("/h/.codex/worktrees/1a2b3c4d5e/app", "/h/dev/app")).toBe("1a2b3c4d");
  expect(worktreeName("/h/elsewhere/other", "/h/dev/app")).toBe("other");
});

test("a gone worktree takes the longest main checkout name that prefixes it", async () => {
  const git: Git = async (dir) => `${dir}\n${dir}/.git\n`;
  const places = new Places(git);
  await places.dir("/h/dev/scout");
  await places.dir("/h/dev/demo-app");
  expect(places.gone("/h/dev/demo-app-chat/src/x")).toMatchObject({ project: "demo-app", wt: "chat", top: "/h/dev/demo-app-chat" });
  expect(places.gone("/h/dev/scout-fix/src")).toMatchObject({ project: "scout", wt: "fix" });
  expect(places.gone("/h/elsewhere/thing")).toBeNull();
  expect(places.at("/h/dev/demo-app-chat/src/y.ts")?.wt).toBe("chat");
});

test("git output parsers", () => {
  const log = `\x1eaaa\x1f100\x1fme\x1fme@x\x1frefs/heads/feature\x1fAdd a\n\x1ebbb\x1f101\x1fGitHub\x1fMe@X\x1frefs/remotes/origin/main\x1fAdd a (#12)\n\x1eaaa\x1f100\x1fme\x1fme@x\x1fHEAD\x1fAdd a\n`;
  expect(parseLog(log)).toEqual([
    { sha: "aaa", at: 100, author: "me", email: "me@x", ref: "refs/heads/feature", subj: "Add a" },
    { sha: "bbb", at: 101, author: "GitHub", email: "me@x", ref: "refs/remotes/origin/main", subj: "Add a (#12)" },
  ]);
  expect(LOG_FORMAT.split("%x1f").length).toBe(6);
  expect([branchOf("refs/heads/a/b"), branchOf("refs/remotes/origin/a/b"), branchOf("HEAD")]).toEqual(["a/b", "a/b", ""]);
  // what git log --source prints: the short name it matched
  expect([branchOf("session-nav"), branchOf("origin/roster-codes"), branchOf("upstream/port/x"), branchOf("port/x")]).toEqual(["session-nav", "roster-codes", "port/x", "port/x"]);
  const show = "diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n a\n+b\n-c\n+d\ndiff --git a/n.md b/n.md\nnew file mode 100644\n--- /dev/null\n+++ b/n.md\n@@ -0,0 +1 @@\n+hi\n";
  expect(parseShow(show).map(({ path, isNew, add, del }) => ({ path, isNew, add, del }))).toEqual([
    { path: "src/a.ts", isNew: false, add: 2, del: 1 }, { path: "n.md", isNew: true, add: 1, del: 0 },
  ]);
  expect(parseNumstat("3\t1\tsrc/a.ts\n-\t-\timg.png\n2\t0\tsrc/{old => new}/b.ts\n")).toMatchObject([
    { path: "src/a.ts", add: 3, del: 1 }, { path: "img.png", add: 0, del: 0 }, { path: "src/new/b.ts", add: 2 },
  ]);
  expect(parseWorktrees("worktree /h/app\nHEAD 1\nbranch refs/heads/main\n\nworktree /h/app-x\nHEAD 2\nbranch refs/heads/x\n\nworktree /h/app-d\ndetached\n"))
    .toEqual([{ top: "/h/app", branch: "main" }, { top: "/h/app-x", branch: "x" }, { top: "/h/app-d", branch: "" }]);
});

test("shape: generated files sink, declarations rise, comment-only diffs halve", () => {
  const code = shapeOf("src/a.ts", "@@\n+export function a() {}\n+  return 1;\n", 2, 0, false, false);
  const lock = shapeOf("bun.lock", "@@\n+x\n", 1, 0, false, false);
  const note = shapeOf("src/b.ts", "@@\n+// a note\n", 1, 0, false, false);
  expect(code.kind).toBe("code");
  expect(code.shapeWhy).toContain("1 declaration changed");
  expect(lock.kind).toBe("generated");
  expect(lock.shape).toBeLessThan(0.05);
  expect(note.shapeWhy).toContain("comments only");
  expect(note.shape).toBeLessThan(code.shape);
});

/* a host with one repo: its main checkout, a feature worktree on disk, and one that is gone */
const MAIN = join(HOME, "dev/app"), FEAT = join(HOME, "dev/app-feature"), GONE = join(HOME, "dev/app-gone");
mkdirSync(join(MAIN, "src"), { recursive: true });
mkdirSync(join(FEAT, "src"), { recursive: true });
mkdirSync(join(HOME, ".ssh"), { recursive: true });
writeFileSync(join(FEAT, "src/a.ts"), "export const a = 2;\nexport const b = 3;\n");
writeFileSync(join(MAIN, "src/a.ts"), "export const a = 1;\n");
writeFileSync(join(FEAT, "shot.png"), "png");
writeFileSync(join(FEAT, "notes.md"), "---\ntitle: x\n---\n# Notes\nline\n");
writeFileSync(join(HOME, ".ssh/id_rsa"), "secret");
mkdirSync(join(HOME, "notes"), { recursive: true });
writeFileSync(join(HOME, "notes/n.md"), "a note outside every approved folder");

const FROM = 1_800_000_000_000, F0 = FROM / 1000;
const strs = [
  "~/dev/app-feature", "Edit", join(FEAT, "src/a.ts"), "Bash", "git commit -m 'Add a'", "Read", "~/dev/app-gone/old.md", "",
  join(FEAT, "notes.md"), join(FEAT, "shot.png"), "~/notes/n.md",
];
const week: WorldWeekPayload = {
  now: FROM + 3_600_000, from: FROM,
  actors: [
    { i: 0, id: "operator", name: "Art", kind: "person", node: null, branch: null, cls: null, project: null, root: null, harness: null },
    { i: 1, id: "app-agent", name: "app", kind: "agent", node: null, branch: null, cls: null, project: "app", root: null, harness: "claude" },
  ],
  asks: [[FROM + 1000, FROM + 900_000, "c", 0, 1, "Add a", "", "b"]],
  msgs: [], hosts: [{ name: "host-a", platform: "darwin", self: true, seen: null, tailnet: false, caps: [] }],
  events: [
    [100, 0, "e", 0, 1, 2, 2, 2, 1],
    [110, 0, "r", 0, 5, 8, 8],
    [115, 0, "r", 0, 5, 9, 9],
    [200, 0, "b", 0, 3, 4, -1],
    [300, 0, "e", 0, 1, 6, -1],
    [310, 0, "e", 0, 1, 10, -1],
  ],
  strs, sessions: [["sess-0001-aaaa", "claude", "", [[50, 4]]]],
  work: { 0: { s: 0, t0: 50, t1: 400, n: 5, task: "Add a", files: [], urls: [], cmds: [] } }, allow: [],
  roots: {}, quota: [], usage: {}, usageLoose: {}, colds: [],
};
const SHOW = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n-export const a = 1;\n+export const a = 2;\n+export const b = 3;\n";
const calls: string[][] = [];
const git: Git = async (dir, args) => {
  calls.push(args);
  if (args[0] === "rev-parse") {
    if (dir.startsWith(FEAT)) return `${FEAT}\n${MAIN}/.git\n`;
    if (dir.startsWith(MAIN)) return `${MAIN}\n${MAIN}/.git\n`;
    return null;
  }
  if (args[0] === "worktree") return `worktree ${MAIN}\nbranch refs/heads/main\n\nworktree ${FEAT}\nbranch refs/heads/feature\n`;
  if (args[0] === "config") return "me@x\n";
  if (args[0] === "log") return [
    ["c1", F0 + 205, "me", "me@x", "refs/heads/feature", "Add a"],
    ["c2", F0 + 900, "GitHub", "me@x", "refs/remotes/origin/main", "Add a (#12)"],
    ["c3", F0 + 950, "someone", "them@y", "refs/remotes/origin/main", "Their change"],
  ].map((r) => "\x1e" + r.join("\x1f")).join("\n") + "\n";
  if (args[0] === "show") return SHOW;
  return null;
};

test("the window: worktrees from git, gone ones from their sibling, commits tied to the session that made them", async () => {
  const svc = createReviewWindowService({ week: { get: async () => week }, git, home: HOME });
  const d = await svc.data(2);
  expect(d.host).toBe("host-a");
  expect(d.projects).toEqual({ app: "~/dev/app" });
  expect(d.wts).toContainEqual(["app", "feature", "~/dev/app-feature", 0, "feature"]);
  expect(d.wts).toContainEqual(["app", "gone", "~/dev/app-gone", 1, ""]);
  const feat = d.wts.findIndex((w) => w[1] === "feature");
  const gone = d.wts.findIndex((w) => w[1] === "gone");
  // a call outside every repo still belongs to the session's folder
  expect(d.calls.map((c) => c[4])).toEqual([feat, feat, feat, feat, gone, feat]);
  // a file row belongs to the folder that holds it, not to the session's last worktree
  expect(d.files.map(([p, w]) => [d.strs[p], w])).toContainEqual(["~/notes/n.md", -1]);
  // the squash twin folds into the branch commit; someone else's upstream commit is not this host's work
  expect(d.commits).toEqual([{ id: "c1", repo: "app", t: 205, subj: "Add a", branch: "feature", merged: "", mergedAs: "12", s: 0, w: feat, how: "commit" }]);
  expect(d.changes.map((c) => [c.key, c.add, c.del, c.kind])).toEqual([["app:src/a.ts", 2, 1, "code"]]);
  expect(d.sessions[0]).toMatchObject({ sid: "sess-000", agent: 1 });
  expect(d.actors[1]).toEqual(["app", "agent", "app", "claude", "app-agent"]);
  // the newest touched copy is the one that counts; the gone file is listed as gone
  expect(d.current["app:src/a.ts"]).toMatchObject({ path: "~/dev/app-feature/src/a.ts", w: feat });
  expect(d.current["app:shot.png"]).toMatchObject({ image: true });
  expect(d.current["app:old.md"]).toMatchObject({ gone: true, mt: -1 });
  // on disk but outside every approved folder: listed as closed, never served
  expect(d.current["~/notes/n.md"]).toMatchObject({ path: "~/notes/n.md", closed: true });
  expect(d.current["app:src/a.ts"].closed).toBeUndefined();
  expect(calls.every((a) => !["commit", "checkout", "reset", "stash", "fetch", "push"].includes(a[0]))).toBe(true);
  // cached: a second read in the window does not run git again
  const n = calls.length;
  await svc.json(2);
  expect(calls.length).toBe(n);
});

test("file reads: only listed paths, within approved roots, off the deny list; images only as raw", async () => {
  const svc = createReviewWindowService({ week: { get: async () => week }, git, home: HOME });
  expect(await svc.file("~/dev/app-feature/src/a.ts", "head")).toBeNull(); // nothing built yet
  await svc.data(2);
  const head = await svc.file("~/dev/app-feature/src/a.ts", "head");
  expect(head).toMatchObject({ kind: "head", body: { head: "export const a = 2;\nexport const b = 3;\n", lines: 3 } });
  expect(await svc.file("~/dev/app-feature/notes.md", "head")).toMatchObject({ body: { head: "# Notes\nline\n" } });
  // the code pane gets the source as written, front matter and all
  expect(await svc.file("~/dev/app-feature/src/a.ts", "text")).toMatchObject({ kind: "text", body: { text: "export const a = 2;\nexport const b = 3;\n", lines: 3, cut: 0 } });
  expect(await svc.file("~/dev/app-feature/shot.png", "text")).toBeNull();
  expect(await svc.file("~/.ssh/id_rsa", "text")).toBeNull();
  expect(await svc.file("~/dev/app-feature/shot.png", "raw")).toEqual({ kind: "raw", real: join(FEAT, "shot.png") });
  expect(await svc.file("~/dev/app-feature/shot.png", "head")).toBeNull();
  expect(await svc.file("~/dev/app-feature/src/a.ts", "raw")).toBeNull();
  expect(await svc.file("~/dev/app/src/a.ts", "head")).toBeNull(); // on disk, but not the copy the window lists
  expect(await svc.file("~/.ssh/id_rsa", "head")).toBeNull();
  expect(await svc.file("~/notes/n.md", "head")).toBeNull();
  expect(await svc.file("~/dev/app-feature/../app-feature/src/a.ts", "head")).toBeNull();
});

test("a background job's scratch folder opens for its images and nothing else", async () => {
  const JOB = join(HOME, ".claude/jobs/job123");
  mkdirSync(join(JOB, "tmp"), { recursive: true });
  writeFileSync(join(JOB, "tmp/fixed.png"), "png");
  writeFileSync(join(JOB, "tmp/query.md"), "scratch notes");
  writeFileSync(join(JOB, "state.png"), "png");
  const n = strs.length;
  const w: WorldWeekPayload = {
    ...week,
    strs: [...strs, join(JOB, "tmp/fixed.png"), join(JOB, "tmp/query.md"), join(JOB, "state.png")],
    events: [...week.events, [320, 0, "r", 0, 5, n, n], [330, 0, "r", 0, 5, n + 1, n + 1], [340, 0, "r", 0, 5, n + 2, n + 2]],
  };
  const svc = createReviewWindowService({ week: { get: async () => w }, git, home: HOME });
  const d = await svc.data(2);
  expect(d.current["~/.claude/jobs/job123/tmp/fixed.png"]).toMatchObject({ image: true });
  expect(d.current["~/.claude/jobs/job123/tmp/fixed.png"].closed).toBeUndefined();
  expect(d.current["~/.claude/jobs/job123/tmp/query.md"]).toMatchObject({ closed: true });
  expect(d.current["~/.claude/jobs/job123/state.png"]).toMatchObject({ closed: true });
  expect(await svc.file("~/.claude/jobs/job123/tmp/fixed.png", "raw")).toEqual({ kind: "raw", real: join(JOB, "tmp/fixed.png") });
  expect(await svc.file("~/.claude/jobs/job123/tmp/fixed.png", "head")).toBeNull();
  expect(await svc.file("~/.claude/jobs/job123/tmp/query.md", "head")).toBeNull();
  expect(await svc.file("~/.claude/jobs/job123/state.png", "raw")).toBeNull();
});

test("historical denied paths retain counts but never added or deleted patch content", async () => {
  const { execFileSync } = await import("node:child_process");
  const repo = join(HOME, "secrets");
  mkdirSync(repo);
  const run = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  run("init"); run("config", "user.email", "me@x"); run("config", "user.name", "Me");
  writeFileSync(join(repo, "credentials.json"), "deleted-secret\n");
  run("add", "."); run("commit", "-m", "Add credentials");
  rmSync(join(repo, "credentials.json"));
  writeFileSync(join(repo, ".env"), "added-secret\n");
  run("add", "-A"); run("commit", "-m", "Replace credentials");
  const { execGit } = await import("./review-window.ts");
  const now = Date.now();
  const d = await createReviewWindowService({
    home: HOME, git: execGit,
    week: { get: async () => ({ ...week, from: now - 86400000, now: now + 1000,
      strs: [repo, "Read", join(repo, ".env")], events: [[1, 0, "r", 0, 1, 2, 2]] }) },
  }).data(2);
  expect(d.changes.some((c) => c.path === ".env" && c.add > 0)).toBe(true);
  expect(d.changes.some((c) => c.path === "credentials.json" && c.isGone && c.del > 0)).toBe(true);
  expect(d.changes.every((c) => c.patch === "")).toBe(true);
  expect(JSON.stringify(d)).not.toContain("deleted-secret");
  expect(JSON.stringify(d)).not.toContain("added-secret");
});

test("long identifiers stay whole and current copies stay in their worktrees", async () => {
  const long = "src/" + "a".repeat(150);
  const paths = [join(MAIN, long + "x.ts"), join(FEAT, long + "x.ts"), join(FEAT, long + "y.ts")];
  for (const p of paths) writeFileSync(p, p);
  const w = { ...week, strs: [MAIN, FEAT, "Edit", ...paths],
    events: [[10, 0, "e", 0, 2, 3, 3], [20, 1, "e", 0, 2, 4, 4], [30, 1, "e", 0, 2, 5, 5]] } as WorldWeekPayload;
  const d = await createReviewWindowService({ home: HOME, week: { get: async () => w },
    git: async (dir, args, opts) => args[0] === "show" ? SHOW.replaceAll("src/a.ts", long + "x.ts") : git(dir, args, opts) }).data(2);
  expect(new Set(d.files.map((f) => d.strs[f[2]])).size).toBe(2);
  expect(d.changes[0].key).toBe(d.strs[d.files[0][2]]);
  const copies = Object.entries(d.currentByWorktree!).filter(([k]) => JSON.parse(k)[0] === "app:" + long + "x.ts");
  expect(copies.length).toBe(2);
  expect(new Set(copies.map(([, c]) => c.path)).size).toBe(2);
});

test("builds serialize across day counts, coalesce pending reads and bound shows while retaining own-author session attribution", async () => {
  let active = 0, peak = 0, shows = 0;
  const svc = createReviewWindowService({ home: HOME,
    week: { get: async () => { active++; peak = Math.max(peak, active); await Bun.sleep(10); active--; return week; } },
    git: async (dir, args, opts) => {
      if (args[0] === "log") return Array.from({ length: 250 }, (_, i) =>
        "\x1e" + [i === 0 ? "a".repeat(40) : "hash" + i, F0 + (i === 50 ? 205 : 900), "Me", i < 50 ? "other@x" : "me@x", "refs/heads/main", "Change"].join("\x1f")).join("\n");
      if (args[0] === "show") { shows++; expect(args.at(-1)).not.toMatch(/^hash([1-9]|[1-4][0-9])$/); expect(args.at(-1)).not.toBe("a".repeat(40)); }
      return git(dir, args, opts);
    } });
  const a = svc.data(1), b = svc.data(2), again = svc.data(1);
  const result = await a;
  expect(result).toBe(await again); await b;
  expect(result.commits.find((c) => c.id === "hash50")).toMatchObject({ s: 0, how: "commit" });
  expect(result.changes.some((c) => c.c === "hash50")).toBe(true);
  expect(peak).toBe(1);
  expect(shows).toBe(100); // second build reuses immutable show cache
});

test("pending builds do not expire after the completed-result TTL", async () => {
  let release!: () => void, starts = 0;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const svc = createReviewWindowService({ home: HOME, git,
    week: { get: async () => { starts++; await wait; return week; } } });
  const first = svc.data(2);
  await Bun.sleep(1);
  const realNow = Date.now;
  let second: ReturnType<typeof svc.data>;
  try {
    Date.now = () => realNow() + 60_000;
    second = svc.data(2);
  } finally { Date.now = realNow; release(); }
  expect(await first).toBe(await second!);
  expect(starts).toBe(1);
});

test("whole-build discovery caps distinct session roots and shares the git deadline", async () => {
  const roots = Array.from({ length: BUILD_ROOTS_CAP + 50 }, (_, i) => join(HOME, "roots", String(i)));
  for (const r of roots) mkdirSync(r, { recursive: true });
  const payload = { ...week, strs: [...roots, "noop"],
    events: roots.map((_, i) => [i, i, "c", 0, 0, roots.length, -1]) } as WorldWeekPayload;
  let probes = 0, total = 0;
  const data = await createReviewWindowService({ home: HOME, week: { get: async () => payload },
    git: async (dir, args, opts) => {
      total++;
      if (args[0] === "rev-parse") { probes++; return MAIN + "\n" + MAIN + "/.git\n"; }
      if (args[0] === "worktree") return "";
      return git(dir, args, opts);
    } }).data(2);
  expect(probes).toBe(BUILD_ROOTS_CAP);
  expect(total).toBeLessThanOrEqual(BUILD_GIT_CALLS_CAP);
  expect(data.calls.length).toBe(roots.length);

  // Advance the build clock during root discovery, not during week loading.
  // No later discovery, log or show may launch once this budget is exhausted.
  const realNow = Date.now;
  let clock = realNow(), callsAfterBudget = 0, launches = 0;
  try {
    Date.now = () => clock;
    await createReviewWindowService({ home: HOME, week: { get: async () => payload },
      git: async (_dir, _args, opts) => {
        if (clock >= realNow() + 30_000) callsAfterBudget++;
        expect(opts?.timeout).toBeLessThanOrEqual(30_000);
        launches++; clock += 10_000;
        return MAIN + "\n" + MAIN + "/.git\n";
      } }).data(2);
  } finally { Date.now = realNow; }
  expect(launches).toBe(3);
  expect(callsAfterBudget).toBe(0);
});

test("queued day counts cannot overlap root discovery or subsequent git work", async () => {
  let release!: () => void, entered!: () => void, weekReads = 0, blocked = false;
  const gate = new Promise<void>((r) => { release = r; });
  const started = new Promise<void>((r) => { entered = r; });
  const svc = createReviewWindowService({ home: HOME,
    week: { get: async () => { weekReads++; expect(blocked).toBe(false); return week; } },
    git: async (dir, args, opts) => {
      if (!blocked && weekReads === 1 && args[0] === "rev-parse") {
        blocked = true; entered(); await gate; blocked = false;
      }
      return git(dir, args, opts);
    } });
  const a = svc.data(1);
  await started;
  const b = svc.data(2);
  await Bun.sleep(5);
  expect(weekReads).toBe(1);
  release();
  await Promise.all([a, b]);
  expect(weekReads).toBe(2);
});

test("a nearby git commit command cannot admit an unrelated author's patch", async () => {
  let shows = 0;
  const payload: WorldWeekPayload = { ...week, strs: [FEAT, "Bash", "git commit -m local"],
    events: [[100, 0, "c", 0, 1, 2, -1]] };
  const d = await createReviewWindowService({ home: HOME, week: { get: async () => payload },
    git: async (dir, args, opts) => {
      if (args[0] === "log") return "\x1e" + ["b".repeat(40), F0 + 105, "Other", "other@test", "refs/heads/feature", "Unrelated"].join("\x1f");
      if (args[0] === "config") return "me@test";
      if (args[0] === "show") shows++;
      return git(dir, args, opts);
    } }).data(2);
  expect(d.commits).toEqual([]);
  expect(d.changes).toEqual([]);
  expect(shows).toBe(0);
});

test("a budget-refused show fallback is retried with a fresh build budget", async () => {
  const realNow = Date.now, initial = realNow();
  let now = initial, attempts = 0, fallback = 0;
  try {
    Date.now = () => now;
    const svc = createReviewWindowService({ home: HOME, week: { get: async () => week },
      git: async (dir, args, opts) => {
        if (args[0] === "show") {
          if (args.includes("--numstat")) { fallback++; return "2\t1\tsrc/a.ts\n"; }
          attempts++;
          if (attempts === 1) { now += 30_001; return null; }
        }
        return git(dir, args, opts);
      } });
    const exhausted = await svc.data(1);
    expect(exhausted.changes).toEqual([]);
    expect(fallback).toBe(0);
    now += 50_000;
    const retried = await svc.data(1);
    expect(attempts).toBeGreaterThan(1);
    expect(retried.changes[0].patch).toContain("+export const a = 2");
    expect(fallback).toBe(0);
  } finally { Date.now = realNow; }
});

for (const harness of ["claude", "codex"]) for (const compound of [false, true])
test(harness + ": other-author patches are excluded even with " + (compound ? "dry-run compound" : "commit") + " output", async () => {
  const { createInlineWorldWeekService } = await import("./world-week.ts");
  const home = join(HOME, "identity-" + harness + "-" + compound), repo = join(home, "dev/repo");
  const transcripts = join(home, harness === "claude" ? ".claude/projects/test" : ".codex/sessions/test");
  mkdirSync(transcripts, { recursive: true }); mkdirSync(repo, { recursive: true });
  const sha = "abcdef1234567890abcdef1234567890abcdef12";
  const unrelated = "b".repeat(40), wrongTree = "c".repeat(40);
  const command = compound ? "git commit --dry-run; git log -1 --format=%H" : "git commit --author='Other <other@test>' -m change";
  const output = compound ? sha + "\n" + wrongTree : "[main " + sha.slice(0, 8) + "] Change\n" + wrongTree;
  const now = Date.now(), timestamp = new Date(now - 1000).toISOString();
  writeFileSync(join(transcripts, "witness.jsonl"), (harness === "claude" ? [
    { type: "assistant", timestamp, cwd: repo, message: { content: [
      { type: "tool_use", id: "commit", name: "Bash", input: { command } },
      { type: "tool_use", id: "read", name: "Bash", input: { command: "cat notes" } },
    ] } },
    { type: "user", timestamp, message: { content: [
      { type: "tool_result", tool_use_id: "read", content: "[main " + unrelated + "] not commit output" },
      { type: "tool_result", tool_use_id: "commit", content: output },
    ] } },
  ] : [
    { type: "session_meta", payload: { cwd: repo } },
    { timestamp, payload: { type: "function_call", name: "exec_command", call_id: "commit", arguments: JSON.stringify({ cmd: command, workdir: repo }) } },
    { timestamp, payload: { type: "function_call", name: "exec_command", call_id: "read", arguments: JSON.stringify({ cmd: "cat notes", workdir: repo }) } },
    { timestamp, payload: { type: "function_call_output", call_id: "read", output: "[main " + unrelated + "] not commit output" } },
    { timestamp, payload: { type: "function_call_output", call_id: "commit", output } },
  ]).map((x) => JSON.stringify(x)).join("\n"));
  const weekService = createInlineWorldWeekService({ home, now: () => now,
    readBroker: async () => ({ asks: [], messages: [], actors: [], agents: [] }), readHosts: async () => [] });
  let inspected = 0, reachabilityChecks = 0;
  const svc = createReviewWindowService({ home, week: weekService, git: async (dir, args) => {
    if (args[0] === "rev-parse") return dir + "\n" + repo + "/.git\n";
    if (args[0] === "config") return "me@test";
    if (args[0] === "worktree") return "";
    if (args[0] === "log") return [sha, unrelated, wrongTree].map((id) =>
      "\x1e" + [id, Math.floor((now - 1000) / 1000), "Other", "other@test", "refs/heads/main", "Change"].join("\x1f")).join("\n");
    if (args[0] === "merge-base") {
      reachabilityChecks++; return "";
    }
    if (args[0] === "show") { inspected++; expect(args.at(-1)).toBe(sha); return SHOW; }
    return null;
  } });
  const d = await svc.data(2);
  expect(d.commits).toEqual([]);
  expect(d.changes).toEqual([]);
  expect(inspected).toBe(0);
  expect(reachabilityChecks).toBe(0);
  expect(await weekService.get(2)).not.toHaveProperty("commitOutputs");
});
