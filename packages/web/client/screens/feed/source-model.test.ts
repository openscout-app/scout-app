import { describe, expect, test } from "bun:test";
import type { FeedOutsideThread, FeedQuotaEvent, FeedSources } from "../../../shared/api/feed-sources.ts";
import { hasUsageReading, heat, mergedDays, outsideLine, postKind, providerRows, quotaCurve, quotaHeadline, quotaMeta, sourcePostsByDay, weekMap } from "./source-model.ts";

const NOW = new Date(2026, 10, 16, 14, 0).getTime();
const H = 3_600_000;

const pr = (state: "open" | "draft" | "merged" | "closed") => ({ key: `o/r#1`, label: "#1", title: "t", state, url: "https://example.org/pull/1" });
const head = (p: Partial<Parameters<typeof postKind>[0]>) => ({ forYou: null, lead: { kind: "text" } as const, prs: [], ...p }) as Parameters<typeof postKind>[0];

describe("postKind", () => {
  test("a question on the thread wins, then live work, then the pull request and the lead", () => {
    expect(postKind(head({ forYou: { reason: "attention", label: "" }, prs: [pr("draft")] }))).toBe("question");
    expect(postKind(head({ lead: { kind: "live", ref: { workId: "w", sessionId: null } } }))).toBe("running");
    expect(postKind(head({ prs: [pr("draft")] }))).toBe("draft");
    expect(postKind(head({ prs: [pr("merged")], lead: { kind: "visual", ref: { asset: "a", name: "n", caption: null, source: "show" } } }))).toBe("visual");
    expect(postKind(head({ prs: [pr("merged")] }))).toBe("merged");
    expect(postKind(head({}))).toBe("result");
  });
});

describe("providerRows", () => {
  test("the lead window, over at 90%, with its reset; a status gauge with a reading keeps its words", () => {
    const rows = providerRows([
      { id: "claude", label: "Claude", kind: "quota", fill: 0.93, usedLabel: "", capLabel: "", unitLabel: "", resetAt: NOW + 30 * H,
        windows: [
          { label: "5h", fill: 0.4, usedLabel: "", capLabel: "", unitLabel: "", resetAt: NOW + 2 * H },
          { label: "7d", fill: 0.93, usedLabel: "", capLabel: "", unitLabel: "", resetAt: NOW + 30 * H },
        ] },
      { id: "grok", label: "Grok", kind: "status", statusLabel: "Local activity", detailLabel: "12k tokens", tone: "dim", capturedAt: NOW - H },
    ], NOW);
    expect(rows[0]).toMatchObject({ kind: "quota", window: "7d", percent: 93, over: true, others: ["5h 40%"] });
    expect(rows[0]!.kind === "quota" && rows[0]!.reset).toMatch(/^Tue \d\d:\d\d$/);
    expect(rows[1]).toEqual({ id: "grok", name: "Grok", kind: "status", status: "Local activity · 12k tokens" });
    // The same 93% with 8 hours of the week left is on pace: good use, not red.
    const late = providerRows([{ id: "claude", label: "Claude", kind: "quota", fill: 0.93, usedLabel: "", capLabel: "", unitLabel: "", resetAt: NOW + 8 * H,
      windows: [{ label: "7d", fill: 0.93, usedLabel: "", capLabel: "", unitLabel: "", resetAt: NOW + 8 * H }] }], NOW);
    expect(late[0]).toMatchObject({ percent: 93, over: false });
  });

  test("a provider with no usage reading has no row", () => {
    const signedIn = { id: "cursor", label: "Cursor", kind: "status", statusLabel: "Signed in", detailLabel: "Open the billing dashboard", tone: "ok" } as const;
    expect(hasUsageReading(signedIn)).toBe(false);
    expect(hasUsageReading({ ...signedIn, capturedAt: NOW })).toBe(true);
    expect(providerRows([signedIn, { id: "kimi", label: "Kimi", kind: "status", statusLabel: "Kimi Code", detailLabel: "Signed in, usage pending", tone: "dim" }], NOW)).toEqual([]);
  });
});

describe("weekMap", () => {
  test("one accent, by square root, never zero for a day with posts", () => {
    expect(heat(0, 10)).toBe(0);
    expect(heat(10, 10)).toBeCloseTo(1);
    expect(heat(1, 100)).toBeCloseTo(0.244);
    const map = weekMap({ days: ["2026-11-15", "2026-11-16"], rows: [
      { project: "a", cells: [{ claude: 4 }, {}], total: 4 },
      { project: "b", cells: [{}, { codex: 1, claude: 2 }], total: 3 },
    ] }, 1);
    expect(map?.rows).toHaveLength(1);
    expect(map?.more).toBe(1);
    expect(map?.rows[0]!.cells[0]).toMatchObject({ count: 4, hot: true });
    expect(map?.days.map((d) => d.label)).toEqual(["Sun", "Mon"]);
    expect(weekMap({ days: [], rows: [] })).toBeNull();
  });
});

const thread = (p: Partial<FeedOutsideThread>): FeedOutsideThread => ({
  id: "slack:D1", source: "slack", workspace: "w", channel: { id: "D1", title: "Kim", kind: "direct" }, url: null,
  at: NOW - 3 * H, day: "2026-11-16", last: { who: "Kim", operator: false, at: NOW - 3 * H }, waiting: "you", messages: [], earlier: 0, ...p,
});

const event: FeedQuotaEvent = {
  id: "quota:claude:7d:1", provider: "claude", label: "claude", window: "7d", threshold: 0.9,
  crossedAt: NOW - 33 * H, day: "2026-11-15", peak: 0.96, peakAt: NOW - 20 * H, resetAt: NOW, windowMs: 168 * H, ranOutAt: null,
  points: [[NOW - 40 * H, 0.8], [NOW - 33 * H, 0.91], [NOW - 20 * H, 0.96]], now: null,
};

describe("outside and quota posts", () => {
  test("the waiting line says who spoke last and how long ago", () => {
    expect(outsideLine(thread({}), NOW)).toBe("Kim replied 3h ago");
    expect(outsideLine(thread({ waiting: "them", last: { who: "me", operator: true, at: NOW - 49 * H } }), NOW)).toBe("You wrote 2d ago, no answer yet");
  });

  test("the headline names the limit in words, in the tense of the window, and rounds the lead before splitting it", () => {
    // Reset: how much was left when it passed 90%.
    expect(quotaHeadline({ ...event, crossedAt: NOW - (47 * H + 40 * 60_000) }, NOW)).toBe("Claude reached 90% of its weekly limit with 2 days left");
    expect(quotaHeadline(event, NOW)).toBe("Claude reached 90% of its weekly limit with 1 day 9 hours left");
    // Open: how much is used now, and how long is left.
    expect(quotaHeadline(event, NOW - 10 * H)).toBe("Claude has used 96% of its weekly limit with 10 hours left");
    // Run out.
    const out = { ...event, ranOutAt: NOW - 6 * H };
    expect(quotaHeadline(out, NOW)).toBe("Claude ran out of its weekly limit 6 hours before it reset");
    expect(quotaHeadline(out, NOW - 2 * H)).toMatch(/^Claude is out of its weekly limit until /);
    expect(quotaHeadline({ ...event, window: "5h", windowMs: 5 * H }, NOW)).toMatch(/of its 5-hour limit/);
  });

  test("the line under it: when an open window runs out at its pace, or what a past one peaked at", () => {
    expect(quotaMeta(event, NOW)).toMatch(/^Peaked at 96% · reset /);
    // 96% used with 10 hours of the week left: on pace to run out about 6 hours before the reset.
    expect(quotaMeta(event, NOW - 10 * H)).toMatch(/^At this pace it runs out .+, before it resets /);
    expect(quotaMeta({ ...event, points: [[NOW - 40 * H, 0.5]] }, NOW - 10 * H)).toMatch(/^On pace now · resets /);
  });

  test("the curve spans the whole window, with the even-pace line from empty to full", () => {
    const curve = quotaCurve(event, 168, 100)!;
    expect(curve.line.split(" ")).toHaveLength(3);
    expect(curve.line.split(" ")[0]!.startsWith("128.0,")).toBe(true);
    expect(curve.pace).toEqual({ x1: 0, y1: 98, x2: 168, y2: 4 });
    expect(quotaCurve({ ...event, window: "weekly", windowMs: null }, 168, 100)!.pace).toBeNull();
  });

  test("source posts join their day; a day older than what is loaded waits while older pages remain", () => {
    const sources: FeedSources = { generatedAt: NOW, outside: { connected: true, threads: [thread({}), thread({ id: "slack:D2", day: "2026-11-01", at: NOW - 400 * H })] }, quota: [event], activity: { days: [], rows: [] } };
    const byDay = sourcePostsByDay(sources, ["2026-11-16", "2026-11-15"], true);
    expect([...byDay.keys()].sort()).toEqual(["2026-11-15", "2026-11-16"]);
    expect(sourcePostsByDay(sources, ["2026-11-16", "2026-11-15"], false).has("2026-11-01")).toBe(true);
    expect(mergedDays(["2026-11-15"], ["2026-11-16", "2026-11-15"])).toEqual(["2026-11-16", "2026-11-15"]);
  });
});

describe("postKind for agent posts", () => {
  test("an agent's own post reads as a post or a milestone; one joined to a task keeps the task's kind", () => {
    expect(postKind(head({ agentPost: { milestone: false, links: [], own: true } }))).toBe("post");
    expect(postKind(head({ agentPost: { milestone: true, links: [], own: true } }))).toBe("milestone");
    expect(postKind(head({ agentPost: { milestone: true, links: [], own: false }, prs: [pr("merged")] }))).toBe("merged");
  });
});
