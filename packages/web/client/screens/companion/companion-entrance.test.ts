import { describe, expect, test } from "bun:test";

import { ENTRANCE, ENTRANCE_TOTAL_MS, entranceDelays } from "./companion-entrance.ts";

describe("entranceDelays", () => {
  test("the home row files out nearest to the hex first", () => {
    const delays = entranceDelays([{ id: "far", x: 100 }, { id: "near", x: 900 }, { id: "mid", x: 500 }], 1000);
    expect([...delays.keys()]).toEqual(["near", "mid", "far"]);
    expect(delays.get("near")).toBe(ENTRANCE.CREW_START_MS);
    expect(delays.get("mid")).toBe(ENTRANCE.CREW_START_MS + ENTRANCE.STAGGER_MS);
    expect(delays.get("far")).toBe(ENTRANCE.CREW_START_MS + 2 * ENTRANCE.STAGGER_MS);
  });

  test("placed figures come after the home row", () => {
    const delays = entranceDelays([{ id: "row", x: 40 }], 0, ["placed-a", "placed-b"]);
    expect([...delays.keys()]).toEqual(["row", "placed-a", "placed-b"]);
  });

  test("a large crew shrinks the stagger to stay inside the span", () => {
    const row = Array.from({ length: 30 }, (_, index) => ({ id: `w${index}`, x: index * 10 }));
    const delays = entranceDelays(row, 0);
    const last = Math.max(...delays.values());
    expect(last).toBe(ENTRANCE.CREW_START_MS + ENTRANCE.CREW_SPAN_MS);
    expect(last + ENTRANCE.STEP_MS).toBeLessThanOrEqual(ENTRANCE_TOTAL_MS);
  });

  test("one figure leaves at the start, and none gives an empty map", () => {
    expect(entranceDelays([{ id: "solo", x: 10 }], 0).get("solo")).toBe(ENTRANCE.CREW_START_MS);
    expect(entranceDelays([], 0).size).toBe(0);
  });
});
