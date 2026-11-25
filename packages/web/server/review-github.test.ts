import { describe, expect, test } from "bun:test";
import type { SwarmPullState } from "./routes/swarm-pulls.ts";
import type { Git } from "./review-window.ts";
import {
  Budget, cleanBody, createReviewGithubService, githubRemotes, githubRepoOf, joinProject, knownOf, parsePullsAnswer, projectHeads,
  pullFromGraph, pullsQuery, pullsQueryArgs, refsOf, selectPulls, verdictOf,
  type GPull, type Gh, type PullList,
} from "./review-github.ts";
import { reviewGithubShift, reviewPullMoments, type ReviewData } from "../shared/review-window.ts";

/* ---------- a window: two projects, one on a fork ---------- */
const FROM = Date.parse("2026-11-05T00:00:00Z");
const iso = (secs: number) => new Date(FROM + secs * 1000).toISOString();
const sha = (id: string) => id + "0".repeat(40 - id.length);
const C1 = "1a2b3c4d5e6f", C2 = "2b3c4d5e6f70", C3 = "3c4d5e6f7081", C4 = "4d5e6f708192", C5 = "5e6f708192a3";

function windowData(): ReviewData {
  const strs = ["~/dev/app-feature/src/a.ts", "app:src/a.ts", "~/dev/app/docs/guide.md", "app:docs/guide.md", "app:src/util/a.ts", "~/dev/app-feature/src/util/a.ts"];
  return {
    from: FROM, now: FROM + 2 * 86_400_000, host: "h", days: 2, kinds: ["e"], strs,
    wts: [
      ["app", "main", "~/dev/app", 0, "main"], ["app", "feature", "~/dev/app-feature", 0, "feature"],
      ["app", "stacked", "~/dev/app-stacked", 0, "stacked"], ["core", "main", "~/dev/core", 0, "main"],
      ["core", "hooks", "~/dev/core-hooks", 0, "hooks"], ["app", "gone", "~/dev/app-gone", 1, ""],
    ],
    projects: { app: "~/dev/app", core: "~/dev/core" },
    files: [[0, 1, 1], [2, 0, 3], [5, 1, 4]],
    calls: [], sessions: [],
    actors: [["Art", "person", "", "", "operator"], ["claude", "agent", "app", "claude", "session-abc123-def456"]],
    asks: [],
    commits: [
      { id: C1, repo: "app", t: 1000, subj: "Add a", branch: "feature", merged: "", mergedAs: "41", s: 0, w: 1, how: "commit" },
      // made before a force-push: GitHub no longer lists its sha, its branch still ties it
      { id: C2, repo: "app", t: 2000, subj: "Fix a", branch: "feature", merged: "", s: 0, w: 1, how: "commit" },
      { id: C3, repo: "app", t: 3000, subj: "Stack on a", branch: "stacked", merged: "", s: -1, w: 2, how: "" },
      { id: C4, repo: "core", t: 1500, subj: "Hooks", branch: "hooks", merged: "", s: -1, w: 4, how: "" },
      // a squash whose branch commit is not in the window: its number still names its pull request
      { id: C5, repo: "app", t: 500, subj: "Old work (#40)", branch: "main", merged: "40", s: -1, w: 0, how: "" },
    ],
    changes: [{ id: `${C1}:src/a.ts`, c: C1, key: "app:src/a.ts", path: "src/a.ts", add: 2, del: 1, isNew: false, isGone: false, kind: "code", hunks: 1, shape: 0.5, shapeWhy: "", patch: "", cut: 0 }],
    current: {},
  };
}

function listed(repo: string, n: number, o: Partial<SwarmPullState> = {}): SwarmPullState {
  return {
    key: `${repo}#${n}`, repo, number: n, state: "open", title: `${repo} ${n}`, url: `https://github.com/${repo}/pull/${n}`,
    mergedAt: null, closedAt: null, updatedAt: iso(1800), createdAt: iso(600), stackedOn: null, head: "", base: "main", cross: false, headOwner: "",
    ...o,
  };
}

function lists(): Record<string, SwarmPullState[]> {
  return {
    "acme/app": [
      listed("acme/app", 41, { state: "merged", head: "feature", mergedAt: iso(1400), closedAt: iso(1400), updatedAt: iso(1400) }),
      listed("acme/app", 42, { state: "draft", head: "stacked", base: "feature" }),
      // the same branch name, long closed: not this window's
      listed("acme/app", 30, { state: "closed", head: "feature", closedAt: iso(-90_000), updatedAt: iso(-90_000), createdAt: iso(-99_000) }),
      listed("acme/app", 50, { head: "someone-else" }),
      listed("acme/app", 40, { state: "merged", head: "old-work", mergedAt: iso(-3600), closedAt: iso(-3600), updatedAt: iso(-3600), createdAt: iso(-7200) }),
    ],
    "acme/core": [
      listed("acme/core", 7, { head: "hooks", cross: true, headOwner: "me" }),
      // a stranger's fork with the same branch name
      listed("acme/core", 8, { head: "hooks", cross: true, headOwner: "stranger" }),
    ],
    "me/core": [listed("me/core", 3, { head: "hooks" })],
  };
}

const PR41: GPull = {
  number: 41, createdAt: iso(600), body: "Adds a.\n<!-- agent: hidden -->\n![shot](https://x/shot.png)\n\nChecks: web:check PASS",
  author: { __typename: "User", login: "me" }, additions: 3, deletions: 1, changedFiles: 1, reviewDecision: "APPROVED", mergeable: "UNKNOWN",
  reviewRequests: { nodes: [{ requestedReviewer: { __typename: "Team", slug: "core-team" } }] },
  commits: { totalCount: 2, nodes: [{ commit: { oid: sha(C1) } }, { commit: { oid: sha("99999999") } }] },
  tip: { nodes: [{ commit: { oid: sha(C1), statusCheckRollup: { state: "FAILURE", contexts: { totalCount: 4, nodes: [
    { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://ci/build", completedAt: iso(1010) },
    { __typename: "StatusContext", context: "deploy", state: "PENDING", targetUrl: "https://ci/deploy", createdAt: iso(1020) },
    { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "https://ci/test", completedAt: iso(1030) },
    { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "CANCELLED", detailsUrl: "", completedAt: iso(1040) },
  ] } } } }] },
  reviews: { totalCount: 4, nodes: [
    { author: { __typename: "Bot", login: "coderabbitai" }, state: "COMMENTED", submittedAt: iso(1100), url: "https://r/1", comments: { totalCount: 1 },
      body: "<!-- coderabbit -->\n**Actionable comments posted: 1**\n\n<details><summary>Nitpicks (2)</summary>\n<details><summary>src/a.ts</summary>deep</details>\n</details>" },
    { author: { __typename: "User", login: "me" }, state: "PENDING", submittedAt: null, body: "draft", url: "", comments: { totalCount: 0 } },
    { author: { __typename: "User", login: "reviewer" }, state: "APPROVED", submittedAt: iso(1200), body: "", url: "https://r/2", comments: { totalCount: 0 } },
  ] },
  reviewThreads: { totalCount: 1, nodes: [{
    path: "src/a.ts", line: null, startLine: null, originalLine: 2, originalStartLine: null, diffSide: "RIGHT", isResolved: false, isOutdated: true, subjectType: "LINE",
    comments: { totalCount: 9, nodes: [{
      author: { __typename: "Bot", login: "coderabbitai" }, body: "Use `b` here.", createdAt: iso(1100), url: "https://t/1",
      diffHunk: "@@ -1 +1,2 @@\n-export const a = 1;\n+export const a = 2;\n+export const b = 3;", originalCommit: { oid: sha(C1) },
    }] },
  }] },
  comments: { totalCount: 1, nodes: [{
    author: { __typename: "User", login: "me" }, createdAt: iso(1300), url: "https://c/1",
    body: `Independent review APPROVE: session-abc123-def456. Exact head${sha(C1)}, see src/a.ts:2 and https://github.com/acme/app/blob/${sha(C1)}/docs/guide.md#L4`,
  }] },
  timelineItems: { nodes: [
    { __typename: "BaseRefChangedEvent", createdAt: iso(800), actor: { __typename: "User", login: "me" }, previousRefName: "feature-base", currentRefName: "main" },
    { __typename: "ReadyForReviewEvent", createdAt: iso(900), actor: { __typename: "User", login: "me" } },
    { __typename: "ReviewRequestedEvent", createdAt: iso(950), actor: { __typename: "User", login: "me" }, requestedReviewer: { __typename: "Bot", login: "copilot" } },
    { __typename: "MergedEvent", createdAt: iso(1400), actor: { __typename: "User", login: "reviewer" } },
    { __typename: "SomethingNew", createdAt: iso(1401) },
  ] },
};
const small = (n: number, oids: string[] = []): GPull => ({
  number: n, createdAt: iso(600), body: "", author: { __typename: "User", login: "me" },
  commits: { totalCount: oids.length, nodes: oids.map((oid) => ({ commit: { oid: sha(oid) } })) },
});
const DETAILS: Record<string, GPull[]> = {
  "acme/app": [PR41, small(42, [C3]), small(40)],
  "acme/core": [small(7, [C4])],
  "me/core": [small(3, [C4])],
};

function fakes(o: { list?: Record<string, SwarmPullState[]>; listWarning?: string; ghError?: Error } = {}) {
  let clock = FROM + 2 * 86_400_000;
  const current = o.list ?? lists();
  const listCalls: string[] = [], ghCalls: { repo: string; numbers: number[] }[] = [];
  const list: PullList = async (repo) => {
    listCalls.push(repo);
    if (o.listWarning) return { pulls: [], warning: `${repo}: ${o.listWarning}` };
    return { pulls: current[repo] ?? [], warning: null };
  };
  const gh: Gh = async (args) => {
    const val = (flag: string, key: string) => args.filter((_, i) => args[i - 1] === flag).find((a) => a.startsWith(key + "="))?.slice(key.length + 1);
    const repo = `${val("-f", "o")}/${val("-f", "n")}`;
    const numbers = args.filter((_, i) => args[i - 1] === "-F").map((a) => Number(a.split("=")[1]));
    ghCalls.push({ repo, numbers });
    if (o.ghError) throw o.ghError;
    const repository = Object.fromEntries(numbers.map((n, i) => [`p${i}`, DETAILS[repo]?.find((p) => p.number === n) ?? null]));
    return JSON.stringify({ data: { viewer: { login: "me" }, rateLimit: { remaining: 4000 }, repository } });
  };
  const git: Git = async (dir, args) => {
    if (args[0] !== "config") return null;
    if (dir === "/h/dev/app") return "remote.origin.url git@github.com:acme/app.git\n";
    if (dir === "/h/dev/core") return "remote.origin.url https://github.com/me/core.git\nremote.upstream.url git@github.com:acme/core.git\n";
    return null;
  };
  return { list, gh, git, current, listCalls, ghCalls, now: () => clock, advance: (msecs: number) => { clock += msecs; } };
}

/* ---------- remotes, text, names ---------- */
describe("review github: remotes and text", () => {
  test("GitHub remotes, upstream first; other hosts are not GitHub", () => {
    expect(githubRepoOf("git@github.com:Arach/Scout.git")).toBe("arach/scout");
    expect(githubRepoOf("https://x-token@github.com/example-org/demo-app")).toBe("example-org/demo-app");
    expect(githubRepoOf("ssh://git@github.com/a/b.git")).toBe("a/b");
    expect(githubRepoOf("git@gitlab.com:a/b.git")).toBeNull();
    expect(githubRepoOf("https://github.com/a/b/c")).toBeNull();
    expect(githubRemotes("remote.origin.url git@github.com:arach/scout.git\nremote.upstream.url git@github.com:openscout-app/scout.git\nremote.mirror.url git@github.com:x/y.git\n"))
      .toEqual(["openscout-app/scout", "arach/scout"]);
    expect(githubRemotes("remote.origin.url git@github.com:a/b.git\nremote.upstream.url https://github.com/a/b\n")).toEqual(["a/b"]);
    expect(githubRemotes("")).toEqual([]);
  });

  test("bodies lose HTML comments, images and folded sections, keeping the outer summary", () => {
    expect(cleanBody(PR41.reviews!.nodes![0]!.body)).toBe("**Actionable comments posted: 1**\n\n[folded: Nitpicks (2)]");
    expect(cleanBody("a\r\n<!-- x\ny -->\n\n\n\nb <img src=x> ![i](u) <picture><source/></picture>")).toBe("a\n\nb");
    expect(cleanBody(null)).toBe("");
    const budget = new Budget(10);
    expect(budget.clip("x".repeat(30), 20)).toEqual({ body: "x".repeat(20), cut: 10 });
    // spent: the next body keeps its start only
    expect(budget.clip("y".repeat(400), 300).body.length).toBe(160);
  });

  test("a verdict is an explicit word near the start", () => {
    expect(verdictOf("Independent review APPROVE: exact head")).toBe("approve");
    expect(verdictOf("REQUEST CHANGES: the test is gone")).toBe("changes");
    expect(verdictOf("I approve of this")).toBe("");
    expect(verdictOf("x".repeat(500) + " APPROVE")).toBe("");
  });

  test("a comment names the window's commits, files and agents, and nothing it does not have", () => {
    const k = knownOf(windowData(), "app");
    expect([...k.commits.keys()].sort()).toEqual([C1, C2, C3, C5].sort());
    expect(k.paths.get("a.ts")!.sort()).toEqual(["src/a.ts", "src/util/a.ts"]);
    // a hex word run into the sha, a short sha, an unknown sha
    expect(refsOf(`exact head${sha(C1)} and ${C2.slice(0, 8)}, not deadbeefcafe`, k)).toEqual({ commits: [C1, C2] });
    expect(refsOf("see src/a.ts:12, ~/dev/app-feature/src/util/a.ts and https://github.com/acme/app/blob/abc/docs/guide.md#L4", k)!.files)
      .toEqual([{ key: "app:src/a.ts", line: 12 }, { key: "app:src/util/a.ts", line: 0 }, { key: "app:docs/guide.md", line: 4 }]);
    // "util/a.ts" ends one path only; "a.ts" alone names nothing
    expect(refsOf("util/a.ts:3 and a.ts:4", k)!.files).toEqual([{ key: "app:src/util/a.ts", line: 3 }]);
    expect(refsOf("by session-abc123-def456. and operator", k)).toEqual({ agents: ["session-abc123-def456"] });
    expect(refsOf("nothing here", k)).toBeUndefined();
  });

  test("the query carries numbers and names as variables only", () => {
    const args = pullsQueryArgs("acme/app", [41, 42]);
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(args.slice(4)).toEqual(["-f", "o=acme", "-f", "n=app", "-F", "p0=41", "-F", "p1=42"]);
    const q = pullsQuery(2);
    expect(q).toContain("query($o: String!, $n: String!, $p0: Int!, $p1: Int!)");
    expect(q).toContain("p1: pullRequest(number: $p1) { ...P }");
    expect(q).not.toMatch(/mutation/u);
    expect(parsePullsAnswer("not json")).toBeNull();
    expect(parsePullsAnswer(JSON.stringify({ data: { viewer: { login: "me" }, repository: { p0: PR41, p1: null } } }))!.pulls.size).toBe(1);
  });
});

/* ---------- which, and what ---------- */
describe("review github: the pull requests of a window", () => {
  test("a project's heads are its branches, not its main branch; its numbers are its squashes", () => {
    const d = windowData();
    expect([...projectHeads(d, "app").heads].sort()).toEqual(["feature", "stacked"]);
    expect([...projectHeads(d, "app").numbers].sort()).toEqual([40, 41]);
    expect([...projectHeads(d, "core").heads]).toEqual(["hooks"]);
  });

  test("a pull request belongs by its head (a fork's only when the fork is ours) or its squash number, and must be live", () => {
    const L = new Map(Object.entries(lists()));
    const app = selectPulls({ project: "app", repos: ["acme/app"], lists: L, heads: new Set(["feature", "stacked"]), numbers: new Set([40]), from: FROM });
    // open first, then the most recently updated; #30 is a long-closed namesake, #50 someone else's
    expect(app.picked.map((c) => c.list.number)).toEqual([42, 41, 40]);
    const core = selectPulls({ project: "core", repos: ["acme/core", "me/core"], lists: L, heads: new Set(["hooks"]), numbers: new Set([3]), from: FROM });
    // a number is read against the first repository only: me/core#3 is in by its head
    expect(core.picked.map((c) => `${c.repo}#${c.list.number}`)).toEqual(["acme/core#7", "me/core#3"]);
    const capped = selectPulls({ project: "app", repos: ["acme/app"], lists: L, heads: new Set(["feature", "stacked"]), numbers: new Set(), from: FROM, cap: 1 });
    expect(capped.picked.map((c) => c.list.number)).toEqual([42]);
    expect([...capped.dropped]).toEqual([["acme/app", 1]]);
  });

  test("a read pull request: checks, reviews, threads on their file and commit, conversation, state changes", () => {
    const d = windowData();
    const p = pullFromGraph({ id: "acme/app#41", repo: "acme/app", project: "app", list: lists()["acme/app"]![0]! }, PR41, { from: FROM, known: knownOf(d, "app"), budget: new Budget(1e6) });
    expect(p).toMatchObject({
      id: "acme/app#41", state: "merged", by: "me", bot: false, head: "feature", base: "main", fork: "", opened: 600, ended: 1400, updated: 1400,
      body: "Adds a.\n\nChecks: web:check PASS", cut: 0, commitCount: 2, add: 3, del: 1, files: 1, decision: "approved", mergeable: "",
      requested: ["core-team"], read: true, more: { reviews: 1, threads: 0, comments: 0 },
    });
    expect(p.checks).toEqual({
      state: "fail", sha: C1, total: 4, runs: [
        { name: "test", state: "fail", url: "https://ci/test", t: 1030 },
        { name: "deploy", state: "pending", url: "https://ci/deploy", t: 1020 },
        { name: "lint", state: "cancelled", url: "", t: 1040 },
        { name: "build", state: "pass", url: "https://ci/build", t: 1010 },
      ],
    });
    // the unsubmitted review is the viewer's draft: left out
    expect(p.reviews.map((r) => [r.by, r.bot, r.state, r.t, r.n])).toEqual([["coderabbitai", true, "commented", 1100, 1], ["reviewer", false, "approved", 1200, 0]]);
    expect(p.threads).toEqual([{
      key: "app:src/a.ts", path: "src/a.ts", line: null, start: null, oline: 2, ostart: null, side: "R", commit: C1, sha: C1,
      resolved: false, outdated: true, file: false, hunk: "@@ -1 +1,2 @@\n-export const a = 1;\n+export const a = 2;\n+export const b = 3;",
      comments: [{ by: "coderabbitai", bot: true, t: 1100, body: "Use `b` here.", cut: 0, url: "https://t/1", says: "" }], more: 8,
    }]);
    expect(p.comments[0]).toMatchObject({
      by: "me", t: 1300, says: "approve",
      refs: { commits: [C1], files: [{ key: "app:src/a.ts", line: 2 }, { key: "app:docs/guide.md", line: 4 }], agents: ["session-abc123-def456"] },
    });
    expect(p.events).toEqual([
      { t: 800, kind: "base", by: "me", bot: false, what: "main", was: "feature-base" },
      { t: 900, kind: "ready", by: "me", bot: false },
      { t: 950, kind: "requested", by: "me", bot: false, what: "copilot" },
      { t: 1400, kind: "merged", by: "reviewer", bot: false },
    ]);
    const moments = reviewPullMoments(p);
    expect(moments.map((m) => `${m.t} ${m.kind}`)).toEqual(["600 opened", "800 base", "900 ready", "950 requested", "1100 commented", "1200 approved", "1300 comment", "1400 merged"]);
    expect(moments[4]).toMatchObject({ src: "reviews", i: 0, by: "coderabbitai", bot: true });
  });

  test("not read this time: the list's state and times, no author, nothing said", () => {
    const p = pullFromGraph({ id: "acme/app#42", repo: "acme/app", project: "app", list: lists()["acme/app"]![1]! }, null, { from: FROM, known: knownOf(windowData(), "app"), budget: new Budget(1e6) });
    expect(p).toMatchObject({ state: "draft", by: "", read: false, opened: 600, ended: null, reviews: [], threads: [], checks: null });
  });

  test("commits join by sha, by squash number, else by branch; worktrees by branch and by the commits made there", () => {
    const d = windowData(), known = knownOf(d, "app"), budget = new Budget(1e6);
    // main's squash of another pull request, which git reached through the feature branch: never joined by branch
    d.commits.push({ id: "6f708192a3b4", repo: "app", t: 1700, subj: "Other (#12)", branch: "feature", merged: "12", s: -1, w: 1, how: "" });
    const L = lists()["acme/app"]!;
    const p41 = pullFromGraph({ id: "acme/app#41", repo: "acme/app", project: "app", list: L[0]! }, PR41, { from: FROM, known, budget });
    const p42 = pullFromGraph({ id: "acme/app#42", repo: "acme/app", project: "app", list: L[1]! }, small(42, [C3]), { from: FROM, known, budget });
    const p40 = pullFromGraph({ id: "acme/app#40", repo: "acme/app", project: "app", list: L[4]! }, small(40), { from: FROM, known, budget });
    // a fork's pull request against its stale main lists every commit since: each still goes to its own
    const stale = pullFromGraph({ id: "me/app#9", repo: "me/app", project: "app", list: listed("me/app", 9, { head: "elsewhere" }) }, { ...small(9, [C1, C3]), commits: { totalCount: 700, nodes: [] } }, { from: FROM, known, budget });
    const oids = new Map([["acme/app#41", new Set([C1, "999999990000"])], ["acme/app#42", new Set([C3])], ["acme/app#40", new Set<string>()], ["me/app#9", new Set([C1, C3, C2])]]);
    joinProject(d, [stale, p41, p42, p40], oids, new Set(["acme/app"]));
    // C2's sha is only the stale fork's: GitHub lists it there, and nothing has a better claim
    expect(stale.commits).toEqual([C2]);
    expect(p41.commits).toEqual([C1]);
    expect(p41.wts).toEqual(["~/dev/app-feature"]);
    expect(p42.commits).toEqual([C3]);
    expect(p42.wts).toEqual(["~/dev/app-stacked"]);
    expect(p40.commits).toEqual([C5]);
    expect(p40.wts).toEqual(["~/dev/app"]);
  });

  test("moments shift onto a Review build with another start", () => {
    expect(reviewGithubShift({ from: FROM }, { from: FROM - 5000 })).toBe(5);
  });
});

/* ---------- the service ---------- */
describe("review github: the service", () => {
  test("joins a window's pull requests across a project's upstream and fork", async () => {
    const f = fakes();
    const svc = createReviewGithubService({ review: { data: async () => windowData() }, list: f.list, gh: f.gh, git: f.git, home: "/h", now: f.now });
    const gh = await svc.data(2);
    expect(gh.from).toBe(FROM);
    expect(gh.me).toBe("me");
    expect(gh.warnings).toEqual([]);
    // the busiest project first; a project's upstream before its origin
    expect(gh.repos).toEqual([
      { project: "app", repo: "acme/app", read: true },
      { project: "core", repo: "acme/core", read: true },
      { project: "core", repo: "me/core", read: true },
    ]);
    expect(gh.pulls.map((p) => [p.id, p.state, p.read, p.wts, p.commits])).toEqual([
      ["acme/app#42", "draft", true, ["~/dev/app-stacked"], [C3]],
      ["acme/core#7", "open", true, ["~/dev/core-hooks"], [C4]],
      // the fork's own pull request on the same branch: its worktree, but the commit is upstream's (listed first)
      ["me/core#3", "open", true, ["~/dev/core-hooks"], []],
      ["acme/app#41", "merged", true, ["~/dev/app-feature"], [C1, C2]],
      ["acme/app#40", "merged", true, ["~/dev/app"], [C5]],
    ]);
    expect(gh.pulls.find((p) => p.id === "acme/core#7")!.fork).toBe("me");
    expect(f.ghCalls).toEqual([{ repo: "acme/app", numbers: [42, 41, 40] }, { repo: "acme/core", numbers: [7] }, { repo: "me/core", numbers: [3] }]);
    expect(JSON.parse(await svc.json(2)).pulls).toHaveLength(5);
  });

  test("keeps a build a minute, a read until the list moves, an open one's 3 minutes", async () => {
    const f = fakes();
    const svc = createReviewGithubService({ review: { data: async () => windowData() }, list: f.list, gh: f.gh, git: f.git, home: "/h", now: f.now });
    await svc.data(2);
    await svc.data(2);
    expect(f.listCalls).toHaveLength(3);
    expect(f.ghCalls).toHaveLength(3);
    f.advance(61_000);
    await svc.data(2);
    // listed again, nothing moved, nothing open is 3 minutes old: no query
    expect(f.listCalls).toHaveLength(6);
    expect(f.ghCalls).toHaveLength(3);
    f.current["acme/app"]![0]!.updatedAt = iso(1500);
    f.advance(61_000);
    await svc.data(2);
    expect(f.ghCalls.slice(3)).toEqual([{ repo: "acme/app", numbers: [41] }]);
    f.advance(180_000);
    await svc.data(2);
    // the open ones, now 3 minutes old
    expect(f.ghCalls.slice(4)).toEqual([{ repo: "acme/app", numbers: [42] }, { repo: "acme/core", numbers: [7] }, { repo: "me/core", numbers: [3] }]);
  });

  test("gh missing everywhere is one warning and no pull requests", async () => {
    const f = fakes({ listWarning: "gh is not installed" });
    const svc = createReviewGithubService({ review: { data: async () => windowData() }, list: f.list, gh: f.gh, git: f.git, home: "/h", now: f.now });
    const gh = await svc.data(2);
    expect(gh.pulls).toEqual([]);
    expect(gh.warnings).toEqual(["gh is not installed: pull requests are not shown"]);
    expect(gh.repos.every((r) => !r.read)).toBe(true);
    expect(f.ghCalls).toEqual([]);
  });

  test("a query that fails keeps the pull requests, unread, and says why", async () => {
    const f = fakes({ ghError: Object.assign(new Error("gh exited with 1"), { code: "exit", stderr: "HTTP 401: Bad credentials (https://api.github.com/graphql)" }) });
    const svc = createReviewGithubService({ review: { data: async () => windowData() }, list: f.list, gh: f.gh, git: f.git, home: "/h", now: f.now });
    const gh = await svc.data(2);
    expect(gh.pulls).toHaveLength(5);
    expect(gh.pulls.every((p) => !p.read)).toBe(true);
    expect(gh.warnings).toContain("acme/app: reviews and comments unavailable: gh is not signed in");
    // still joined by branch
    expect(gh.pulls.find((p) => p.id === "acme/app#41")!.commits).toEqual([C1, C2]);
  });

  test("one build at a time", async () => {
    const f = fakes();
    let active = 0, most = 0;
    const review = { data: async () => { active++; most = Math.max(most, active); await new Promise((r) => setTimeout(r, 5)); active--; return windowData(); } };
    const svc = createReviewGithubService({ review, list: f.list, gh: f.gh, git: f.git, home: "/h", now: f.now });
    await Promise.all([svc.data(2), svc.data(3), svc.data(2)]);
    expect(most).toBe(1);
  });

  test("a project without a GitHub remote reads nothing", async () => {
    const f = fakes();
    const git: Git = async () => "remote.origin.url git@gitlab.com:a/b.git\n";
    const svc = createReviewGithubService({ review: { data: async () => windowData() }, list: f.list, gh: f.gh, git, home: "/h", now: f.now });
    const gh = await svc.data(2);
    expect([gh.repos, gh.pulls, gh.warnings, f.listCalls]).toEqual([[], [], [], []]);
  });
});

