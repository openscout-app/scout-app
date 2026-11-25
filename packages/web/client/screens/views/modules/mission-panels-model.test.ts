import { describe, expect, test } from "bun:test";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import type { MissionLog } from "../../ops/mission-wall.ts";
import type { MissionDockState } from "./mission-dock.ts";
import {
  cursorRoute,
  isMissionRoute,
  missionContextState,
  routeCursor,
  urlHoldsCursor,
} from "./mission-panels-model.ts";

describe("the wall's own route", () => {
  test("Ops › Control, and bare /ops, which opens on it", () => {
    expect(isMissionRoute({ view: "ops", mode: "mission" })).toBe(true);
    expect(isMissionRoute({ view: "ops" })).toBe(true);
    expect(isMissionRoute({ view: "ops", mode: "tail" })).toBe(false);
    expect(isMissionRoute({ view: "ops", mode: "lanes" })).toBe(false);
    expect(isMissionRoute({ view: "inbox" })).toBe(false);
  });
});

describe("the cursor in the URL", () => {
  test("reads ?sessionId= on Ops › Control only", () => {
    expect(routeCursor({ view: "ops", mode: "mission", sessionId: "abc" })).toBe("abc");
    expect(routeCursor({ view: "ops", sessionId: " abc " })).toBe("abc");
    expect(routeCursor({ view: "ops", mode: "mission", sessionId: "  " })).toBeNull();
    expect(routeCursor({ view: "ops", mode: "mission" })).toBeNull();
    expect(routeCursor({ view: "ops", mode: "tail", sessionId: "abc" })).toBeNull();
  });

  test("writes Ops › Control with the cursor, or without one", () => {
    expect(cursorRoute("abc")).toEqual({ view: "ops", mode: "mission", sessionId: "abc" });
    expect(cursorRoute(null)).toEqual({ view: "ops", mode: "mission" });
    expect(cursorRoute(" ")).toEqual({ view: "ops", mode: "mission" });
    expect(routeCursor(cursorRoute("abc"))).toBe("abc");
  });

  test("the wall holds its own cursor until the router writes sessionId on /ops/control", () => {
    expect(urlHoldsCursor(() => "/ops/control")).toBe(false);
    expect(urlHoldsCursor(() => "/ops/control?sessionId=probe")).toBe(true);
  });
});

describe("the Session context panel", () => {
  const log = { id: "s1", sessionId: "s1" } as MissionLog;
  const lane = { id: "s1" } as AgentLane;
  const dock = (patch: Partial<MissionDockState>): MissionDockState => ({ walls: 1, docks: 1, context: null, ...patch });

  test("says when there is no wall, before anything else", () => {
    expect(missionContextState(dock({ walls: 0, context: { cursorId: "s1", log, lane } })).kind).toBe("no-wall");
  });

  test("waits for a cursor", () => {
    expect(missionContextState(dock({})).kind).toBe("no-cursor");
    expect(missionContextState(dock({ context: { cursorId: null, log: null, lane: null } })).kind).toBe("no-cursor");
  });

  test("names a deep-linked session that has not written yet", () => {
    expect(missionContextState(dock({ context: { cursorId: "s9", log: null, lane: null } }))).toEqual({
      kind: "off-wall",
      sessionId: "s9",
    });
  });

  test("reads the cursor's log and lane", () => {
    expect(missionContextState(dock({ context: { cursorId: "s1", log, lane } }))).toEqual({ kind: "ready", log, lane });
  });
});
