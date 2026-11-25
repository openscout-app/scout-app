import { expect, test } from "bun:test";
import { worldHistoryLoader } from "./history-load.ts";
import type { LiveHandlers } from "./live.ts";

function setup() {
  const requests: Array<{ hours: number; closed: boolean; handlers: LiveHandlers }> = [];
  const mounts: Array<[unknown, number, number?]> = [];
  const deltas: unknown[] = [], statuses: unknown[] = [];
  let retry = () => {};
  const loader = worldHistoryLoader((hours, handlers) => {
    const request = { hours, handlers, closed: false };
    requests.push(request);
    return () => { request.closed = true; };
  }, {
    mount: (data, hours, rung) => { mounts.push([data, hours, rung]); },
    delta: data => { deltas.push(data); }, status: data => { statuses.push(data); },
    error: (_msg, again) => { retry = again; }, loading: () => {},
  });
  loader.load(4);
  requests[0].handlers.onSeed("opening");
  return { loader, requests, mounts, deltas, statuses, retry: () => retry() };
}

test("a failed widening keeps the previous seed and stream, then retry replaces them together", () => {
  const { loader, requests, mounts, deltas, statuses, retry } = setup();
  expect(loader.select(24, 4)).toBe(true);
  requests[1].handlers.onError?.("temporarily unavailable");
  requests[0].handlers.onDelta("old stream");
  retry();
  expect(requests[1].closed).toBe(true);
  expect(requests[0].closed).toBe(false);
  requests[1].handlers.onSeed("late response");
  requests[2].handlers.onDelta("new stream before seed");
  requests[2].handlers.onSeed("wider");
  expect(requests[0].closed).toBe(true);
  requests[0].handlers.onDelta("obsolete stream");
  requests[2].handlers.onDelta("new stream");
  requests[2].handlers.onStatus?.("healthy");
  expect(mounts).toEqual([["opening", 4, undefined], ["wider", 24, 4]]);
  expect(deltas).toEqual(["old stream", "new stream"]);
  expect(statuses).toEqual(["healthy"]);
});

test("a narrower choice cancels an out-of-order widening, including after disposal", () => {
  const { loader, requests, mounts } = setup();
  loader.select(168, 5);
  loader.select(24, 4);
  expect(loader.select(4, 2)).toBe(false);
  for (const req of requests.slice(1)) {
    expect(req.closed).toBe(true);
    req.handlers.onSeed("late");
  }
  loader.dispose();
  expect(requests[0].closed).toBe(true);
  requests[0].handlers.onSeed("late reconnect");
  expect(mounts.length).toBe(1);
});

test("live ranges sharing one request keep the last rung and reconnect without resetting it", () => {
  const { loader, requests, mounts } = setup();
  loader.select(24, 4);
  loader.select(24, 5);
  expect(requests.length).toBe(2);
  requests[1].handlers.onSeed("initial");
  requests[1].handlers.onSeed("server reconnect");
  loader.reseed();
  expect(requests[2].hours).toBe(24);
  requests[2].handlers.onSeed("gap recovery");
  expect(mounts.slice(1)).toEqual([["initial", 24, 5], ["server reconnect", 24, undefined], ["gap recovery", 24, undefined]]);
});

test("a live gap can recover after the pending widening failed", () => {
  const { loader, requests, mounts } = setup();
  loader.select(24, 5);
  requests[1].handlers.onError?.("connection dropped");
  loader.reseed();
  loader.reseed();
  expect(requests.map(req => req.hours)).toEqual([4, 24, 24]);
  expect(requests[1].closed).toBe(true);
  requests[2].handlers.onSeed("recovered");
  expect(mounts.at(-1)).toEqual(["recovered", 24, 5]);
});
