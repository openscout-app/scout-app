import { describe, expect, test } from "bun:test";
import type { FeedPostHead, FeedResponse } from "../../../shared/api/feed.ts";
import { appendPage, dayLabel, emptyFeed, feedPath, hasLargeLead, mergeFeed, refillDay, shownLead } from "./feed-store.ts";

function head(id: string, partial: Partial<FeedPostHead> = {}): FeedPostHead {
  return {
    id, version: 1, day: "2026-11-15", at: 1, class: "landed", reviewed: false, selected: true, score: 1, title: id, caption: null,
    writtenBy: "reply", line: null, agent: { name: "a", harness: null }, others: 0, thread: null, state: "done",
    lead: { kind: "text", ref: null }, change: null, joined: [], prs: [], prCount: 0, forYou: null, backToYou: false, updates: 0, workId: id, conversationId: null,
    owner: { agentId: null, sessionId: null, cwd: null }, study: null, project: null, ...partial,
  };
}

function res(partial: Partial<FeedResponse>): FeedResponse {
  return {
    version: 1, generatedAt: 0, view: "all", full: true, posts: [], removed: [], days: [], cursor: null,
    size: { posts: 0, days: 0, reviewed: 0 }, home: null, views: ["all", "reviewed", "home"], ...partial,
  };
}

describe("feed store", () => {
  test("a patch replaces changed heads and drops removed ones in place", () => {
    let state = mergeFeed(emptyFeed("all"), res({ posts: [head("a"), head("b")], days: [{ day: "2026-11-15", at: 1, ids: ["a", "b"], folded: [] }] }));
    state = mergeFeed(state, res({ version: 2, full: false, posts: [head("a", { title: "new" })], removed: ["b"], days: [{ day: "2026-11-15", at: 1, ids: ["a"], folded: [] }] }));
    expect(state.version).toBe(2);
    expect(state.posts.get("a")!.title).toBe("new");
    expect(state.posts.has("b")).toBe(false);
    expect(state.days[0]!.ids).toEqual(["a"]);
  });

  test("older pages append and survive a refresh of the first page", () => {
    let state = mergeFeed(emptyFeed("all"), res({ posts: [head("a")], days: [{ day: "2026-11-15", at: 1, ids: ["a"], folded: [] }], cursor: "2026-11-15" }));
    state = appendPage(state, res({ posts: [head("o", { day: "2026-11-01" })], days: [{ day: "2026-11-01", at: 0, ids: ["o"], folded: [] }], cursor: null }));
    expect(state.days.map((d) => d.day)).toEqual(["2026-11-15", "2026-11-01"]);
    state = mergeFeed(state, res({ version: 3, posts: [head("a")], days: [{ day: "2026-11-15", at: 1, ids: ["a"], folded: [] }], cursor: "2026-11-15" }));
    expect(state.days.map((d) => d.day)).toEqual(["2026-11-15", "2026-11-01"]);
    expect(state.posts.has("o")).toBe(true);
    expect(state.cursor).toBeNull();
  });

  test("paths, day labels and the large slot", () => {
    expect(feedPath("home", { since: 4 })).toBe("/api/feed?view=home&since=4");
    expect(feedPath("all", { since: -1, cursor: "2026-11-01" })).toBe("/api/feed?view=all&cursor=2026-11-01");
    const now = new Date(2026, 10, 16, 2, 0).getTime();
    expect([dayLabel("2026-11-15", now), dayLabel("2026-11-14", now), dayLabel("2026-11-10", now)]).toEqual(["Today", "Yesterday", ""]);
    expect(hasLargeLead(head("a"))).toBe(false);
    // A change is never a lead: a code-only post has no picture block.
    expect(hasLargeLead(head("a", { change: { pull: "x#1", files: 2, additions: 1, deletions: 1 } }))).toBe(false);
    expect(hasLargeLead(head("a", { lead: { kind: "visual", ref: { asset: "/a", name: "a.png", caption: null, source: "show" } } }))).toBe(true);
  });
});

describe("refillDay", () => {
  const posts = new Map([
    ["a", { id: "a", at: 50 }], ["b", { id: "b", at: 40 }], ["c", { id: "c", at: 30 }],
    ["f1", { id: "f1", at: 45 }], ["f2", { id: "f2", at: 20 }], ["f3", { id: "f3", at: 10 }],
  ]);
  const get = (id: string) => posts.get(id);

  test("posts placed elsewhere are replaced by the newest folded ones, in time order", () => {
    const day = refillDay(["a", "b", "c"], ["f2", "f1", "f3"], new Set(["a", "b"]), get);
    expect(day.shown.map((p) => p.id)).toEqual(["f1", "c", "f2"]);
    expect(day.folded.map((p) => p.id)).toEqual(["f3"]);
  });

  test("nothing hidden: the day is as the engine chose it", () => {
    const day = refillDay(["a", "b"], ["f1"], new Set(), get);
    expect(day.shown.map((p) => p.id)).toEqual(["a", "b"]);
    expect(day.folded.map((p) => p.id)).toEqual(["f1"]);
  });

  test("a hidden folded post stays out, and a short fold lifts what it has", () => {
    const day = refillDay(["a", "b", "c"], ["f1", "f2"], new Set(["a", "b", "c", "f1"]), get);
    expect(day.shown.map((p) => p.id)).toEqual(["f2"]);
    expect(day.folded).toEqual([]);
  });
});

describe("shownLead", () => {
  const picture = { src: "/api/feed/pr-image?pull=o%2Fr%231&i=1", alt: "After" };
  test("a post with only words leads with its pull request's screenshot", () => {
    expect(shownLead({ lead: { kind: "text", ref: null }, picture })).toEqual({ kind: "visual", ref: { asset: picture.src, name: "After", caption: "After", source: "pull" } });
    expect(hasLargeLead({ lead: { kind: "text", ref: null }, picture })).toBe(true);
  });
  test("the engine's own lead wins, and words with no picture stay words", () => {
    const page = { kind: "page" as const, ref: { path: "studies/a", href: null } };
    expect(shownLead({ lead: page, picture })).toBe(page);
    expect(hasLargeLead({ lead: { kind: "text", ref: null }, picture: null })).toBe(false);
  });
});
