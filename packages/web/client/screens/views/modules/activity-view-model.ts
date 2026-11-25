import type { ActivityItem, Route } from "../../../lib/types.ts";
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_META } from "../../activity/activity-model.ts";
import type { ModuleConfig, ModuleScopeOption } from "./contract.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { optionsFrom, pathLabels } from "./labels.ts";

/*
 * The Activity view's rules, without React: where an Activity panel keeps its
 * selection, where Activity details reads it, and the routes they move to.
 * activity.tsx and activity-item.tsx read these; activity-view-model.test.ts
 * holds them.
 *
 * On /activity the panel the view ships with follows the page
 * (`follow: "@route"`): the URL's ?event= is its selection, written back with
 * replace, and its ?machineId= narrows it, as the Activity page always did.
 * Anywhere else (or an Activity panel added beside it) keeps its own pick in
 * its settings (`event`) and hands it to an Activity details panel on the
 * same view (activity-picks.ts). It never moves another view; only Open full
 * goes to /activity.
 */

/** Follows the Activity page when set to FOLLOW_PAGE. */
export const ACTIVITY_FOLLOW_KEY = "follow";
/** The event an own panel last picked: live state, so a reload selects it again. */
export const ACTIVITY_EVENT_KEY = "event";
/** A workspace root; "" = every project. */
export const ACTIVITY_PROJECT_KEY = "project";
/** One of the log's groups; "" = every kind. */
export const ACTIVITY_CATEGORY_KEY = "category";

/**
 * The Activity route with its selection. Typed here with `eventId` so this
 * reads the same before and after the router carries ?event= (lib/types.ts).
 */
type ActivityRoute = Extract<Route, { view: "activity" }> & { eventId?: string };

/** The page is the Activity page. */
export function onActivityPage(route: Route): boolean {
  return route.view === "activity";
}

/** The event the Activity page has open (?event=), "" = none. */
export function pageActivityEventId(route: Route): string {
  if (route.view !== "activity") return "";
  return (route as ActivityRoute).eventId?.trim() ?? "";
}

/**
 * /activity with this event open ("" or null = none). It names no machine:
 * navigation keeps the page's ?machineId= when the next route leaves it out.
 */
export function activityRoute(eventId?: string | null): Route {
  const next: ActivityRoute = { view: "activity", ...(eventId ? { eventId } : {}) };
  return next;
}

export type ActivityPanelMode = "route" | "own";

/** "route": the URL holds this panel's selection. "own": its settings do. */
export function activityPanelMode(config: ModuleConfig, route: Route): ActivityPanelMode {
  return onActivityPage(route) && config[ACTIVITY_FOLLOW_KEY] === FOLLOW_PAGE ? "route" : "own";
}

/** The event a panel has selected: the page's on its own route, else its own. "" = none. */
export function panelSelection(config: ModuleConfig, route: Route): string {
  return activityPanelMode(config, route) === "route" ? pageActivityEventId(route) : config[ACTIVITY_EVENT_KEY]?.trim() ?? "";
}

/** What Activity details shows: the page's event on /activity, else the pick of an Activity panel beside it. */
export function detailsSource(route: Route): "route" | "picks" {
  return onActivityPage(route) ? "route" : "picks";
}

/**
 * Open full is for a panel that is not the page: it goes to /activity with
 * the panel's pick open. On /activity itself there is nowhere further to go.
 */
export function offersOpenFull(route: Route): boolean {
  return !onActivityPage(route);
}

/**
 * Where a pick opens. "inline": under its row, as the Activity page drew it,
 * when no Activity details panel is on the view to show it, the list is
 * lifted into full view (which hides that panel), or the pick is the panel's
 * own on the Activity page (details there follows the page, and an own pick
 * never moves the page). "beside": in that panel.
 */
export function pickOpens(where: { detailsOnView: boolean; full: boolean; ownOnPage?: boolean }): "inline" | "beside" {
  return where.detailsOnView && !where.full && !where.ownOnPage ? "beside" : "inline";
}

/** The group picker's choices, in the log's order. */
export function activityCategoryOptions(): ModuleScopeOption[] {
  return ACTIVITY_CATEGORIES.map((category) => ({ value: category, label: ACTIVITY_CATEGORY_META[category].label }));
}

/** The project picker's choices: every workspace in recent activity, by a name that tells two apart. */
export function activityProjectOptions(items: readonly Pick<ActivityItem, "workspaceRoot">[]): ModuleScopeOption[] {
  const roots = optionsFrom(items, (item) => item.workspaceRoot).map((option) => option.value);
  const labels = pathLabels(roots);
  return roots.map((root) => ({ value: root, label: labels.get(root) ?? root }));
}
