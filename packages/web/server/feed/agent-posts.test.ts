import { describe, expect, test } from "bun:test";
import type { WebFeedTask } from "../../shared/api/feed.ts";
import { AGENT_POST_PREFIX, placePosts, POST_TAIL_MS, taskCoversPost, taskFromPost, type RuntimePost } from "./agent-posts.ts";
import { linkContext } from "./links.ts";
import { buildPost, type PostContext } from "./post.ts";

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 15, 14, 0).getTime();
const SHOW = "show-0123456789abcdef0123456789abcdef";

function task(partial: Partial<WebFeedTask> & { id: string }): WebFeedTask {
  return {
    title: "Do the thing.", state: "done", accepted: false, operatorAsked: true, askedFrom: null, askedByAgent: false,
    ownerId: "agent-a", ownerName: "demo-app-a", harness: "claude", sessionId: "s1", conversationId: null,
    parentId: null, parentTitle: null, projectRoot: "/p", cwd: "/p", branch: null,
    createdAt: NOW - 2 * HOUR, updatedAt: NOW - HOUR, finishedAt: NOW - HOUR,
    replyId: `msg-${partial.id}`, reply: "Landed the thing.", operator: null,
    presentation: { status: "missing", title: null, caption: null }, shows: [], media: [], studies: [],
    ...partial,
  };
}

function post(partial: Partial<RuntimePost> & { id: string }): RuntimePost {
  return {
    source: "post", author: { agentId: "agent-a", sessionId: "s1", harness: "claude", name: "Agent posts", nodeId: "n" },
    text: "Shipped the posts page. Replies go back to the session.", createdAt: NOW - 90 * 60_000, ...partial,
  };
}

const ctx = (): PostContext => ({ originHost: "mini", ...linkContext([], {}), mainRepo: null, attentionByKey: new Map(), localBranches: new Set() });

describe("placing agent posts", () => {
  test("a post joins the newest finished task of its session inside the window; the rest stand alone", () => {
    const older = task({ id: "older", finishedAt: NOW - 3 * HOUR, createdAt: NOW - 4 * HOUR });
    const newer = task({ id: "newer" });
    const working = task({ id: "working", state: "working", createdAt: NOW - 2 * HOUR });
    const other = task({ id: "other", sessionId: "s2" });
    const covered = post({ id: "p1", file: { showId: SHOW, kind: "image", mediaType: "image/png", byteSize: 3, name: "a.png" } });
    const late = post({ id: "p2", createdAt: NOW - HOUR + POST_TAIL_MS + 1 });
    const { tasks, alone } = placePosts([older, newer, working, other], [covered, late]);
    expect(alone.map((p) => p.id)).toEqual(["p2"]);
    const joined = tasks.find((t) => t.id === "newer")!;
    expect(joined.agentPost?.id).toBe("p1");
    expect(joined.shows.map((s) => s.id)).toEqual([SHOW]);
    expect(tasks.find((t) => t.id === "older")!.agentPost).toBeUndefined();
    expect(tasks.find((t) => t.id === "working")!.agentPost).toBeUndefined();
    expect(tasks.find((t) => t.id === "other")!.agentPost).toBeUndefined();
  });

  test("without a session on both sides, the owner decides; a synthetic task never covers a post", () => {
    const noSession = task({ id: "t", sessionId: null });
    expect(taskCoversPost(noSession, post({ id: "p" }))).toBe(true);
    expect(taskCoversPost(noSession, post({ id: "p", author: { agentId: "agent-b", nodeId: "n" } }))).toBe(false);
    expect(taskCoversPost(taskFromPost(post({ id: "q" })), post({ id: "p" }))).toBe(false);
  });

  test("a post standing alone is a finished turn of its own with the author's name, harness and session", () => {
    const t = taskFromPost(post({ id: "p", links: [{ url: "https://example.com/x" }, { url: "javascript:alert(1)" }], milestone: true }));
    expect(t.id).toBe(`${AGENT_POST_PREFIX}p`);
    expect(t).toMatchObject({ state: "done", ownerName: "Agent posts", harness: "claude", sessionId: "s1", finishedAt: NOW - 90 * 60_000 });
    expect(t.agentPost).toMatchObject({ milestone: true, links: [{ url: "https://example.com/x", title: null }] });
    expect(taskFromPost(post({ id: "f", text: "", source: "show", file: { showId: SHOW, kind: "image", mediaType: "image/png", byteSize: 1, name: "shot.png" } })).title).toBe("shot.png");
  });
});

describe("an agent post as a Feed post", () => {
  test("its own words are the title and caption; no ask, no push prompt, no repeated body", () => {
    const built = buildPost([taskFromPost(post({ id: "p", branch: "feat/x" }))], { ...ctx(), localBranches: new Set(["r:feat/x"]) })!;
    expect(built.head).toMatchObject({ title: "Shipped the posts page", caption: "Replies go back to the session.", writtenBy: "agent", forYou: null });
    expect(built.head.agentPost).toEqual({ milestone: false, links: [], own: true });
    expect(built.head.agent).toEqual({ name: "Agent posts", harness: "claude" });
    expect(built.detail.asked).toBeNull();
    expect(built.detail.body.landed).toBe("");
    expect(built.candidate.agentPost).toEqual({ milestone: false });
  });

  test("a milestone scores higher; a long post keeps its full words in the detail", () => {
    const plain = buildPost([taskFromPost(post({ id: "a" }))], ctx())!;
    const big = buildPost([taskFromPost(post({ id: "b", milestone: true }))], ctx())!;
    expect(big.candidate.base - plain.candidate.base).toBe(2);
    const long = buildPost([taskFromPost(post({ id: "c", text: `Done. ${"word ".repeat(120)}` }))], ctx())!;
    expect(long.detail.body.landed.length).toBeGreaterThan(0);
  });

  test("a joined publication supplies the outcome above the task's ask", () => {
    const { tasks } = placePosts([task({ id: "t", title: "Build the posts page." })], [post({ id: "p" })]);
    const built = buildPost(tasks, ctx())!;
    expect(built.head.title).toBe("Shipped the posts page");
    expect(built.head.caption).toBe("Build the posts page");
    expect(built.head.agentPost?.own).toBe(false);
    expect(built.candidate.agentPost).toBeNull();
  });
});
