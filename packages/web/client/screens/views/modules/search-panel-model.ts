import {
  parseSearchFiltersFromUrl,
  searchFiltersAreActive,
  type SearchFilters,
} from "../../../lib/knowledge-search.ts";
import type { Route } from "../../../lib/types.ts";
import type { ModuleConfig } from "./contract.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * Where a Search panel keeps its search, and what it may do with it. Pure, so
 * the rules test without a DOM (search-panel-model.test.ts).
 *
 * On the Search route, the panel the Search view ships with follows the page
 * (`follow: "@route"`): the URL holds its filters and its selected moment, and
 * it writes them back with replace, as the Search page always has. Anywhere
 * else (or a Search panel added beside it) keeps its own search in its
 * settings, under the URL's own names (q, source, harness, project, time), so
 * one parser reads both. It never moves the page: an answer selects a moment
 * for the Result panel beside it, and only "Open full" goes to Search.
 */

/** Follows the Search page when set to FOLLOW_PAGE. */
export const SEARCH_FOLLOW_KEY = "follow";

/** The moment an own search last had picked by hand: live state, so a reload selects it again. */
export const SEARCH_HIT_KEY = "hit";

/** The settings that hold an own search: the Search URL's parameter names. */
export const SEARCH_FILTER_KEYS = ["q", "source", "harness", "project", "time"] as const;

export type SearchPanelMode = "route" | "own";

/** "route": the URL is this panel's search. "own": its settings are. */
export function searchPanelMode(config: ModuleConfig, route: Route): SearchPanelMode {
  return route.view === "search" && config[SEARCH_FOLLOW_KEY] === FOLLOW_PAGE ? "route" : "own";
}

/** An own search, read from settings the way the router reads the URL. */
export function filtersFromConfig(config: ModuleConfig): SearchFilters {
  const params = new URLSearchParams();
  for (const key of SEARCH_FILTER_KEYS) {
    const value = config[key];
    if (value) params.set(key, value);
  }
  return parseSearchFiltersFromUrl(params);
}

/** The settings patch that keeps these filters. Empty values clear their keys. */
export function filtersToConfig(filters: SearchFilters): Record<string, string> {
  return {
    q: filters.query.trim(),
    source: filters.sourceKinds.join(","),
    harness: filters.harness.join(","),
    project: filters.project.join(","),
    time: filters.timeWindow === "all" ? "" : filters.timeWindow,
  };
}

/** A stable key for an own search, so settings that did not change keep one filters object. */
export function configFilterKey(config: ModuleConfig): string {
  return SEARCH_FILTER_KEYS.map((key) => `${key}=${config[key] ?? ""}`).join("&");
}

/** Search, showing this search and this moment: where "Open full" goes. */
export function searchRouteFor(filters: SearchFilters, hitId?: string | null): Route {
  return {
    view: "search",
    ...(searchFiltersAreActive(filters) ? { filters } : {}),
    ...(hitId ? { hitId } : {}),
  };
}

/** What a Result panel shows: the Search page's moment on its route, else the one a Search panel beside it picked. */
export function resultSource(route: Route): "route" | "picks" {
  return route.view === "search" ? "route" : "picks";
}
