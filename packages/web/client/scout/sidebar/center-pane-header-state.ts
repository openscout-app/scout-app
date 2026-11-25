/**
 * Pure title-bar projections for CenterPaneHeader (SCO-086 / SCO-087b).
 * Free of React so unit tests do not load chrome modules.
 */
import type { Route } from "../../lib/types.ts";
import { areaSubNavForRoute } from "../nav-destinations.ts";

/**
 * Whether the top row carries the area's tabs. Every area draws its pages in
 * one strip; an area with a single page (Home) has none.
 *
 * The shell consumes this to size the top-row frame + contentTopOffset so the
 * arithmetic stays consistent across the center pane, side rail and inspector.
 * Kept in lock-step with CenterPaneHeader's second-row render.
 */
export function hasSecondaryNavRow(route: Route): boolean {
  return Boolean(areaSubNavForRoute(route));
}
