import { describe, expect, test } from "bun:test";
import type { FeedHome, FeedPostHead } from "../../../../shared/api/feed.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import type { ServiceGauge } from "../quota-gauge.ts";
import { firstSentence, HOME_FOR_YOU_LIMIT, homeLead, homeView, turnArtifact, nearLimitQuotas, permissionWhere, readableTitle, requestCovers, type HomeFeed } from "./front-page-model.ts";

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 16, 14, 0).getTime();
const SIZE = { posts: 12, days: 7, reviewed: 3 };

function head(id: string, partial: Partial<FeedPostHead> = {}): FeedPostHead {
  return {
    id: `post:${id}`,
    version: 1,
    day: "2026-11-16",
    at: NOW - HOUR,
    class: "landed",
    reviewed: false,
    selected: true,
    score: 1,
    title: `Post ${id}`,
    caption: "Landed the thing.",
    writtenBy: "reply",
    line: null,
    agent: { name: `agent-${id}`, harness: "claude" },
    others: 0,
    thread: null,
    state: "done",
    lead: { kind: "text", ref: null },
    change: null,
    joined: [],
    prs: [],
    prCount: 0,
    forYou: null,
    backToYou: false,
    updates: 0,
    workId: id,
    conversationId: `chn-${id}`,
    owner: { agentId: null, sessionId: null, cwd: "/example/op/dev/demo-app-x" },
    study: null,
    project: null,
    ...partial,
  };
}

function feed(posts: FeedPostHead[], home: FeedHome): HomeFeed {
  return { posts, home, size: SIZE };
}

function request(id: string, updatedAt: number, extra: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem {
  return {
    id, kind: "question", title: `Question ${id}`, summary: "Which way? The rest is detail.", detail: null,
    agentId: "a", agentName: "hawking-14", conversationId: null, updatedAt,
    severity: "info", sourceLabel: "runtime", actions: [], ...extra,
  } as unknown as OperatorAttentionItem;
}

const draftPr = { key: "example-org/demo-app#12", label: "#12", title: "PR 12", state: "draft" as const, url: "https://github.com/example-org/demo-app/pull/12" };

describe("For you", () => {
  test("the runtime's requests lead, newest first, then the engine's posts in its order", () => {
    const a = head("a", { class: "for_you", forYou: { reason: "draft", label: "Draft demo-app#12 awaits review" }, prs: [draftPr], prCount: 1 });
    const b = head("b", { class: "for_you", forYou: { reason: "local_branch", label: "Left on home/x, no pull request" }, caption: null });
    const view = homeView(feed([b, a], { forYou: ["post:a", "post:b"], backToYou: [], landed: [], running: [] }), {
      requests: [request("old", NOW - 2 * HOUR), request("new", NOW - HOUR)],
    });
    expect(view.forYou.map((r) => r.id)).toEqual(["request:new", "request:old", "post:a", "post:b"]);
    const first = view.forYou[0]!;
    expect(first.source === "request" && first.ask).toEqual({ label: "Answer", route: { view: "requests", requestId: "new" } });
    expect(first.caption).toBe("Which way?");
    const post = view.forYou[2]!;
    expect(post.source === "post" && post.reason.reason).toBe("draft");
    expect(post.refs).toEqual([{ label: "#12", state: "draft", url: draftPr.url }]);
    expect(post.project).toBe("demo-app");
  });

  test("a failed ask is a notice, not a question: it neither leads nor stands for its post", () => {
    const thread = head("t", { class: "for_you", forYou: { reason: "draft", label: "Draft" }, conversationId: "chn-t" });
    const failed = request("ask:inv-1", NOW, { kind: "ask", title: "Ask failed", conversationId: "chn-t" });
    const view = homeView(feed([thread], { forYou: ["post:t"], backToYou: [], landed: [], running: [] }), { requests: [failed, request("q", NOW - HOUR)] });
    expect(view.forYou.map((r) => r.id)).toEqual(["request:q", "post:t"]);
  });

  test("a request stands for the post it is about, by conversation or by work item", () => {
    const byChat = head("c", { class: "for_you", forYou: { reason: "attention", label: "Which way?" } });
    const byWork = head("w", { class: "for_you", forYou: { reason: "attention", label: "Approve?" } });
    const draft = head("d", { class: "for_you", forYou: { reason: "draft", label: "Draft" }, conversationId: "chn-c" });
    const asks = [
      request("q1", NOW, { conversationId: "chn-c" }),
      request("work_item:w", NOW - HOUR),
    ];
    expect(requestCovers(asks[0]!, byChat)).toBe(true);
    expect(requestCovers(asks[1]!, byWork)).toBe(true);
    // only a question on the thread is the same thing; a draft on that thread still shows
    expect(requestCovers(asks[0]!, draft)).toBe(false);
    const view = homeView(feed([byChat, byWork, draft], { forYou: ["post:c", "post:w", "post:d"], backToYou: [], landed: [], running: [] }), { requests: asks });
    expect(view.forYou.map((r) => r.id)).toEqual(["request:q1", "request:work_item:w", "post:d"]);
  });

  test("a title is never a runtime id: the work's name, then the reply's first sentence", () => {
    const chained = { class: "for_you" as const, forYou: { reason: "draft" as const, label: "Draft awaits review" } };
    const byThread = head("t", { ...chained, title: "Previous task inv-request-5627ab91 (completed)", thread: "home/front-page" });
    const byReply = head("r", { ...chained, title: "flight-9c2e41aa", thread: null, caption: "Home is shippable." });
    const neither = head("n", { ...chained, title: "Previous task inv-request-77aa01", thread: "f-mw3k9x", caption: null });
    const view = homeView(feed([byThread, byReply, neither], { forYou: ["post:t", "post:r", "post:n"], backToYou: [], landed: [], running: [] }));
    expect(view.forYou.map((r) => [r.title, r.caption])).toEqual([
      ["home/front-page", "Landed the thing."],
      ["Home is shippable.", null],
      ["Draft awaits review", null],
    ]);
  });

  test("a request whose title is an id reads from its summary", () => {
    const view = homeView(null, { requests: [request("x", NOW, { title: "Previous task inv-request-5627ab91 (completed)" })] });
    expect(view.forYou[0]).toMatchObject({ title: "Which way?", caption: null });
  });

  test("a terminal's rule in a request's summary is not part of its caption", () => {
    const summary = `${"─".repeat(160)} Tool use │ Creates an isolated worktree.`;
    const view = homeView(null, { requests: [request("x", NOW, { title: "Permission request", summary })] });
    expect(view.forYou[0]?.caption).toBe("Tool use │ Creates an isolated worktree.");
  });

  test("readable titles: ids, hashes, record kinds and placeholders are refused", () => {
    for (const text of ["Previous task inv-request-5627… (completed)", "flight-9c2e41aa", "msg-request-4306017e", "4306017ed862d93c", "[attachment]", "Pasted content", "Pasted text #2", "Request", "claude-a.main.studio-film-relay-agent", "", null]) {
      expect(readableTitle(text)).toBeNull();
    }
    expect(readableTitle("[ask:f-123] Ship the Home rebase")).toBe("Ship the Home rebase");
    expect(readableTitle("Fix the work-in-progress banner")).toBe("Fix the work-in-progress banner");
    expect(readableTitle("Ship v1.2 of the feed")).toBe("Ship v1.2 of the feed");
  });

  test(`at most ${HOME_FOR_YOU_LIMIT} rows`, () => {
    const posts = ["a", "b", "c", "d", "e"].map((id) => head(id, { class: "for_you", forYou: { reason: "draft", label: "Draft" } }));
    const view = homeView(feed(posts, { forYou: posts.map((p) => p.id), backToYou: [], landed: [], running: [] }));
    expect(view.forYou).toHaveLength(HOME_FOR_YOU_LIMIT);
  });

  test("before the first read, requests still show and nothing else does", () => {
    const view = homeView(null, { requests: [request("a", NOW)] });
    expect(view.forYou.map((r) => r.id)).toEqual(["request:a"]);
    expect(view.landed).toEqual([]);
    expect(view.feed).toBeNull();
  });
});

describe("Landed", () => {
  test("is the engine's list, in its order, with the Feed's size", () => {
    const shot = head("s", { lead: { kind: "visual", ref: { asset: "/api/feed/asset/a1", name: "a.png", caption: "The page", source: "show" } } });
    const diff = head("d", { change: { pull: draftPr.key, files: 4, additions: 120, deletions: 30 }, prs: [draftPr] });
    const view = homeView(feed([diff, shot], { forYou: [], backToYou: [], landed: ["post:s", "post:d", "post:gone"], running: [] }));
    expect(view.landed.map((p) => p.id)).toEqual(["post:s", "post:d"]);
    expect(view.landed[0]!.lead).toEqual({ kind: "visual", src: "/api/feed/asset/a1", caption: "The page" });
    expect(view.landed[1]!.size).toEqual({ additions: 120, deletions: 30 });
    expect(view.landed[1]!.lead).toEqual({ kind: "text" });
    expect(view.feed).toEqual(SIZE);
  });

  test("a post carries its title, caption, agent and where it opens", () => {
    const [post] = homeView(feed([head("a")], { forYou: [], backToYou: [], landed: ["post:a"], running: [] })).landed;
    expect(post).toMatchObject({
      title: "Post a",
      caption: "Landed the thing.",
      agent: { name: "agent-a", harness: "claude" },
      project: "demo-app-x",
      size: null,
      open: { view: "conversation", conversationId: "chn-a" },
    });
  });
});

describe("pieces", () => {
  test("live leads draw as text; pages keep their address", () => {
    expect(homeLead({ kind: "live", ref: { workId: "w", sessionId: null } })).toEqual({ kind: "text" });
    expect(homeLead({ kind: "page", ref: { path: "/studies/x", href: "http://h/studies/x" } })).toEqual({ kind: "page", label: "/studies/x", href: "http://h/studies/x" });
  });

  test("first sentence: stops at the first full stop, folds space, clips long ones", () => {
    expect(firstSentence("One.  Two.")).toBe("One.");
    expect(firstSentence("v1.2 shipped today. More")).toBe("v1.2 shipped today.");
    expect(firstSentence("   ")).toBeNull();
    expect(firstSentence("x".repeat(300), 20)).toHaveLength(20);
  });

  test("the quota note names only subscriptions past 85% of their window, fullest first", () => {
    const now = new Date(NOW);
    const quota = (id: string, fill: number, extra: Partial<Extract<ServiceGauge, { kind: "quota" }>> = {}): ServiceGauge => ({
      id, label: id[0]!.toUpperCase() + id.slice(1), kind: "quota", fill, usedLabel: `${fill * 100}%`, capLabel: "100%",
      unitLabel: "7d", resetAt: NOW + 30 * HOUR, ...extra,
    });
    const notes = nearLimitQuotas([
      quota("claude", 0.9),
      quota("codex", 0.5),
      quota("kimi", 0.97),
      quota("grok", 0.95, { resetAt: NOW - HOUR }),
      { id: "x", label: "X", kind: "status", statusLabel: "ok", tone: "ok" },
    ], now);
    expect(notes.map((n) => [n.id, n.percent])).toEqual([["kimi", 97], ["claude", 90]]);
    expect(notes[0]!.resets).toMatch(/^Tue \d\d:\d\d$/);
  });
});

describe("where a permission runs", () => {
  const permission = { requestId: "r1", version: "1", sessionId: "s1", projectRoot: "/example/op/dev/demo-app/" };
  test("the project, then the agent's alias; never a raw id", () => {
    expect(permissionWhere({ agentName: "Session Mwk67d59 Arahgt", permission }, { handle: "@project-locke-22", project: null, projectRoot: null }, null))
      .toBe("demo-app · project-locke-22");
    // A command run in a subfolder still runs in its project.
    expect(permissionWhere({ agentName: "Session Mwk67d59 Arahgt", permission }, null, "/example/op/dev/demo-app/packages/web")).toBe("demo-app");
    expect(permissionWhere({ agentName: null }, { handle: null, project: null, projectRoot: "/example/op/dev/scout" }, "/example/op/dev/scout/packages/cli")).toBe("scout");
    // The command's folder names the project only when nothing else does.
    expect(permissionWhere({ agentName: null }, null, "/example/op/dev/hudson")).toBe("hudson");
    expect(permissionWhere({ agentName: "scout-locke-22" }, { handle: null, project: "scout", projectRoot: null }, null)).toBe("scout · scout-locke-22");
    expect(permissionWhere({ agentName: null }, null, null)).toBeNull();
  });
});

describe("Back to you", () => {
  const shot = { kind: "visual" as const, ref: { asset: "/api/feed/asset/abc", name: "shot.png", caption: "The page", source: "show" as const } };

  test("finished turns come in the engine's order, each led by what it produced; a request on one stands for it", () => {
    const a = head("a", { backToYou: true, lead: shot, at: NOW - HOUR, owner: { agentId: "x", sessionId: "s-a", cwd: null } });
    const b = head("b", { backToYou: true, prs: [draftPr], prCount: 1, change: { pull: draftPr.key, files: 2, additions: 12, deletions: 3 }, at: NOW - 2 * HOUR });
    const asked = head("c", { backToYou: true, conversationId: "chn-c", forYou: { reason: "attention", label: "Asks" }, at: NOW - 3 * HOUR });
    const view = homeView(feed([a, b, asked], { forYou: [], backToYou: ["post:a", "post:b", "post:c"], landed: [], running: [] }), {
      requests: [request("q", NOW, { conversationId: "chn-c" })],
    });
    expect(view.backToYou.map((t) => t.id)).toEqual(["post:a", "post:b"]);
    const [first, second] = view.backToYou;
    expect(first!.artifact).toEqual({ kind: "visual", src: "/api/feed/asset/abc", caption: "The page", href: "/api/feed/asset/abc" });
    expect(first!.sessionId).toBe("s-a");
    expect(first!.turnKey).toBe(`post:a@${NOW - HOUR}`);
    // a change is never the artifact: a turn that made nothing else shows none, and its size is quiet meta
    expect(second!.artifact).toBeNull();
    expect(second!.size).toEqual({ additions: 12, deletions: 3 });
    expect(second!.title).toBe("Post b");
  });

  test("an older server without the list shows none", () => {
    const view = homeView(feed([head("a", { backToYou: true })], { forYou: [], landed: [], running: [] } as unknown as FeedHome));
    expect(view.backToYou).toEqual([]);
  });

  test("a page or a study is an artifact by its file name; a reply alone has none", () => {
    expect(turnArtifact(head("p", { lead: { kind: "page", ref: { path: "design/studio/home-pov/index.html", href: "/studies/home-pov" } } }))).toEqual({ kind: "page", label: "index.html", href: "/studies/home-pov" });
    expect(turnArtifact(head("s", { study: "/studies/day-reel" }))).toEqual({ kind: "page", label: "day-reel", href: "/studies/day-reel" });
    expect(turnArtifact(head("t"))).toBeNull();
  });
});

describe("shipped turns and pull request pictures", () => {
  test("Home reads shipped turns, and an older server's absent list as none", () => {
    const shipped = head("s", { settled: { state: "merged", prs: ["#1993"], at: NOW } });
    expect(homeView(feed([shipped], { forYou: [], backToYou: [], landed: [], shipped: ["post:s"], running: [] })).shipped.map((t) => t.id)).toEqual(["post:s"]);
    expect(homeView(feed([shipped], { forYou: [], backToYou: [], landed: [], running: [] })).shipped).toEqual([]);
  });

  test("a turn with no picture of its own leads with its pull request's screenshot, opening the pull request", () => {
    const post = head("p", {
      picture: { src: "/api/feed/pr-image?pull=o%2Fr%231993&i=1", alt: "1440 dark" },
      prs: [{ key: "o/r#1993", label: "#1993", title: "Canvas", state: "merged", url: "https://github.com/o/r/pull/1993" }],
    });
    expect(turnArtifact(post)).toEqual({ kind: "visual", src: "/api/feed/pr-image?pull=o%2Fr%231993&i=1", caption: "1440 dark", href: "https://github.com/o/r/pull/1993" });
    expect(turnArtifact(head("q"))).toBeNull();
  });
});
