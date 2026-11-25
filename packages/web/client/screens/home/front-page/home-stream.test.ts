import { describe, expect, test } from "bun:test";
import type { FeedOutsideThread, FeedQuotaEvent } from "../../../../shared/api/feed-sources.ts";
import type { HomeForYou, HomePost, HomeTurn } from "./front-page-model.ts";
import { homeContext, homeWaiting, placedIds } from "./home-stream.ts";
import type { HomeWhyKind } from "./home-why.ts";

const NOW = new Date(2026, 10, 16, 14, 0).getTime();
const H = 3_600_000;

const post = (id: string, hoursAgo: number): HomePost => ({
  id, at: NOW - hoursAgo * H, title: id, caption: null, project: null, agent: null, refs: [], lead: { kind: "text" }, size: null, open: null,
});
const why = (kind: HomeWhyKind) => ({ kind, label: kind, then: "" });
const ask = (id: string, hoursAgo: number, kind: HomeWhyKind = "question") => ({ ...post(id, hoursAgo), source: "request", ask: { label: "Answer", route: { view: "requests" } }, item: {}, why: why(kind) }) as unknown as HomeForYou;
const handedBack = (id: string, hoursAgo: number, reason: "attention" | "draft" = "draft") =>
  ({ ...post(id, hoursAgo), source: "post", post: {}, reason: { reason, label: "" }, why: why(reason === "attention" ? "question" : "draft") }) as unknown as HomeForYou;
const turn = (id: string, hoursAgo: number, kind: HomeWhyKind = "steer") =>
  ({ ...post(id, hoursAgo), post: {}, artifact: null, sessionId: null, turnKey: `${id}@${NOW - hoursAgo * H}`, why: why(kind) }) as unknown as HomeTurn;
const thread = (id: string, waiting: FeedOutsideThread["waiting"], hoursAgo: number) => ({ id, waiting, at: NOW - hoursAgo * H }) as FeedOutsideThread;

describe("homeWaiting", () => {
  test("what blocks an agent first, then turns to steer, replies, reviews, merges and pushes; newest first in each", () => {
    const items = homeWaiting({
      forYou: [handedBack("q-old", 9, "attention"), ask("ask-old", 8), handedBack("q-new", 1, "attention"), ask("perm", 0.5, "permission"), ask("ask-new", 2)],
      backToYou: [turn("push", 0.1, "push"), turn("merge", 0.2, "merge"), turn("draft", 0.3, "draft"), turn("turn-old", 7), turn("turn-new", 3)],
      outside: [thread("slack-them", "them", 1), thread("slack-you", "you", 5), thread("slack-quiet", null, 1)],
    });
    expect(items.map((i) => i.id)).toEqual(["q-new", "ask-new", "ask-old", "q-old", "perm", "turn-new", "turn-old", "slack-you", "draft", "merge", "push"]);
    expect(items.map((i) => i.why.kind)).toEqual(["question", "question", "question", "question", "permission", "steer", "steer", "reply", "draft", "merge", "push"]);
    expect([...placedIds(items)].sort()).toEqual(["draft", "merge", "push", "q-new", "q-old", "slack-you", "turn-new", "turn-old"]);
  });

  test("a draft pull request alone is not a reason: it waits only as a finished turn", () => {
    const items = homeWaiting({ forYou: [handedBack("draft", 1)], backToYou: [], outside: [] });
    expect(items).toEqual([]);
  });

  test("a turn opened or steered from Home leaves; a newer turn on the same thread comes back", () => {
    const seen = new Set([`a@${NOW - 2 * H}`]);
    expect(homeWaiting({ forYou: [], backToYou: [turn("a", 2), turn("b", 1)], outside: [], seen }).map((i) => i.id)).toEqual(["b"]);
    expect(homeWaiting({ forYou: [], backToYou: [turn("a", 1)], outside: [], seen }).map((i) => i.id)).toEqual(["a"]);
  });

  test("a turn with a question on it shows once, as the question", () => {
    const items = homeWaiting({ forYou: [handedBack("x", 1, "attention")], backToYou: [turn("x", 1)], outside: [] });
    expect(items.map((i) => i.kind)).toEqual(["question"]);
  });

  test("nothing waiting: no placement", () => {
    expect(homeWaiting({ forYou: [], outside: [thread("slack-them", "them", 1)] })).toEqual([]);
  });
});

describe("homeContext", () => {
  test("a quota warning stays while its window is open; threads waiting on the other side join it", () => {
    const event = (id: string, hoursAgo: number, resetsIn: number) => ({ id, crossedAt: NOW - hoursAgo * H, resetAt: NOW + resetsIn * H }) as FeedQuotaEvent;
    const ctx = homeContext({ quota: [event("reset", 20, -2), event("open", 60, 30)], outside: [thread("a", "them", 2), thread("b", "you", 1)], nowMs: NOW });
    expect(ctx.quota?.id).toBe("open");
    expect(ctx.waitingOnThem.map((t) => t.id)).toEqual(["a"]);
    expect(homeContext({ quota: [event("reset", 20, -2)], outside: [], nowMs: NOW }).quota).toBeNull();
  });
});

describe("nothing shows twice", () => {
  test("whatever a placement shows, on either side, is left out of the stream", () => {
    const quota = [{ id: "quota:claude:7d:1", crossedAt: NOW - 5 * H, resetAt: NOW + 40 * H }] as FeedQuotaEvent[];
    const outside = [thread("slack-you", "you", 1), thread("slack-them", "them", 2), thread("slack-quiet", null, 3)];
    const waiting = homeWaiting({ forYou: [ask("ask-1", 1)], backToYou: [turn("turn-1", 2)], outside });
    const context = homeContext({ quota, outside, nowMs: NOW });
    expect([...placedIds(waiting, context)].sort()).toEqual(["quota:claude:7d:1", "slack-them", "slack-you", "turn-1"]);
    // A warning whose window reset is not placed, so it keeps its day in the stream.
    const old = homeContext({ quota: [{ id: "quota:old", crossedAt: NOW - 60 * H, resetAt: NOW - H }] as FeedQuotaEvent[], outside: [], nowMs: NOW });
    expect(placedIds([], old).has("quota:old")).toBe(false);
  });
});
