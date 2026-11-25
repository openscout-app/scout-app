import { api } from "../../lib/api.ts";
import {
  KNOWLEDGE_SEARCH_DEFAULTS,
  searchTimeWindowMs,
  type IndexStartResponse,
  type KnowledgeStatus,
  type SearchFilters,
  type SearchResponse,
} from "../../lib/knowledge-search.ts";
import type { SearchPrimitivesResponse } from "./search-primitives.ts";

/* The knowledge endpoints every Search surface reads (server/routes/knowledge.ts). */

export async function fetchKnowledgeStatus(): Promise<KnowledgeStatus> {
  return api<KnowledgeStatus>("/api/knowledge/status");
}

/** Facet values with counts for the Agent and Project chip rows. */
export async function fetchSearchFacets(): Promise<SearchPrimitivesResponse> {
  const params = new URLSearchParams();
  for (const key of ["harness", "project", "sourceKind"]) params.append("key", key);
  params.set("limit", "200");
  return api<SearchPrimitivesResponse>(`/api/knowledge/search-primitives?${params.toString()}`);
}

export async function searchKnowledge(
  q: string,
  filters: SearchFilters,
  signal: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, limit: String(KNOWLEDGE_SEARCH_DEFAULTS.hitLimit) });
  for (const kind of filters.sourceKinds) params.append("sourceKind", kind);
  for (const harness of filters.harness) params.append("harness", harness);
  for (const project of filters.project) params.append("project", project);
  const sinceMs = searchTimeWindowMs(filters.timeWindow);
  if (sinceMs != null) params.set("updatedAfterMs", String(sinceMs));
  return api<SearchResponse>(`/api/knowledge/search?${params.toString()}`, { signal });
}

/** Starts a session index in the background; progress is read from /status. */
export async function startIndexSessions(force = false): Promise<IndexStartResponse> {
  return api<IndexStartResponse>("/api/knowledge/sessions/index", {
    method: "POST",
    body: JSON.stringify({
      days: KNOWLEDGE_SEARCH_DEFAULTS.days,
      limit: KNOWLEDGE_SEARCH_DEFAULTS.sessionLimit,
      force,
      background: true,
    }),
  });
}
