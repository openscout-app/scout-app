import { describe, expect, test } from "bun:test";
import { collides, type GridLayout } from "../../../components/hud-grid/hud-grid-layout.ts";
import { HOME_GRID_ADOPTS, HOME_VIEW_INSTANCES, HOME_VIEW_LAYOUT } from "../../home/home-view.ts";
import { staleGridSave, type ViewComposition } from "../views-model.ts";
import { adoptedKey, adoptGridSave, adoptReplacedGrid, adoptRestoreSave, gridSaveKey, type AdoptingView } from "./adopt-grid.ts";

const home: AdoptingView & ViewComposition = {
  id: "home",
  label: "Home",
  intent: "",
  instances: HOME_VIEW_INSTANCES,
  layout: HOME_VIEW_LAYOUT,
  adopts: HOME_GRID_ADOPTS,
};
const instanceIds = home.instances.map((i) => i.id);

/** An operator's Home: the tail moved to the left, moving and coordination on the right. */
const OLD: GridLayout = [
  { id: "tail", x: 0, y: 0, w: 5, h: 20 },
  { id: "moving", x: 5, y: 0, w: 7, h: 10 },
  { id: "coord", x: 5, y: 10, w: 7, h: 10 },
  { id: "quotas", x: 0, y: 20, w: 8, h: 6 },
  { id: "velocity", x: 8, y: 20, w: 4, h: 6 },
];

function memory(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

const noOverlap = (layout: GridLayout) => {
  for (const [n, a] of layout.entries()) for (const b of layout.slice(n + 1)) expect(collides(a, b)).toBe(false);
};

describe("adoptGridSave", () => {
  const adopted = adoptGridSave({ old: OLD, ids: HOME_GRID_ADOPTS.ids, shipped: HOME_VIEW_LAYOUT, instanceIds, cols: 12 })!;

  test("keeps the operator's arrangement under the new ids, in the same shape", () => {
    const at = (id: string) => adopted.find((c) => c.id === id)!;
    const tail = at("home-tail");
    const moving = at("home-moving");
    const coord = at("home-coord");
    expect({ x: tail.x, w: tail.w, h: tail.h }).toEqual({ x: 0, w: 5, h: 20 });
    expect({ x: moving.x, w: moving.w }).toEqual({ x: 5, w: 7 });
    expect(coord.y).toBe(moving.y + moving.h);
    // shifted together, never pulled apart
    expect(moving.y - tail.y).toBe(0);
  });

  test("places every instance once, with no overlaps, the cockpit on top", () => {
    expect(adopted.map((c) => c.id).sort()).toEqual([...instanceIds].sort());
    noOverlap(adopted);
    expect(adopted.find((c) => c.id === "home-cockpit")).toEqual({ id: "home-cockpit", x: 0, y: 0, w: 12, h: 3 });
  });

  test("is not a stale save for the composition, so the host keeps it", () => {
    expect(staleGridSave(home, adopted)).toBe(false);
  });

  test("a save with none of the old panels adopts nothing", () => {
    expect(adoptGridSave({ old: [{ id: "other", x: 0, y: 0, w: 4, h: 4 }], ids: HOME_GRID_ADOPTS.ids, shipped: HOME_VIEW_LAYOUT, instanceIds, cols: 12 })).toBeNull();
  });

  test("at 8 columns, cells wider than the grid are narrowed and pulled in", () => {
    const eight = adoptGridSave({ old: OLD, ids: HOME_GRID_ADOPTS.ids, shipped: HOME_VIEW_LAYOUT, instanceIds, cols: 8 })!;
    for (const c of eight) expect(c.x + c.w).toBeLessThanOrEqual(8);
    noOverlap(eight);
  });
});

describe("adoptRestoreSave", () => {
  test("an expanded panel restores to its old cell, moved as far as its panel moved", () => {
    const old: GridLayout = [{ id: "moving", x: 0, y: 0, w: 12, h: 10 }];
    const adopted: GridLayout = [{ id: "home-moving", x: 0, y: 3, w: 12, h: 10 }];
    const restore = adoptRestoreSave([{ id: "moving", x: 0, y: 0, w: 8, h: 10 }], old, adopted, HOME_GRID_ADOPTS.ids);
    expect(restore).toEqual([{ id: "home-moving", x: 0, y: 3, w: 8, h: 10 }]);
  });
});

describe("adoptReplacedGrid", () => {
  test("copies the old Home save into the composition's, once, and leaves the old one", () => {
    const store = memory({ [gridSaveKey("home", 12)]: JSON.stringify(OLD) });
    expect(adoptReplacedGrid(home, store)).toBe(true);
    const saved = JSON.parse(store.getItem(gridSaveKey("view.home", 12))!) as GridLayout;
    expect(saved.find((c) => c.id === "home-tail")?.w).toBe(5);
    expect(store.getItem(gridSaveKey("home", 12))).toBe(JSON.stringify(OLD));
    expect(store.getItem(adoptedKey("home"))).toBe("1");
    // a second load, after the operator rearranged the composition, adopts nothing
    store.setItem(gridSaveKey("view.home", 12), "[]");
    expect(adoptReplacedGrid(home, store)).toBe(false);
    expect(store.getItem(gridSaveKey("view.home", 12))).toBe("[]");
  });

  test("never overwrites an arrangement the composition already has", () => {
    const mine = JSON.stringify(HOME_VIEW_LAYOUT);
    const store = memory({ [gridSaveKey("home", 12)]: JSON.stringify(OLD), [gridSaveKey("view.home", 12)]: mine });
    adoptReplacedGrid(home, store);
    expect(store.getItem(gridSaveKey("view.home", 12))).toBe(mine);
  });

  test("with no old save, nothing is written but the once-mark", () => {
    const store = memory();
    expect(adoptReplacedGrid(home, store)).toBe(false);
    expect([...store.data.keys()]).toEqual([adoptedKey("home")]);
  });

  test("a view that replaced no grid does nothing", () => {
    const store = memory({ [gridSaveKey("home", 12)]: JSON.stringify(OLD) });
    expect(adoptReplacedGrid({ ...home, adopts: undefined }, store)).toBe(false);
    expect(store.data.size).toBe(1);
  });

  test("storage that throws adopts nothing, and the shipped layout draws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(adoptReplacedGrid(home, broken)).toBe(false);
  });

  test("a copy that fails to write is tried again on the next load", () => {
    const store = memory({ [gridSaveKey("home", 12)]: JSON.stringify(OLD) });
    const full = {
      getItem: store.getItem,
      setItem: (k: string, v: string) => {
        if (k === gridSaveKey("view.home", 12)) throw new Error("QuotaExceededError");
        store.setItem(k, v);
      },
    };
    expect(adoptReplacedGrid(home, full)).toBe(false);
    expect(store.getItem(adoptedKey("home"))).toBeNull();
    expect(adoptReplacedGrid(home, store)).toBe(true);
    expect(store.getItem(gridSaveKey("view.home", 12))).not.toBeNull();
    expect(store.getItem(adoptedKey("home"))).toBe("1");
  });

  test("an unreadable old save is skipped", () => {
    const store = memory({ [gridSaveKey("home", 12)]: "{not json" });
    expect(adoptReplacedGrid(home, store)).toBe(false);
  });
});
