import { expect, test } from "bun:test";
import type { FlightRecord } from "@openscout/protocol";
import { isMobileAgentWorking } from "./service.ts";

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function flight(overrides: Partial<FlightRecord>): FlightRecord {
  return {
    id: "flt-1",
    invocationId: "inv-1",
    requesterId: "operator",
    targetAgentId: "agent.a",
    state: "running",
    startedAt: NOW - 2 * HOUR,
    ...overrides,
  } as FlightRecord;
}

test("an open flight with a live session is work", () => {
  expect(isMobileAgentWorking([flight({})], [{ state: "active" }], NOW)).toBe(true);
  expect(isMobileAgentWorking([flight({ state: "waiting" })], [{ state: "idle" }], NOW)).toBe(true);
});

test("an open flight whose session is gone is not work", () => {
  const stuck = flight({ startedAt: NOW - 59 * HOUR });
  expect(isMobileAgentWorking([stuck], [{ state: "offline" }], NOW)).toBe(false);
  expect(isMobileAgentWorking([stuck], [], NOW)).toBe(false);
});

test("a flight still bringing its session up is work for a few minutes", () => {
  const waking = flight({ state: "waking", startedAt: NOW - 60_000 });
  expect(isMobileAgentWorking([waking], [], NOW)).toBe(true);
  expect(isMobileAgentWorking([waking], [], NOW + HOUR)).toBe(false);
});

test("no open flight is not work, whatever the session", () => {
  expect(isMobileAgentWorking([flight({ state: "completed" })], [{ state: "active" }], NOW)).toBe(false);
  expect(isMobileAgentWorking([], [{ state: "active" }], NOW)).toBe(false);
});
