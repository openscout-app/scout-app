import { describe, expect, test } from "bun:test";
import type { Route } from "../lib/types.ts";
import { allRouteViews, getPrimaryArea, routeViewsByArea } from "./primary-areas.ts";
import { ROUTE_AREA_BY_VIEW, areaForRoute, type NavigationEntryId } from "./route-areas.ts";

describe("route ownership", () => {
  test("ROUTE_AREA_BY_VIEW has exactly 30 keys and seven non-empty buckets", () => {
    const views = allRouteViews();
    expect(views).toHaveLength(30);
    expect(new Set(views).size).toBe(30);

    const buckets = routeViewsByArea();
    const areaIds = Object.keys(buckets) as NavigationEntryId[];
    expect(areaIds).toHaveLength(7);
    for (const id of areaIds) {
      expect(buckets[id].length).toBeGreaterThan(0);
    }

    const sortedViews = (views: Route["view"][]) => [...views].sort();
    // Home is the Feed: the Inbox, the old Feed route and Briefings fold into it.
    expect(sortedViews(buckets.home)).toEqual(sortedViews(["briefings", "feed", "inbox", "requests"]));
    // Chats holds rooms and DMs; Sent belongs with the operations record.
    expect(sortedViews(buckets.chat)).toEqual(
      sortedViews(["conversation", "messages", "rooms"]),
    );
    // agents-v2 is filed by view under Work (the project list and the agent
    // feed); areaForRoute moves an opened agent to Agents.
    expect(sortedViews(buckets.work)).toEqual(
      sortedViews([
        "activity",
        "agents-v2",
        "boards",
        "canvas",
        "code",
        "follow",
        "repo-diff",
        "repos",
        "review",
        "work",
      ]),
    );
    expect(sortedViews(buckets.agents)).toEqual(
      sortedViews(["agent-info", "sessions"]),
    );
    // Sent, the Ops pages, and Status (the old Home grid).
    expect(sortedViews(buckets.dashboards)).toEqual(sortedViews(["broker", "mesh", "mesh-ops", "ops", "status", "terminal"]));
    expect(buckets.search).toEqual(["search"] satisfies Route["view"][]);
    // Providers stays in Settings › Agents.
    expect(sortedViews(buckets.settings)).toEqual(
      sortedViews(["harnesses", "settings", "views", "voice"]),
    );
  });

  test("every Route view maps through areaForRoute", () => {
    for (const view of allRouteViews()) {
      const route = { view } as Route;
      const areaId = areaForRoute(route);
      expect(ROUTE_AREA_BY_VIEW[view]).toBe(areaId);
      expect(getPrimaryArea(areaId).id).toBe(areaId);
    }
  });

  test("an agent opened from the feed or a project belongs to Agents", () => {
    expect(areaForRoute({ view: "agents-v2" })).toBe("work");
    expect(areaForRoute({ view: "agents-v2", indexView: "projects" })).toBe("work");
    expect(areaForRoute({ view: "agents-v2", agentId: "agent-1" })).toBe("agents");
  });

  test("follow preferredView prefers the resolved target area", () => {
    expect(areaForRoute({ view: "follow" })).toBe("work");
    expect(areaForRoute({ view: "follow", preferredView: "tail" })).toBe("dashboards");
    expect(areaForRoute({ view: "follow", preferredView: "session" })).toBe("agents");
    expect(areaForRoute({ view: "follow", preferredView: "chat" })).toBe("chat");
    expect(areaForRoute({ view: "follow", preferredView: "work" })).toBe("work");
  });

  test("Ops pages file by mode: the instruments in Ops, Lanes and Map in Agents, Worktrees in Work", () => {
    for (const mode of ["mission", "cockpit", "tail", "issues", "atop", "week"] as const) {
      expect(areaForRoute({ view: "ops", mode })).toBe("dashboards");
    }
    for (const mode of ["agents", "lanes", "world"] as const) {
      expect(areaForRoute({ view: "ops", mode })).toBe("agents");
    }
    expect(areaForRoute({ view: "ops", mode: "advisor" })).toBe("work");
    expect(areaForRoute({ view: "ops" })).toBe("dashboards");
    expect(areaForRoute({ view: "status" })).toBe("dashboards");
    expect(areaForRoute({ view: "harnesses" })).toBe("settings");
    expect(areaForRoute({ view: "mesh-ops" })).toBe("dashboards");
  });

});
