import {
  KNOWLEDGE_SOURCE_KIND_LABELS,
  searchTimeWindowLabel,
  type KnowledgeFacetValue,
  type SearchFilters,
} from "../../lib/knowledge-search.ts";

/* The filter bar's words and rules, shared by the Search page and the Search panel. Pure. */

export function titleCase(value: string): string {
  if (!value) return value;
  return value
    .split(/[\s_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** The most common values of one facet, for a chip row: by count, then name. */
export function topFacetValues(
  facets: readonly KnowledgeFacetValue[] | undefined,
  key: string,
  limit = 6,
): KnowledgeFacetValue[] {
  if (!facets) return [];
  return facets
    .filter((entry) => entry.key === key && entry.value.length > 0)
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value))
    .slice(0, limit);
}

/** Any chip set: source, agent, project, or a time window. The query is not a chip. */
export function filterChipsActive(filters: SearchFilters): boolean {
  return filters.sourceKinds.length > 0
    || filters.harness.length > 0
    || filters.project.length > 0
    || filters.timeWindow !== "all";
}

/** The chips that are set, one phrase per row: "Sessions + Skills", "Claude", "Last 24h". */
export function filterSummaryParts(filters: SearchFilters): string[] {
  const parts: string[] = [];
  if (filters.sourceKinds.length > 0) {
    parts.push(filters.sourceKinds.map((kind) => KNOWLEDGE_SOURCE_KIND_LABELS[kind] ?? kind).join(" + "));
  }
  if (filters.harness.length > 0) parts.push(filters.harness.map(titleCase).join(" + "));
  if (filters.project.length > 0) parts.push(filters.project.join(" + "));
  if (filters.timeWindow !== "all") parts.push(searchTimeWindowLabel(filters.timeWindow));
  return parts;
}

export function summarizeFilters(filters: SearchFilters): string {
  const parts = filterSummaryParts(filters);
  return parts.length > 0 ? `Filters: ${parts.join(" · ")}` : "";
}

/** A multi-select chip: on adds the value, off removes it. */
export function toggleValue(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];
}
