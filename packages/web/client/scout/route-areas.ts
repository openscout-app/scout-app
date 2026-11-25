/**
 * Route classification shared by area chrome and destination projections.
 * Kept dependency-free so primary areas can read canonical catalog labels
 * without creating a primary-areas ↔ nav-destinations initialization cycle.
 */
import type { FollowPreferredView, OpsMode, Route } from "../lib/types.ts";

/** Stable route-owner ids, in sidebar order (labels live in primary-areas.ts). */
export type PrimaryAreaId =
  | "home"
  | "work"
  | "chat"
  | "agents"
  | "search"
  | "dashboards"
  | "settings";

/** Every route belongs to a primary area. */
export type NavigationEntryId = PrimaryAreaId;

/**
 * Exhaustive view → primary area map. Proves every Route["view"] union member
 * is classified.
 *
 * A view is not always enough: Ops pages, an agent opened from the feed and a
 * resolved follow belong by more than their view, so chrome classifies routes
 * with areaForRoute.
 */
export const ROUTE_AREA_BY_VIEW = {
  // Home is the Feed, led by what waits on the operator: the Inbox, the old
  // Feed route and Briefings fold into it.
  inbox: "home",
  requests: "home",
  feed: "home",
  briefings: "home",
  // Chat: rooms and one-to-one conversations.
  messages: "chat",
  conversation: "chat",
  rooms: "chat",
  // Sent is the dispatch ledger: every ask's delivery, not a conversation.
  broker: "dashboards",
  // Work: the board, the projects, their changes and files, what agents
  // showed, and the log of what happened (the agent feed included).
  work: "work",
  review: "work",
  boards: "work",
  "agents-v2": "work",
  repos: "work",
  "repo-diff": "work",
  code: "work",
  canvas: "work",
  activity: "work",
  follow: "work",
  // Agents: who is working and where.
  "agent-info": "agents",
  sessions: "agents",
  // Control owns the machine: terminals, processes, hosts and the event tail.
  terminal: "dashboards",
  mesh: "dashboards",
  "mesh-ops": "dashboards",
  ops: "dashboards",
  status: "dashboards",
  search: "search",
  // Settings: how Scout looks, sounds and runs, Home's tab order included.
  // Providers (usage and budget) sits in Settings › Agents.
  views: "settings",
  harnesses: "settings",
  settings: "settings",
  voice: "settings",
} as const satisfies Record<Route["view"], NavigationEntryId>;

/**
 * Each Ops page's area: the instruments are Ops'; Lanes and Map
 * (Fleet) are Agents' tabs, and Worktrees is Work's.
 */
const OPS_MODE_AREA: Record<OpsMode, PrimaryAreaId> = {
  mission: "dashboards",
  cockpit: "dashboards",
  tail: "dashboards",
  issues: "dashboards",
  atop: "dashboards",
  week: "dashboards",
  agents: "agents",
  lanes: "agents",
  world: "agents",
  advisor: "work",
};

/** Where a follow lands once its target is resolved. */
const FOLLOW_TARGET_AREA: Record<FollowPreferredView, PrimaryAreaId> = {
  tail: "dashboards",
  session: "agents",
  chat: "chat",
  work: "work",
};

/**
 * The area a route belongs to. Most routes belong by view; an Ops page by its
 * mode; an agent opened from the feed or a project is Agents'; and
 * FollowScreen (a transient resolver) belongs to its resolved target's area
 * when preferredView is set.
 */
export function areaForRoute(route: Route): NavigationEntryId {
  if (route.view === "agents-v2" && route.agentId) return "agents";
  if (route.view === "ops" && route.mode) return OPS_MODE_AREA[route.mode];
  if (route.view === "follow" && route.preferredView) return FOLLOW_TARGET_AREA[route.preferredView];
  return ROUTE_AREA_BY_VIEW[route.view];
}
