import { describe, expect, test } from "bun:test";
import type { FeedPostHead } from "../../../../shared/api/feed.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import { homeView, requestCovers, type HomeFeed } from "./front-page-model.ts";
import { homeWaiting } from "./home-stream.ts";
import { requestWhy, WHY_ORDER } from "./home-why.ts";

const NOW = new Date(2026, 10, 16, 14, 0).getTime();

const ready = (patch: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem => ({
  id: "ready:flt-1", kind: "ready", title: "Ranger is ready", summary: "Fixed the route resolution.", detail: "Fix the session route",
  agentId: "ranger", agentName: "Ranger", conversationId: "dm.ranger", updatedAt: NOW - 60_000, severity: "info", sourceLabel: "Ready",
  ready: { invocationId: "inv-1", flightId: "flt-1", workId: "w1", summary: "Fixed the route resolution. Tests pass.", at: NOW - 60_000 },
  actions: [
    { kind: "continue", label: "Continue", flightId: "flt-1" },
    { kind: "hold", label: "Hold", flightId: "flt-1" },
    { kind: "open", label: "Open conversation", route: { view: "conversation", conversationId: "dm.ranger" } },
  ],
  ...patch,
});

const question = (id: string, at: number): OperatorAttentionItem => ({
  id, kind: "question", title: `Question ${id}`, summary: "Which way?", detail: null, agentId: "a", agentName: "kit",
  conversationId: null, updatedAt: at, severity: "info", sourceLabel: "runtime", actions: [],
});

const post = (id: string, partial: Partial<FeedPostHead> = {}): FeedPostHead => ({
  id: `post:${id}`, version: 1, day: "2026-11-16", at: NOW - 3_600_000, class: "landed", reviewed: false, selected: true, score: 1,
  title: `Post ${id}`, caption: "Did it.", writtenBy: "reply", line: null, agent: { name: "Ranger", harness: "claude" }, others: 0,
  thread: null, state: "done", lead: { kind: "text", ref: null }, change: null, joined: [], prs: [], prCount: 0, forYou: null,
  backToYou: true, updates: 0, workId: id, conversationId: `chn-${id}`, owner: { agentId: null, sessionId: null, cwd: "/tmp" },
  study: null, project: null, ...partial,
}) as FeedPostHead;

describe("Ready on Home", () => {
  test("its own reason, after what blocks an agent, and never a question to answer", () => {
    const why = requestWhy(ready());
    expect(why.kind).toBe("ready");
    expect(why.label).toBe("Ready");
    expect(why.label).not.toBe("Question to answer");
    expect(WHY_ORDER.indexOf("ready")).toBe(WHY_ORDER.indexOf("permission") + 1);
  });

  test("a Back to you row: the agent is ready, its summary, its conversation", () => {
    const [row] = homeView(null, { requests: [ready()] }).forYou;
    expect(row).toMatchObject({
      id: "request:ready:flt-1", source: "request", title: "Ranger is ready", caption: "Fixed the route resolution. Tests pass.",
      at: NOW - 60_000, open: { view: "conversation", conversationId: "dm.ranger" },
    });
    expect(row!.why.kind).toBe("ready");
  });

  test("stands for its task's turn, by work item or conversation, whatever the turn waits on", () => {
    expect(requestCovers(ready(), post("w1"))).toBe(true);
    expect(requestCovers(ready({ ready: { ...ready().ready!, workId: null } }), post("x", { conversationId: "dm.ranger" }))).toBe(true);
    expect(requestCovers(ready(), post("w2"))).toBe(false);
    const feed: HomeFeed = { posts: [post("w1"), post("w2")], home: { forYou: [], backToYou: ["post:w1", "post:w2"], landed: [] } as never, size: { posts: 2, days: 1, reviewed: 0 } };
    expect(homeView(feed, { requests: [ready()] }).backToYou.map((t) => t.id)).toEqual(["post:w2"]);
  });

  test("Back to you orders questions, then Ready, then turns to steer", () => {
    const view = homeView(null, { requests: [ready(), question("q1", NOW - 120_000)] });
    const items = homeWaiting({ forYou: view.forYou, outside: [] });
    expect(items.map((i) => i.why.kind)).toEqual(["question", "ready"]);
  });
});
