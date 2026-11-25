import { expect, test } from "bun:test";
import type { FlightRecord } from "@openscout/protocol";
import { mobileAgentNowLine } from "./service.ts";

function flight(overrides: Partial<FlightRecord>): FlightRecord {
  return {
    id: "flt-1",
    invocationId: "inv-1",
    requesterId: "operator",
    targetAgentId: "agent.a",
    state: "running",
    startedAt: 1_000,
    ...overrides,
  } as FlightRecord;
}

const snapshot = {
  invocations: {
    "inv-1": { id: "inv-1", task: "\n  Run the iOS   tests\nand report failures" },
    "inv-2": { id: "inv-2", task: "Older task" },
  },
} as never;

test("a running flight reads as the first line of its task, whitespace folded", () => {
  expect(mobileAgentNowLine(snapshot, [flight({})])).toBe("Run the iOS tests");
});

test("a waiting flight reads as what it waits on", () => {
  const waiting = flight({ state: "waiting", waitingOn: { kind: "question", summary: "Keep the greeting?", since: 2_000 } });
  expect(mobileAgentNowLine(snapshot, [waiting])).toBe("Keep the greeting?");
});

test("the newest active flight wins; finished flights and no work read as nothing", () => {
  const older = flight({ id: "flt-0", invocationId: "inv-2", startedAt: 500 });
  expect(mobileAgentNowLine(snapshot, [older, flight({})])).toBe("Run the iOS tests");
  expect(mobileAgentNowLine(snapshot, [flight({ state: "completed" })])).toBeNull();
  expect(mobileAgentNowLine(snapshot, [])).toBeNull();
});

test("a long task is cut to one short line", () => {
  const long = { invocations: { "inv-1": { id: "inv-1", task: "x".repeat(300) } } } as never;
  const line = mobileAgentNowLine(long, [flight({})]);
  expect(line?.length).toBe(120);
  expect(line?.endsWith("…")).toBe(true);
});
