import { expect, test } from "bun:test";
import type { BrokerEvent } from "./sse.ts";
import { readRequestEvent, requestIdsForRecord } from "./request-events.ts";

const upserted = (record: unknown) => ({ kind: "collaboration.upserted", payload: { record } }) as unknown as BrokerEvent;

test("a permission record backs its permission row; an operator question backs its need row", () => {
  expect(requestIdsForRecord({ id: "p1", metadata: { permissionRequest: {} } })).toEqual(["permission:p1"]);
  expect(requestIdsForRecord({ id: "operator-question:m1", metadata: {} })).toEqual(["need:m1"]);
  expect(requestIdsForRecord({ id: "q1", metadata: { operatorNeedMessageId: "m2" } })).toEqual(["need:m2"]);
  expect(requestIdsForRecord({ id: "work-1", metadata: {} })).toEqual([]);
});

test("a settled request names what leaves the list; an open one names nothing", () => {
  expect(readRequestEvent(upserted({ id: "p1", state: "closed", metadata: { permissionRequest: {} } }))).toEqual({ settled: ["permission:p1"] });
  expect(readRequestEvent(upserted({ id: "p1", state: "declined", metadata: { permissionRequest: {} } }))).toEqual({ settled: ["permission:p1"] });
  expect(readRequestEvent(upserted({ id: "p1", state: "open", metadata: { permissionRequest: {} } }))).toEqual({ settled: [] });
});

test("events about anything else are not request events", () => {
  expect(readRequestEvent(upserted({ id: "work-1", state: "done", metadata: {} }))).toBeNull();
  expect(readRequestEvent(upserted(null))).toBeNull();
  expect(readRequestEvent({ kind: "message.posted", payload: {} } as BrokerEvent)).toBeNull();
});
