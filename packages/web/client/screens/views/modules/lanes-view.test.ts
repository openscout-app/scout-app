import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gridColumnsFor, reconcile, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import type { Route } from "../../../lib/types.ts";
import { composedViewFor } from "../composed-routes.ts";
import { defaultsFor, SHIPPED_VIEWS, type ViewComposition } from "../views-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * Ops › Lanes in three regions, each with its own handle: the roster docked
 * on the left, the deck as the main area, and the lane it opened over Ops
 * summary and Requests · Active docked on the right. The deck is the grid's
 * only panel and fills it on every grid it can draw on. Minimums are read
 * from the module files as text, as registry.test.ts does, so a change to
 * any module's minSize is held to this.
 *
 * Skipped until the composition ships (views-model.ts SHIPPED_VIEWS gains
 * "ops-lanes"; composed-routes.ts claims mode lanes).
 */

const FILES: Record<string, string> = {
  "lanes": "lanes.tsx",
  "lane": "lane.tsx",
  "lanes-roster": "lanes-roster.tsx",
  "ops-summary": "ops-summary.tsx",
  "ops-queue": "ops-queue.tsx",
};

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

const shipped = SHIPPED_VIEWS.find((v) => v.id === "ops-lanes");
// a skipped describe still runs its body: an empty stand-in keeps it from throwing
const v: ViewComposition = shipped ?? { id: "ops-lanes", label: "", intent: "", instances: [], layout: [] };
const ops = (mode: string, extra: Partial<Extract<Route, { view: "ops" }>> = {}) => ({ view: "ops", mode, ...extra }) as Route;

describe.skipIf(!shipped)("the Lanes view", () => {
  test("is the deck, the lane it opened, the roster, the Ops inspector and Requests · Active", () => {
    expect(v.host).toEqual({ view: "ops", mode: "lanes" });
    expect(v.quickTerminal).toBe(false);
    // stacked, the deck leads, then the lane it opened
    expect(v.instances.map((i) => i.type)).toEqual(["lanes", "lane", "lanes-roster", "ops-summary", "ops-queue"]);
    // ?sessionId= is the page's lane
    expect(v.instances.find((i) => i.type === "lane")?.config).toEqual({ lane: FOLLOW_PAGE });
    // the deck starts unscoped: every project, any harness
    expect(v.instances.find((i) => i.type === "lanes")?.config ?? {}).toEqual({});
  });

  test("draws on /ops/lanes, with or without the lane the deck opened", () => {
    expect(composedViewFor(ops("lanes"))).toBe("ops-lanes");
    expect(composedViewFor(ops("lanes", { sessionId: "native:codex:019a" }))).toBe("ops-lanes");
    expect(composedViewFor(ops("lanes", { targetAgentId: "scout.ada" }))).toBe("ops-lanes");
  });

  test("leaves the floor (/ops/fleet) and World (/ops/world) their screens", () => {
    expect(composedViewFor(ops("world"))).not.toBe("ops-lanes");
    expect(composedViewFor(ops("week"))).not.toBe("ops-lanes");
  });

  const byType = (type: string) => v.instances.find((i) => i.type === type)?.id ?? type;

  test("docks the roster left and the lane, over the summary and the queue, right", () => {
    expect(v.sides?.left).toEqual([byType("lanes-roster")]);
    // the lane leads the right side
    expect(v.sides?.right).toEqual(["lane", "ops-summary", "ops-queue"].map(byType));
    // a lane reads whole, so its side ships wider than a list's
    expect(v.sideWidth?.right ?? 0).toBeGreaterThan(v.sideWidth?.left ?? 340);
    // and the lane takes most of its side's height
    const w = v.sideWeights ?? {};
    const [laneW, ...rest] = (v.sides?.right ?? []).map((id) => w[id] ?? 0);
    expect(laneW!).toBeGreaterThan(rest.reduce((a, b) => a + b, 0));
  });

  const docked = new Set([...(v.sides?.left ?? []), ...(v.sides?.right ?? [])]);
  const gridIds = v.instances.map((i) => i.id).filter((id) => !docked.has(id));
  const mins: GridMins = Object.fromEntries(v.instances.map((i) => [i.id, minOf(FILES[i.type]!)]));
  const defaults = defaultsFor(v, v.instances, () => ({ w: 6, h: 8 }));

  // 760 and 1099 are the 8-column grid's ends; 1100 and up is 12
  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px the deck is the main area and fills the grid`, () => {
      const cols = gridColumnsFor(width)!;
      const l = reconcile(null, defaults, gridIds, cols, mins);
      expect(l.map((i) => i.id)).toEqual([byType("lanes")]);
      const deck = l[0]!;
      expect(deck).toMatchObject({ x: 0, y: 0, w: cols });
      expect(deck.h).toBeGreaterThanOrEqual(mins[deck.id]!.h);
    });
  }
});
