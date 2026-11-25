import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collides, gridColumnsFor, reconcile, type GridLayout, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import { defaultsFor, shippedView, sideOf } from "../views-model.ts";

/*
 * The Terminals view on every grid it can draw on: the Index docked on the
 * left, as wide as it is dragged (DockedSides.tsx), and the Workspace (the old
 * main stage) taking the whole grid beside it. The workspace's minimum is read
 * from its module file as text, as registry.test.ts does.
 */

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

const view = shippedView("terminals");
const gridIds = view.instances.filter((i) => !sideOf(view, i.id)).map((i) => i.id);
const mins: GridMins = { "terminals-workspace": minOf("terminal-workspace.tsx") };
const defaults = defaultsFor(view, view.instances, () => ({ w: 6, h: 8 }));
const cell = (l: GridLayout, id: string) => l.find((i) => i.id === id)!;

describe("the Terminals view", () => {
  test("the index docks on the left; the workspace is the grid's one panel", () => {
    expect(sideOf(view, "terminals-index")).toBe("left");
    expect(gridIds).toEqual(["terminals-workspace"]);
  });

  // below 720px panels stack in instance order, so the stage must not sit under the index
  test("stacked, the workspace comes first", () => {
    expect(gridColumnsFor(719)).toBeNull();
    expect(view.instances[0]?.type).toBe("terminal-workspace");
  });

  // 760 and 1099 are the 8-column grid's ends; 1100 and up is 12
  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px the workspace fills the grid from the top`, () => {
      const cols = gridColumnsFor(width)!;
      const l = reconcile(null, defaults, gridIds, cols, mins);
      const ws = cell(l, "terminals-workspace");
      expect(ws).toMatchObject({ x: 0, y: 0, w: cols });
      expect(ws.w).toBeGreaterThanOrEqual(mins["terminals-workspace"].w);
      expect(l.some((a) => l.some((b) => collides(a, b)))).toBe(false);
    });
  }
});
