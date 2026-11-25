/**
 * Neutral route breadcrumb labels for the slim top utility bar.
 *
 * Extracted from topNavConfig so breadcrumbs survive deletion of the top-tab
 * projection (SCO-083). Prefer this module for new call sites.
 */
import type { Route } from "../lib/types.ts";
import { getDestination } from "./nav-destinations.ts";

/** Human labels for primary/detail route views used in breadcrumbs and chrome. */
export const ROUTE_VIEW_LABELS: Record<string, string> = {
  requests: getDestination("requests").label,
  inbox: getDestination("home").label,
  conversation: "Conversation",
  "agent-info": "Agent",
  "agents-v2": getDestination("projects").label,
  messages: getDestination("chat").label,
  rooms: getDestination("chat").label,
  sessions: getDestination("sessions").label,
  terminal: getDestination("terminals").label,
  repos: getDestination("repos").label,
  "repo-diff": "Diff",
  harnesses: getDestination("providers").label,
  search: getDestination("search").label,
  activity: getDestination("activity").label,
  briefings: "Briefings",
  views: "Views",
  boards: getDestination("boards").label,
  review: getDestination("review").label,
  canvas: "Workspace",
  feed: getDestination("feed").label,
  mesh: getDestination("mesh").label,
  "mesh-ops": getDestination("mesh-ops").label,
  status: "Status",
  broker: "Control",
  settings: "Settings",
  work: getDestination("work-board").label,
  follow: "Follow",
  code: "Files",
  ops: getDestination("ops").label,
  voice: "Live Voice",
};

/**
 * Breadcrumb text for the current route, or null when the top-level primary
 * destination already conveys the location (Feed, Sessions, etc.).
 *
 * Complete for primary/detail routes that benefit from a detail crumb.
 */
export function routeBreadcrumbForRoute(route: Route): string | null {
  if (route.view === "settings" && route.section === "agents") {
    return getDestination("agent-config").label;
  }
  switch (route.view) {
    case "agents-v2":
      return getDestination("project-list").active(route) ? getDestination("project-list").label : null;
    case "terminal":
    case "conversation":
    case "agent-info":
    case "repos":
    case "repo-diff":
    case "harnesses":
    case "mesh":
    case "mesh-ops":
    case "work":
    case "code":
    case "briefings":
    case "rooms":
    case "activity":
    case "views":
    case "boards":
    case "review":
    case "canvas":
    case "feed":
    case "follow":
    case "voice":
      return ROUTE_VIEW_LABELS[route.view] ?? route.view;
    case "ops": {
      if (route.mode === "tail" || route.mode === "issues") return getDestination("tail").label;
      if (route.mode === "lanes") return getDestination("lanes").label;
      if (route.mode === "world") return "Network";
      if (route.mode === "week") return "Control";
      if (route.mode === "atop") return getDestination("runtime").label;
      if (route.mode === "advisor") return getDestination("advisor").label;
      if (route.mode === "mission" || route.mode === undefined) {
        return getDestination("mission-control").label;
      }
      return ROUTE_VIEW_LABELS.ops;
    }
    case "settings":
      return "Settings";
    case "sessions":
    case "inbox":
    case "messages":
    case "search":
    case "broker":
    default:
      return null;
  }
}
