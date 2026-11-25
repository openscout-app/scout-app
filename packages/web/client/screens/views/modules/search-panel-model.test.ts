import { describe, expect, test } from "bun:test";

import {
  EMPTY_SEARCH_FILTERS,
  parseSearchFiltersFromUrl,
  serializeSearchFiltersToParams,
  type SearchFilters,
} from "../../../lib/knowledge-search.ts";
import {
  configFilterKey,
  filtersFromConfig,
  filtersToConfig,
  resultSource,
  searchPanelMode,
  searchRouteFor,
} from "./search-panel-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";


/** What CompositionHost does with a patch: empty values clear their keys. */
const apply = (config: Record<string, string>, patch: Record<string, string>) => {
  const next = { ...config };
  for (const [k, v] of Object.entries(patch)) {
    if (v) next[k] = v;
    else delete next[k];
  }
  return next;
};

const filters = (patch: Partial<SearchFilters>): SearchFilters => ({ ...EMPTY_SEARCH_FILTERS, ...patch });

describe("where a Search panel keeps its search", () => {
  test("the Search view's own panel follows the URL, on the Search route only", () => {
    const follows = { follow: FOLLOW_PAGE };
    expect(searchPanelMode(follows, { view: "search" })).toBe("route");
    expect(searchPanelMode(follows, { view: "search", hitId: "h", mode: "indexer" })).toBe("route");
    // carried to another view (a saved copy), it keeps its own search and never moves the page
    expect(searchPanelMode(follows, { view: "inbox" })).toBe("own");
    expect(searchPanelMode(follows, { view: "terminal" })).toBe("own");
  });

  test("a panel added from the library keeps its own search, even on the Search route", () => {
    expect(searchPanelMode({}, { view: "search" })).toBe("own");
    expect(searchPanelMode({ q: "deploy" }, { view: "views", viewId: "watch" })).toBe("own");
  });

  test("settings use the URL's names, so the router's parser reads them", () => {
    const kept = filters({
      query: "deploy failed",
      sourceKinds: ["session", "skill"],
      harness: ["claude"],
      project: ["openscout"],
      timeWindow: "7" as SearchFilters["timeWindow"],
    });
    const config = apply({}, filtersToConfig(kept));
    expect(config).toEqual({ q: "deploy failed", source: "session,skill", harness: "claude", project: "openscout", time: "7" });
    expect(filtersFromConfig(config)).toEqual(kept);
    expect(parseSearchFiltersFromUrl(serializeSearchFiltersToParams(kept))).toEqual(filtersFromConfig(config));
  });

  test("clearing a search clears its keys, leaving the panel's other settings", () => {
    const config = apply({ follow: FOLLOW_PAGE, hit: "h1" }, filtersToConfig(filters({ query: "x", harness: ["codex"] })));
    const cleared = apply(config, filtersToConfig(EMPTY_SEARCH_FILTERS));
    expect(cleared).toEqual({ follow: FOLLOW_PAGE, hit: "h1" });
    expect(filtersFromConfig(cleared)).toEqual(EMPTY_SEARCH_FILTERS);
  });

  test("a trailing space is not kept: the field holds it, the settings do not", () => {
    expect(filtersToConfig(filters({ query: "deploy " })).q).toBe("deploy");
  });

  test("unknown time windows read as any time, as in the URL", () => {
    expect(filtersFromConfig({ time: "9000" }).timeWindow).toBe("all");
  });

  test("the filter key moves only with the search, not with other settings", () => {
    const a = configFilterKey({ q: "x", hit: "1" });
    expect(configFilterKey({ q: "x", hit: "2", follow: FOLLOW_PAGE })).toBe(a);
    expect(configFilterKey({ q: "y" })).not.toBe(a);
  });
});

describe("where Open full and Result go", () => {
  test("Open full carries the search and the moment, and nothing when there is no search", () => {
    expect(searchRouteFor(filters({ query: "x" }), "h")).toEqual({ view: "search", filters: filters({ query: "x" }), hitId: "h" });
    expect(searchRouteFor(EMPTY_SEARCH_FILTERS, null)).toEqual({ view: "search" });
  });

  test("Result follows the page on the Search route, else the Search panels beside it", () => {
    expect(resultSource({ view: "search" })).toBe("route");
    expect(resultSource({ view: "search", hitId: "h" })).toBe("route");
    expect(resultSource({ view: "inbox" })).toBe("picks");
    expect(resultSource({ view: "views", viewId: "watch" })).toBe("picks");
  });
});
