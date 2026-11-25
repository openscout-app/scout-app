import { useSyncExternalStore } from "react";
import { routePath } from "../../../lib/router.ts";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import { laneDock, type LaneDockState } from "./lane-dock.ts";
import { urlHoldsLane } from "./lanes-panel-model.ts";

/*
 * What the Lanes panels (the deck, the Lane panel, the roster) share beyond
 * the dock itself: the dock as React reads it, and whether the router keeps
 * a picked lane in the page's URL.
 */

/** Probed against the page's own path, so a /scope/* address in the window does not answer for it. */
export const URL_HOLDS_LANE = urlHoldsLane((route) => routePath(route, "/ops/lanes"));

const NO_LANES: readonly AgentLane[] = [];
const deckLanes = () => laneDock.get().reading?.lanes ?? NO_LANES;
const deckOnView = () => laneDock.get().decks > 0;

/** The dock: decks, Lane panels, the deck's reading and its pick. */
export function useLaneDock(): LaneDockState {
  return useSyncExternalStore(laneDock.subscribe, laneDock.get, laneDock.get);
}

/** The lanes the deck on this view built, for a picker; none without a deck. */
export function useDeckLanes(): readonly AgentLane[] {
  return useSyncExternalStore(laneDock.subscribe, deckLanes, () => NO_LANES);
}

/** A Lanes deck is on this view. */
export function useDeckOnView(): boolean {
  return useSyncExternalStore(laneDock.subscribe, deckOnView, () => false);
}
