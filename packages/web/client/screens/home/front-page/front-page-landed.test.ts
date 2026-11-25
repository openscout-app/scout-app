import { describe, expect, test } from "bun:test";
import type { FeedDay, FeedPostHead } from "../../../../shared/api/feed.ts";
import { artifactOf, landedToday } from "./front-page-landed.ts";

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 16, 14, 0).getTime();
const TODAY = "2026-11-16";

function head(id: string, partial: Partial<FeedPostHead> = {}): FeedPostHead {
  return {
    id, version: 1, day: TODAY, at: NOW - HOUR, class: "landed", reviewed: false, selected: true, score: 1,
    title: `Post ${id}`, caption: `Finished ${id}.`, writtenBy: "reply", line: null, agent: { name: `agent-${id}`, harness: "claude" },
    others: 0, thread: null, state: "done", lead: { kind: "text", ref: null }, change: null, joined: [], prs: [], prCount: 0, forYou: null, backToYou: false,
    updates: 0, workId: id, conversationId: `chn-${id}`, owner: { agentId: null, sessionId: null, cwd: null }, study: null, project: null,
    ...partial,
  };
}

function feed(posts: FeedPostHead[], days: FeedDay[]) {
  return { posts: new Map(posts.map((p) => [p.id, p])), days };
}

const today = (ids: string[], folded: string[] = []): FeedDay => ({ day: TODAY, at: NOW, ids, folded });

describe("Landed today", () => {
  test("nothing until the Feed has read", () => {
    expect(landedToday(null, NOW)).toBeNull();
  });

  test("today's finished turns with a result, newest first, folded ones included", () => {
    const a = head("a", { at: NOW - 3 * HOUR });
    const b = head("b", { at: NOW - HOUR, caption: null, lead: { kind: "visual", ref: { asset: "/a/b.png", name: "home-1280.png", caption: null, source: "show" } } });
    const yesterday = head("y", { day: "2026-11-15", at: NOW - 20 * HOUR });
    const landed = landedToday(feed([a, b, yesterday], [today(["a"], ["b"]), { day: "2026-11-15", at: NOW - 24 * HOUR, ids: ["y"], folded: [] }]), NOW)!;
    expect(landed.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(landed.rows[0]).toMatchObject({ outcome: null, artifact: { kind: "Screenshot", name: "home-1280.png" }, agent: { name: "agent-b", harness: "claude" } });
    expect(landed.rows[1]).toMatchObject({ outcome: "Finished a.", artifact: null });
  });

  test("still running, a routine pass, or nothing to show: not a result", () => {
    const running = head("r", { lead: { kind: "live", ref: { workId: "r", sessionId: "s" } } });
    const routine = head("p", { class: "routine" });
    const empty = head("e", { caption: null });
    const landed = landedToday(feed([running, routine, empty], [today(["r", "p", "e"])]), NOW)!;
    expect(landed.rows).toEqual([]);
  });

  test("carries no pull request fields", () => {
    const pr = head("a", { prs: [{ key: "o/r#1", label: "#1", title: "x", state: "merged", url: "u" }], prCount: 1 });
    const row = landedToday(feed([pr], [today(["a"])]), NOW)!.rows[0]!;
    expect(Object.keys(row).sort()).toEqual(["agent", "artifact", "at", "id", "open", "outcome", "title"]);
    expect(row.artifact).toBeNull();
  });

  test("a working day turns over at 4am: 01:00 still reads yesterday's", () => {
    const late = new Date(2026, 10, 17, 1, 0).getTime();
    expect(landedToday(feed([head("a")], [today(["a"])]), late)!.rows).toHaveLength(1);
  });

  test("shows a few and counts the rest", () => {
    const posts = Array.from({ length: 7 }, (_, i) => head(`p${i}`, { at: NOW - i * HOUR }));
    const landed = landedToday(feed(posts, [today(posts.map((p) => p.id))]), NOW)!;
    expect(landed.rows).toHaveLength(5);
    expect(landed.more).toBe(2);
  });

  test("a page names its file", () => {
    expect(artifactOf({ kind: "page", ref: { path: "studies/home/wide.html", href: null } })).toEqual({ kind: "Page", name: "wide.html" });
  });
});
