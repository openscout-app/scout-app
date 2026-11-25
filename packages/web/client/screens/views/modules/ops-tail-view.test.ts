import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collides, gridColumnsFor, reconcile, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import { composedViewFor } from "../composed-routes.ts";
import { defaultsFor, SHIPPED_VIEWS, type ViewComposition } from "../views-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { tailPanelPlan } from "./tail-panel-model.ts";

/*
 * Ops › Tail and Ops › Alerts on every grid they can draw on: the stream is
 * the grid, and the rest dock on the right side from the top (Following, the
 * picked Event, the rail's Requests · Active), where they fold out of its way. Minimums are read from the module files as
 * text, as registry.test.ts does, so a change to any module's minSize is held
 * to this.
 *
 * Skipped until the compositions ship (views-model.ts SHIPPED_VIEWS gains
 * "ops-tail" and "ops-issues", composed-routes.ts claims modes tail and issues).
 */

const FILES: Record<string, string> = {
  // tail.tsx holds Tail first, then Alerts, at one size
  "tail": "tail.tsx",
  "alerts": "tail.tsx",
  "tail-event": "tail-event.tsx",
  "tail-follow": "tail-follow.tsx",
  "ops-queue": "ops-queue.tsx",
};

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

const blank = (id: string): ViewComposition => ({ id, label: "", intent: "", instances: [], layout: [] });

function holdsOnEveryGrid(v: ViewComposition, streamType: string) {
  const stream = v.instances.find((i) => i.type === streamType) ?? { id: streamType, type: streamType };
  const gridIds = v.instances.filter((i) => !v.sides?.right?.includes(i.id)).map((i) => i.id);
  const mins: GridMins = Object.fromEntries(v.instances.map((i) => [i.id, minOf(FILES[i.type] ?? "tail.tsx")]));
  const defaults = defaultsFor(v, v.instances, () => ({ w: 6, h: 8 }));

  test("the rest dock on the right side, top down: Following when there is one, Event, then Requests · Active", () => {
    const docked = (v.sides?.right ?? []).map((id) => v.instances.find((i) => i.id === id)?.type);
    expect(docked).toEqual(v.instances.some((i) => i.type === "tail-follow") ? ["tail-follow", "tail-event", "ops-queue"] : ["tail-event", "ops-queue"]);
    expect(v.sides?.left).toBeUndefined();
  });

  // 760 and 1099 are the 8-column grid's ends; 1100 and up is 12
  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px the stream is the whole grid`, () => {
      const cols = gridColumnsFor(width)!;
      const l = reconcile(null, defaults, gridIds, cols, mins);
      expect(l.map((i) => i.id)).toEqual([stream.id]);
      expect(l[0]).toMatchObject({ x: 0, y: 0, w: cols });
      expect(l[0]!.h).toBeGreaterThanOrEqual(mins[stream.id]!.h);
      expect(l.some((a) => l.some((b) => collides(a, b)))).toBe(false);
    });
  }

  // below 720px panels stack in instance order: the stream the page always was comes first, then the pick
  test("stacked, the stream leads, then Event", () => {
    expect(gridColumnsFor(719)).toBeNull();
    expect(v.instances[0]?.type).toBe(streamType);
    expect(v.instances[1]?.type).toBe("tail-event");
  });

  test("no New terminal: nothing here starts one", () => {
    expect(v.quickTerminal).toBe(false);
  });
}

const tailView = SHIPPED_VIEWS.find((v) => v.id === "ops-tail");

// skipIf still runs the describe body to collect its tests, so nothing here may assume the view
describe.skipIf(!tailView)("the Ops › Tail view", () => {
  const v = tailView ?? blank("ops-tail");
  const stream = v.instances.find((i) => i.type === "tail");

  test("is the stream, Event, Following and Requests · Active, one of each", () => {
    expect(v.instances.map((i) => i.type).sort()).toEqual(["ops-queue", "tail", "tail-event", "tail-follow"]);
    expect(v.host).toEqual({ view: "ops", mode: "tail" });
  });

  test("draws on /ops/tail, with or without a filter or follow ids", () => {
    expect(composedViewFor({ view: "ops", mode: "tail" })).toBe("ops-tail");
    expect(composedViewFor({ view: "ops", mode: "tail", tailQuery: "openscout" })).toBe("ops-tail");
    expect(composedViewFor({ view: "ops", mode: "tail", flightId: "flt-1", invocationId: "inv-1", conversationId: "c-1", workId: "w-1", sessionId: "s-1", targetAgentId: "opus" })).toBe("ops-tail");
  });

  test("its stream follows the page: the URL's filter and follow ids", () => {
    expect(stream?.config?.q).toBe(FOLLOW_PAGE);
    expect(tailPanelPlan({ view: "ops", mode: "tail", flightId: "flt-1" }, "tail", stream?.config ?? {})).toEqual({ follows: "page" });
  });

  holdsOnEveryGrid(v, "tail");
});

const issuesView = SHIPPED_VIEWS.find((v) => v.id === "ops-issues");

describe.skipIf(!issuesView)("the Ops › Alerts view", () => {
  const v = issuesView ?? blank("ops-issues");
  const stream = v.instances.find((i) => i.type === "alerts");

  test("is Alerts, Event and Requests · Active, one of each", () => {
    expect(v.instances.map((i) => i.type).sort()).toEqual(["alerts", "ops-queue", "tail-event"]);
    expect(v.host).toEqual({ view: "ops", mode: "issues" });
  });

  test("draws on /ops/issues, which /ops/errors and /ops/warnings parse to", () => {
    expect(composedViewFor({ view: "ops", mode: "issues" })).toBe("ops-issues");
  });

  test("its stream follows the page", () => {
    expect(stream?.config?.q).toBe(FOLLOW_PAGE);
    expect(tailPanelPlan({ view: "ops", mode: "issues" }, "issues", stream?.config ?? {})).toEqual({ follows: "page" });
  });

  holdsOnEveryGrid(v, "alerts");
});

describe.skipIf(!tailView || !issuesView)("the other Ops pages", () => {
  test("keep their own screens until they are composed: Tail and Alerts claim only their modes", () => {
    for (const mode of ["mission", "advisor", "atop", "agents", "lanes", "world", "week"] as const) {
      expect(composedViewFor({ view: "ops", mode }), mode).not.toBe("ops-tail");
      expect(composedViewFor({ view: "ops", mode }), mode).not.toBe("ops-issues");
    }
    // bare /ops is Control
    expect(composedViewFor({ view: "ops" })).not.toBe("ops-tail");
    expect(composedViewFor({ view: "ops" })).not.toBe("ops-issues");
  });
});
