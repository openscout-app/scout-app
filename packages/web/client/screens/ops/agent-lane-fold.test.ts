import { describe, expect, test } from "bun:test";
import type { AgentLane } from "./agent-lanes-model.ts";
import {
  capLaneFolds,
  laneFold,
  laneFoldContent,
  laneFoldsKey,
  noteLanesSeen,
  readLaneFolds,
  toggleLaneFold,
  writeLaneFolds,
} from "./agent-lane-fold.ts";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const ev = (id: string, at: number, kind = "tool", text = "Read a file") => ({ id, t: 0, at, kind, text });
const lane = (id: string, events: ReturnType<typeof ev>[] | null, state = "idle") =>
  ({
    id,
    agent: { id, state },
    source: "scout",
    observe: events ? { events, files: [], metadata: {} } : null,
    lastActiveAt: NOW - MIN,
    current: true,
  }) as unknown as AgentLane;

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("lane fold content", () => {
  test("a lane with no trace, or only placeholders, is empty", () => {
    expect(laneFoldContent(lane("a", null), NOW, 5 * MIN)).toEqual({ empty: true, count: undefined, state: "no trace", mark: undefined });
    const placeholder = lane("b", [ev("1", NOW - MIN, "system", "Transcript discovered")]);
    expect(laneFoldContent(placeholder, NOW, 5 * MIN)).toMatchObject({ empty: true, state: "quiet" });
  });

  test("a working agent's lane is not empty while it thinks", () => {
    expect(laneFoldContent(lane("a", null, "working"), NOW, 5 * MIN).empty).toBe(false);
  });

  test("a lane with trace counts what its window shows and marks its newest event", () => {
    const c = laneFoldContent(lane("a", [ev("1", NOW - 10 * MIN), ev("2", NOW - 2 * MIN), ev("3", NOW - MIN)]), NOW, 5 * MIN);
    expect(c).toEqual({ empty: false, count: 2, state: "idle", mark: String(NOW - MIN) });
  });
});

describe("lane folds", () => {
  test("an empty lane folds on its own and opens when its trace gets something", () => {
    const empty = laneFoldContent(lane("a", null), NOW, 5 * MIN);
    expect(laneFold(empty, {}, "a")).toMatchObject({ folded: true, manual: false, word: "no trace" });
    const filled = laneFoldContent(lane("a", [ev("1", NOW)]), NOW, 5 * MIN);
    expect(laneFold(filled, {}, "a")).toMatchObject({ folded: false, word: null, count: undefined });
  });

  test("a lane folded by hand stays folded, and reads new when its trace grows", () => {
    const before = laneFoldContent(lane("a", [ev("1", NOW - 2 * MIN)]), NOW, 5 * MIN);
    const holds = toggleLaneFold({}, "a", before);
    expect(laneFold(before, holds, "a")).toMatchObject({ folded: true, manual: true, fresh: false, word: "idle", count: 1 });
    const after = laneFoldContent(lane("a", [ev("1", NOW - 2 * MIN), ev("2", NOW)]), NOW, 5 * MIN);
    expect(laneFold(after, holds, "a")).toMatchObject({ folded: true, fresh: true, word: "new", count: 2 });
    // opening it by hand drops the hold: it follows its trace again
    expect(toggleLaneFold(holds, "a", after)).toEqual({});
  });

  test("a fold made before the trace arrived takes its first mark as seen", () => {
    const holds = toggleLaneFold({}, "a", undefined);
    const first = laneFoldContent(lane("a", [ev("1", NOW)]), NOW, 5 * MIN);
    const noted = noteLanesSeen(holds, new Map([["a", first]]));
    expect(noted.a).toEqual({ held: "folded", seen: String(NOW) });
    expect(laneFold(first, noted, "a").fresh).toBe(false);
  });

  test("hand folds are saved per deck and keep the newest lanes", () => {
    const storage = memoryStorage();
    writeLaneFolds(storage, "web.ops", { a: { held: "folded", seen: "1" }, b: { held: "open" } });
    expect(storage.map.has(laneFoldsKey("web.ops"))).toBe(true);
    expect(readLaneFolds(storage, "web.ops")).toEqual({ a: { held: "folded", seen: "1" }, b: { held: "open" } });
    expect(readLaneFolds(storage, "other")).toEqual({});
    writeLaneFolds(storage, "web.ops", {});
    expect(storage.map.has(laneFoldsKey("web.ops"))).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`l${i}`, { held: "open" as const }]));
    expect(Object.keys(capLaneFolds(many, 3))).toEqual(["l2", "l3", "l4"]);
  });
});
