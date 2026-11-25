import { describe, expect, test } from "bun:test";

import { placePointAsks, sentInWindow, type PointAsk } from "./swarm-point.ts";

const MIN = 60_000;
const start = Date.UTC(2026, 9, 24, 8, 41);
/** An hour across 600 pixels, ten pixels a minute, held to the track as the lanes view holds it. */
const x = (at: number) => Math.min(600, Math.max(0, ((at - start) / (60 * MIN)) * 600));
const ask = (id: string, minutes: number, title = `Ask ${id}`): PointAsk => ({ id, title, askedAt: start + minutes * MIN });

describe("sentInWindow", () => {
  test("an ask sent at the window's first moment is on the axis, and one sent before it is not", () => {
    expect(sentInWindow({ askedAt: start }, start)).toBe(true);
    expect(sentInWindow({ askedAt: start - 1 }, start)).toBe(false);
  });
});

describe("placePointAsks", () => {
  test("asks sent before the window are neither quoted nor marked, so the ask sent in it keeps its quote", () => {
    const places = placePointAsks([
      ask("c", -31 * 60, "#95: rebase onto core-split with the 175 -> 174 record"),
      ask("e1", -31 * 60, "#111: push the prepared wiring now; run the local controls when the disk allows"),
      ask("t", 9, "Stage 3: fence mobile post-startup effects, as a draft stacked on A2"),
    ], { start, x, width: 600 });
    expect(places).toEqual([{ id: "t", x: 90, label: "Stage 3: fence mobile post-…", quote: "after" }]);
  });

  test("an earlier ask with room neither after nor before its send becomes a mark, so the later ask keeps its words", () => {
    const places = placePointAsks([ask("a", 5), ask("b", 10), ask("c", 20)], { start, x, width: 600 });
    expect(places.map((place) => [place.id, place.quote])).toEqual([["a", null], ["b", "after"], ["c", "after"]]);
  });

  test("the ask that resumed a lane five minutes after a ruling keeps its quote, and the ruling's quote ends at its own send", () => {
    const places = placePointAsks([
      ask("ruling", 30, "Ruling: is the final guarded client submission the external-work acceptance boundary? (stage 4)"),
      ask("resume", 35, "Stage 4 resumed: Fable ruled YES (the final guarded client submission is the acceptance boundary)"),
    ], { start, x, width: 600 });
    expect(places).toEqual([
      { id: "ruling", x: 300, label: "Ruling: is the final guarde…", quote: "before" },
      { id: "resume", x: 350, label: "Stage 4 resumed: Fable rule…", quote: "after" },
    ]);
  });

  test("the newest ask, sent near now, keeps its words: they end at its send instead of running past the right edge", () => {
    const places = placePointAsks([
      ask("resume", 2, "Stage 4 resumed: Fable ruled YES (the final guarded client submission is the acceptance boundary)"),
      ask("stage5", 58, "Stage 5: fence local-agent and Codex commands and ACP invocation/delivery"),
    ], { start, x, width: 600 });
    expect(places).toEqual([
      { id: "resume", x: 20, label: "Stage 4 resumed: Fable rule…", quote: "after" },
      { id: "stage5", x: 580, label: "Stage 5: fence local-agent…", quote: "before" },
    ]);
  });

  test("a quote that would run past the left edge becomes a mark", () => {
    expect(placePointAsks([ask("a", 3), ask("z", 4)], { start, x, width: 600 })[0]?.quote).toBe(null);
  });

  test("no quote covers the mark of a later ask or an earlier one", () => {
    const places = placePointAsks([ask("v", 40), ask("y", 54), ask("z", 58)], { start, x, width: 600 });
    expect(places.map((place) => [place.id, place.quote])).toEqual([["v", "after"], ["y", "before"], ["z", null]]);
  });

  test("the row returns asks left to right, whatever order they arrive in", () => {
    const places = placePointAsks([ask("c", 20), ask("a", 5), ask("b", 10)], { start, x, width: 600 });
    expect(places.map((place) => [place.id, place.quote])).toEqual([["a", null], ["b", "after"], ["c", "after"]]);
  });
});
