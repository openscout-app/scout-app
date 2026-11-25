import { describe, expect, test } from "bun:test";
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { diffNewPostIds, pendingArrivalSummary, shouldQueueArrival, smallModalityOf } from "./arrival-model.ts";

function post(overrides: Partial<FeedPostHead> = {}): FeedPostHead {
  return {
    id: overrides.id ?? "p-1",
    version: 1,
    day: "2026-11-24",
    at: overrides.at ?? 1_700_000_000_000,
    class: overrides.class ?? "routine",
    reviewed: false,
    selected: true,
    score: 1,
    title: "Finished task",
    caption: null,
    writtenBy: "reply",
    line: null,
    agent: { name: "Astra", harness: "codex" },
    others: 0,
    thread: "scout-app",
    state: "done",
    lead: { kind: "text", ref: null },
    change: null,
    joined: [],
    prs: [],
    prCount: 0,
    forYou: null,
    backToYou: false,
    settled: null,
    picture: null,
    updates: 0,
    workId: "w-1",
    conversationId: "c-1",
    owner: { agentId: "a-1", sessionId: "s-1", cwd: "/repo" },
    project: "scout-app",
    study: null,
    ...overrides,
  };
}

describe("Feed arrival model and compact modalities", () => {
  test("classifies decisions, pages, visuals, code, milestones, and notes in priority order", () => {
    expect(smallModalityOf(post({ forYou: { reason: "attention", label: "Needs review" } }))).toBe("decision");
    expect(smallModalityOf(post({ lead: { kind: "page", ref: { path: "studies/feed-modalities", href: "/studies/feed-modalities" } } }))).toBe("page");
    expect(smallModalityOf(post({ picture: { src: "/img.png", alt: "Shot" } }))).toBe("visual");
    expect(smallModalityOf(post({ prs: [{ key: "scout#1", label: "#1", title: "Fix", url: "https://example.com", state: "open" }] }))).toBe("code");
    expect(smallModalityOf(post({ change: { pull: "scout#1", files: 3, additions: 40, deletions: 10 } }))).toBe("code");
    expect(smallModalityOf(post({ agentPost: { own: true, milestone: true, links: [] } }))).toBe("milestone");
    expect(smallModalityOf(post())).toBe("note");
  });

  test("queues only after the reading-safe scroll threshold", () => {
    expect(shouldQueueArrival(0)).toBe(false);
    expect(shouldQueueArrival(80)).toBe(false);
    expect(shouldQueueArrival(120)).toBe(true);
    expect(shouldQueueArrival(420)).toBe(true);
  });

  test("returns unseen posts newest first", () => {
    const posts = new Map<string, FeedPostHead>([
      ["old-1", post({ id: "old-1", at: 100 })],
      ["new-1", post({ id: "new-1", at: 200 })],
      ["new-2", post({ id: "new-2", at: 300 })],
    ]);
    expect(diffNewPostIds(new Set(["old-1"]), { posts })).toEqual(["new-2", "new-1"]);
  });

  test("summarizes decisions, PRs, and visuals without overloading the pill", () => {
    expect(pendingArrivalSummary([])).toBe("");
    expect(pendingArrivalSummary([post({ id: "1" })])).toBe("1 new");
    expect(pendingArrivalSummary([
      post({ id: "1", forYou: { reason: "attention", label: "Approve" } }),
      post({ id: "2", prs: [{ key: "r#1", label: "#1", title: "PR", url: "https://example.com", state: "open" }] }),
    ])).toBe("2 new · 1 waiting, 1 PR");
  });
});
