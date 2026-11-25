/**
 * Search index — what Search can find, and a way to bring it up to date.
 *
 * Shows:  one line: "N moments · last 3 days · updated HH:MM", or "Indexing
 *         sessions in the background · X of Y" with a spinner and a meter,
 *         or "No index yet · basic search". On the Search route, the filters
 *         in force. The last run that failed. Update index.
 * Data:   /api/knowledge/status on opening, then every 1.5s while the server
 *         indexes. Opening asks for the background refresh of the last 3 days
 *         (POST /api/knowledge/sessions/index), skipped while one runs or when
 *         this window indexed in the last 5 minutes. Shared with every Search
 *         surface (screens/search/knowledge-search-store.ts), so it runs once.
 * Scope:  none; there is one index.
 * Opens:  nothing. Update index forces a full run of the last 3 days.
 */
import { Loader2 } from "lucide-react";
import { formatClockTimestamp } from "../../../lib/time.ts";
import { indexProgress, indexStatusLine } from "../../search/knowledge-search-store.ts";
import { filterChipsActive, summarizeFilters } from "../../search/search-filter-model.ts";
import { useKnowledgeIndex, useShowsIndexStatus } from "../../search/use-knowledge-search.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./search-panels.css";

function SearchIndex({ route }: ModuleProps) {
  const index = useKnowledgeIndex();
  useShowsIndexStatus();
  const updated = index.status ? formatClockTimestamp(index.status.generatedAt) || "just now" : "";
  const progress = index.busy ? indexProgress(index.status) : null;
  const filters = route.view === "search" && route.filters && filterChipsActive(route.filters) ? summarizeFilters(route.filters) : "";

  return (
    <div className="vw-search-index" data-search-keys="companion">
      <div className="vw-search-index-row" aria-live="polite">
        <p className="vw-search-index-line">
          {index.busy ? <Loader2 size={12} className="ks-spin" aria-hidden="true" /> : null}
          <span>{indexStatusLine(index, updated)}</span>
        </p>
        <button type="button" className="vw-chip" onClick={index.refresh} disabled={index.busy}>
          {index.busy ? "Indexing…" : "Update index"}
        </button>
      </div>
      {progress ? (
        <div
          className="vw-meter"
          role="progressbar"
          aria-label="Sessions indexed"
          aria-valuemin={0}
          aria-valuemax={progress.discovered}
          aria-valuenow={progress.indexed}
        >
          <b style={{ width: `${Math.round((progress.indexed / progress.discovered) * 100)}%` }} />
        </div>
      ) : null}
      {index.error ? <p className="vw-search-index-error" role="alert">{index.error}</p> : null}
      {filters ? <p className="vw-search-index-filters">{filters}</p> : null}
    </div>
  );
}

export const searchIndexModule = defineModule({
  type: "search-index",
  title: "Search index",
  blurb: "What Search can find, how fresh it is, and Update index",
  docs: {
    shows: "Moments indexed and when, progress while it runs, the last failure, Update index.",
    data: "/api/knowledge/status, every 1.5s while indexing; a background refresh on opening.",
    opens: "Nothing. Update index re-indexes the last 3 days.",
  },
  size: { w: 5, h: 5 },
  minSize: { w: 3, h: 3 },
  maxPerView: 1,
  Component: SearchIndex,
});
