/**
 * Search box — one field that lands on Search with the query filled in.
 *
 * Shows:  one field. Enter opens Search across sessions, messages and docs.
 * Data:   none; Search reads the knowledge index.
 * Scope:  none.
 * Opens:  Search with the query.
 */
import { useState } from "react";
import { EMPTY_SEARCH_FILTERS } from "../../../lib/knowledge-search.ts";
import { defineModule, type ModuleProps } from "./contract.ts";

function Search({ navigate }: ModuleProps) {
  const [q, setQ] = useState("");
  return (
    <form
      className="vw-search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) navigate({ view: "search", filters: { ...EMPTY_SEARCH_FILTERS, query: q.trim() } });
      }}
    >
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions, messages, docs" aria-label="Search" />
    </form>
  );
}

export const searchModule = defineModule({
  type: "search",
  title: "Search box",
  blurb: "One field that opens Search; the Search panel searches in place",
  docs: { shows: "One field; Enter opens Search with the query.", data: "None.", opens: "Search." },
  size: { w: 4, h: 3 },
  minSize: { w: 2, h: 3 },
  Component: Search,
});
