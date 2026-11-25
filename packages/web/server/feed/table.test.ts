import { describe, expect, test } from "bun:test";
import type { WebFeedPull, WebFeedTask } from "../../shared/api/feed.ts";
import { dayKey, dayStart, previousDay } from "./days.ts";
import { FeedTable } from "./table.ts";
import type { FeedContext } from "./project.ts";
import { assetId, changeOf, chooseLead, leadsFor } from "./leads.ts";
import { slotId, linkContext, taskBranch } from "./links.ts";
import { buildPost, type PostContext } from "./post.ts";
import { DAY_TOP } from "./score.ts";
import { firstSentence, isReviewPass, operatorLine, postBody, replySections, taskTitle } from "./text.ts";

const HOUR = 3_600_000;
// Sun 15 Nov 2026, 14:00 local: "today" runs from 04:00 on the 15th.
const NOW = new Date(2026, 10, 15, 14, 0).getTime();
const APPS = "/example/op/dev/demo-app";
const CORE = "/example/op/dev/scout";
const REPOS = { [APPS]: "example-org/demo-app", [CORE]: "arach/scout" };

function task(partial: Partial<WebFeedTask> & { id: string }): WebFeedTask {
  return {
    title: "Do the thing.",
    state: "done",
    accepted: false,
    operatorAsked: true,
    askedFrom: null,
    askedByAgent: false,
    ownerId: `agent-${partial.id}`,
    ownerName: `demo-app-${partial.id}`,
    harness: "claude",
    sessionId: null,
    conversationId: `chn-${partial.id}`,
    parentId: null,
    parentTitle: null,
    projectRoot: APPS,
    cwd: APPS,
    branch: null,
    createdAt: NOW - 3 * HOUR,
    updatedAt: NOW - HOUR,
    finishedAt: NOW - HOUR,
    replyId: `msg-${partial.id}`,
    reply: "Landed the thing.",
    operator: null,
    presentation: { status: "missing", title: null, caption: null },
    shows: [],
    media: [],
    studies: [],
    ...partial,
  };
}

function pull(partial: Partial<WebFeedPull> & { number: number }): WebFeedPull {
  const repo = partial.repo ?? "example-org/demo-app";
  return {
    key: `${repo}#${partial.number}`,
    repo,
    state: "merged",
    title: `PR ${partial.number}`,
    url: `https://github.com/${repo}/pull/${partial.number}`,
    head: `branch-${partial.number}`,
    at: null,
    additions: null,
    deletions: null,
    files: null,
    ...partial,
  };
}

function postCtx(pulls: WebFeedPull[] = [], extra: Partial<PostContext> = {}): PostContext {
  return { originHost: "mini", ...linkContext(pulls, REPOS), mainRepo: "example-org/demo-app", attentionByKey: new Map(), localBranches: new Set(), ...extra };
}

function context(pulls: WebFeedPull[] = [], extra: Partial<FeedContext> = {}): FeedContext {
  return { pulls, repos: REPOS, attention: [], localBranches: [], hides: [], ...extra };
}

/* ── days ──────────────────────────────────────────────────────────────── */

describe("days", () => {
  test("a day turns over at 4am", () => {
    expect(dayKey(new Date(2026, 10, 16, 1, 10).getTime())).toBe("2026-11-15");
    expect(dayKey(new Date(2026, 10, 16, 4, 0).getTime())).toBe("2026-11-16");
    expect(previousDay("2026-11-01")).toBe("2026-10-31");
    expect(dayStart("2026-11-16")).toBe(new Date(2026, 10, 16, 4).getTime());
  });
});

/* ── text ──────────────────────────────────────────────────────────────── */

describe("text", () => {
  test("a heading is the ask's first sentence", () => {
    expect(taskTitle("Take the Feed to merge-ready. Then reply.")).toBe("Take the Feed to merge-ready");
  });

  test("an agent naming its model is not the caption", () => {
    expect(firstSentence("Model: Claude Opus 5.5 (claude-opus-5-5). Independent read: the plan holds.")).toBe("Independent read: the plan holds.");
    expect(firstSentence("**Model:** Claude Fable 5.2\nShipped the row.")).toBe("Shipped the row.");
    expect(firstSentence("Model: claude")).toBe("Model: claude");
    expect(firstSentence("Model drift fixed in the scorer.")).toBe("Model drift fixed in the scorer.");
  });

  test("a caption is one sentence, never the whole reply", () => {
    const reply = "[answered] DONE — Feed engine landed on the branch. It has tests. And more words after that.";
    expect(firstSentence(reply)).toBe("Feed engine landed on the branch.");
    // A status word goes; a very short opener takes the next sentence too.
    expect(firstSentence("Done. Merged #12 after checks.")).toBe("Merged #12 after checks.");
    expect(firstSentence("It is made. Here is how.")).toBe("It is made. Here is how.");
    expect(firstSentence(null)).toBeNull();
  });

  test("sections and the post body", () => {
    const reply = "Shipped it.\n\nChecks: web:check ok\n\nNext: port Home";
    expect(replySections(reply).checks).toEqual(["web:check ok"]);
    expect(postBody(reply)).toEqual({ landed: "Shipped it.", checks: "web:check ok", next: "port Home", open: null });
  });

  test("an operator line drops routing tags", () => {
    expect(operatorLine({ text: "[ask:f-1] Looks great, merge it.", at: 1 })).toEqual({ text: "Looks great, merge it.", at: 1 });
    expect(operatorLine({ text: "[ask:f-1]", at: 1 })).toBeNull();
  });

  test("review passes", () => {
    expect(isReviewPass({ title: "Review PR #1933", reply: null })).toBe(true);
    expect(isReviewPass({ title: "Build it", reply: "Approved at c39dc82." })).toBe(true);
    expect(isReviewPass({ title: "Build it", reply: "Blocked on the runtime." })).toBe(false);
  });
});

/* ── threads ───────────────────────────────────────────────────────────── */

describe("threads", () => {
  test("sessions, not shared PRs or owners, supply the thread key", () => {
    const fields = { sessionId: "s", conversationId: "c", branch: "b", parentId: "p", reply: "See #1950." };
    const tasks = [
      task({ id: "a", ...fields, replyId: "m" }), task({ id: "b", ...fields, replyId: "m" }),
      task({ id: "c", ...fields }), task({ id: "d", ...fields, sessionId: "other", replyId: "m" }),
      task({ id: "e", ...fields, sessionId: null }), task({ id: "f", ...fields, sessionId: null }),
    ];
    expect(tasks.map(t => slotId("mini", t))).toEqual(["mini:thread:s","mini:thread:s","mini:thread:s","mini:thread:other","mini:work:e","mini:work:f"]);
  });

  test("a worktree's branch is its folder name beside the checkout", () => {
    expect(taskBranch({ branch: null, cwd: `${APPS}-slack-interop`, projectRoot: `${APPS}-slack-interop` }, REPOS)).toBe("slack-interop");
    expect(taskBranch({ branch: "main", cwd: APPS, projectRoot: APPS }, REPOS)).toBeNull();
  });
});

/* ── leads ─────────────────────────────────────────────────────────────── */

describe("leads", () => {
  const show = (kind: "image" | "video") => ({ id: `show-${kind}`, itemId: kind, name: `${kind}.x`, kind, mediaType: `${kind}/x`, caption: null, at: 1 });

  test("the first kind real refs support wins, in order", () => {
    const all = task({
      id: "a",
      shows: [show("image"), show("video")],
      media: [{ path: "/tmp/a.png", kind: "image" }],
      studies: [{ path: "/studies/x", href: null, poster: "/p/x.png" }, { path: "/studies/y", href: null, poster: null }],
    });
    const running = task({ id: "r", state: "working" });
    const kinds = leadsFor(all, [all, running]).map((l) => l.kind);
    expect(kinds).toEqual(["video", "visual", "visual", "visual", "live", "page", "text"]);
    expect(chooseLead(leadsFor(task({ id: "t" }), [])).kind).toBe("text");
  });

  test("a diff is never a lead: a code-only turn leads with its outcome sentence", () => {
    expect(leadsFor(task({ id: "a", reply: "Merged https://github.com/example-org/demo-app/pull/3." }), []).map((l) => l.kind)).toEqual(["text"]);
  });

  test("the change's size: merged beats open, a closed pull request is none, an unknown size is none", () => {
    const sized = (n: number, state: WebFeedPull["state"] = "merged") => pull({ number: n, state, additions: 120, deletions: 18, files: 4 });
    expect(changeOf([sized(1, "closed"), sized(2, "open"), sized(3)])).toEqual({ pull: "example-org/demo-app#3", files: 4, additions: 120, deletions: 18 });
    expect(changeOf([sized(1, "closed")])).toBeNull();
    expect(changeOf([pull({ number: 5 })])).toBeNull();
    expect(changeOf([])).toBeNull();
  });

  test("stable asset ids", () => {
    expect(assetId("/a/b.png")).toBe(assetId("/a/b.png"));
    expect(assetId("/a/b.png")).not.toBe(assetId("/a/c.png"));
    expect(assetId("/a/b.png")).toMatch(/^[0-9a-f]{16}$/);
  });
});

/* ── posts ─────────────────────────────────────────────────────────────── */

describe("posts", () => {
  test("written for the reader: presentation when current, else the reply's first sentence", () => {
    const fresh = buildPost([task({ id: "a", presentation: { status: "current", title: "The Feed is on", caption: "Finished work, one post per thread." } })], postCtx())!;
    expect([fresh.head.title, fresh.head.caption, fresh.head.writtenBy]).toEqual(["The Feed is on", "Do the thing", "presentation"]);
    const stale = buildPost([task({ id: "a", title: "Make it so. Then more.", reply: "The thing is made and merged. Long tail here.", presentation: { status: "stale", title: "Old", caption: "Old" } })], postCtx())!;
    expect([stale.head.title, stale.head.caption, stale.head.writtenBy]).toEqual(["The thing is made and merged", "Make it so", "reply"]);
  });

  test("only attention promotes a post; draft and branch facts remain available to hand-back cards", () => {
    const attention = { id: "q", workId: "a", conversationId: null, label: "Asks a question" };
    expect(buildPost([task({ id: "a" })], postCtx([], { attentionByKey: new Map([["work:a", attention]]) }))!.head.forYou?.reason).toBe("attention");
    expect(buildPost([task({ id: "a", reply: "Opened #77." })], postCtx([pull({ number: 77, state: "draft" })]))!.head.class).toBe("landed");
    const local = buildPost([task({ id: "a", branch: "feat/x" })], postCtx([], { localBranches: new Set(["example-org/demo-app:feat/x"]) }))!;
    expect(local.head.class).toBe("landed");
    expect(local.head.forYou).toEqual({ reason: "local_branch", label: "Left on feat/x, no pull request" });
  });

  test("back to you: the newest turn was asked for by the operator, answered, not spoken on since, and nothing on the thread runs", () => {
    expect(buildPost([task({ id: "a" })], postCtx())!.head.backToYou).toBe(true);
    // a draft pull request is a shape the turn can take, not a reason against it
    expect(buildPost([task({ id: "a", reply: "Opened #77." })], postCtx([pull({ number: 77, state: "draft" })]))!.head.backToYou).toBe(true);
    expect(buildPost([task({ id: "a", operator: { id: "m", text: "Now the tests.", at: NOW } })], postCtx())!.head.backToYou).toBe(false);
    expect(buildPost([task({ id: "a", operatorAsked: false })], postCtx())!.head.backToYou).toBe(false);
    // An agent asking another under the operator's name (a review from a project checkout) is not back to you.
    expect(buildPost([task({ id: "a", askedFrom: "/repo/app-review", askedByAgent: true })], postCtx())!.head.backToYou).toBe(false);
    expect(buildPost([task({ id: "a", replyId: null, reply: null })], postCtx())!.head.backToYou).toBe(false);
    // steered: a new task runs on the thread
    expect(buildPost([task({ id: "a" }), task({ id: "b", conversationId: "chn-a", state: "working" })], postCtx())!.head.backToYou).toBe(false);
    // the newest turn decides: an older answered turn does not keep it back
    const later = [task({ id: "a", finishedAt: NOW - 3 * HOUR }), task({ id: "b", conversationId: "chn-a", finishedAt: NOW - HOUR, operatorAsked: false })];
    expect(buildPost(later, postCtx())!.head.backToYou).toBe(false);
  });

  test("a thread of review passes nobody spoke on is routine; a running-only thread is no post", () => {
    expect(buildPost([task({ id: "a", title: "Review PR #12", operatorAsked: false })], postCtx())!.head.class).toBe("routine");
    expect(buildPost([task({ id: "a", state: "working" })], postCtx())).toBeNull();
  });

  test("the newest reply supplies the outcome on the same stable session slot", () => {
    const thread = [
      task({ id: "build", sessionId:"s", createdAt: NOW - 5 * HOUR, finishedAt: NOW - 3 * HOUR, reply: "Built it." }),
      task({ id: "rev", sessionId:"s", title: "Review the build", createdAt: NOW - 2 * HOUR, finishedAt: NOW - HOUR }),
    ];
    const post = buildPost(thread, postCtx())!;
    expect(post.head.id).toBe("mini:thread:s");
    expect(post.head.workId).toBe("rev");
    expect(post.head.updates).toBe(1);
    expect(post.detail.earlier[0]?.id).toBe("build");
  });

  test("the detail carries what the turn was asked and the branch it worked on, for the post's page", () => {
    const post = buildPost([task({ id: "a", title: "Give the Feed a post page.\n\nOpen it from the title.", branch: "feed/post-detail", reply: "Done." })], postCtx())!;
    expect(post.detail.asked).toBe("Give the Feed a post page. Open it from the title.");
    expect(post.detail.branch).toBe("feed/post-detail");
    expect(buildPost([task({ id: "b", title: "" })], postCtx())!.detail.asked).toBeNull();
  });
});

/* ── engine ────────────────────────────────────────────────────────────── */

function strip(engine: FeedTable) {
  const res = engine.response("all",{now:NOW,debug:true})!;
  return { days:res.days,rank:res.ranking,home:engine.home(NOW),live:engine.live(null)!.sessions.map(({version,...s})=>s),
    posts:res.posts.map(({version,...p}) => ({...p,detail:{...engine.detail(p.id),version:0}})) };

}

describe("engine", () => {
  const tasks = [
    task({ id: "a", conversationId: "chn-1", finishedAt: NOW - 30 * HOUR, createdAt: NOW - 31 * HOUR }),
    task({ id: "b", conversationId: "chn-1", finishedAt: NOW - 2 * HOUR }),
    task({ id: "c", reply: "Opened #1950.", finishedAt: NOW - 3 * HOUR, operator: { id: "op-c", text: "Nice, ship it.", at: NOW - HOUR } }),
    task({ id: "d", branch: "feed/finished-work", finishedAt: NOW - 4 * HOUR }),
    task({ id: "e", title: "Review PR #12", operatorAsked: false, finishedAt: NOW - 5 * HOUR }),
    task({ id: "f", shows: [{ id: "s1", itemId: "i1", name: "shot.png", kind: "image", mediaType: "image/png", caption: "The page", at: NOW }], finishedAt: NOW - 6 * HOUR }),
    task({ id: "g", finishedAt: NOW - 7 * HOUR }),
    task({ id: "h", finishedAt: NOW - 50 * HOUR, createdAt: NOW - 51 * HOUR }),
    task({ id: "run", state: "working", conversationId: "chn-1", reply: "Halfway through the port. More soon." }),
  ];
  const pulls = [pull({ number: 1950, head: "feed/finished-work" }), pull({ number: 12 })];

  test("an incremental update equals a full recompute", () => {
    const full = new FeedTable({ originHost: "mini" });
    full.apply({ context: context(pulls), upsert: tasks });

    const inc = new FeedTable({ originHost: "mini" });
    inc.apply({ context: context([]) });
    for (const t of tasks) inc.apply({ upsert: [t] });
    inc.apply({ context: { pulls } });
    expect(strip(inc)).toEqual(strip(full));

    // Changes in place: a reply edited, a task removed, a merge of two threads, attention, and a branch.
    const edits: Array<Parameters<FeedTable["apply"]>[0]> = [
      { upsert: [{ ...tasks[6]!, reply: "Now it names #1950." }] },
      { remove: ["e"] },
      { upsert: [task({ id: "join", conversationId: "chn-1", reply: "See #1950.", finishedAt: NOW - HOUR / 2 })] },
      { context: { attention: [{ id: "q", workId: null, conversationId: "chn-f", label: "Question" }] } },
      { context: { localBranches: ["example-org/demo-app:x"] } },
      { upsert: [{ ...tasks[8]!, state: "done", finishedAt: NOW - HOUR / 4 }] },
    ];
    let current = [...tasks];
    let ctx = context(pulls);
    for (const edit of edits) {
      inc.apply(edit);
      for (const id of edit.remove ?? []) current = current.filter((t) => t.id !== id);
      for (const t of edit.upsert ?? []) current = [...current.filter((x) => x.id !== t.id), t];
      ctx = { ...ctx, ...edit.context };
      const ref = new FeedTable({ originHost: "mini" });
      ref.apply({ context: ctx, upsert: current });
      expect(strip(inc)).toEqual(strip(ref));
    }
  });

  test("a hidden thread leaves as a removal, and comes back on undo or on a newer turn", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(pulls), upsert: tasks });
    const id = "mini:work:g";
    const at = engine.head(id)!.at;
    const hide = { hides: [{ id, at }] };
    expect(engine.apply({ context: hide }).removed).toEqual([id]);
    expect(engine.head(id)).toBeNull();
    // Hidden stays hidden without a second removal.
    expect(engine.apply({ context: hide }).removed).toEqual([]);
    // Undo writes it again.
    expect(engine.apply({ context: { hides: [] } }).changed).toContain(id);
    expect(engine.head(id)?.at).toBe(at);
    // Hidden again, then a newer turn on the thread: it is back.
    engine.apply({ context: hide });
    expect(engine.apply({ upsert: [{ ...tasks[6]!, reply: "Another turn.", finishedAt: at + HOUR / 10 }] }).changed).toContain(id);
    expect(engine.head(id)?.at).toBe(at + HOUR / 10);
  });

  test("a change recomputes only its thread and its day", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(pulls), upsert: tasks });
    const result = engine.apply({ upsert: [{ ...tasks[6]!, reply: "Edited." }] });
    expect(result.changed).toEqual(["mini:work:g"]);
    expect(engine.head("mini:work:g")?.day).toBe(dayKey(NOW - 7 * HOUR));
    // Nothing moved: no new version.
    const v = engine.version;
    expect(engine.apply({ upsert: [{ ...tasks[6]!, reply: "Edited." }] }).changed).toEqual([]);
    expect(engine.version).toBe(v);
  });

  test("versioned reads: 304 when unchanged, changed posts and removals otherwise", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(pulls), upsert: tasks });
    const first = engine.response("all", { now: NOW })!;
    expect(first.full).toBe(true);
    expect(engine.response("all", { now: NOW, since: first.version })).toBeNull();
    engine.apply({ upsert: [{ ...tasks[6]!, reply: "Edited." }] });
    engine.apply({ remove: ["h"] });
    const patch = engine.response("all", { now: NOW, since: first.version })!;
    expect(patch.full).toBe(false);
    expect(patch.posts.map((p) => p.id)).toEqual(["mini:work:g"]);
    expect(patch.removed).toEqual(["mini:work:h"]);
  });

  test("a session occupies one slot across days and artifact kinds; earlier turns stay in detail", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ upsert: [
      task({id:"first",sessionId:"s",finishedAt:NOW-30*HOUR,media:[{path:"/tmp/x.png",kind:"image"}]}),
      task({id:"last",sessionId:"s",finishedAt:NOW})
    ] });
    const res = engine.response("all",{now:NOW})!;
    expect(res.posts.map(p=>[p.id,p.workId,p.updates])).toEqual([["mini:thread:s","last",1]]);
    expect(engine.detail("mini:thread:s")?.earlier.map(u=>u.id)).toEqual(["first"]);
  });

  test("a shared PR cannot join two sessions or hide a better-ranked older turn", () => {
    const engine = new FeedTable({ originHost: "mini" });
    const turn = (id: string, sessionId: string, hours: number, operatorAsked = false) =>
      task({ id, sessionId, operatorAsked, finishedAt: NOW - hours * HOUR, reply: "See #43." });
    engine.apply({ context: context([pull({ number: 43, additions: 120 })]), upsert: [
      turn("new", "s", 1), turn("best", "s", 2, true), turn("other", "t", 3),
    ] });
    const read = engine.response("all", { now: NOW, debug: true })!;
    expect(read.days[0]!.ids).toEqual(["mini:thread:s"]);
    expect(read.days[0]!.folded.sort()).toEqual(["mini:thread:t"]);
    expect(read.posts.every(post => post.joined.length === 0 && post.lead.kind === "text")).toBe(true);
    expect(read.posts.every(post => post.change?.additions === 120)).toBe(true);
  });

  test("the list carries heads only; the detail carries the body", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(pulls), upsert: tasks });
    const res = engine.response("all", { now: NOW })!;
    const head = res.posts.find((p) => p.id === "mini:work:c")!;
    expect(head.line?.text).toBe("Nice, ship it.");
    expect(JSON.stringify(res)).not.toContain("body");
    expect(engine.detail("mini:work:c")!.body.landed).toBe("Opened #1950.");
    expect(engine.detail("mini:work:c")!.asked).toBe("Do the thing.");
  });

  test("leads, live and the live channel", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(pulls), upsert: tasks });
    expect(engine.head("mini:work:f")!.lead.kind).toBe("visual");
    expect(engine.head("mini:work:a")!.lead.kind).toBe("text");
    const live = engine.live(null)!;
    expect(live.sessions.map((s) => [s.workId, s.postId, s.snippet])).toEqual([["run", null, "Halfway through the port."]]);
    expect(engine.live(live.version)).toBeNull();
    engine.apply({ upsert: [{ ...tasks[8]!, state: "done" }] });
    expect(engine.live(live.version)!.sessions).toEqual([]);
    expect(engine.head("mini:work:a")!.lead.kind).not.toBe("live");
  });

  test("days page by cursor; the Reviewed view keeps posts with the operator's words", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(pulls), upsert: tasks });
    const page = engine.response("all", { now: NOW, pageDays: 1 })!;
    expect(page.days.map((d) => d.day)).toEqual([dayKey(NOW)]);
    expect(page.cursor).toBe(dayKey(NOW));
    const older = engine.response("all", { now: NOW, pageDays: 5, cursor: page.cursor })!;
    expect(older.days[0]!.day < dayKey(NOW)).toBe(true);
    expect(older.cursor).toBeNull();
    const reviewed = engine.response("reviewed", { now: NOW })!;
    expect(reviewed.days.flatMap((d) => [...d.ids, ...d.folded])).toEqual(["mini:work:c"]);
    expect(engine.response("following", { now: NOW })!.days).toEqual([]);
  });

  test("a day shows its top few and folds the rest", () => {
    const many = Array.from({ length: 6 }, (_, i) => task({ id: `m${i}`, finishedAt: NOW - (i + 1) * HOUR / 2 }));
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(), upsert: many });
    const day = engine.response("all", { now: NOW })!.days[0]!;
    expect(day.ids.length).toBe(DAY_TOP);
    expect(day.folded.length).toBe(3);
  });

  test("Home places attention once, keeps Back to you newest first, and ranks the remaining turns", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(pulls, { attention: [{ id: "q", workId: "g", conversationId: null, label: "Question" }] }), upsert: tasks });
    const res = engine.response("home", { now: NOW })!;
    const home = res.home!;
    expect(home.forYou).toEqual(["mini:work:g"]);
    expect(home.landed).not.toContain("mini:work:g");
    // d is on #1950's branch, and #1950 merged: d left Back to you for shipped. c has the operator's reply.
    expect(home.backToYou).toEqual(["mini:work:b", "mini:work:f", "mini:work:a"]);
    expect(home.shipped).toEqual(["mini:work:d"]);
    expect(res.posts.find(p => p.id === "mini:work:f")?.lead.kind).toBe("visual");
    expect(home.landed).toEqual(["mini:work:c"]);
    expect(home.running).toEqual([]);
    expect(res.posts.map(p => p.id).sort()).toEqual([...home.forYou, ...home.backToYou, ...home.shipped!, ...home.landed].sort());
    expect(res.size).toEqual({ posts: 8, days: 3, reviewed: 1 });
  });

  test("evicting old work keeps a bounded window", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: context(pulls), upsert: tasks });
    const result = engine.apply({expireBefore:NOW - 40 * HOUR});
    expect(result.removed).toEqual(["mini:work:h"]);
  });
});

describe("engine, randomized", () => {
  test("any sequence of changes ends where a full recompute does", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    const pullPool = [pull({ number: 101, head: "b1" }), pull({ number: 102, head: "b2", state: "draft" }), pull({ number: 103, head: "b3", state: "open" })];
    const make = (i: number): WebFeedTask => task({
      id: `t${i}`,
      conversationId: `chn-${rand(4)}`,
      parentId: rand(3) === 0 ? `t${rand(12)}` : null,
      branch: rand(3) === 0 ? `b${1 + rand(3)}` : null,
      reply: rand(2) ? `Opened #${101 + rand(3)}.` : "Did it.",
      state: rand(6) === 0 ? "working" : rand(2) ? "done" : "review",
      title: rand(5) === 0 ? "Review PR #101" : `Task ${i}.`,
      operator: rand(4) === 0 ? { id: `op-${i}`, text: "Good.", at: NOW } : null,
      createdAt: NOW - (100 - i) * HOUR,
      finishedAt: NOW - rand(72) * HOUR,
    });
    for (let round = 0; round < 25; round++) {
      const inc = new FeedTable({ originHost: "mini" });
      let ctx = context([]);
      inc.apply({ context: ctx });
      const live = new Map<string, WebFeedTask>();
      for (let step = 0; step < 30; step++) {
        const roll = rand(10);
        if (roll < 6) {
          const t = make(rand(12));
          live.set(t.id, t);
          inc.apply({ upsert: [t] });
        } else if (roll < 8 && live.size) {
          const id = [...live.keys()][rand(live.size)]!;
          live.delete(id);
          inc.apply({ remove: [id] });
        } else {
          const change: Partial<FeedContext> = rand(2)
            ? { pulls: pullPool.filter(() => rand(3) > 0) }
            : { attention: rand(2) ? [{ id: "q", workId: `t${rand(12)}`, conversationId: null, label: "Q" }] : [], localBranches: rand(2) ? ["example-org/demo-app:b1"] : [] };
          ctx = { ...ctx, ...change };
          inc.apply({ context: change });
        }
      }
      const ref = new FeedTable({ originHost: "mini" });
      ref.apply({ context: ctx, upsert: [...live.values()] });
      expect(strip(inc)).toEqual(strip(ref));
      inc.close(); ref.close();
    }
  });
});

test("PR count, state and line counts change metadata, never identity, rank or day selection", () => {
  const engine = new FeedTable({ originHost: "mini" });
  const tasks = [
    task({ id: "answer", sessionId: "s", title: "Why did it stop?", reply: "The queue was full. See #43." }),
    task({ id: "study", sessionId: "t", reply: "#43 and #44", studies: [{ path: "/studies/queue", href: null, poster: null }] }),
    task({ id: "code", sessionId: "v", reply: "Opened #43 on #44." }),
  ];
  const view = () => engine.response("all", { now: NOW, debug: true })!;
  const read = () => ({ days: view().days, rank: view().ranking, home: engine.home(NOW) });
  engine.apply({ upsert: tasks, context: context([pull({ number: 43, state: "open", additions: 1 })]) });
  const before = read();
  engine.apply({ context: { pulls: [pull({ number: 43, state: "draft", additions: 10_000 }), pull({ number: 44, state: "merged" })] } });
  expect(read()).toEqual(before);
  expect(engine.pull("example-org/demo-app#44")?.state).toBe("merged");
  expect(engine.head("mini:thread:v")!.prCount).toBe(2);
  expect(engine.head("mini:thread:s")!.lead.kind).toBe("text");
  expect(view().ranking!["mini:thread:s"]?.kind).toBe("answer");
  expect(engine.head("mini:thread:t")!.lead.kind).toBe("page");
  expect(engine.detail("mini:thread:s")!.leads.map(l => l.kind)).toEqual(["text"]);
  expect(view().ranking!["mini:thread:v"]?.kind).toBe("diff");
  expect(engine.handbackHeads().map(h => h.forYou?.reason)).toContain("draft");
});

test("one open request on a conversation moves with its latest turn; a work-scoped request stays put", () => {
  const engine = new FeedTable({ originHost: "mini" });
  const t = (id: string, order: number) => task({ id, conversationId: "shared", sessionId: id, createdAt: NOW + order });
  const attn = { id: "q", workId: null, conversationId: "shared", label: "Choose a direction" };
  engine.apply({ context: context([], { attention: [attn] }), upsert: [t("a", 1)] });
  expect(engine.home(NOW).forYou).toEqual(["mini:thread:a"]);
  engine.apply({ upsert: [t("b", 2)] });
  expect(engine.home(NOW)).toEqual({ forYou: ["mini:thread:b"], backToYou: ["mini:thread:a"], landed: [], shipped: [], running: [] });
  engine.apply({ context: { attention: [{ ...attn, workId: "a" }] } });
  expect(engine.home(NOW).forYou).toEqual(["mini:thread:a"]);
  engine.apply({ context: { attention: [] } });
  expect(engine.head("mini:thread:a")?.joined).toEqual([]);
});

test("Back to you follows the latest idle turn, without joining sessions sharing a conversation", () => {
  const engine = new FeedTable({ originHost: "mini" });
  const scope = { ownerId: "writer", conversationId: "chat", sessionId: "s" };
  const first = task({ ...scope, id: "one", branch: "feat/x" });
  const other = task({ ...scope, id: "other", sessionId: "t", finishedAt: NOW - 2 * HOUR });
  engine.apply({ context: context([], { localBranches: ["example-org/demo-app:feat/x"] }), upsert: [first, other] });
  const initial = engine.response("home", { now: NOW })!;
  expect(initial.home?.backToYou).toEqual(["mini:thread:s", "mini:thread:t"]);
  // Push remains the hand-back action without a steering boost or a PR-shaped lead.
  expect(initial.posts.find(p => p.id === "mini:thread:s")).toMatchObject({ class: "landed", forYou: { reason: "local_branch" }, lead: { kind: "text" } });
  const run = task({ ...scope, id: "next", state: "working" });
  engine.apply({ upsert: [run] });
  const active = engine.response("home", { now: NOW, since: initial.version })!;
  expect(active.home?.backToYou).toEqual(["mini:thread:t"]);
  expect(engine.head("mini:thread:s")?.backToYou).toBe(false);
  engine.apply({ upsert: [{ ...run, state: "done", finishedAt: NOW, askedByAgent: true }] });
  expect(engine.home(NOW).backToYou).toEqual(["mini:thread:t"]);
  const next = engine.response("all", { now: NOW, debug: true })!;
  expect(next.ranking!["mini:thread:s"]?.why).not.toContain("operator asked");
  expect(engine.size().posts).toBe(2);
  engine.apply({ remove: ["next"] });
  expect(engine.home(NOW).backToYou).toEqual(initial.home?.backToYou ?? []);
});

test("Home still ranks four highlights after placing Back to you", () => {
  const engine = new FeedTable({ originHost: "mini" });
  engine.apply({ upsert: [
    task({ id: "handback", sessionId: "s" }),
    task({ id: "earlier", sessionId: "s", operatorAsked: false, finishedAt: NOW - 2 * HOUR, title: "How does it work?" }),
    ...["a", "b", "c", "d", "e"].map(id => task({ id, sessionId: id, operatorAsked: false })),
    task({ id: "clip", sessionId: "clip", operatorAsked: false, finishedAt: NOW - 24 * HOUR, media: [{ kind: "video", path: "/tmp/render.mp4" }] }),
  ] });
  const home = engine.home(NOW);
  expect(home.backToYou).toEqual(["mini:thread:s"]);
  expect(home.landed).toHaveLength(4);
  expect(home.landed[0]).toBe("mini:thread:clip");
  expect(home.landed).not.toContain("mini:work:earlier");
});

test("deleting a duplicate turn record preserves the shared final reply", () => {
  const engine = new FeedTable({ originHost: "mini" });
  const rows = ["a", "b"].map(id => task({ id, sessionId: "s", replyId: "same", reply: "Saved the recording." }));
  engine.apply({ upsert: rows });
  expect(engine.size().posts).toBe(1);
  engine.apply({ remove: ["a"] });
  expect(engine.head("mini:thread:s")?.title).toBe("Saved the recording");
  expect(engine.size().posts).toBe(1);
});

test("a Home patch carries newly eligible heads, even across an idle day boundary", () => {
  const engine = new FeedTable({ originHost: "mini" });
  engine.apply({ mark: NOW, upsert: [task({ id: "a", operatorAsked: false, finishedAt: NOW - 24 * HOUR })] });
  const first = engine.response("home", { now: NOW })!;
  expect(first.home?.landed).toEqual(["mini:work:a"]);
  engine.apply({ mark: NOW + 24 * HOUR }); // the quiet writer tick advances the same pull cursor at the day boundary
  const tomorrow = engine.response("home", { now: NOW + 24 * HOUR, since: first.version })!;
  expect(tomorrow.home?.landed).toEqual([]);
  expect(engine.response("home", { now: NOW + 24 * HOUR, since: tomorrow.version })).toBeNull();
});

test("two hosts with the same source keys produce disjoint slot IDs, including running and quota", () => {
  const a = new FeedTable({ originHost: "mini" }), b = new FeedTable({ originHost: "lab:2" });
  try {
    for (const table of [a, b]) {
      table.apply({
        mark: NOW, upsert: [task({ id: "one", sessionId: "s" }), task({ id: "two" }), task({ id: "live", sessionId: "s", state: "working" })],
        posts: [{ id: "p", source: "post", author: { agentId: "other", nodeId: "peer" }, createdAt: NOW, text: "Measured the latency." }],
      });
      table.writeQuota([{
        id: "quota:codex:5h:1", provider: "codex", label: "Codex", window: "5h", threshold: .9, crossedAt: NOW, day: dayKey(NOW),
        peak: .95, peakAt: NOW, resetAt: NOW + HOUR, points: [[NOW,.95]], now: null,
      }], NOW);
    }
    const batch = a.pullSlots(null, NOW)!;
    const local = ["post:p", "quota:codex:5h:1", "running:live", "thread:s", "work:two"];
    expect(batch.slots.map(r => r.id).sort()).toEqual(local.map(k => "mini:" + k));
    expect(b.pullSlots(null, NOW)!.slots.map(r => r.id).sort()).toEqual(local.map(k => "lab%3A2:" + k));
    expect(a.quota(NOW)[0]?.id).toBe("mini:quota:codex:5h:1");
    expect(a.live(null)?.sessions[0]?.postId).toBe("mini:thread:s");
    expect(a.detail("mini:thread:s")?.id).toBe("mini:thread:s");
    expect(a.pullSlots(batch.version, NOW)).toBeNull();

    a.writeQuota([], NOW);
    a.apply({ remove: ["live", "two"], mark: NOW });
    const delta = a.pullSlots(batch.version, NOW)!;
    expect(delta).toMatchObject({ origin_host: "mini", full: false, version: a.version });
    expect(delta.slots.filter(r => r.state === "removed").map(r => r.id).sort()).toEqual(["mini:quota:codex:5h:1","mini:running:live","mini:work:two"]);
    expect(delta.slots.every(r => r.updated_seq > batch.version && r.updated_seq <= delta.version)).toBe(true);
    expect(a.quota(NOW)).toEqual([]);
    expect(a.pullSlots(delta.version, NOW)).toBeNull();
  } finally { a.close(); b.close(); }
});

test("an All delta and the unranked pull include an edit older than the newest seven days", () => {
  const table = new FeedTable({ originHost: "mini" });
  try {
    const tasks = Array.from({ length: 10 }, (_, i) => task({ id: String(i), finishedAt: NOW - i * 24 * HOUR }));
    table.apply({ upsert: tasks, mark: NOW });
    const first = table.response("all", { now: NOW })!;
    expect(first.posts).toHaveLength(7);
    const old = tasks[9]!;
    table.apply({ upsert: [{ ...old, reply: "Fixed the ninth day's item." }] });
    const delta = table.response("all", { now: NOW, since: first.version })!;
    expect(delta.days).toHaveLength(7);
    expect(delta.posts.map(p => p.id)).toEqual(["mini:work:9"]);
    expect(table.pullSlots(first.version, NOW)?.slots.map(s => s.id)).toEqual(["mini:work:9"]);
  } finally { table.close(); }
});
