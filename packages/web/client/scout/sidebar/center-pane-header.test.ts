import { describe, expect, test } from "bun:test";
import { routeBreadcrumbForRoute } from "../route-breadcrumb.ts";
import { areaSubNavForRoute } from "../nav-destinations.ts";
import { primaryAreaForRoute, ROUTE_AREA_BY_VIEW } from "../primary-areas.ts";
import { hasSecondaryNavRow } from "./center-pane-header-state.ts";

/**
 * Breadcrumb header seam coverage (SCO-085 / SCO-086).
 * CenterPaneHeader composes these pure projections — assert the seam inputs
 * for a sample of routes without mounting React chrome.
 */
describe("center-pane header seam projections (SCO-085 / SCO-086)", () => {
  test("the Inbox folds into Home, which is one page and draws no tab row", () => {
    expect(primaryAreaForRoute({ view: "requests" })).toBe("home");
    expect(hasSecondaryNavRow({ view: "requests" })).toBe(false);
    expect(hasSecondaryNavRow({ view: "inbox" })).toBe(false);
    expect(areaSubNavForRoute({ view: "requests" })).toBeNull();
  });

  test("breadcrumb renders for sample detail routes", () => {
    expect(routeBreadcrumbForRoute({ view: "sessions" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "repos" })).toBe("Repos");
    expect(routeBreadcrumbForRoute({ view: "code" })).toBe("Files");
    expect(routeBreadcrumbForRoute({ view: "canvas" })).toBe("Workspace");
    expect(routeBreadcrumbForRoute({ view: "activity" })).toBe("Activity");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "lanes" })).toBe("Lanes");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "world" })).toBe("Network");
  });

  test("breadcrumb is null on top-level area landings that need no crumb", () => {
    expect(routeBreadcrumbForRoute({ view: "inbox" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "agents-v2" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "messages" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "search" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "broker" })).toBeNull();
  });

  test("area sub-nav strip is present for each area with several pages", () => {
    expect(areaSubNavForRoute({ view: "rooms" })).toBeNull();
    for (const route of [
      { view: "work", workId: "", board: true } as const,
      { view: "agents-v2", indexView: "projects" } as const,
      { view: "activity" } as const,
    ]) {
      expect(areaSubNavForRoute(route)?.items.map((i) => i.label)).toEqual([
        "Board",
        "Projects",
      ]);
    }
    for (const route of [{ view: "mesh" }, { view: "terminal" }, { view: "ops", mode: "tail" }] as const) {
      expect(areaSubNavForRoute(route)?.items.map((i) => i.label)).toEqual([
        "Control", "Terminals", "Tail", "Processes", "Hosts",
      ]);
    }
    expect(areaSubNavForRoute({ view: "harnesses" })?.items.map((i) => i.label)).toEqual([
      "General",
      "Voice",
      "Agents",
    ]);
  });

  test("header seam has content when either breadcrumb or sub-nav applies", () => {
    const samples = [
      { view: "agents-v2" as const },
      { view: "code" as const },
      { view: "ops" as const, mode: "lanes" as const },
      { view: "broker" as const },
      { view: "harnesses" as const },
    ];
    // Board, Control and Settings have tabs; Lanes keeps a detail breadcrumb.
    for (const route of samples) {
      const crumb = routeBreadcrumbForRoute(route);
      const sub = areaSubNavForRoute(route);
      expect([route.view, Boolean(crumb) || Boolean(sub)]).toEqual([route.view, true]);
    }
  });

  test("areaSubNavForRoute is parity-aligned with ROUTE_AREA_BY_VIEW", () => {
    const withSubNav = new Set(["work", "dashboards", "settings"]);
    for (const [view, areaId] of Object.entries(ROUTE_AREA_BY_VIEW) as Array<
      [keyof typeof ROUTE_AREA_BY_VIEW, (typeof ROUTE_AREA_BY_VIEW)[keyof typeof ROUTE_AREA_BY_VIEW]]
    >) {
      const route = { view } as Parameters<typeof areaSubNavForRoute>[0];
      const sub = areaSubNavForRoute(route, { meshOpsEnabled: true });
      if (withSubNav.has(areaId)) {
        expect(sub?.areaId as string | undefined).toBe(areaId);
        expect(primaryAreaForRoute(route)).toBe(areaId);
      } else {
        // Home has one tab; Search has none.
        expect(sub).toBeNull();
      }
    }
  });

  // SCO-088b/c: the top row is ONE 40px band. hasSecondaryNavRow gates whether
  // the INLINE tab cluster (and its slash separator) render beside the section
  // name: it is true exactly when the route's area has several tabs.
  test("hasSecondaryNavRow is true wherever the route's area has tabs", () => {
    for (const route of [
      { view: "broker" } as const,
      { view: "work", workId: "", board: true } as const,
      { view: "agents-v2" } as const,
      { view: "code" } as const,
      { view: "ops", mode: "advisor" } as const,
      { view: "mesh" } as const,
      { view: "settings", section: "appearance" } as const,
      { view: "ops", mode: "tail" } as const,
      { view: "harnesses" } as const,
    ]) {
      expect([route, hasSecondaryNavRow(route)]).toEqual([route, true]);
      expect(hasSecondaryNavRow(route)).toBe(Boolean(areaSubNavForRoute(route)));
    }
  });

  test("hasSecondaryNavRow is false on flush landings — section name only", () => {
    // No tab cluster: the top row shows just the section name (no slash, no tabs).
    expect(hasSecondaryNavRow({ view: "sessions" })).toBe(false);
    expect(hasSecondaryNavRow({ view: "ops", mode: "lanes" })).toBe(false);
    expect(hasSecondaryNavRow({ view: "search" })).toBe(false);
    expect(hasSecondaryNavRow({ view: "rooms" })).toBe(false);
    expect(hasSecondaryNavRow({ view: "messages" })).toBe(false);
    expect(hasSecondaryNavRow({ view: "inbox" })).toBe(false);
    expect(hasSecondaryNavRow({ view: "feed" })).toBe(false);
    expect(hasSecondaryNavRow({ view: "briefings" })).toBe(false);
  });
});
