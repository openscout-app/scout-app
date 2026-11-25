import { describe, expect, test } from "bun:test";

import type { Flight, FlightSessionTrace } from "../../lib/types.ts";
import { FLIGHT_RECORD_MISSING, flightRecordState, resolveFlightSessionId, uniqueFlightSessions } from "./flight-observe.ts";

function traceEntry(sessionId: string, startedAt: number): FlightSessionTrace {
  return {
    sessionId,
    startedAt,
    lastAcknowledgedAt: startedAt,
  };
}

describe("flight observe session selection", () => {
  test("orders unique sessions by their most recent trace span", () => {
    const firstA = traceEntry("session-a", 100);
    const sessionB = traceEntry("session-b", 200);
    const resumedA = traceEntry("session-a", 300);

    expect(uniqueFlightSessions([firstA, sessionB, resumedA])).toEqual([
      sessionB,
      resumedA,
    ]);
  });

  test("falls back to a concrete session when the flight record is unavailable", () => {
    expect(resolveFlightSessionId([], "session-known")).toBe("session-known");
  });

  test("keeps trace-tail selection when a requested session is not in the flight", () => {
    expect(resolveFlightSessionId([
      traceEntry("session-a", 100),
      traceEntry("session-b", 200),
    ], "session-stale")).toBe("session-b");
  });
});

describe("a flight page's record", () => {
  const flight = { id: "f", state: "running", sessions: [] } as unknown as Flight;
  test("nothing to read without a flight", () => {
    expect(flightRecordState(undefined, { value: null, error: null, loaded: false })).toEqual({ flight: null, loading: false, error: null });
  });
  test("reading, found, missing, and a failed read that keeps the record", () => {
    expect(flightRecordState("f", { value: null, error: null, loaded: false })).toEqual({ flight: null, loading: true, error: null });
    expect(flightRecordState("f", { value: flight, error: null, loaded: true })).toEqual({ flight, loading: false, error: null });
    expect(flightRecordState("f", { value: null, error: null, loaded: true }).error).toBe(FLIGHT_RECORD_MISSING);
    expect(flightRecordState("f", { value: flight, error: "offline", loaded: true })).toEqual({ flight, loading: false, error: "offline" });
  });
});
