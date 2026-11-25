/** Sidebar rows and section boundaries; route-areas.ts owns active state. */
import {
  ChatsGlyph,
  FolderGlyph,
  HomeGlyph,
  OpsGlyph,
  SearchGlyph,
  SessionsGlyph,
  SettingsGlyph,
  type NavIcon,
} from "../components/ScoutGlyph.tsx";
import type { Route } from "../lib/types.ts";
import { getDestination } from "./nav-destinations.ts";
import {
  ROUTE_AREA_BY_VIEW,
  areaForRoute,
  type PrimaryAreaId,
  type NavigationEntryId,
} from "./route-areas.ts";
export {
  ROUTE_AREA_BY_VIEW,
  areaForRoute,
  type PrimaryAreaId,
  type NavigationEntryId,
} from "./route-areas.ts";

/** Full Scout uses navigate and system; alternate layouts can supply tool rows. */
export type PrimaryAreaSection = "tools" | "navigate" | "system";

/**
 * An area's intent inside its section. The expanded sidebar draws a hairline
 * where the group changes: Feed, then the work, then Control. The icon
 * rail draws no rules and keeps its one row pitch.
 */
export type PrimaryAreaGroup = "tools" | "home" | "work" | "dashboards" | "record" | "infrastructure";

export type PrimaryArea = {
  id: PrimaryAreaId;
  label: string;
  icon: NavIcon;
  /** Default route when the area is selected: its first tab. */
  defaultRoute: Route;
  section: PrimaryAreaSection;
  group: PrimaryAreaGroup;
};

/** Feed → plan → discuss → execute → recall → inspect. Settings stays at the foot. */
export const PRIMARY_AREAS: readonly PrimaryArea[] = [
  {
    // The Feed row carries the open Inbox count.
    id: "home",
    label: getDestination("home").label,
    icon: HomeGlyph,
    defaultRoute: getDestination("home").route,
    section: "navigate",
    group: "home",
  },
  {
    id: "work",
    label: getDestination("work-board").label,
    icon: FolderGlyph,
    defaultRoute: getDestination("work-board").route,
    section: "navigate",
    group: "work",
  },
  {
    id: "chat",
    label: getDestination("chat").label,
    icon: ChatsGlyph,
    defaultRoute: getDestination("chat").route,
    section: "navigate",
    group: "work",
  },
  {
    id: "agents",
    label: getDestination("sessions").label,
    icon: SessionsGlyph,
    defaultRoute: getDestination("sessions").route,
    section: "navigate",
    group: "work",
  },
  {
    id: "search",
    label: getDestination("search").label,
    icon: SearchGlyph,
    defaultRoute: getDestination("search").route,
    section: "navigate",
    group: "work",
  },
  {
    id: "dashboards",
    label: getDestination("mission-control").label,
    icon: OpsGlyph,
    defaultRoute: getDestination("mission-control").route,
    section: "navigate",
    group: "dashboards",
  },
  {
    id: "settings",
    label: "Settings",
    icon: SettingsGlyph,
    defaultRoute: { view: "settings", section: "appearance" },
    section: "system",
    group: "infrastructure",
  },
] as const;

/** One sidebar row: a primary area, or a row of a build's own (basic's Terminals). */
export type SidebarRow = Omit<PrimaryArea, "id" | "group"> & { id: string; group?: PrimaryAreaGroup };

/**
 * A build that groups its sidebar differently from the full app (basic) passes
 * its rows and says which row a route lights. Rows it shares with the full app
 * should be the full app's areas, so labels and icons stay in step.
 */
export type SidebarLayout = {
  rows: readonly SidebarRow[];
  rowForRoute: (route: Route) => string;
};

const AREA_BY_ID: ReadonlyMap<PrimaryAreaId, PrimaryArea> = new Map(
  PRIMARY_AREAS.map((area) => [area.id, area]),
);

export function getPrimaryArea(id: PrimaryAreaId): PrimaryArea {
  const area = AREA_BY_ID.get(id);
  if (!area) {
    throw new Error(`Unknown primary area: ${id}`);
  }
  return area;
}

/** Resolve the primary area for a route (see areaForRoute). */
export function primaryAreaForRoute(route: Route): NavigationEntryId {
  return areaForRoute(route);
}

/** Default route for an area: its first tab. Control opens on its mission wall. */
export function defaultRouteForArea(
  areaId: PrimaryAreaId,
  _options?: { opsControlEnabled?: boolean },
): Route {
  return getPrimaryArea(areaId).defaultRoute;
}

/** Areas in the tools row at the top of the list (order stable). */
export function toolPrimaryAreas(): readonly PrimaryArea[] {
  return PRIMARY_AREAS.filter((area) => area.section === "tools");
}

/** Areas in the Navigate section (order stable). */
export function navigatePrimaryAreas(): readonly PrimaryArea[] {
  return PRIMARY_AREAS.filter((area) => area.section === "navigate");
}

/** Areas in the System section (order stable). */
export function systemPrimaryAreas(): readonly PrimaryArea[] {
  return PRIMARY_AREAS.filter((area) => area.section === "system");
}

/** All Route["view"] keys classified by the area map. */
export function allRouteViews(): readonly Route["view"][] {
  return Object.keys(ROUTE_AREA_BY_VIEW) as Route["view"][];
}

/** Bucket every view under its area. */
export function routeViewsByArea(): Record<NavigationEntryId, Route["view"][]> {
  const buckets = Object.fromEntries(
    PRIMARY_AREAS.map((area) => [area.id, [] as Route["view"][]]),
  ) as Record<NavigationEntryId, Route["view"][]>;
  for (const [view, areaId] of Object.entries(ROUTE_AREA_BY_VIEW) as Array<
    [Route["view"], NavigationEntryId]
  >) {
    buckets[areaId].push(view);
  }
  return buckets;
}
