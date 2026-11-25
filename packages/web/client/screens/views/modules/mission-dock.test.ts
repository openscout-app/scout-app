import { describe, expect, test } from "bun:test";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import type { MissionLog } from "../../ops/mission-wall.ts";
import { createMissionDock } from "./mission-dock.ts";

const log = { id: "s1", sessionId: "s1" } as MissionLog;
const lane = { id: "s1" } as AgentLane;

describe("mission dock", () => {
  test("counts walls and context panels, and a release counts once", () => {
    const dock = createMissionDock();
    const releaseWall = dock.mountWall();
    const releaseDock = dock.dock();
    expect(dock.get()).toMatchObject({ walls: 1, docks: 1 });
    releaseDock();
    releaseDock();
    expect(dock.get().docks).toBe(0);
    releaseWall();
    releaseWall();
    expect(dock.get().walls).toBe(0);
  });

  test("StrictMode's mount, release, mount leaves one wall", () => {
    const dock = createMissionDock();
    const first = dock.mountWall();
    first();
    dock.mountWall();
    expect(dock.get().walls).toBe(1);
  });

  test("the context clears when the last wall leaves, and only then", () => {
    const dock = createMissionDock();
    const a = dock.mountWall();
    const b = dock.mountWall();
    dock.publish({ cursorId: "s1", log, lane });
    a();
    expect(dock.get().context?.cursorId).toBe("s1");
    b();
    expect(dock.get().context).toBeNull();
  });

  test("a context panel leaving keeps the wall's reading", () => {
    const dock = createMissionDock();
    dock.mountWall();
    const release = dock.dock();
    dock.publish({ cursorId: "s1", log, lane });
    release();
    expect(dock.get().context?.log).toBe(log);
  });

  test("an equal reading notifies no one; a new one does", () => {
    const dock = createMissionDock();
    let calls = 0;
    const unsubscribe = dock.subscribe(() => calls++);
    dock.publish({ cursorId: "s1", log, lane });
    const held = dock.get();
    dock.publish({ cursorId: "s1", log, lane });
    expect(calls).toBe(1);
    expect(dock.get()).toBe(held);
    dock.publish({ cursorId: "s1", log: { ...log }, lane });
    expect(calls).toBe(2);
    dock.publish(null);
    expect(calls).toBe(3);
    dock.publish(null);
    expect(calls).toBe(3);
    unsubscribe();
    dock.publish({ cursorId: "s2", log: null, lane: null });
    expect(calls).toBe(3);
  });

  test("every change is a new snapshot, so useSyncExternalStore sees it", () => {
    const dock = createMissionDock();
    const before = dock.get();
    dock.dock();
    expect(dock.get()).not.toBe(before);
    expect(before.docks).toBe(0);
  });
});
