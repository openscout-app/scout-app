import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collides, gridColumnsFor, reconcile, type GridLayout, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import { composedViewFor } from "../composed-routes.ts";
import { defaultsFor, shippedView } from "../views-model.ts";

/*
 * The Dispatch view on every grid it can draw on: the overview on top (Routes,
 * then Health beside it), the record under it (the Ledger under Routes, In
 * flight under Health). Minimums are read from the module files as text, as
 * registry.test.ts does, so a change to a module's minSize is held to this.
 */

const FILES: Record<string, string> = {
  "dispatches": "dispatches.tsx",
  "dispatch-routes": "dispatch-routes.tsx",
  "dispatch-health": "dispatch-health.tsx",
  // asks.tsx holds In flight first, then Recently done
  "inflight": "asks.tsx",
};

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

const view = shippedView("dispatch");
const ids = view.instances.map((i) => i.id);
const idOf = (type: string) => view.instances.find((i) => i.type === type)!.id;
const mins: GridMins = Object.fromEntries(view.instances.map((i) => [i.id, minOf(FILES[i.type]!)]));
const defaults = defaultsFor(view, view.instances, () => ({ w: 6, h: 8 }));
const cell = (l: GridLayout, type: string) => l.find((i) => i.id === idOf(type))!;

describe("the Dispatch view", () => {
  test("is the Ledger, Routes, Health and In flight, one of each", () => {
    expect(view.instances.map((i) => i.type).sort()).toEqual(["dispatch-health", "dispatch-routes", "dispatches", "inflight"]);
    expect(view.id).toBe("dispatch");
    expect(view.host).toEqual({ view: "broker" });
  });

  test("draws on /dispatch, with or without a scope or an open dispatch", () => {
    expect(composedViewFor({ view: "broker" })).toBe("dispatch");
    expect(composedViewFor({ view: "broker", filter: "failed" })).toBe("dispatch");
    expect(composedViewFor({ view: "broker", attemptId: "message:m1", focus: ["agent:opus"], between: false, window: "24h" })).toBe("dispatch");
  });

  test("never takes the routes that stay full-bleed", () => {
    expect(composedViewFor({ view: "work", workId: "w1" })).not.toBe("dispatch");
    expect(composedViewFor({ view: "follow", flightId: "f1" })).not.toBe("dispatch");
  });

  // below 720px panels stack in instance order: the ledger the page always led with comes first
  test("stacked, the Ledger comes first", () => {
    expect(gridColumnsFor(719)).toBeNull();
    expect(view.instances[0]?.type).toBe("dispatches");
  });

  // 760 and 1099 are the 8-column grid's ends; 1100 and up is 12
  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px the overview sits on top and the record under it`, () => {
      const cols = gridColumnsFor(width)!;
      const l = reconcile(null, defaults, ids, cols, mins);
      const routes = cell(l, "dispatch-routes");
      const health = cell(l, "dispatch-health");
      const ledger = cell(l, "dispatches");
      const inflight = cell(l, "inflight");
      expect(routes).toMatchObject({ x: 0, y: 0 });
      expect(health).toMatchObject({ x: routes.w, y: 0 });
      expect(health.x + health.w).toBe(cols);
      expect(ledger).toMatchObject({ x: 0, y: routes.h, w: routes.w });
      expect(inflight).toMatchObject({ x: health.x, y: health.h, w: health.w });
      for (const item of l) {
        expect(item.w, item.id).toBeGreaterThanOrEqual(mins[item.id]!.w);
        expect(item.h, item.id).toBeGreaterThanOrEqual(mins[item.id]!.h);
      }
      expect(l.some((a) => l.some((b) => collides(a, b)))).toBe(false);
    });
  }
});
