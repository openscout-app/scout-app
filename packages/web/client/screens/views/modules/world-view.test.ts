import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collides, gridColumnsFor, reconcile, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import type { Route } from "../../../lib/types.ts";
import { composedViewFor } from "../composed-routes.ts";
import { defaultsFor, SHIPPED_VIEWS, type ViewComposition } from "../views-model.ts";

/*
 * Ops › Overview as a composition: the HUD as the main area, its own two side
 * columns docked beside it, on every grid it can draw on. Minimums are read from the module files as text,
 * as registry.test.ts does, so a change to any of them is held to this.
 *
 * Skipped until the composition ships (views-model.ts SHIPPED_VIEWS gains
 * "ops-world"; composed-routes.ts claims mode week).
 */

const FILES: Record<string, string> = {
  "world-stage": "world-stage.tsx",
  "world-readouts": "world-readouts.tsx",
  "world-details": "world-details.tsx",
};

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

const shipped = SHIPPED_VIEWS.find((v) => v.id === "ops-world");
// a skipped describe still runs its body: an empty stand-in keeps it from throwing
const blank: ViewComposition = { id: "ops-world", label: "", intent: "", instances: [], layout: [] };
const ops = (mode: string, extra: Partial<Extract<Route, { view: "ops" }>> = {}) => ({ view: "ops", mode, ...extra }) as Route;

describe.skipIf(!shipped)("the World view", () => {
  const v = shipped ?? blank;
  const ids = v.instances.map((i) => i.id);
  const idOf = (type: string) => v.instances.find((i) => i.type === type)?.id ?? type;

  test("is the HUD between its two columns; stacked, the world leads", () => {
    expect(v.host).toEqual({ view: "ops", mode: "week" });
    expect(v.quickTerminal).toBe(false);
    expect(v.instances.map((i) => i.type)).toEqual(["world-stage", "world-readouts", "world-details"]);
  });

  test("draws on /ops/world (and the legacy /ops/week), its ?source= and ?data= included", () => {
    expect(composedViewFor(ops("week"))).toBe("ops-world");
    expect(composedViewFor(ops("week", { source: "live", dataset: "team" }))).toBe("ops-world");
  });

  test("never takes Lanes or Fleet", () => {
    expect(composedViewFor(ops("lanes"))).not.toBe("ops-world");
    expect(composedViewFor(ops("world"))).not.toBe("ops-world");
  });

  test("docks the readouts left and the details right, each at its own width", () => {
    expect(v.sides?.left).toEqual([idOf("world-readouts")]);
    expect(v.sides?.right).toEqual([idOf("world-details")]);
    // docked sides open at the shared pane width in pixels, not a quarter of the grid each
    expect(v.sideWidth).toBeUndefined();
  });

  const docked = new Set([...(v.sides?.left ?? []), ...(v.sides?.right ?? [])]);
  const gridIds = ids.filter((id) => !docked.has(id));
  const mins: GridMins = Object.fromEntries(v.instances.map((i) => [i.id, minOf(FILES[i.type]!)]));
  const defaults = defaultsFor(v, v.instances, () => ({ w: 6, h: 8 }));

  // 760 and 1099 are the 8-column grid's ends; 1100 and up is 12
  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px the world is the main area and fills the grid`, () => {
      const cols = gridColumnsFor(width)!;
      const l = reconcile(null, defaults, gridIds, cols, mins);
      expect(l.map((i) => i.id)).toEqual([idOf("world-stage")]);
      const stage = l[0]!;
      expect(stage).toMatchObject({ x: 0, y: 0, w: cols, h: 24 });
      expect(l.some((a) => l.some((b) => collides(a, b)))).toBe(false);
    });
  }
});
