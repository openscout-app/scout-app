import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collides, gridColumnsFor, reconcile, type GridLayout, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import { composedViewFor } from "../composed-routes.ts";
import { defaultsFor, SHIPPED_VIEWS } from "../views-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { searchPanelMode } from "./search-panel-model.ts";

/*
 * The Search view on every grid it can draw on: Search on the left, Result
 * beside it from the top, the index under Result. Minimums are read from the
 * module files as text, as registry.test.ts does, so a change to any module's
 * minSize is held to this.
 *
 * Skipped until the composition ships (views-model.ts SHIPPED_VIEWS gains
 * "search", composed-routes.ts claims the Search route).
 */

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

const view = SHIPPED_VIEWS.find((v) => v.id === "search");

// skipIf still runs the describe body to collect its tests, so nothing here may assume the view
describe.skipIf(!view)("the Search view", () => {
  const v = view ?? { id: "search", label: "", intent: "", instances: [], layout: [] };
  const ids = v.instances.map((i) => i.id);
  const byType = (type: string) => v.instances.find((i) => i.type === type) ?? { id: type, type };
  const results = byType("search-results");
  const result = byType("search-hit");
  const index = byType("search-index");
  const mins: GridMins = {
    [results.id]: minOf("search-results.tsx"),
    [result.id]: minOf("search-hit.tsx"),
    [index.id]: minOf("search-index.tsx"),
  };
  const defaults = defaultsFor(v, v.instances, () => ({ w: 6, h: 8 }));
  const cell = (l: GridLayout, id: string) => l.find((i) => i.id === id)!;

  test("hosts on the Search route, and every Search URL draws it", () => {
    expect(v.host).toEqual({ view: "search" });
    expect(composedViewFor({ view: "search" })).toBe("search");
    expect(composedViewFor({ view: "search", hitId: "h", mode: "indexer" })).toBe("search");
    expect(composedViewFor({ view: "search", filters: { query: "x", sourceKinds: [], harness: [], project: [], timeWindow: "all" } })).toBe("search");
  });

  test("its Search panel follows the page", () => {
    expect(searchPanelMode(results.config ?? {}, { view: "search" })).toBe("route");
    expect(results.config?.follow).toBe(FOLLOW_PAGE);
  });

  test("no New terminal: nothing on Search starts one", () => {
    expect(v.quickTerminal).toBe(false);
  });

  // below 720px panels stack in instance order: the field and the list come first
  test("stacked, Search leads, then Result, then the index", () => {
    expect(gridColumnsFor(719)).toBeNull();
    expect(v.instances.map((i) => i.type)).toEqual(["search-results", "search-hit", "search-index"]);
  });

  test("Search and Result share an 8-column row", () => {
    expect(mins[results.id].w + mins[result.id].w).toBeLessThanOrEqual(8);
  });

  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px Result sits beside Search from the top, the index under Result`, () => {
      const cols = gridColumnsFor(width)!;
      const l = reconcile(null, defaults, ids, cols, mins);
      const list = cell(l, results.id);
      const hit = cell(l, result.id);
      const idx = cell(l, index.id);
      expect(list).toMatchObject({ x: 0, y: 0 });
      expect(hit.y).toBe(0);
      expect(hit.x).toBe(list.x + list.w);
      expect(hit.x + hit.w).toBe(cols);
      expect(idx.x).toBe(hit.x);
      expect(idx.y).toBe(hit.y + hit.h);
      for (const id of ids) {
        expect(cell(l, id).w, id).toBeGreaterThanOrEqual(mins[id].w);
        expect(cell(l, id).h, id).toBeGreaterThanOrEqual(mins[id].h);
      }
      expect(l.some((a) => l.some((b) => collides(a, b)))).toBe(false);
    });
  }
});
