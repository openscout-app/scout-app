import { describe, expect, test } from "bun:test";
import {
  GO_SHORTCUT_PROJECTION,
  NAV_DESTINATIONS,
  allProjectedDestinationIds,
  areaSubNavForRoute,
  getDestination,
  projectAreaSubNav,
  projectGoShortcuts,
  projectJumpDockItems,
  projectOpsSecondaryNav,
  projectPaletteNavCommands,
  sidebarSubNavForRoute,
  projectTopNavItems,
  type NavDestinationId,
} from "./nav-destinations.ts";
import { AGENTS_SECONDARY_NAV, OPS_SECONDARY_NAV } from "./secondaryNavConfig.ts";
import { GO_SHORTCUTS } from "../lib/go-shortcuts.ts";
import { TOP_NAV_ITEMS } from "./topNavConfig.ts";
import { areaForRoute as primaryAreaForRoute, type PrimaryAreaId } from "./route-areas.ts";
import type { Route } from "../lib/types.ts";

describe("nav destination catalog", () => {
  test("every catalog destination has a unique id, route, and active predicate", () => {
    const ids = NAV_DESTINATIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const destination of NAV_DESTINATIONS) {
      expect(destination.id).toBeTruthy();
      expect(destination.label).toBeTruthy();
      expect(destination.route).toBeTruthy();
      expect(typeof destination.route.view).toBe("string");
      expect(typeof destination.active).toBe("function");
      // Default route should activate its own destination.
      expect(destination.active(destination.route)).toBe(true);
    }
  });

  test("the Inbox is a catalog destination that folds into Home, which has no tabs", () => {
    const requests = getDestination("requests");
    expect(requests.label).toBe("Inbox");
    expect(requests.route).toEqual({ view: "requests" });
    expect(requests.active({ view: "requests" })).toBe(true);
    expect(requests.active({ view: "inbox" })).toBe(false);
    expect(projectTopNavItems().some((item) => item.route.view === "requests")).toBe(false);
    // Home is one page: the Inbox, the old Feed and Briefings keep their
    // addresses, belong to Home, and draw no tab row.
    expect(projectAreaSubNav("home")).toEqual([]);
    for (const route of [
      { view: "inbox" },
      { view: "requests" },
      { view: "feed" },
      { view: "briefings" },
    ] as const) {
      expect(primaryAreaForRoute(route)).toBe("home");
      expect(areaSubNavForRoute(route)).toBeNull();
      expect(sidebarSubNavForRoute(route)).toBeNull();
    }
  });

  test("every projected destination id resolves to a catalog entry", () => {
    for (const id of allProjectedDestinationIds()) {
      const destination = getDestination(id);
      expect(destination.id).toBe(id);
      expect(destination.active(destination.route)).toBe(true);
    }
  });

  test("keeps Agents and Repos addressable without putting them in the tab bar", () => {
    expect(getDestination("projects")).toMatchObject({
      label: "Agents",
      route: { view: "agents-v2" },
    });
    expect(getDestination("repos")).toMatchObject({
      label: "Repos",
      route: { view: "repos" },
    });
  });

  test("all destination projections inherit catalog labels", () => {
    for (const shortcut of projectGoShortcuts()) {
      expect(shortcut.label).toBe(`Go to ${getDestination(shortcut.destinationId).label}`);
    }
    for (const command of projectPaletteNavCommands()) {
      expect(command.label.replace(/^(Go to|Open) /, "")).toBe(getDestination(command.destinationId).label);
    }
    for (const jump of projectJumpDockItems()) {
      expect(jump.label).toBe(getDestination(jump.destinationId).label);
    }
    // Settings › Agents names the Providers surface; the other tabs use catalog labels.
    for (const area of ["home", "chat", "work", "agents", "dashboards", "settings"] as const) {
      for (const item of projectAreaSubNav(area)) {
        expect(item.label).toBe(area === "settings" && item.id === "agents"
          ? "Agents" : getDestination(item.destinationId).label);
      }
    }
    // The Ops screen's own strip keeps catalog labels.
    for (const item of projectOpsSecondaryNav().flatMap((group) => group.items)) {
      expect(NAV_DESTINATIONS.some((d) => d.label === item.label && d.active(item.route))).toBe(true);
    }
  });

  test("area entry points lead to the Projects list without renaming ids", () => {
    const projectsRoute = { view: "agents-v2", indexView: "projects" } as const;
    expect(getDestination("project-list").route).toEqual(projectsRoute);
    expect(projectTopNavItems().find((item) => item.key === "agents")?.route).toEqual(projectsRoute);
    expect(projectGoShortcuts().find((item) => item.key === "p")?.route).toEqual(projectsRoute);
    expect(projectPaletteNavCommands().find((item) => item.id === "nav:agents")?.route).toEqual(projectsRoute);
  });

  test("top nav projection matches the public TOP_NAV_ITEMS export", () => {
    expect(projectTopNavItems()).toEqual(TOP_NAV_ITEMS);
    expect(TOP_NAV_ITEMS.map((item) => item.key)).toEqual([
      "home",
      "sessions",
      "chat",
      "agents",
      "terminals",
      "search",
      "ops",
    ]);
  });

  test("ops tab destination lights for every ops mode; mission stays a deep link", () => {
    const ops = getDestination("ops");
    expect(ops.route).toEqual({ view: "ops", mode: "mission" });
    expect(ops.active({ view: "ops" })).toBe(true);
    expect(ops.active({ view: "ops", mode: "tail" })).toBe(true);
    expect(ops.active({ view: "ops", mode: "lanes" })).toBe(true);
    expect(ops.active({ view: "ops", mode: "world" })).toBe(true);
    expect(ops.active({ view: "search" })).toBe(false);

    const secondaryMission = OPS_SECONDARY_NAV
      .flatMap((g) => g.items)
      .find((item) => item.id === "control");
    expect(secondaryMission).toBeDefined();
    expect(secondaryMission!.route).toEqual({ view: "ops", mode: "mission" });
    expect(secondaryMission!.active({ view: "ops", mode: "mission" })).toBe(true);
    expect(secondaryMission!.active({ view: "ops", mode: "tail" })).toBe(false);
  });

  test("ops secondary nav items resolve to catalog destinations with valid active predicates", () => {
    const opsItems = projectOpsSecondaryNav().flatMap((g) => g.items);
    expect(opsItems.length).toBeGreaterThan(0);
    for (const item of opsItems) {
      expect(item.active(item.route)).toBe(true);
    }
  });

  test("secondary nav surfaces stay wired to the catalog", () => {
    expect(AGENTS_SECONDARY_NAV[0]?.items[0]?.route).toEqual({
      view: "settings",
      section: "agents",
    });
  });

  test("go-shortcuts projection preserves keys and resolves destinations", () => {
    const projected = projectGoShortcuts();
    expect(projected).toEqual([...GO_SHORTCUTS]);
    const keys = projected.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const shortcut of projected) {
      const destination = getDestination(shortcut.destinationId);
      expect(destination).toBeDefined();
      // Active predicate comes from the catalog destination.
      if (shortcut.route.view === destination.route.view) {
        expect(destination.active(shortcut.route) || destination.active(destination.route)).toBe(
          true,
        );
      }
    }
    expect(GO_SHORTCUTS.find((s) => s.key === "o")?.route).toEqual({ view: "ops", mode: "mission" });
    // each key reaches one place: g i is the Inbox, g c is Chats
    expect(GO_SHORTCUTS.find((s) => s.key === "i")?.destinationId).toBe("requests");
    expect(GO_SHORTCUTS.find((s) => s.key === "c")?.destinationId).toBe("chat");
    const destinations = projected.map((s) => s.destinationId);
    expect(new Set(destinations).size).toBe(destinations.length);
  });

  test("Alerts lights Tail, not Mission Control", () => {
    const alerts = { view: "ops", mode: "issues" } as const;
    expect(getDestination("mission-control").active(alerts)).toBe(false);
    expect(getDestination("tail").active(alerts)).toBe(true);
    expect(getDestination("mission-control").active({ view: "ops" })).toBe(true);
  });

  test("number shortcuts match the sidebar, with legacy links still available in the palette", () => {
    const commands = projectPaletteNavCommands();
    const destinations = ["home", "work-board", "chat", "sessions", "search", "mission-control"] as const;
    for (const [index, id] of destinations.entries()) {
      expect(commands.filter((c) => c.shortcut === `Cmd+${index + 1}`).map((c) => c.destinationId)).toEqual([id]);
    }
    for (const id of ["tail", "alerts", "work", "briefings", "views"] as const) {
      expect(commands.some((c) => c.destinationId === id)).toBe(true);
    }
    expect(commands.find((c) => c.destinationId === "week")).toBeUndefined();
    expect(commands.find((c) => c.destinationId === "requests")?.label).toBe("Open Inbox");
  });

  test("jump dock projection items resolve to catalog destinations", () => {
    const jumps = projectJumpDockItems();
    expect(jumps.length).toBeGreaterThan(0);
    for (const jump of jumps) {
      const destination = getDestination(jump.destinationId);
      expect(destination).toBeDefined();
      expect(jump.icon).toBeTruthy();
      expect(jump.route.view).toBeTruthy();
    }
    const opsJump = jumps.find((j) => j.id === "ops");
    expect(opsJump?.opsGated).toBe(true);
    expect(opsJump?.route).toEqual({ view: "ops", mode: "mission" });
  });

  test("palette nav projection resolves destinations and gates ops entries", () => {
    const all = projectPaletteNavCommands({ opsEnabled: true });
    const gated = projectPaletteNavCommands({ opsEnabled: false });
    expect(all.some((c) => c.id === "nav:ops")).toBe(true);
    expect(all.some((c) => c.id === "nav:ops-atop")).toBe(true);
    expect(gated.some((c) => c.id === "nav:ops")).toBe(false);
    expect(gated.some((c) => c.id === "nav:ops-atop")).toBe(false);
    // Settings drawer is intentionally absent from the destination projection.
    expect(all.some((c) => c.id === "nav:settings")).toBe(false);
    expect(all.find((c) => c.id === "nav:agents")?.label).toBe("Go to Projects");
    expect(all.find((c) => c.id === "nav:repos")?.label).toBe("Open Repos");
    expect(all.find((c) => c.id === "nav:code")).toBeUndefined();
    // Agent config remains a routed destination.
    expect(all.find((c) => c.id === "nav:agent-config")?.route).toEqual({
      view: "settings",
      section: "agents",
    });
    for (const command of all) {
      const destination = getDestination(command.destinationId as NavDestinationId);
      expect(destination).toBeDefined();
      expect(command.route.view).toBeTruthy();
    }
  });

  test("go-shortcut projection table only references known destinations", () => {
    for (const entry of GO_SHORTCUT_PROJECTION) {
      expect(() => getDestination(entry.destinationId)).not.toThrow();
    }
  });

  test("Board and Control expose exactly their approved tabs, regardless of optional surface flags", () => {
    for (const flags of [undefined, { canvasEnabled: true, meshOpsEnabled: true, boardsEnabled: true, reviewEnabled: true }]) {
      expect(projectAreaSubNav("work", flags).map((t) => [t.destinationId, t.label])).toEqual([
        ["work-board", "Board"], ["project-list", "Projects"],
      ]);
      expect(projectAreaSubNav("dashboards", flags).map((t) => [t.destinationId, t.label])).toEqual([
        ["mission-control", "Control"], ["terminals", "Terminals"], ["tail", "Tail"],
        ["runtime", "Processes"], ["mesh", "Hosts"],
      ]);
    }
    expect(projectAreaSubNav("dashboards", { opsControlEnabled: false }).map((t) => t.label)).toEqual([
      "Terminals", "Tail", "Hosts",
    ]);
    expect(projectAreaSubNav("settings").map((t) => t.label)).toEqual(["General", "Voice", "Agents"]);
  });

  test("single surfaces have an active sidebar row but no sub-navigation", () => {
    const cases: [Route, PrimaryAreaId][] = [
      [{ view: "rooms" }, "chat"], [{ view: "messages" }, "chat"],
      [{ view: "conversation", conversationId: "c-1" }, "chat"],
      [{ view: "rooms", directId: "dm-1" }, "chat"],
      [{ view: "sessions" }, "agents"], [{ view: "ops", mode: "lanes" }, "agents"],
      [{ view: "agents-v2", agentId: "a" }, "agents"], [{ view: "search" }, "search"],
    ];
    for (const [route, area] of cases) {
      expect(primaryAreaForRoute(route)).toBe(area);
      expect(areaSubNavForRoute(route)).toBeNull();
      expect(sidebarSubNavForRoute(route)).toBeNull();
    }
  });

  test("each visible tab belongs to its area and lights only itself on its default route", () => {
    for (const area of ["work", "dashboards", "settings"] as const) {
      const items = projectAreaSubNav(area);
      for (const item of items) {
        expect(primaryAreaForRoute(item.route)).toBe(area);
        expect(items.filter((t) => t.active(item.route)).map((t) => t.id)).toEqual([item.id]);
      }
    }
  });

  test("folded and legacy links keep their area without inventing a visible tab", () => {
    const cases: [Route, "work" | "dashboards" | "settings", string[]][] = [
      [{ view: "work", workId: "w-1" }, "work", ["Board"]],
      [{ view: "review" }, "work", ["Board"]],
      [{ view: "boards", boardId: "b-1" }, "work", ["Board"]],
      [{ view: "agents-v2", projectSlug: "openscout" }, "work", ["Projects"]],
      [{ view: "repos" }, "work", []],
      [{ view: "repo-diff", path: "/tmp/repo" }, "work", []],
      [{ view: "activity" }, "work", []],
      [{ view: "ops", mode: "advisor" }, "work", []],
      [{ view: "ops" }, "dashboards", ["Control"]],
      [{ view: "ops", mode: "issues" }, "dashboards", ["Tail"]],
      [{ view: "mesh-ops" }, "dashboards", ["Hosts"]],
      [{ view: "settings", section: "agents" }, "settings", ["Agents"]],
      [{ view: "views" }, "settings", ["General"]],
    ];
    for (const [route, area, labels] of cases) {
      for (const project of [areaSubNavForRoute, sidebarSubNavForRoute]) {
        const nav = project(route);
        expect(nav?.areaId).toBe(area);
        expect(nav?.items.filter((t) => t.active(route)).map((t) => t.label)).toEqual(labels);
      }
    }
    expect(getDestination("repos").active({ view: "repo-diff", path: "/tmp/repo" })).toBe(true);
  });

  test("chat destination lights for DM and channel conversations alike", () => {
    const chat = getDestination("chat");
    expect(chat.active({ view: "messages" })).toBe(true);
    // A channel deep link is just a conversation id on the unified route.
    expect(chat.active({ view: "messages", conversationId: "chan-1" })).toBe(true);
    expect(chat.active({ view: "conversation", conversationId: "c-1" })).toBe(true);
    expect(chat.active({ view: "rooms" })).toBe(true);
    expect(chat.active({ view: "rooms", directId: "dm-1" })).toBe(true);
  });

  test("the expanded sidebar shows the same tabs as the area's tab row", () => {
    const options = { canvasEnabled: true, meshOpsEnabled: true };
    for (const route of [
      { view: "broker", filter: "failed" },
      { view: "work", workId: "", board: true },
      { view: "ops", mode: "advisor" },
      { view: "terminal" },
      { view: "ops", mode: "tail" },
      { view: "voice" },
    ] as const) {
      const sidebar = sidebarSubNavForRoute(route, options);
      const strip = areaSubNavForRoute(route, options);
      expect(sidebar?.areaId).toBe(strip!.areaId);
      expect(sidebar?.items.map(({ id, label, route }) => ({ id, label, route }))).toEqual(
        strip!.items.map(({ id, label, route }) => ({ id, label, route })),
      );
      expect(sidebar?.items.map((item) => item.active(route))).toEqual(strip!.items.map((item) => item.active(route)));
    }
    expect(sidebarSubNavForRoute({ view: "rooms" })).toBeNull();
    expect(sidebarSubNavForRoute({ view: "inbox" })).toBeNull();
    expect(sidebarSubNavForRoute({ view: "search" })).toBeNull();
  });
});
