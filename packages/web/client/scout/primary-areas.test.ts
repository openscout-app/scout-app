import { describe, expect, test } from "bun:test";
import { HomeGlyph } from "../components/ScoutGlyph.tsx";
import {
  PRIMARY_AREAS, defaultRouteForArea, getPrimaryArea, navigatePrimaryAreas,
  primaryAreaForRoute, systemPrimaryAreas, toolPrimaryAreas,
} from "./primary-areas.ts";

describe("canonical sidebar", () => {
  test("rows follow the work in order, with boundaries before Board and Control", () => {
    expect(PRIMARY_AREAS.map(({ id, label, section, group }) => [id, label, section, group])).toEqual([
      ["home", "Feed", "navigate", "home"],
      ["work", "Board", "navigate", "work"],
      ["chat", "Chat", "navigate", "work"],
      ["agents", "Sessions", "navigate", "work"],
      ["search", "Search", "navigate", "work"],
      ["dashboards", "Control", "navigate", "dashboards"],
      ["settings", "Settings", "system", "infrastructure"],
    ]);
    expect(navigatePrimaryAreas()).toEqual(PRIMARY_AREAS.slice(0, -1));
    expect(systemPrimaryAreas()).toEqual([getPrimaryArea("settings")]);
    expect(toolPrimaryAreas()).toEqual([]);
    expect(getPrimaryArea("home").icon).toBe(HomeGlyph);
  });

  test("each row opens its canonical landing and lights itself", () => {
    expect(PRIMARY_AREAS.map(({ id }) => defaultRouteForArea(id))).toEqual([
      { view: "inbox" },
      { view: "work", workId: "", board: true },
      { view: "rooms" },
      { view: "sessions" },
      { view: "search" },
      { view: "ops", mode: "mission" },
      { view: "settings", section: "appearance" },
    ]);
    for (const area of PRIMARY_AREAS) {
      expect(primaryAreaForRoute(area.defaultRoute)).toBe(area.id);
    }
  });
});
