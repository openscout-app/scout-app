import type { PanelContent } from "../../../components/hud-grid/hud-grid-fold.ts";
import type { Route } from "../../../lib/types.ts";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import type { LaneDockState } from "./lane-dock.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/**
 * The Lanes panels' page rules: which route is the deck's own, how a picked
 * lane lives in its URL (`/ops/lanes?sessionId=<lane id>`), which lane a Lane
 * panel shows, and what the deck's project and harness pickers offer.
 */

/** Ops › Lanes. /ops/fleet (the floor) and /ops/world keep their own screens. */
export function isLanesRoute(route: Route): boolean {
  return route.view === "ops" && route.mode === "lanes";
}

/** The lane the page's URL picks, if any: ?sessionId=, or ?targetAgentId= (?agentId=) for a registered agent. */
export function routeLane(route: Route): string | null {
  if (route.view !== "ops" || !isLanesRoute(route)) return null;
  return route.sessionId?.trim() || route.targetAgentId?.trim() || null;
}

/** Ops › Lanes with one lane picked, or none. */
export function laneRoute(laneId: string | null): Route {
  const id = laneId?.trim();
  return id ? { view: "ops", mode: "lanes", sessionId: id } : { view: "ops", mode: "lanes" };
}

/**
 * Whether the router keeps the pick in the URL; pass it `routePath`. Until it
 * writes `sessionId` on /ops/lanes (today it drops it), the deck and the Lane
 * panel share the pick through the dock instead: writing it to a URL that
 * strips it would lose it.
 */
export function urlHoldsLane(path: (route: Route) => string): boolean {
  return path(laneRoute("probe")).includes("sessionId=probe");
}

/**
 * The lane an id names: a lane id, the harness session it runs, a native
 * lane's session (the tail of `native:<source>:<session>`), or a registered
 * agent's id. A link from a session page carries the session, not the lane.
 */
export function laneForSelection(lanes: readonly AgentLane[], id: string | null | undefined): AgentLane | null {
  const want = id?.trim();
  if (!want) return null;
  return lanes.find((lane) => lane.id === want)
    ?? lanes.find((lane) => lane.agent.harnessSessionId === want)
    ?? lanes.find((lane) => lane.id.startsWith("native:") && lane.id.endsWith(`:${want}`))
    ?? lanes.find((lane) => lane.agent.id === want)
    ?? null;
}

/** Where a Lane panel's lane comes from. */
export type LaneSource =
  /** The page's URL picks it (Ops › Lanes, once the router keeps the pick). */
  | "page"
  /** The deck beside it picked it. */
  | "pick"
  /** One lane, pinned in the panel's settings. */
  | "pinned";

/** Which lane a Lane panel shows, and why. `urlHolds`: urlHoldsLane(routePath). */
export function panelLane(
  route: Route,
  setting: string | undefined,
  pick: string | null,
  urlHolds: boolean,
): { id: string | null; source: LaneSource } {
  const value = setting?.trim() ?? "";
  if (value && value !== FOLLOW_PAGE) return { id: value, source: "pinned" };
  if (value === FOLLOW_PAGE && isLanesRoute(route) && urlHolds) return { id: routeLane(route), source: "page" };
  return { id: pick, source: "pick" };
}

/** A Lane panel that shows a pick (the page's or the deck's) counts itself in, so the deck sends picks to it. */
export function showsPicks(source: LaneSource): boolean {
  return source !== "pinned";
}

/**
 * Where a deck's pick goes. To a Lane panel when one on the view shows picks
 * and the deck is not drawn over the whole grid (in full view the panel is
 * out of sight, so the deck opens its own sheet, as the page always did).
 * On its own page, with a URL that keeps it, the pick is the page's.
 */
export function pickTarget(dock: Pick<LaneDockState, "followers">, fullViewSelf: boolean, ownPage: boolean, urlHolds: boolean): "sheet" | "url" | "dock" {
  if (dock.followers === 0 || fullViewSelf) return "sheet";
  return ownPage && urlHolds ? "url" : "dock";
}

export type LanePanelState =
  /** No deck on this view: nothing reads the tail for lanes. */
  | { kind: "no-deck" }
  /** A deck with no lanes in its window, and nothing picked. */
  | { kind: "no-pick"; source: LaneSource }
  /** The pick names a lane the deck has not built in its window (ended, or older than it). */
  | { kind: "not-live"; id: string; horizonLabel: string }
  /**
   * The lane to draw. `latest`: nothing is picked, so the panel reads the lane
   * that wrote last until the deck opens one, instead of standing empty.
   */
  | { kind: "ready"; lane: AgentLane; latest?: boolean };

/** The deck's lane that wrote last, a lane still running ahead of one that ended. */
export function latestLane(lanes: readonly AgentLane[]): AgentLane | null {
  let best: AgentLane | null = null;
  for (const lane of lanes) {
    if (!best || Number(lane.current) > Number(best.current) || (lane.current === best.current && lane.lastActiveAt > best.lastActiveAt)) best = lane;
  }
  return best;
}

/** What a Lane panel draws, from the dock and its pick. */
export function lanePanelState(dock: Pick<LaneDockState, "decks" | "reading">, shown: { id: string | null; source: LaneSource }): LanePanelState {
  if (dock.decks === 0 || !dock.reading) return { kind: "no-deck" };
  if (!shown.id) {
    const latest = latestLane(dock.reading.lanes);
    return latest ? { kind: "ready", lane: latest, latest: true } : { kind: "no-pick", source: shown.source };
  }
  const lane = laneForSelection(dock.reading.lanes, shown.id);
  if (!lane) return { kind: "not-live", id: shown.id, horizonLabel: dock.reading.horizonLabel };
  return { kind: "ready", lane };
}

/**
 * What a Lane panel reports to its grid: empty (it folds to its head row)
 * until it has a lane to read; `name` is the lane's label for the folded row.
 * A different lane, or the lane writing again, is news to a hand fold.
 */
export function lanePanelContent(state: LanePanelState, name?: (lane: AgentLane) => string): PanelContent {
  switch (state.kind) {
    case "no-deck":
      return { empty: true, state: "no deck" };
    case "no-pick":
      return { empty: true, state: "none picked" };
    case "not-live":
      return { empty: true, state: "not in window" };
    case "ready":
      return { empty: false, state: name?.(state.lane), mark: `${state.lane.id}@${state.lane.lastActiveAt}` };
  }
}

function pathLeaf(value: string | null | undefined): string | null {
  const leaf = value?.trim().replace(/\/+$/u, "").split(/[\\/]/u).filter(Boolean).pop();
  return leaf?.trim() || null;
}

/** The deck's Harness picker: each harness a lane runs on, as the deck's filter matches it. */
export function laneHarnessValues(lanes: readonly AgentLane[]): string[] {
  const seen = new Set<string>();
  for (const lane of lanes) {
    const harness = lane.agent.harness?.trim().toLowerCase();
    if (harness) seen.add(harness);
  }
  return [...seen].sort();
}

/**
 * The deck's Project picker: each project a lane runs in, by its folder name
 * (the deck's filter matches a path's last segment), from the project root
 * when the lane knows it, else its working directory.
 */
export function laneProjectOptions(lanes: readonly AgentLane[]): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const lane of lanes) {
    const { agent } = lane;
    const leaf = pathLeaf(agent.projectRoot) ?? pathLeaf(lane.facts?.cwd) ?? pathLeaf(agent.cwd) ?? pathLeaf(agent.project);
    if (leaf && !seen.has(leaf.toLowerCase())) seen.set(leaf.toLowerCase(), leaf);
  }
  return [...seen.values()]
    .sort((a, b) => a.localeCompare(b))
    .map((leaf) => ({ value: leaf, label: leaf }));
}
