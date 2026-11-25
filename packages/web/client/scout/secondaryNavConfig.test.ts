import { describe, expect, test } from "bun:test";
import { areaSubNavForRoute, projectOpsSecondaryNav } from "./nav-destinations.ts";
import { OPS_SECONDARY_NAV } from "./secondaryNavConfig.ts";

describe("ops secondary nav", () => {
  test("keeps the Ops screen's own strip in its order and labels", () => {
    const items = OPS_SECONDARY_NAV.flatMap((group) => group.items);
    expect(items.map((item) => item.label)).toEqual(["Control", "Terminals", "Tail", "Processes", "Hosts"]);
    expect(items.map((item) => item.route)).toEqual(
      projectOpsSecondaryNav().flatMap((group) => group.items.map((item) => item.route)),
    );
  });

  test("each legacy Control strip button lights the same area tab, including folded routes", () => {
    const items = OPS_SECONDARY_NAV.flatMap((group) => group.items);
    for (const route of [...items.map((item) => item.route), { view: "mesh-ops" }, { view: "ops", mode: "issues" }] as const) {
      const sub = areaSubNavForRoute(route);
      expect(sub?.areaId).toBe("dashboards");
      expect(sub?.items.filter((tab) => tab.active(route)).map((tab) => tab.label)).toEqual(
        items.filter((item) => item.active(route)).map((item) => item.label),
      );
    }
  });

  test("keeps Mission Control reachable inside the ops cluster", () => {
    const missionControl = OPS_SECONDARY_NAV
      .flatMap((group) => group.items)
      .find((item) => item.id === "control");

    expect(missionControl).toBeDefined();
    expect(missionControl?.label).toBe("Control");
    expect(missionControl?.route).toEqual({ view: "ops", mode: "mission" });
    expect(missionControl?.active({ view: "ops" })).toBe(true);
    expect(missionControl?.active({ view: "ops", mode: "mission" })).toBe(true);
  });
});
