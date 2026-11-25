import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FeedResponse, WebFeedTask } from "../../shared/api/feed.ts";
import { pullRefs, studyLinks, worktreeName } from "../../shared/feed-refs.ts";
import type { RuntimeShow } from "../canvas-shows.ts";
import type { FeedRead } from "../db/feed.ts";
import { readPresentation } from "../db/feed.ts";
import { diffStat, fileArea, parseGhPullFiles } from "../feed/diff.ts";
import { checkMediaFile, insideCheckout, namedMediaPaths, replyDocument, replyMedia, studyPoster } from "../feed/files.ts";
import { assetId } from "../feed/leads.ts";
import type { SwarmPullState } from "./swarm-pulls.ts";
import type { PostSource, RuntimePost } from "../feed/agent-posts.ts";
import { attentionForFeed, mountFeedRoutes, parseSince, parseView, reposByRoot, showsForTask } from "./feed.ts";

const APPS = "/workspace/demo-app";
const DAY = 86_400_000;
const NOW = new Date(2026, 10, 15, 14, 0).getTime();

function task(partial: Partial<WebFeedTask> & { id: string }): WebFeedTask {
  return {
    title: "t", state: "done", accepted: false, operatorAsked: true, askedFrom: null, askedByAgent: false, ownerId: "agent-1", ownerName: "a", harness: null, sessionId: null,
    conversationId: `chn-${partial.id}`, parentId: null, parentTitle: null, projectRoot: APPS, cwd: APPS, branch: null,
    createdAt: NOW - 3_600_000, updatedAt: NOW - 1_000, finishedAt: NOW - 1_000, replyId: `m-${partial.id}`, reply: "Did it.", operator: null,
    presentation: { status: "missing", title: null, caption: null }, shows: [], media: [], studies: [], ...partial,
  };
}

function show(partial: Partial<RuntimeShow> & { id: string }): RuntimeShow {
  return {
    itemId: partial.id, agentId: "agent-1", projectRoot: APPS, worktree: APPS, sourcePath: "/tmp/shot.png",
    kind: "image", mediaType: "image/png", byteSize: 1, createdAt: NOW - 2_000_000, ...partial,
  };
}

function ghPull(partial: Partial<SwarmPullState> & { number: number }): SwarmPullState {
  const repo = partial.repo ?? "example-org/demo-app";
  return {
    key: `${repo}#${partial.number}`, repo, state: "merged", title: "x", url: "u", mergedAt: null, closedAt: null,
    updatedAt: null, createdAt: null, stackedOn: null, head: "h", base: "main", cross: false, headOwner: "", ...partial,
  };
}

const scratch = mkdtempSync(join(tmpdir(), "feed-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("references", () => {
  test("pull requests by URL, short form and bare number", () => {
    expect(pullRefs("See https://github.com/Arach/Scout/pull/204, arach/scout#195 and PR #1950.", "example-org/demo-app")).toEqual([
      { repo: "arach/scout", number: 204 },
      { repo: "arach/scout", number: 195 },
      { repo: "example-org/demo-app", number: 1950 },
    ]);
    expect(pullRefs("#1 first, a.b#12, x&#123;")).toEqual([]);
  });

  test("study pages, never study files", () => {
    expect(studyLinks("Open /studies/home-calm, or http://127.0.0.1:43147/studies/home-calm. Shot: design/studio/public/studies/home-calm/f.png")).toEqual([
      { path: "/studies/home-calm", href: "http://127.0.0.1:43147/studies/home-calm" },
    ]);
  });

  test("a worktree's branch name, by the checkout it sits beside", () => {
    expect(worktreeName(`${APPS}-slack-interop`, [APPS, "/workspace/demo-core"])).toBe("slack-interop");
    expect(worktreeName(APPS, [APPS])).toBeNull();
  });
});

describe("assembly helpers", () => {
  test("query parameters", () => {
    expect([parseView("home"), parseView("nope"), parseView(undefined)]).toEqual(["home", "all", "all"]);
    expect([parseSince("4"), parseSince("-1"), parseSince("x"), parseSince(undefined)]).toEqual([4, null, null, null]);
  });

  test("a root's repository is the one its replies name most; a worktree takes its checkout's", () => {
    const named = new Map([
      ["a", { root: APPS, repos: ["example-org/demo-app"] }],
      ["b", { root: APPS, repos: ["example-org/demo-app", "arach/scout"] }],
      ["c", { root: `${APPS}-feed`, repos: [] }],
    ]);
    expect(reposByRoot(named)).toEqual({ [APPS]: "example-org/demo-app", [`${APPS}-feed`]: "example-org/demo-app" });
  });

  test("shows inside a task's run, newest version of each item", () => {
    const shows = showsForTask(task({ id: "a" }), [
      show({ id: "s1", itemId: "i", createdAt: NOW - 3_000_000 }),
      show({ id: "s2", itemId: "i", createdAt: NOW - 2_000_000 }),
      show({ id: "s3", agentId: "someone-else" }),
      show({ id: "s4", createdAt: NOW - 10 * DAY }),
    ]);
    expect(shows.map((s) => s.id)).toEqual(["s2"]);
  });

  test("the attention queue joins by work item and conversation", () => {
    expect(attentionForFeed([
      { id: "work_item:w1", title: "Waiting on you", conversationId: "c1" },
      { id: "q:2", title: "Question", conversationId: "c2", actions: [{ recordKind: "work_item", recordId: "w2" }] },
      { id: "ask:inv-3", kind: "ask", title: "Ask failed", conversationId: "c3" },
    ])).toEqual([
      { id: "work_item:w1", workId: "w1", conversationId: "c1", label: "Waiting on you" },
      { id: "q:2", workId: "w2", conversationId: "c2", label: "Question" },
    ]);
  });

  test("a Ready task marks the post of its own work item", () => {
    expect(attentionForFeed([
      { id: "ready:flt-1", kind: "ready", title: "Ranger is ready", conversationId: "c1", ready: { workId: "w1" } },
      { id: "ready:flt-2", kind: "ready", title: "Kit is ready", conversationId: "c2", ready: { workId: null } },
    ])).toEqual([
      { id: "ready:flt-1", workId: "w1", conversationId: "c1", label: "Ranger is ready" },
      { id: "ready:flt-2", workId: null, conversationId: "c2", label: "Kit is ready" },
    ]);
  });

  test("a presentation counts only at the item's current version", () => {
    const record = (version: string) => JSON.stringify({
      schema: "openscout.derived.v1", kind: "presentation", sourceId: "w", sourceVersion: version,
      body: { headline: "The Feed is on", summary: "One post per thread." },
    });
    expect(readPresentation(record("r2.u100"), "w", 100, 2)).toEqual({ status: "current", title: "The Feed is on", caption: "One post per thread." });
    expect(readPresentation(record("r1.u100"), "w", 100, 2).status).toBe("stale");
    expect(readPresentation(null, "w", 100, 2).status).toBe("missing");
    expect(readPresentation("{bad", "w", 100, 2).status).toBe("missing");
  });
});

describe("files", () => {
  test("an ask sent from inside a git checkout, a linked worktree, or a retired one, came from a project", async () => {
    const repo = join(scratch, "checkout");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "packages", "web"), { recursive: true });
    const worktree = join(scratch, "checkout-topic");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, ".git"), "gitdir: ../checkout/.git/worktrees/topic\n");
    const desk = join(scratch, "desk");
    mkdirSync(desk, { recursive: true });
    expect(await insideCheckout(join(repo, "packages", "web"), scratch)).toBe(true);
    expect(await insideCheckout(worktree, scratch)).toBe(true);
    expect(await insideCheckout(desk, scratch)).toBe(false);
    expect(await insideCheckout(join(scratch, "retired-worktree"), scratch)).toBe(true);
    expect(await insideCheckout("/elsewhere/not-here", scratch)).toBe(false);
  });

  test("media paths a reply names, never inside a URL", () => {
    expect(namedMediaPaths("Shot: /tmp/a.png, film ~/rec/b.mov. See https://github.com/x/y/blob/z/c.png and `/tmp/d.webp`.", "/home/example")).toEqual([
      "/tmp/a.png", "/home/example/rec/b.mov", "/tmp/d.webp",
    ]);
  });

  test("only real pictures and films under an allowed root", async () => {
    const png = join(scratch, "shot.png");
    writeFileSync(png, "x");
    const txt = join(scratch, "notes.txt");
    writeFileSync(txt, "x");
    const roots = [scratch, "/private" + scratch];
    expect(await checkMediaFile(png, roots)).toMatch(/shot\.png$/);
    expect(await checkMediaFile(txt, roots)).toBeNull();
    expect(await checkMediaFile(join(scratch, "missing.png"), roots)).toBeNull();
    expect(await checkMediaFile(png, ["/nowhere"])).toBeNull();
    expect((await replyMedia(`Here: ${png} and ${png}`, roots)).length).toBe(1);
  });

  test("document delivery needs a real file and an explicit handoff", async () => {
    const path = join(scratch, "slides.pptx");
    writeFileSync(path, "deck");
    expect(await replyDocument(`Deck: \`${path}\`.`, null)).toEqual({ path, kind: "deck" });
    expect(await replyDocument(`I read ${path} as background.`, null)).toBeNull();
    expect(await replyDocument("Report: /does/not/exist.md", null)).toBeNull();
    expect(await replyDocument(`Files: src/main.ts, ${path}`, null)).toBeNull();
  });

  test("a study's poster: poster.* first, else its first picture", async () => {
    const dir = join(scratch, "design/studio/public/studies/home-x");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "b.png"), "x");
    writeFileSync(join(dir, "a.png"), "x");
    expect(await studyPoster("home-x", [scratch], 1)).toMatch(/a\.png$/);
    writeFileSync(join(dir, "poster.png"), "x");
    expect(await studyPoster("home-x", [scratch], 1 + 120_000)).toMatch(/poster\.png$/);
    expect(await studyPoster("none", [scratch], 1)).toBeNull();
  });
});

describe("diff", () => {
  test("areas, top files and totals", () => {
    expect([fileArea("a/b.test.ts"), fileArea("server/routes/x.ts"), fileArea("db/migrations/1.sql"), fileArea("client/x.tsx"), fileArea("README.md"), fileArea("lib/x.ts")])
      .toEqual(["tests", "routes", "migrations", "ui", "docs", null]);
    const stat = diffStat([
      { path: "server/routes/feed.ts", additions: 100, deletions: 20 },
      { path: "server/feed/engine.test.ts", additions: 300, deletions: 0 },
      { path: "lib/x.ts", additions: 1, deletions: 1 },
    ], "abc");
    expect(stat).toMatchObject({ additions: 401, deletions: 21, files: 3, areas: ["tests", "routes"], sha: "abc" });
    expect(stat.top[0]!.path).toBe("server/feed/engine.test.ts");
    expect(parseGhPullFiles(JSON.stringify({ files: [{ path: "a.ts", additions: 2, deletions: 1 }], headRefOid: "s" }))!.additions).toBe(2);
    expect(parseGhPullFiles("nope")).toBeNull();
  });
});

describe("routes", () => {
  function setup(rows: () => { tasks: WebFeedTask[]; gone: string[] }, posts?: PostSource) {
    const reads: FeedRead[] = [];
    let clock = NOW;
    const app = new Hono();
    const service = mountFeedRoutes(app, {
      originHost: async () => "mini",
      query: (read) => { reads.push(read); return rows(); },
      pulls: Object.assign(async () => ({ generatedAt: 0, source: "gh" as const, pulls: [], missing: [], warnings: [] }), {
        list: async () => ({ pulls: [ghPull({ number: 1950, head: "feed/x", additions: 10, deletions: 2 })], warning: null }),
      }),
      localBranches: async () => [],
      pullFiles: async () => diffStat([{ path: "a.ts", additions: 10, deletions: 2 }], "sha1"),
      attention: async () => [],
      now: () => clock,
      posts,
    });
    return { app, service, reads, tick: async (ms: number) => { clock += ms; await service.refresh(); } };
  }

  test("a pull cursor returns all changes at the same sequence; a quiet poll returns just 304", async () => {
    let tasks = [task({ id: "a" }), task({ id: "b" })], gone: string[] = [];
    const { app, tick, service } = setup(() => ({ tasks, gone }));
    try {
      const first = await (await app.request("/api/feed/slots")).json();
      expect(first).toMatchObject({ origin_host: "mini", full: true, slots: [{ id: "mini:work:a" }, { id: "mini:work:b" }] });
      for (const path of ["/api/feed?view=all&", "/api/feed?view=home&", "/api/feed/live?", "/api/feed/slots?"]) {
        const poll = await app.request(path + "since=" + first.version);
        expect(poll.status).toBe(304);
        expect(poll.headers.get("x-feed-version")).toBe(String(first.version));
        expect(await poll.text()).toBe("");
      }
      tasks = [task({ id: "a", reply: "The new result." })];
      gone = ["b"];
      await tick(65_000);
      const delta = await (await app.request("/api/feed/slots?since=" + first.version)).json();
      expect(delta.full).toBe(false);
      expect(delta.slots).toMatchObject([
        { id: "mini:work:a", title: "The new result", updated_seq: delta.version },
        { id: "mini:work:b", state: "removed", updated_seq: delta.version },
      ]);
      expect((await app.request("/api/feed/slots?since=" + delta.version)).status).toBe(304);
      expect((await app.request("/api/feed/slots?since=no")).status).toBe(400);
      await tick(15 * 86_400_000);
      expect(await (await app.request("/api/feed/slots?since=" + first.version)).json()).toMatchObject({ full: true, slots: [] });
    } finally { await service.stop(); }
  });

  test("an agent post stands alone as its own item, joins a task that covers it, and is read only when newer", async () => {
    const author = { agentId: "agent-a", sessionId: "s1", harness: "claude", name: "Agent posts", nodeId: "n" };
    const store: RuntimePost[] = [
      { id: "alone", source: "post", author: { ...author, sessionId: "s9" }, text: "Found the slow query. It was the feed index.", createdAt: NOW - 2 * 3_600_000 },
      { id: "joined", source: "post", author, text: "Landed the page; screenshots attached.", createdAt: NOW - 3_600_000 - 60_000 },
    ];
    const asks: number[] = [];
    const source: PostSource = { list: async (since) => { asks.push(since); return store.filter((p) => p.createdAt > since); } };
    const { app, tick } = setup(() => ({ tasks: [task({ id: "a", sessionId: "s1", ownerId: "agent-a" })], gone: [] }), source);
    const first = await (await app.request("/api/feed")).json() as FeedResponse;
    const own = first.posts.find((p) => p.id === "mini:post:alone")!;
    expect(own).toMatchObject({ title: "Found the slow query", caption: "It was the feed index.", agent: { name: "Agent posts", harness: "claude" } });
    expect(own.agentPost?.own).toBe(true);
    const a = first.posts.find((p) => p.id === "mini:thread:s1")!;
    expect(a.title).toBe("Landed the page; screenshots attached");
    expect(a.agentPost?.own).toBe(false);
    expect(first.posts.some((p) => p.id === "mini:post:joined")).toBe(false);

    await tick(60_000);
    await app.request(`/api/feed?since=${first.version}`);
    // The second read asks only for what is newer than the newest post it holds.
    expect(asks.at(-1)).toBe(NOW - 3_600_000 - 60_000);
  });

  test("the first read takes the window, later ones only what changed; an unchanged version is a 304", async () => {
    let rows = { tasks: [task({ id: "a", reply: "Opened https://github.com/example-org/demo-app/pull/1950." })], gone: [] as string[] };
    const { app, reads, tick } = setup(() => rows);
    const first = await (await app.request("/api/feed")).json() as FeedResponse;
    expect(reads[0]!.mode).toBe("window");
    // A pull request is the change's size on the meta line, never the lead.
    expect(first.posts.map((p) => [p.id, p.lead.kind])).toEqual([["mini:work:a", "text"]]);
    expect(first.posts[0]!.prs.map((p) => p.label)).toEqual(["#1950"]);

    rows = { tasks: [], gone: [] };
    await tick(10_000);
    const same = await app.request(`/api/feed?since=${first.version}`);
    expect(reads[1]!.mode).toBe("changed");
    expect(same.status).toBe(304);

    rows = { tasks: [], gone: ["a"] };
    await tick(10_000);
    const patch = await (await app.request(`/api/feed?since=${first.version}`)).json() as FeedResponse;
    expect(patch.removed).toEqual(["mini:work:a"]);
  });

  test("debug=rank explains this view, including a session fold, without changing the normal payload", async () => {
    const { app } = setup(() => ({ tasks: ["a", "b"].map(id => task({ id, sessionId: "s" })), gone: [] }));
    const first = await (await app.request("/api/feed")).json() as FeedResponse;
    expect(first.ranking).toBeUndefined();
    const debug = await (await app.request(`/api/feed?debug=rank&since=${first.version}`)).json() as FeedResponse;
    expect(debug.days).toEqual(first.days);
    expect(debug.posts.map(p => [p.id,p.updates])).toEqual([["mini:thread:s",1]]);
    const home = await (await app.request("/api/feed?view=home&debug=rank")).json() as FeedResponse;
    expect(home.home!.backToYou).toEqual(["mini:thread:s"]);
    expect(home.ranking!["mini:thread:s"]?.why).toContain("newest first, not scored for placement");
    expect(Object.keys(home.ranking!).sort()).toEqual([...home.home!.backToYou].sort());
  });

  test("a post's detail carries its body and the per-file diff", async () => {
    const { app } = setup(() => ({ tasks: [task({ id: "a", reply: "Opened https://github.com/example-org/demo-app/pull/1950.\n\nChecks: ok" })], gone: [] }));
    const res = await (await app.request("/api/feed/post/mini:work:a")).json() as { body: { checks: string }; diff: { files: number } };
    expect(res.body.checks).toBe("ok");
    expect(res.diff.files).toBe(1);
    expect((await app.request("/api/feed/post/mini:post:nope")).status).toBe(404);
  });

  test("Home and the live channel", async () => {
    const { app } = setup(() => ({ tasks: [task({ id: "a" }), task({ id: "r", state: "working", conversationId: "chn-a", reply: "Halfway." })], gone: [] }));
    const home = await (await app.request("/api/feed?view=home")).json() as FeedResponse;
    expect(home.home).toEqual({ forYou: [], backToYou: [], landed: ["mini:work:a"], shipped: [], running: [] });
    expect(home.size.posts).toBe(1);
    const live = await (await app.request("/api/feed/live")).json() as { version: number; sessions: Array<{ workId: string }> };
    expect(live.sessions.map((s) => s.workId)).toEqual(["r"]);
    expect((await app.request(`/api/feed/live?since=${live.version}`)).status).toBe(304);
  });

  test("an asset is served only when a current lead names it", async () => {
    const png = join(scratch, "lead.png");
    writeFileSync(png, "picture");
    const { app } = setup(() => ({ tasks: [task({ id: "a", reply: `Captured ${png}.` })], gone: [] }));
    const feed = await (await app.request("/api/feed")).json() as FeedResponse;
    const lead = feed.posts[0]!.lead;
    expect(lead.kind).toBe("visual");
    const asset = lead.kind === "visual" ? lead.ref.asset : "";
    const res = await app.request(asset);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("picture");
    expect((await app.request(asset, { headers: { range: "bytes=0-2" } })).status).toBe(206);
    expect((await app.request(`/api/feed/asset/${assetId("/etc/hosts")}`)).status).toBe(404);
    expect((await app.request("/api/feed/asset/../../etc")).status).toBe(404);
  });

  test("a held attention queue answers at once while the next is read behind it; an old one waits", async () => {
    let clock = NOW;
    const reads: Array<(items: never[]) => void> = [];
    const queue = (tag: string) => [{ id: tag }] as never[];
    const service = mountFeedRoutes(new Hono(), {
      originHost: async () => "mini",
      query: () => ({ tasks: [], gone: [] }),
      requests: () => new Promise((resolve) => reads.push(resolve)),
      now: () => clock,
    });
    try {
      const first = service.readRequests();
      reads[0]!(queue("a"));
      expect(await first).toEqual(queue("a"));
      // past the half minute: the held queue answers, one read goes out behind it, and For you says pending
      clock += 40_000;
      expect(await service.readRequests()).toEqual(queue("a"));
      expect(await service.readRequests()).toEqual(queue("a"));
      expect(reads.length).toBe(2);
      expect((await service.forYou()).pending).toBe(true);
      reads[1]!(queue("b"));
      await new Promise((r) => setTimeout(r, 0));
      expect(await service.readRequests()).toEqual(queue("b"));
      // a queue older than the held limit is not served: the read is waited for
      clock += 10 * 60_000;
      const late = service.readRequests();
      expect(reads.length).toBe(3);
      reads[2]!(queue("c"));
      expect(await late).toEqual(queue("c"));
    } finally { await service.stop(); }
  });
});
