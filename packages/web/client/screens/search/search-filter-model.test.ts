import { describe, expect, test } from "bun:test";

import { EMPTY_SEARCH_FILTERS, type KnowledgeFacetValue } from "../../lib/knowledge-search.ts";
import {
  filterChipsActive,
  filterSummaryParts,
  summarizeFilters,
  titleCase,
  toggleValue,
  topFacetValues,
} from "./search-filter-model.ts";

const facet = (key: string, value: string, count: number) => ({ key, value, count }) as KnowledgeFacetValue;

describe("the filter bar", () => {
  test("top facet values: by count, then name, only that key, no blanks", () => {
    const facets = [
      facet("harness", "codex", 2),
      facet("harness", "claude", 5),
      facet("project", "scout", 9),
      facet("harness", "", 7),
      facet("harness", "amp", 2),
    ];
    expect(topFacetValues(facets, "harness").map((f) => f.value)).toEqual(["claude", "amp", "codex"]);
    expect(topFacetValues(facets, "harness", 1).map((f) => f.value)).toEqual(["claude"]);
    expect(topFacetValues(undefined, "harness")).toEqual([]);
  });

  test("a query alone sets no chip", () => {
    expect(filterChipsActive({ ...EMPTY_SEARCH_FILTERS, query: "deploy" })).toBe(false);
    expect(filterChipsActive({ ...EMPTY_SEARCH_FILTERS, timeWindow: "7" as never })).toBe(true);
    expect(filterChipsActive({ ...EMPTY_SEARCH_FILTERS, harness: ["claude"] })).toBe(true);
  });

  test("the summary names each set row", () => {
    const filters = { ...EMPTY_SEARCH_FILTERS, harness: ["claude", "codex_cli"], project: ["openscout"] };
    expect(filterSummaryParts(filters)).toEqual(["Claude + Codex Cli", "openscout"]);
    expect(summarizeFilters(filters)).toBe("Filters: Claude + Codex Cli · openscout");
    expect(summarizeFilters(EMPTY_SEARCH_FILTERS)).toBe("");
  });

  test("chips toggle a value in and out", () => {
    expect(toggleValue(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleValue(["a", "b"], "a")).toEqual(["b"]);
  });

  test("title case splits on spaces, dashes and underscores", () => {
    expect(titleCase("claude-code")).toBe("Claude Code");
    expect(titleCase("")).toBe("");
  });
});
