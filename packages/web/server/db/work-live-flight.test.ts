import { describe, expect, test } from "bun:test";

import { projectLiveFlight } from "./work.ts";

const trace = (sessions: unknown[]) => JSON.stringify({ id: "flt-1", state: "running", startedAt: 1_000, metadata: { sessionTrace: sessions } });

describe("projectLiveFlight", () => {
  test("names the flight's current session and harness from the last trace entry", () => {
    const flight = projectLiveFlight(trace([
      { sessionId: "session-a", harness: "codex", startedAt: 1_000, lastAcknowledgedAt: 1_500 },
      { sessionId: "session-b", harness: "claude", startedAt: 2_000, lastAcknowledgedAt: 2_500 },
    ]), null);
    expect(flight).toEqual({ id: "flt-1", state: "running", sessionId: "session-b", harness: "claude", startedAt: 1_000, lastActivityAt: 2_500 });
  });

  test("last activity is the latest of start, session acknowledgement and work event", () => {
    expect(projectLiveFlight(trace([]), 9_000)?.lastActivityAt).toBe(9_000);
    expect(projectLiveFlight(trace([{ sessionId: "s", startedAt: 1_000, lastAcknowledgedAt: 4_000 }]), 3_000)?.lastActivityAt).toBe(4_000);
    expect(projectLiveFlight(trace([]), null)?.lastActivityAt).toBe(1_000);
  });

  test("a queued flight has no session yet", () => {
    const flight = projectLiveFlight(JSON.stringify({ id: "flt-q", state: "queued", startedAt: null, metadata: null }), null);
    expect(flight).toEqual({ id: "flt-q", state: "queued", sessionId: null, harness: null, startedAt: null, lastActivityAt: null });
  });

  test("no row or a malformed row is no live flight", () => {
    expect(projectLiveFlight(null, 5)).toBeNull();
    expect(projectLiveFlight("{", 5)).toBeNull();
    expect(projectLiveFlight(JSON.stringify({ state: "running" }), 5)).toBeNull();
  });
});
