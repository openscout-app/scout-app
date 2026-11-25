import { describe, expect, test } from "bun:test";

import { failedRunOf } from "./work.ts";

describe("failedRunOf", () => {
  const failed = { state: "waiting", last_flight_state: "failed", last_flight_id: "flt-1", waiting_on_flight_id: "flt-1" };

  test("a wait the runtime wrote for a failed flight is a failed run", () => {
    expect(failedRunOf(failed)).toEqual({ flightId: "flt-1" });
  });

  test("a wait set by hand afterwards, or on another flight, is a real wait", () => {
    expect(failedRunOf({ ...failed, waiting_on_flight_id: null })).toBe(null);
    expect(failedRunOf({ ...failed, waiting_on_flight_id: "flt-0" })).toBe(null);
  });

  test("only waiting items whose last flight failed", () => {
    expect(failedRunOf({ ...failed, state: "working" })).toBe(null);
    expect(failedRunOf({ ...failed, last_flight_state: "completed" })).toBe(null);
    expect(failedRunOf({ state: "waiting" })).toBe(null);
  });
});
