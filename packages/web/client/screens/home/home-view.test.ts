import { describe, expect, test } from "bun:test";
import { collides } from "../../components/hud-grid/hud-grid-layout.ts";
import { FOLLOW_PAGE } from "../views/modules/follow-page.ts";
import { HOME_GRID_ARRANGEMENTS, HOME_GRID_DEFAULT } from "./home-grid.ts";
import {
  HOME_GRID_ADOPTS,
  HOME_MACHINE_KEY,
  HOME_VIEW_ARRANGEMENTS,
  HOME_VIEW_INSTANCES,
  HOME_VIEW_LAYOUT,
  homePanelMachine,
} from "./home-view.ts";

const ids = HOME_VIEW_INSTANCES.map((i) => i.id);

function placesEachOnce(layout: readonly { id: string; x: number; y: number; w: number; h: number }[]) {
  expect([...layout.map((c) => c.id)].sort()).toEqual([...ids].sort());
  for (const [n, a] of layout.entries()) {
    expect(a.x + a.w).toBeLessThanOrEqual(12);
    for (const b of layout.slice(n + 1)) expect({ a: a.id, b: b.id, overlap: collides(a, b) }).toEqual({ a: a.id, b: b.id, overlap: false });
  }
}

describe("Home as a composition", () => {
  test("the shipped layout places every panel once, with no overlaps", () => {
    placesEachOnce(HOME_VIEW_LAYOUT);
  });

  test("every arrangement places every panel once, with no overlaps", () => {
    expect(HOME_VIEW_ARRANGEMENTS.map((a) => a.id)).toEqual(HOME_GRID_ARRANGEMENTS.map((a) => a.id));
    for (const a of HOME_VIEW_ARRANGEMENTS) placesEachOnce(a.layout);
  });

  test("the Home grid keeps its shape, three rows down under the cockpit", () => {
    const cockpit = HOME_VIEW_LAYOUT.find((c) => c.id === "home-cockpit")!;
    expect(cockpit).toEqual({ id: "home-cockpit", x: 0, y: 0, w: 12, h: 3 });
    for (const old of HOME_GRID_DEFAULT) {
      const id = HOME_GRID_ADOPTS.ids[old.id as keyof typeof HOME_GRID_ADOPTS.ids];
      const cell = HOME_VIEW_LAYOUT.find((c) => c.id === id)!;
      if (old.id === "message") continue; // the composer sits beside Recent, under the tail
      expect({ ...cell, id: old.id }).toEqual({ ...old, y: old.y + 3 });
    }
  });

  test("each arrangement keeps the old grid's cells for the panels it had, three rows down", () => {
    for (const old of HOME_GRID_ARRANGEMENTS) {
      const next = HOME_VIEW_ARRANGEMENTS.find((a) => a.id === old.id)!;
      for (const cell of old.layout) {
        if (cell.id === "message") continue;
        const id = HOME_GRID_ADOPTS.ids[cell.id as keyof typeof HOME_GRID_ADOPTS.ids];
        expect({ arrangement: old.id, ...next.layout.find((c) => c.id === id)!, id: cell.id }).toEqual({ arrangement: old.id, ...cell, y: cell.y + 3 });
      }
    }
  });

  test("every panel the old grid saved maps to an instance on the view", () => {
    expect(Object.keys(HOME_GRID_ADOPTS.ids).sort()).toEqual(HOME_GRID_DEFAULT.map((c) => c.id).sort());
    for (const id of Object.values(HOME_GRID_ADOPTS.ids)) expect(ids).toContain(id);
  });

  test("the rail is on the view as Recent", () => {
    expect(HOME_VIEW_INSTANCES.find((i) => i.id === "home-recent")?.type).toBe("home-recent");
  });

  test("Recent and the composer end on one line under coordination and the tail", () => {
    const at = (id: string) => HOME_VIEW_LAYOUT.find((c) => c.id === id)!;
    const bottom = (id: string) => at(id).y + at(id).h;
    expect(at("home-recent").y).toBe(bottom("home-coord"));
    expect(at("home-message").y).toBe(bottom("home-tail"));
    expect(bottom("home-recent")).toBe(bottom("home-message"));
  });

  test("the panels Home narrowed by ?machineId= follow the page", () => {
    for (const id of ["home-moving", "home-coord", "home-message"]) {
      expect(HOME_VIEW_INSTANCES.find((i) => i.id === id)?.config?.[HOME_MACHINE_KEY]).toBe(FOLLOW_PAGE);
    }
  });
});

describe("homePanelMachine", () => {
  const follow = { [HOME_MACHINE_KEY]: FOLLOW_PAGE };

  test("following the page reads its ?machineId=", () => {
    expect(homePanelMachine({ view: "inbox", machineId: "mini" }, follow)).toBe("mini");
  });

  test("following a page with no machine is every machine", () => {
    expect(homePanelMachine({ view: "inbox" }, follow)).toBeNull();
    expect(homePanelMachine({ view: "search" }, follow)).toBeNull();
  });

  test("a pinned machine holds whatever the page says", () => {
    expect(homePanelMachine({ view: "inbox", machineId: "mini" }, { [HOME_MACHINE_KEY]: "build-host" })).toBe("build-host");
  });

  test("unset is every machine, even on a machine's page", () => {
    expect(homePanelMachine({ view: "inbox", machineId: "mini" }, {})).toBeNull();
  });
});
