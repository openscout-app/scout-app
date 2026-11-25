/**
 * Canonical navigation destination catalog + surface projections.
 *
 * Identity (id, label, route, active, capability) lives here once.
 * Surface-specific concerns — tab keys, action prefixes, shortcut keys,
 * palette ids/subtitles, dock icons — live in the projections below.
 *
 * History: the sco-082 web-navigation worklog series was removed from the
 * tree after its PRs merged; see git history.
 */
import type { LucideIcon } from "lucide-react";
import {
  Compass,
  FileText,
  GitBranch,
  House,
  ScrollText,
  Search,
  Terminal,
} from "lucide-react";
import type { CommandOption } from "@hudsonkit";
import type { SecondaryNavGroup } from "../components/SecondaryNav.tsx";
import type { Route } from "../lib/types.ts";
import { areaForRoute } from "./route-areas.ts";

/**
 * Top-tab keys used by chrome. `system` is a residual key for routes outside
 * the tab row (settings, voice) so no tab false-highlights on them.
 */
export type TopNavKey =
  | "requests"
  | "home"
  | "chat"
  | "agents"
  | "terminals"
  | "sessions"
  | "broker"
  | "search"
  | "ops"
  | "system";

export type TopNavItem = {
  key: TopNavKey;
  label: string;
  route: Route;
};

/* ── Catalog ──────────────────────────────────────────────────────────── */

export type NavCapability = "ops.control" | "surface.mesh-ops" | "surface.board" | "surface.review" | "surface.canvas" | "surface.feed";

export type NavDestinationId =
  | "requests"
  | "home"
  | "status"
  | "projects"
  | "project-list"
  | "sessions"
  | "chat"
  | "search"
  | "terminals"
  | "tail"
  | "dispatch"
  | "activity"
  | "work"
  | "work-board"
  | "briefings"
  | "views"
  | "boards"
  | "review"
  | "canvas"
  | "feed"
  | "alerts"
  | "mesh"
  | "mesh-ops"
  | "mission-control"
  | "lanes"
  | "world"
  | "week"
  | "cockpit"
  | "repos"
  | "code"
  | "providers"
  | "runtime"
  | "advisor"
  | "agent-config"
  | "settings-general"
  | "voice"
  | "ops";

export type NavDestination = {
  id: NavDestinationId;
  /** Canonical product label for this destination. */
  label: string;
  /** Default route opened when navigating to this destination. */
  route: Route;
  /** Whether the current route is "on" this destination. */
  active: (route: Route) => boolean;
  /** When set, surfaces must hide this destination unless the flag is on. */
  capability?: NavCapability;
};

function isOpsMission(route: Route): boolean {
  return (
    route.view === "ops" &&
    (route.mode === undefined || route.mode === "mission")
  );
}

/**
 * Single source of truth for every navigable product destination.
 * Projections pick rows from this table; they do not redefine routes/active.
 */
/** The project list, or a project's own pages (not an agent opened in one). */
function isProjectListRoute(route: Route): boolean {
  if (route.view !== "agents-v2") return false;
  if (route.projectSlug) return !route.agentId;
  return route.indexView === "projects";
}

export const NAV_DESTINATIONS: readonly NavDestination[] = [
  { id: "requests", label: "Inbox", route: { view: "requests" }, active: (route) => route.view === "requests" },
  {
    id: "home",
    label: "Feed",
    route: { view: "inbox" },
    active: (route) => route.view === "inbox",
  },
  {
    // Historical id for the agent directory. The Projects tab uses "project-list".
    id: "projects",
    label: "Agents",
    route: { view: "agents-v2" },
    // The activity feed and agent pages. The project list and project
    // pages belong to the Projects tab below.
    active: (route) =>
      (route.view === "agents-v2" && !isProjectListRoute(route)) ||
      route.view === "agent-info",
  },
  {
    id: "project-list",
    label: "Projects",
    route: { view: "agents-v2", indexView: "projects" },
    active: isProjectListRoute,
  },
  {
    id: "boards",
    label: "Boards",
    route: { view: "boards" },
    active: (route) => route.view === "boards",
    capability: "surface.board",
  },
  {
    id: "sessions",
    label: "Sessions",
    route: { view: "sessions" },
    active: (route) => route.view === "sessions",
  },
  {
    id: "chat",
    label: "Chat",
    route: { view: "rooms" },
    active: (route) =>
      route.view === "messages" ||
      route.view === "conversation" ||
      route.view === "rooms",
  },
  {
    id: "search",
    label: "Search",
    route: { view: "search" },
    active: (route) => route.view === "search",
  },
  {
    id: "terminals",
    label: "Terminals",
    route: { view: "terminal" },
    active: (route) => route.view === "terminal",
  },
  {
    id: "tail",
    label: "Tail",
    route: { view: "ops", mode: "tail" },
    // Alerts (/ops/issues) is the Tail filtered to what went wrong
    active: (route) => route.view === "ops" && (route.mode === "tail" || route.mode === "issues"),
  },
  {
    id: "activity",
    label: "Activity",
    route: { view: "activity" },
    active: (route) => route.view === "activity",
  },
  {
    id: "feed",
    // The most useful finished work, one post per thread, led by what was made.
    label: "Feed",
    route: { view: "feed" },
    active: (route) => route.view === "feed",
    capability: "surface.feed",
  },
  {
    id: "review",
    label: "Review",
    route: { view: "review" },
    active: (route) => route.view === "review",
    capability: "surface.review",
  },
  {
    id: "work",
    label: "Work items",
    route: { view: "work", workId: "" },
    active: (route) => route.view === "work" && !route.board,
  },
  {
    id: "work-board",
    label: "Board",
    route: { view: "work", workId: "", board: true },
    active: (route) => route.view === "work" && Boolean(route.board),
  },
  {
    id: "briefings",
    label: "Briefings",
    route: { view: "briefings" },
    active: (route) => route.view === "briefings",
  },
  {
    id: "views",
    label: "Views",
    route: { view: "views" },
    active: (route) => route.view === "views",
  },
  {
    id: "alerts",
    label: "Alerts",
    route: { view: "ops", mode: "issues" },
    active: (route) => route.view === "ops" && route.mode === "issues",
  },
  {
    id: "mesh",
    label: "Hosts",
    route: { view: "mesh" },
    active: (route) => route.view === "mesh",
  },
  {
    id: "mesh-ops",
    label: "Mesh Ops",
    route: { view: "mesh-ops" },
    active: (route) => route.view === "mesh-ops",
    capability: "surface.mesh-ops",
  },
  {
    id: "mission-control",
    label: "Control",
    route: { view: "ops", mode: "mission" },
    active: isOpsMission,
    capability: "ops.control",
  },
  {
    id: "lanes",
    label: "Lanes",
    route: { view: "ops", mode: "lanes" },
    active: (route) => route.view === "ops" && route.mode === "lanes",
  },
  {
    id: "repos",
    label: "Repos",
    route: { view: "repos" },
    // SCO-085: repo-diff is a Repos detail surface — keep Repos sub-nav active.
    active: (route) => route.view === "repos" || route.view === "repo-diff",
  },
  {
    id: "providers",
    label: "Providers",
    route: { view: "harnesses" },
    active: (route) => route.view === "harnesses",
  },
  {
    id: "runtime",
    // Agent processes on this host; "runtime" names the Scout runtime itself.
    label: "Processes",
    route: { view: "ops", mode: "atop" },
    active: (route) => route.view === "ops" && route.mode === "atop",
    capability: "ops.control",
  },
  {
    id: "advisor",
    // The worktrees in play, with their PRs; "In flight" names a module.
    label: "Worktrees",
    route: { view: "ops", mode: "advisor" },
    active: (route) => route.view === "ops" && route.mode === "advisor",
  },
  {
    id: "agent-config",
    label: "Agent Configuration",
    route: { view: "settings", section: "agents" },
    active: (route) => route.view === "settings" && route.section === "agents",
  },
  {
    // Settings' first page: appearance and the sections beside it. Home's
    // tab order (Views) is set here too.
    id: "settings-general",
    label: "General",
    route: { view: "settings", section: "appearance" },
    active: (route) => (route.view === "settings" && route.section !== "agents") || route.view === "views",
  },
  {
    id: "voice",
    label: "Voice",
    route: { view: "voice" },
    active: (route) => route.view === "voice",
  },
  {
    id: "ops",
    // The Ops umbrella tab. Mode-specific destinations (mission-control,
    // lanes, tail, runtime, advisor) stay in the catalog for deep links and
    // the Ops secondary strip; this entry is the tab-level default.
    label: "Control",
    route: { view: "ops", mode: "mission" },
    active: (route) => route.view === "ops",
  },
] as const;

const DESTINATION_BY_ID: ReadonlyMap<NavDestinationId, NavDestination> = new Map(
  NAV_DESTINATIONS.map((destination) => [destination.id, destination]),
);

export function getDestination(id: NavDestinationId): NavDestination {
  const destination = DESTINATION_BY_ID.get(id);
  if (!destination) {
    throw new Error(`Unknown nav destination: ${id}`);
  }
  return destination;
}

export function requireDestination(id: NavDestinationId): NavDestination {
  return getDestination(id);
}

/* ── Shared projection helpers ────────────────────────────────────────── */

function project(
  id: NavDestinationId,
  overrides?: Partial<Pick<NavDestination, "route" | "active">>,
): {
  id: NavDestinationId;
  label: string;
  route: Route;
  active: (route: Route) => boolean;
  capability?: NavCapability;
} {
  const destination = getDestination(id);
  return {
    id: destination.id,
    label: destination.label,
    route: overrides?.route ?? destination.route,
    active: overrides?.active ?? destination.active,
    capability: destination.capability,
  };
}

/* ── Projection: top tabs ─────────────────────────────────────────────── */

type TopTabProjection = {
  destinationId: NavDestinationId;
  key: TopNavKey;
};

const TOP_TAB_PROJECTION: readonly TopTabProjection[] = [
  { destinationId: "home", key: "home" },
  { destinationId: "sessions", key: "sessions" },
  { destinationId: "chat", key: "chat" },
  { destinationId: "project-list", key: "agents" },
  { destinationId: "terminals", key: "terminals" },
  { destinationId: "search", key: "search" },
  { destinationId: "ops", key: "ops" },
];

export function projectTopNavItems(): TopNavItem[] {
  return TOP_TAB_PROJECTION.map((entry) => {
    const destination = getDestination(entry.destinationId);
    return {
      key: entry.key,
      label: destination.label,
      route: destination.route,
    };
  });
}

/* ── Projection: secondary nav ────────────────────────────────────────── */

type SecondaryItemProjection = {
  destinationId: NavDestinationId;
  id: string;
  route?: Route;
  active?: (route: Route) => boolean;
};

function projectSecondaryGroup(
  items: readonly SecondaryItemProjection[],
): SecondaryNavGroup {
  return {
    items: items.map((entry) => {
      const projected = project(entry.destinationId, {
        route: entry.route,
        active: entry.active,
      });
      return {
        id: entry.id,
        label: projected.label,
        route: projected.route,
        active: projected.active,
      };
    }),
  };
}

export function projectAgentsSecondaryNav(): SecondaryNavGroup[] {
  return [
    projectSecondaryGroup([
      { destinationId: "agent-config", id: "config" },
    ]),
  ];
}

/**
 * Chat secondary strip is production-dead. Route unification collapsed the
 * DM/Channels split onto a single conversation route, so there is nothing left
 * to switch between. Kept as an empty projection only for catalog integrity
 * helpers; do not reintroduce a Chat strip in chrome.
 */
export function projectChatSecondaryNav(): SecondaryNavGroup[] {
  return [];
}

/**
 * Search secondary strip is production-dead (single surface). Kept as an empty
 * projection only for catalog integrity helpers that still iterate secondary
 * surfaces; do not reintroduce a Search strip in chrome.
 * @deprecated SCO-083 — Search has no secondary strip.
 */
export function projectSearchSecondaryNav(): SecondaryNavGroup[] {
  return [];
}

/** Legacy in-content chrome uses the same tabs and active predicates as the shell. */
export function projectOpsSecondaryNav(): SecondaryNavGroup[] {
  return [{ items: projectAreaSubNav("dashboards") }];
}

/* ── Projection: go-shortcuts ─────────────────────────────────────────── */

export type GoShortcutProjection = {
  key: string;
  destinationId: NavDestinationId;
  /** Override route when the shortcut intentionally differs from catalog default. */
  route?: Route;
};

/**
 * Curated g+key sequences. Keys are surface-specific; labels, destination
 * identity and default route come from the catalog.
 */
export const GO_SHORTCUT_PROJECTION: readonly GoShortcutProjection[] = [
  { key: "h", destinationId: "home" },
  { key: "i", destinationId: "requests" },
  { key: "c", destinationId: "chat" },
  { key: "p", destinationId: "project-list" },
  { key: "s", destinationId: "sessions" },
  { key: "t", destinationId: "terminals" },
  { key: "r", destinationId: "repos" },
  { key: "f", destinationId: "search" },
  { key: "l", destinationId: "tail" },
  { key: "o", destinationId: "mission-control" },
  { key: "m", destinationId: "mesh" },
  { key: "a", destinationId: "activity" },
];

export type GoShortcut = {
  key: string;
  label: string;
  route: Route;
  destinationId: NavDestinationId;
};

export function projectGoShortcuts(): readonly GoShortcut[] {
  return GO_SHORTCUT_PROJECTION.map((entry) => {
    const destination = getDestination(entry.destinationId);
    return {
      key: entry.key,
      label: `Go to ${destination.label}`,
      route: entry.route ?? destination.route,
      destinationId: entry.destinationId,
    };
  });
}

/* ── Projection: jump dock ────────────────────────────────────────────── */

export type JumpDockItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  route: Route;
  destinationId: NavDestinationId;
  opsGated?: boolean;
};

type JumpDockProjection = {
  destinationId: NavDestinationId;
  id: string;
  icon: LucideIcon;
  route?: Route;
  /** Explicit ops gate independent of catalog capability (mission control uses both). */
  opsGated?: boolean;
};

const JUMP_DOCK_PROJECTION: readonly JumpDockProjection[] = [
  { destinationId: "sessions", id: "sessions", icon: FileText },
  { destinationId: "terminals", id: "terminals", icon: Terminal },
  { destinationId: "repos", id: "repos", icon: GitBranch },
  { destinationId: "search", id: "search", icon: Search },
  { destinationId: "tail", id: "tail", icon: ScrollText },
  // Mission control bounces to Home when the ops cluster is off — only offer
  // the jump when it actually resolves.
  {
    destinationId: "mission-control",
    id: "ops",
    icon: Compass,
    route: { view: "ops", mode: "mission" },
    opsGated: true,
  },
  { destinationId: "home", id: "home", icon: House },
];

export function projectJumpDockItems(): JumpDockItem[] {
  return JUMP_DOCK_PROJECTION.map((entry) => {
    const destination = getDestination(entry.destinationId);
    return {
      id: entry.id,
      label: destination.label,
      icon: entry.icon,
      route: entry.route ?? destination.route,
      destinationId: entry.destinationId,
      opsGated: entry.opsGated ?? destination.capability === "ops.control",
    };
  });
}

/* ── Projection: command palette (static nav subset) ──────────────────── */

export type PaletteNavCommand = {
  id: string;
  label: string;
  destinationId: NavDestinationId;
  route: Route;
  shortcut?: string;
  capability?: NavCapability;
};

type PaletteNavProjection = {
  id: string;
  prefix: "Go to" | "Open";
  destinationId: NavDestinationId;
  route?: Route;
  shortcut?: string;
  capability?: NavCapability;
};

/**
 * Static navigate-to-destination palette rows. Overlay actions (settings
 * drawer), Scoutbot, reload, capture, and dynamic per-agent commands stay in
 * `useScoutCommands` — they are not pure destinations.
 */
const PALETTE_NAV_PROJECTION: readonly PaletteNavProjection[] = [
  { id: "nav:requests", prefix: "Open", destinationId: "requests" },
  { id: "nav:home", prefix: "Go to", destinationId: "home", shortcut: "Cmd+1" },
  { id: "nav:agents", prefix: "Go to", destinationId: "project-list" },
  { id: "nav:messages", prefix: "Go to", destinationId: "chat", shortcut: "Cmd+3" },
  { id: "nav:sessions", prefix: "Go to", destinationId: "sessions", shortcut: "Cmd+4" },
  { id: "nav:terminals", prefix: "Open", destinationId: "terminals" },
  { id: "nav:search", prefix: "Go to", destinationId: "search", shortcut: "Cmd+5" },
  { id: "nav:activity", prefix: "Open", destinationId: "activity" },
  { id: "nav:work", prefix: "Open", destinationId: "work" },
  { id: "nav:work-board", prefix: "Open", destinationId: "work-board", shortcut: "Cmd+2" },
  { id: "nav:briefings", prefix: "Open", destinationId: "briefings" },
  { id: "nav:views", prefix: "Open", destinationId: "views" },
  { id: "nav:mesh", prefix: "Open", destinationId: "mesh" },
  { id: "nav:repos", prefix: "Open", destinationId: "repos" },
  { id: "nav:worktrees", prefix: "Open", destinationId: "advisor" },
  { id: "nav:harnesses", prefix: "Open", destinationId: "providers" },
  { id: "nav:ops-lanes", prefix: "Open", destinationId: "lanes" },
  { id: "nav:ops-tail", prefix: "Open", destinationId: "tail" },
  { id: "nav:ops-alerts", prefix: "Open", destinationId: "alerts" },
  {
    id: "nav:ops",
    prefix: "Go to",
    destinationId: "mission-control",
    shortcut: "Cmd+6",
    capability: "ops.control",
  },
  {
    id: "nav:ops-atop",
    prefix: "Open",
    destinationId: "runtime",
    capability: "ops.control",
  },
  {
    id: "nav:agent-config",
    prefix: "Open",
    destinationId: "agent-config",
  },
];

export function projectPaletteNavCommands(options?: {
  opsEnabled?: boolean;
}): PaletteNavCommand[] {
  const opsEnabled = options?.opsEnabled ?? true;
  return PALETTE_NAV_PROJECTION
    .filter((entry) => {
      const capability = entry.capability ?? getDestination(entry.destinationId).capability;
      if (capability === "ops.control" && !opsEnabled) return false;
      return true;
    })
    .map((entry) => {
      const destination = getDestination(entry.destinationId);
      return {
        id: entry.id,
        label: `${entry.prefix} ${destination.label}`,
        destinationId: entry.destinationId,
        route: entry.route ?? destination.route,
        shortcut: entry.shortcut,
        capability: entry.capability ?? destination.capability,
      };
    });
}

/** Build CommandOption rows for the static nav subset of the palette. */
export function paletteNavCommandOptions(
  navigate: (route: Route) => void,
  options?: { opsEnabled?: boolean },
): CommandOption[] {
  return projectPaletteNavCommands(options).map((command) => ({
    id: command.id,
    label: command.label,
    action: () => navigate(command.route),
    shortcut: command.shortcut,
  }));
}

/* ── Projection: area sub-nav (SCO-085) ───────────────────────────────── */

/**
 * The pages inside each primary area that has more than one. Projected under
 * the active primary area (sidebar expanded) and as a shared center-pane strip
 * (icon-rail mode). Not SideRail content.
 */
export type AreaSubNavAreaId = "home" | "chat" | "work" | "agents" | "dashboards" | "settings";

export type AreaSubNavItem = {
  id: string;
  label: string;
  route: Route;
  active: (route: Route) => boolean;
  destinationId: NavDestinationId;
};

type AreaSubNavProjection = {
  destinationId: NavDestinationId;
  id: string;
  /** The tab's own name where it differs from the destination's (Settings › Agents). */
  label?: string;
  /** Legacy surfaces can share a destination without sharing its default route. */
  route?: Route;
  active?: (route: Route) => boolean;
  /** Pages that fold into this tab and keep it lit (Review lights the Board). */
  alsoActive?: readonly NavDestinationId[];
};

/**
 * Each area's tabs, in order; the first is where the area opens. A page the
 * four-area study folds into another (the Inbox into Home, Review and Work
 * items into the Board, Lanes into Sessions) keeps its address and its
 * palette entry, and lights the tab it folds into.
 */
const AREA_SUB_NAV_PROJECTION: Record<
  AreaSubNavAreaId,
  readonly AreaSubNavProjection[]
> = {
  // Home is one page: the Feed, led by what waits on the operator. The Home
  // row carries the Inbox's open count.
  home: [
    { destinationId: "home", id: "home", alsoActive: ["requests", "feed", "briefings"] },
  ],
  // Rooms and DMs share one Chat surface.
  chat: [
    { destinationId: "chat", id: "channels" },
  ],
  // Legacy repo and activity links still belong to Board, but are not tabs.
  work: [
    { destinationId: "work-board", id: "board", alsoActive: ["work", "review", "boards"] },
    { destinationId: "project-list", id: "project-list" },
  ],
  agents: [
    { destinationId: "sessions", id: "sessions", alsoActive: ["lanes"] },
  ],
  dashboards: [
    { destinationId: "mission-control", id: "control" },
    { destinationId: "terminals", id: "terminals" },
    { destinationId: "tail", id: "tail", alsoActive: ["alerts"] },
    { destinationId: "runtime", id: "processes" },
    { destinationId: "mesh", id: "hosts", alsoActive: ["mesh-ops"] },
  ],
  // Configuration only: the Ops pages filed here moved to Ops.
  settings: [
    { destinationId: "settings-general", id: "general" },
    { destinationId: "voice", id: "voice" },
    { destinationId: "providers", id: "agents", label: "Agents", alsoActive: ["agent-config"] },
  ],
};

/** Which gated destinations this surface shows; ops.control defaults on, Mesh Ops, Boards, Review, Canvas and Feed off. */
export type NavCapabilityOptions = {
  opsControlEnabled?: boolean;
  meshOpsEnabled?: boolean;
  boardsEnabled?: boolean;
  reviewEnabled?: boolean;
  canvasEnabled?: boolean;
  feedEnabled?: boolean;
};

function capabilityShown(
  capability: NavCapability | undefined,
  options?: NavCapabilityOptions,
): boolean {
  if (capability === "ops.control") return options?.opsControlEnabled !== false;
  if (capability === "surface.mesh-ops") return options?.meshOpsEnabled === true;
  if (capability === "surface.board") return options?.boardsEnabled === true;
  if (capability === "surface.review") return options?.reviewEnabled === true;
  if (capability === "surface.canvas") return options?.canvasEnabled === true;
  // Home is the Feed: the Feed has no place of its own in the nav.
  if (capability === "surface.feed") return false;
  return true;
}

function projectAreaSubNavItem(entry: AreaSubNavProjection): AreaSubNavItem {
  const projected = project(entry.destinationId, { route: entry.route, active: entry.active });
  const also = (entry.alsoActive ?? []).map((id) => getDestination(id).active);
  return {
    id: entry.id,
    label: entry.label ?? projected.label,
    route: projected.route,
    active: also.length ? (route) => projected.active(route) || also.some((match) => match(route)) : projected.active,
    destinationId: projected.id,
  };
}

/**
 * Sub-nav items for a primary area that the surface shows. Fewer than two is
 * no sub-nav: the area row already opens its only page.
 */
export function projectAreaSubNav(
  areaId: AreaSubNavAreaId,
  options?: NavCapabilityOptions,
): AreaSubNavItem[] {
  return visibleSubNavItems(AREA_SUB_NAV_PROJECTION[areaId], options);
}

function visibleSubNavItems(
  entries: readonly AreaSubNavProjection[],
  options?: NavCapabilityOptions,
): AreaSubNavItem[] {
  const items = entries
    .filter((entry) => capabilityShown(getDestination(entry.destinationId).capability, options))
    .map(projectAreaSubNavItem);
  return items.length > 1 ? items : [];
}

/**
 * Resolve area sub-nav for the current route from its primary area.
 * Returns null when the area has no AREA_SUB_NAV projection, or shows fewer
 * than two of its pages.
 *
 * Classification is shared through route-areas.ts; primary areas themselves
 * read this catalog's labels, without an initialization cycle.
 */
export function areaSubNavForRoute(
  route: Route,
  options?: NavCapabilityOptions,
): {
  areaId: AreaSubNavAreaId;
  items: AreaSubNavItem[];
} | null {
  const area = areaForRoute(route);
  if (!(area in AREA_SUB_NAV_PROJECTION)) return null;
  const areaId = area as AreaSubNavAreaId;
  const items = projectAreaSubNav(areaId, options);
  return items.length > 0 ? { areaId, items } : null;
}

/* ── Projection: expanded sidebar sub-nav ────────────────────────────── */

export type SidebarSubNavAreaId = AreaSubNavAreaId;

const SIDEBAR_SUB_NAV_PROJECTION: Record<
  SidebarSubNavAreaId,
  readonly AreaSubNavProjection[]
> = AREA_SUB_NAV_PROJECTION;

/** Nested destinations shown only beneath the active area in the expanded sidebar. */
export function sidebarSubNavForRoute(
  route: Route,
  options?: NavCapabilityOptions,
): { areaId: SidebarSubNavAreaId; items: AreaSubNavItem[] } | null {
  const area = areaForRoute(route);
  if (!(area in SIDEBAR_SUB_NAV_PROJECTION)) return null;
  const areaId = area as SidebarSubNavAreaId;
  const items = visibleSubNavItems(SIDEBAR_SUB_NAV_PROJECTION[areaId], options);
  return items.length > 0 ? { areaId, items } : null;
}

/* ── Integrity helpers (tests) ────────────────────────────────────────── */

/** Every destination id referenced by any projection. */
export function allProjectedDestinationIds(): NavDestinationId[] {
  const ids = new Set<NavDestinationId>();
  for (const entry of TOP_TAB_PROJECTION) ids.add(entry.destinationId);
  for (const entry of GO_SHORTCUT_PROJECTION) ids.add(entry.destinationId);
  for (const entry of JUMP_DOCK_PROJECTION) ids.add(entry.destinationId);
  for (const entry of PALETTE_NAV_PROJECTION) ids.add(entry.destinationId);
  for (const areaId of Object.keys(AREA_SUB_NAV_PROJECTION) as AreaSubNavAreaId[]) {
    for (const entry of AREA_SUB_NAV_PROJECTION[areaId]) {
      ids.add(entry.destinationId);
    }
  }
  for (const areaId of Object.keys(SIDEBAR_SUB_NAV_PROJECTION) as SidebarSubNavAreaId[]) {
    for (const entry of SIDEBAR_SUB_NAV_PROJECTION[areaId]) {
      ids.add(entry.destinationId);
    }
  }
  for (const group of [
    ...projectAgentsSecondaryNav(),
    ...projectChatSecondaryNav(),
    ...projectSearchSecondaryNav(),
    ...projectOpsSecondaryNav(),
  ]) {
    for (const item of group.items) {
      // Secondary items don't carry destinationId on the public shape; resolve
      // by matching route/active against the catalog in tests instead.
      void item;
    }
  }
  // Explicit secondary destination ids for integrity checks.
  for (const id of [
    "agent-config",
    "chat",
    "lanes",
    "mission-control",
    "providers",
    "mesh",
    "mesh-ops",
    "tail",
    "runtime",
    "advisor",
  ] as const) {
    ids.add(id);
  }
  return [...ids];
}
