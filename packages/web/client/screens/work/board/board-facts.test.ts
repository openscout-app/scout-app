import { describe, expect, test } from "bun:test";

import type { WebWorkBoardCard, WebWorkItem, WebWorkMove, WebWorkStation } from "../../../../shared/api/web.ts";
import { boardFacts, isFailedRun, latestMoves, shortAge } from "./board-facts.ts";

const station = (id: string, name: string, state: string): WebWorkStation => ({ id, name, state, purpose: null, rules: [], judges: [] });
const STATIONS = [
  station("backlog", "Backlog", "open"),
  station("doing", "Doing", "working"),
  station("waiting", "Waiting", "waiting"),
  station("review", "In review", "review"),
  station("done", "Done", "done"),
  station("dropped", "Dropped", "cancelled"),
];

const NOW = new Date(2026, 10, 20, 15, 0, 0).getTime();
const MIN = 60_000;

function card(id: string, at: string, item: Partial<WebWorkItem> = {}, extra: Partial<WebWorkBoardCard> = {}): WebWorkBoardCard {
  return {
    station: at, reviewPending: false, revision: 1, next: [],
    item: {
      id, title: `Item ${id}`, summary: null, ownerId: null, ownerName: null, nextMoveOwnerId: null, nextMoveOwnerName: null,
      conversationId: null, createdAt: 0, updatedAt: 0, parentId: null, parentTitle: null, state: "open", acceptanceState: "none",
      priority: null, currentPhase: "", attention: "silent", activeChildWorkCount: 0, activeFlightCount: 0,
      lastMeaningfulAt: 0, lastMeaningfulSummary: null, ...item,
    },
    ...extra,
  };
}

const running = (startedAt: number, lastActivityAt = NOW - MIN): WebWorkItem["liveFlight"] => ({ id: "flt", state: "running", sessionId: null, harness: null, startedAt, lastActivityAt });
const nameOf = (id: string | null, name: string | null) => (id === "operator" ? "you" : name ?? id ?? "no one");
const line = (cards: WebWorkBoardCard[], key: string) => boardFacts(cards, STATIONS, NOW, nameOf).find((l) => l.key === key);

describe("board facts", () => {
  test("failed runs leave Waiting and are counted on their own", () => {
    const cards = [
      card("a", "waiting", { nextMoveOwnerId: "operator", failedRun: { flightId: "f1" } }),
      card("b", "waiting", { nextMoveOwnerId: "operator", failedRun: { flightId: "f2" } }),
      card("c", "waiting", { nextMoveOwnerId: "operator" }),
      card("d", "waiting", { nextMoveOwnerId: "kepler", nextMoveOwnerName: "kepler" }),
      card("e", "waiting", { nextMoveOwnerId: "operator" }),
    ];
    expect(cards.filter(isFailedRun).map((c) => c.item.id)).toEqual(["a", "b"]);
    expect(line(cards, "waiting")).toEqual({ key: "waiting", label: "Waiting", count: 3, detail: "2 on you, 1 on kepler" });
    expect(line(cards, "failed")).toEqual({ key: "failed", label: "Failed runs", count: 2, detail: null });
  });

  test("Doing says how long the longest run has gone; quiet sessions get their own line", () => {
    const cards = [
      card("a", "doing", { liveFlight: running(NOW - 90 * MIN) }),
      card("b", "doing", { liveFlight: running(NOW - 5 * MIN) }),
    ];
    expect(line(cards, "doing")).toEqual({ key: "doing", label: "Doing", count: 2, detail: "longest running 2h" });
    expect(line(cards, "quiet")).toBeUndefined();
    const quietRun = { liveFlight: running(NOW - 50 * MIN, NOW - 45 * MIN) };
    const quiet = [...cards, card("c", "backlog", quietRun), card("d", "done", quietRun)];
    expect(line(quiet, "quiet")).toEqual({ key: "quiet", label: "Gone quiet", count: 1, detail: null });
    expect(line([], "doing")).toEqual({ key: "doing", label: "Doing", count: 0, detail: null });
  });

  test("In review counts what waits on a review, and Done counts only today", () => {
    const today = new Date(2026, 10, 20, 9, 0, 0).getTime();
    const yesterday = new Date(2026, 10, 19, 22, 0, 0).getTime();
    const cards = [
      card("r1", "review", {}, { reviewPending: true }),
      card("r2", "review"),
      card("d1", "done", { updatedAt: today }),
      card("d2", "done", { updatedAt: yesterday }),
      card("x", "dropped", { updatedAt: today }),
    ];
    expect(line(cards, "review")).toEqual({ key: "review", label: "In review", count: 2, detail: null });
    expect(line([...cards, card("d3", "done", {}, { reviewPending: true })], "to-review")).toEqual({ key: "to-review", label: "Moves to review", count: 2, detail: null });
    expect(line([], "to-review")).toBeUndefined();
    expect(line(cards, "done")).toEqual({ key: "done", label: "Done today", count: 1, detail: null });
  });

  test("the latest moves come newest first, five at most, only for cards on the board", () => {
    const move = (id: string, createdAt: number) => ({ id, itemId: `item-${id}`, createdAt }) as WebWorkMove;
    const moves = [move("a", 1), move("b", 5), move("c", 3), move("d", 2), move("e", 6), move("f", 4)];
    expect(latestMoves(moves).map((m) => m.id)).toEqual(["e", "b", "f", "c", "d"]);
    expect(latestMoves(moves, () => true, 2).map((m) => m.id)).toEqual(["e", "b"]);
    expect(latestMoves(moves, (id) => id !== "item-e").map((m) => m.id)).toEqual(["b", "f", "c", "d", "a"]);
  });

  test("ages read short", () => {
    expect(shortAge(30_000)).toBe("1m");
    expect(shortAge(59 * MIN)).toBe("59m");
    expect(shortAge(90 * MIN)).toBe("2h");
    expect(shortAge(50 * 60 * MIN)).toBe("2d");
    expect(shortAge(-5)).toBe("0m");
  });
});
