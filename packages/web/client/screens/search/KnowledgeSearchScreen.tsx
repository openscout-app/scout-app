import "./knowledge-search.css";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import {
  ChevronDown,
  Clock,
  Filter,
  Loader2,
  Search as SearchIcon,
  Sparkles,
  X,
} from "lucide-react";

import type { Route } from "../../lib/types.ts";
import { formatClockTimestamp } from "../../lib/time.ts";
import {
  createEmptySearchFilters,
  displaySnippet,
  firstTranscriptRef,
  groupHitsBySession,
  highlightParts,
  KNOWLEDGE_SEARCH_DEFAULTS,
  KNOWLEDGE_SOURCE_KIND_LABELS,
  resultMomentBits,
  resultMomentHeadline,
  resultRoutingContext,
  resultSessionGoal,
  SEARCH_SOURCE_KIND_ORDER,
  SEARCH_TIME_WINDOW_OPTIONS,
  searchFiltersAreActive,
  searchFiltersAreEqual,
  transcriptSessionId,
  type KnowledgeHit,
  type SearchFilters,
  type SearchTimeWindow,
} from "../../lib/knowledge-search.ts";
import { indexStatusLine } from "./knowledge-search-store.ts";
import { filterChipsActive, filterSummaryParts, summarizeFilters, titleCase, toggleValue, topFacetValues } from "./search-filter-model.ts";
import { searchKeyAction, stepMoment } from "./search-keys.ts";
import {
  useKnowledgeIndex,
  useKnowledgeSearch,
  useRouteSearchBinding,
  useSearchFacets,
  useShowsIndexStatus,
  type KnowledgeSearchBinding,
} from "./use-knowledge-search.ts";

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

function activateHitFromKeyboard(event: KeyboardEvent<HTMLElement>, activate: () => void) {
  if (event.target !== event.currentTarget) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activate();
}

const TIME_WINDOWS = SEARCH_TIME_WINDOW_OPTIONS;

function FilterChip({
  active,
  onClick,
  count,
  label,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  label: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      className={`ks-chip${active ? " ks-chip--active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel ?? label}
    >
      <span className="ks-chip-label">{label}</span>
      {typeof count === "number" ? (
        <span className="ks-chip-count" aria-hidden="true">{formatCount(count)}</span>
      ) : null}
    </button>
  );
}

function isTypingTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  return target.tagName === "INPUT"
    || target.tagName === "TEXTAREA"
    || target.tagName === "SELECT"
    || target.isContentEditable
    || Boolean(target.closest(".xterm"));
}

/** What a panel head can show about the list: counts, and whether an answer is out. */
export type KnowledgeSearchSummary = {
  query: string;
  sessions: number;
  moments: number;
  waiting: boolean;
  filters: SearchFilters;
};

export type KnowledgeSearchProps = {
  /** Where the filters and the selected moment are kept: the URL, or a panel's settings. */
  binding: KnowledgeSearchBinding;
  /** A click on a session goes here (Sessions). Answers never navigate. */
  navigate: (route: Route) => void;
  /**
   * "page": the bands of the Search page, inside its shell. "panel": the same
   * list in a view panel, with a compact field and the filters folded behind
   * a toggle; the list scrolls under a fixed field.
   */
  variant?: "page" | "panel";
  /**
   * Off the Search page: answer keys only while focus is inside this element
   * (panel-scope.ts › usePanelKeyScope). Absent: the keys are the screen's.
   */
  keyScope?: () => HTMLElement | null;
  autoFocus?: boolean;
  /** The filter bar starts open. Default: open on the page, folded in a panel. */
  filtersOpen?: boolean;
  /** Something for the panel head, from the list's counts (drawn through ModuleHead). */
  renderHead?: (summary: KnowledgeSearchSummary) => ReactNode;
};

/**
 * The search itself: field, filters, and moments grouped by session. Draws the
 * same on the Search page (web, Basic, the macOS embed) and in a Search panel;
 * the binding decides where its state lives and what an answer selects.
 */
export function KnowledgeSearch({
  binding,
  navigate,
  variant = "page",
  keyScope,
  autoFocus = false,
  filtersOpen: filtersOpenAtStart,
  renderHead,
}: KnowledgeSearchProps) {
  const panel = variant === "panel";
  const index = useKnowledgeIndex();
  const facets = useSearchFacets(index);

  const [filters, setFilters] = useState<SearchFilters>(binding.filters);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const keyScopeRef = useRef(keyScope);
  keyScopeRef.current = keyScope;
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(filtersOpenAtStart ?? !panel);
  const filterBarId = useId();

  // Back and Forward (or a settings change) move the kept filters first; mirror
  // them into the field without resetting equivalent local state (a trailing space).
  useEffect(() => {
    setFilters((current) => searchFiltersAreEqual(current, binding.filters) ? current : binding.filters);
  }, [binding.filters]);

  const onAnswer = useCallback((hits: KnowledgeHit[], answered: SearchFilters) => {
    bindingRef.current.answer(hits, answered);
  }, []);
  const search = useKnowledgeSearch(filters, onAnswer, index.runs);
  const hits = search.answer.hits;
  const sessionResults = useMemo(() => groupHitsBySession(hits), [hits]);
  const trimmedQuery = filters.query.trim();
  const { unanswered, waiting, pending, searching } = search;
  const filtersActive = searchFiltersAreActive(filters);
  const chipsActive = filterChipsActive(filters);
  const selectedId = binding.selection.id;

  // Hit list ordering for keyboard navigation.
  const flatMoments = useMemo<KnowledgeHit[]>(() => {
    const ordered: KnowledgeHit[] = [];
    for (const session of sessionResults) ordered.push(...session.moments);
    return ordered;
  }, [sessionResults]);
  const flatRef = useRef(flatMoments);
  flatRef.current = flatMoments;

  // The kept selection names a moment this list holds (Back and Forward moved
  // ?hit=, or a reload): select it without asking again.
  const wanted = binding.wanted ?? null;
  useEffect(() => {
    if (!wanted || wanted === selectedId) return;
    const hit = hits.find((entry) => entry.id === wanted);
    if (hit) bindingRef.current.selection.pick(hit, filtersRef.current, "answer");
  }, [wanted, selectedId, hits]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    search.run(filters);
  };

  // The field keeps every keystroke, a trailing space too; what is searched
  // (and kept) changes only when the filters do.
  const updateFilters = useCallback((patch: Partial<SearchFilters>) => {
    const current = filtersRef.current;
    const next = { ...current, ...patch };
    filtersRef.current = next;
    setFilters(next);
    if (!searchFiltersAreEqual(current, next)) bindingRef.current.change(next);
  }, []);

  const clearAll = useCallback(() => {
    const next = createEmptySearchFilters();
    filtersRef.current = next;
    setFilters(next);
    bindingRef.current.change(next);
  }, []);

  const pick = useCallback((hit: KnowledgeHit) => {
    bindingRef.current.selection.pick(hit, filtersRef.current, "operator");
  }, []);

  // Keys: "/" focuses this field, j/k walk the moments, Esc clears the
  // selection (or every filter when there is nothing to select). search-keys.ts
  // has the rules for where they answer.
  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const scope = keyScopeRef.current;
      const scopeRoot = scope ? scope() : null;
      const panelEl = target?.closest<HTMLElement>("[data-panel]") ?? null;
      const mine = rootRef.current?.closest<HTMLElement>("[data-panel]") ?? null;
      const action = searchKeyAction({
        key: event.key,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        inField: isTypingTarget(target),
        inScope: scope ? Boolean(target && scopeRoot?.contains(target)) : true,
        // a Result or Search index panel answers for the Search panel; any other kind keeps its own keys
        inOtherPanel: Boolean(panelEl && panelEl !== mine && !panelEl.querySelector('[data-search-keys="companion"]')),
        onPanelFrame: Boolean(target?.hasAttribute("data-panel")),
        fullView: Boolean(document.querySelector(".hud-grid-panel.is-full")),
      });
      if (!action) return;
      if (action === "focus") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        return;
      }
      const moments = flatRef.current;
      if (action === "escape") {
        if (moments.length > 0) bindingRef.current.selection.clear();
        else clearAll();
        return;
      }
      if (moments.length === 0) return;
      event.preventDefault();
      const nextId = stepMoment(moments.map((hit) => hit.id), bindingRef.current.selection.id, action);
      const targetHit = moments.find((hit) => hit.id === nextId);
      if (targetHit) pick(targetHit);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearAll, pick]);

  const harnessOptions = topFacetValues(facets?.facets, "harness");
  const projectOptions = topFacetValues(facets?.facets, "project");
  // In a panel, an index failure is the Search index panel's to say when one is on the view.
  const indexError = panel && index.shown > 0 ? null : index.error;
  const error = search.error ?? indexError;

  const field = (
    <form className={`ks-search-form${panel ? " ksp-field" : ""}`} onSubmit={onSubmit} role="search">
      <SearchIcon size={panel ? 15 : 17} strokeWidth={1.75} aria-hidden="true" />
      <input
        ref={inputRef}
        value={filters.query}
        onChange={(event) => updateFilters({ query: event.target.value })}
        placeholder="Search topics, files, decisions, agents…"
        className="ks-search-input"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label="Search OpenScout knowledge"
      />
      {filters.query ? (
        <button
          type="button"
          className="ks-search-clear"
          onClick={() => updateFilters({ query: "" })}
          aria-label="Clear search"
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : (
        <span className="ks-search-hint" aria-hidden="true">/</span>
      )}
      {pending ? <Loader2 size={15} className="ks-spin" aria-hidden="true" /> : null}
      {panel ? (
        <button
          type="button"
          className={`ksp-filters-toggle${chipsActive ? " is-set" : ""}`}
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls={filterBarId}
        >
          <Filter size={12} aria-hidden="true" />
          Filters
          {chipsActive ? <span className="ksp-filters-count">{filterSummaryParts(filters).length}</span> : null}
        </button>
      ) : null}
    </form>
  );

  const filterBar = (
    <section className="ks-filterbar" id={filterBarId} aria-label="Search filters">
      <div className="ks-filterbar-row">
        <span className="ks-filterbar-label">
          <Filter size={12} aria-hidden="true" />
          Source
        </span>
        <div className="ks-chip-row" role="group" aria-label="Source kind filters">
          {SEARCH_SOURCE_KIND_ORDER.map((kind) => (
            <FilterChip
              key={kind}
              active={filters.sourceKinds.includes(kind)}
              onClick={() => updateFilters({ sourceKinds: toggleValue(filters.sourceKinds, kind) })}
              label={KNOWLEDGE_SOURCE_KIND_LABELS[kind] ?? kind}
            />
          ))}
        </div>
      </div>

      {harnessOptions.length > 0 ? (
        <div className="ks-filterbar-row">
          <span className="ks-filterbar-label">
            <Sparkles size={12} aria-hidden="true" />
            Agent
          </span>
          <div className="ks-chip-row" role="group" aria-label="Harness filters">
            {harnessOptions.map((entry) => (
              <FilterChip
                key={`harness:${entry.value}`}
                active={filters.harness.includes(entry.value)}
                onClick={() => updateFilters({ harness: toggleValue(filters.harness, entry.value) })}
                label={titleCase(entry.value)}
                count={entry.count}
              />
            ))}
          </div>
        </div>
      ) : null}

      {projectOptions.length > 0 ? (
        <div className="ks-filterbar-row">
          <span className="ks-filterbar-label">
            <ChevronDown size={12} aria-hidden="true" />
            Project
          </span>
          <div className="ks-chip-row" role="group" aria-label="Project filters">
            {projectOptions.map((entry) => (
              <FilterChip
                key={`project:${entry.value}`}
                active={filters.project.includes(entry.value)}
                onClick={() => updateFilters({ project: toggleValue(filters.project, entry.value) })}
                label={entry.value}
                count={entry.count}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="ks-filterbar-row ks-filterbar-row--inline">
        <span className="ks-filterbar-label">
          <Clock size={12} aria-hidden="true" />
          Time
        </span>
        <div className="ks-chip-row" role="group" aria-label="Time window filter">
          <FilterChip
            active={filters.timeWindow === "all"}
            onClick={() => updateFilters({ timeWindow: "all" })}
            label="Any time"
          />
          {TIME_WINDOWS.map((option) => (
            <FilterChip
              key={option.value}
              active={filters.timeWindow === option.value}
              onClick={() => updateFilters({ timeWindow: option.value as SearchTimeWindow })}
              label={option.label}
            />
          ))}
        </div>
        {chipsActive ? (
          <button type="button" className="ks-clear-all" onClick={clearAll}>
            Clear filters
          </button>
        ) : null}
      </div>
    </section>
  );

  const list = (
    <div className="ks-hit-list" role="listbox" aria-label="Search results">
      <div className="ks-hit-list-head" aria-live="polite" hidden={!search.failed && !waiting && !trimmedQuery}>
        <span>
          {search.failed
            ? "Search failed"
            : waiting
            ? "Searching…"
            : `${formatCount(sessionResults.length)} session${sessionResults.length === 1 ? "" : "s"}`}
        </span>
        {trimmedQuery && hits.length > 0 ? (
          <span className="ks-hit-list-meta">
            {search.answer.mode === "basic" ? (
              <span
                className="ks-basic-note"
                title="Matched by scanning recent transcripts directly; ranked results arrive when the index is ready."
              >
                Basic matches
                {search.answer.basic ? ` · ${formatCount(search.answer.basic.scannedFiles)} recent sessions scanned` : ""}
                {" · "}
              </span>
            ) : null}
            {formatCount(hits.length)} moment{hits.length === 1 ? "" : "s"}
            {filtersActive ? <> · <button type="button" className="ks-text-action" onClick={clearAll}>Clear filters</button></> : null}
          </span>
        ) : null}
      </div>

      {pending && sessionResults.length === 0 ? (
        <div className="ks-skeleton" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <section className="ks-skeleton-session" key={row}>
              <span className="ks-skeleton-line ks-skeleton-line--meta" />
              <span className="ks-skeleton-line ks-skeleton-line--goal" />
              <div className="ks-skeleton-moments">
                <span className="ks-skeleton-line ks-skeleton-line--title" />
                <span className="ks-skeleton-line ks-skeleton-line--snippet" />
                <span className="ks-skeleton-line ks-skeleton-line--snippet-short" />
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {trimmedQuery && sessionResults.length === 0 && !unanswered && !searching && !search.failed ? (
        <div className="ks-empty-hit">
          <strong>No matches for “{trimmedQuery}”</strong>
          <span>
            Try a project name, file path, or topic from recent work
            {filtersActive ? ", or clear one of the filters above." : "."}
          </span>
          <div className="ks-empty-hit-actions">
            <button type="button" className="ks-text-action" onClick={() => updateFilters({ query: "" })}>
              Clear query
            </button>
            {filtersActive ? (
              <button type="button" className="ks-text-action" onClick={clearAll}>
                Clear all filters
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!trimmedQuery ? (
        <div className="ks-empty-hit ks-empty-hit--quiet">
          <strong>Start with a query</strong>
          <span>Type a topic, file path, agent, or session hint.</span>
        </div>
      ) : null}

      <div className="ks-hit-list-body" aria-busy={searching}>
        {sessionResults.map((session, sessionIndex) => {
          const best = session.best;
          const routing = resultRoutingContext(best);
          const goal = resultSessionGoal(best);
          const sessionId = transcriptSessionId(firstTranscriptRef(best));
          const openSession = () => {
            if (!sessionId) return;
            navigate({ view: "sessions", sessionId });
          };
          const sessionSelected = session.moments.some(
            (moment) => selectedId === moment.id,
          );

          return (
            <section
              key={session.collectionId}
              className={`ks-session${sessionSelected ? " ks-session--selected" : ""}`}
              aria-label={`Session ${sessionIndex + 1}`}
            >
              <header className="ks-session-head">
                <div className="ks-session-topline">
                  <div className="ks-session-meta">
                    {routing.agent ? <span className="ks-hit-chip">{routing.agent}</span> : null}
                    {routing.project ? <span>{routing.project}</span> : null}
                    {routing.session ? (
                      <span className="ks-hit-session" title={sessionId ?? routing.session}>
                        session {routing.session}
                      </span>
                    ) : null}
                    <span className="ks-session-count">
                      {formatCount(session.moments.length)} match{session.moments.length === 1 ? "" : "es"}
                    </span>
                  </div>
                  {routing.when ? <time className="ks-hit-when">{routing.when}</time> : null}
                </div>
                <button
                  type="button"
                  className="ks-session-goal"
                  onClick={openSession}
                  title={sessionId ? "Open session" : undefined}
                >
                  {goal}
                </button>
              </header>

              <div className="ks-session-moments">
                {session.moments.map((hit) => {
                  const momentHeadline = resultMomentHeadline(hit, filters.query);
                  const selected = selectedId === hit.id;
                  const resultSnippet = displaySnippet(hit, filters.query, 200);
                  const momentBits = resultMomentBits(hit);
                  const selectHit = () => pick(hit);
                  const openMomentSession = () => {
                    const id = transcriptSessionId(firstTranscriptRef(hit)) ?? sessionId;
                    if (!id) {
                      selectHit();
                      return;
                    }
                    navigate({ view: "sessions", sessionId: id });
                  };

                  return (
                    <article
                      key={hit.id}
                      className={`ks-hit${selected ? " ks-hit--selected" : ""}`}
                      role="option"
                      aria-selected={selected}
                      tabIndex={0}
                      onClick={selectHit}
                      onDoubleClick={openMomentSession}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                          event.preventDefault();
                          openMomentSession();
                          return;
                        }
                        activateHitFromKeyboard(event, selectHit);
                      }}
                    >
                      <div className="ks-hit-body">
                        {momentBits.length > 0 ? (
                          <div className="ks-hit-details ks-hit-details--moment" aria-label="Turn">
                            {momentBits.map((bit) => (
                              <span key={bit} className="ks-hit-details-strong">{bit}</span>
                            ))}
                          </div>
                        ) : null}

                        <h3 className="ks-hit-title">{momentHeadline}</h3>

                        {resultSnippet && resultSnippet !== momentHeadline ? (
                          <p className="ks-hit-snippet">
                            <HighlightedText text={resultSnippet} query={filters.query} />
                          </p>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );

  const errorBanner = error ? (
    <section className="ks-error" role="alert">
      {error}
    </section>
  ) : null;

  const head = renderHead?.({
    query: trimmedQuery,
    sessions: sessionResults.length,
    moments: hits.length,
    waiting,
    filters,
  });

  if (!panel) {
    return (
      <>
        {head}
        {field}
        {filtersOpen ? filterBar : null}
        {errorBanner}
        {list}
      </>
    );
  }

  return (
    <div className="ksp" ref={rootRef} data-search-keys="list">
      {head}
      {field}
      <div className="ksp-scroll">
        {filtersOpen ? filterBar : chipsActive ? (
          <p className="ksp-filters-summary">
            <span className="ksp-filters-summary-text">{summarizeFilters(filters)}</span>
            <button type="button" className="ks-text-action" onClick={clearAll}>Clear</button>
          </p>
        ) : null}
        {errorBanner}
        {list}
      </div>
    </div>
  );
}

/** The Search page's foot: the index in one line, the filters in force, and Update index. */
function KnowledgeIndexFoot({ filters }: { filters: SearchFilters }) {
  const index = useKnowledgeIndex();
  useShowsIndexStatus();
  const updatedLabel = index.status
    ? formatClockTimestamp(index.status.generatedAt) || "just now"
    : "—";
  return (
    <footer className="ks-foot-status" aria-live="polite">
      <div className="ks-foot-status-shell">
        <span className="ks-foot-status-facts">
          {index.busy ? <Loader2 size={12} className="ks-spin" aria-hidden="true" /> : null}
          {indexStatusLine(index, updatedLabel)}
          {filterChipsActive(filters) ? <> · {summarizeFilters(filters)}</> : null}
        </span>
        <button
          type="button"
          className="ks-text-action"
          onClick={index.refresh}
          disabled={index.busy}
        >
          {index.busy ? "Indexing…" : "Update index"}
        </button>
      </div>
    </footer>
  );
}

/**
 * The Search page: hero, the search, and the index foot. The URL holds the
 * filters and the selected moment (/search?q=&source=&harness=&project=&time=&hit=).
 * Drawn where Search is a page: the macOS embed (/embed/search) and Basic. The
 * web app's Search route draws the Search view's panels instead.
 */
export function KnowledgeSearchScreen({
  navigate,
  mode,
  hitId,
  routeFilters,
}: {
  navigate: (route: Route, options?: { replace?: boolean }) => void;
  /** Kept for route compatibility; search is one surface now. */
  mode?: Extract<Route, { view: "search" }>["mode"];
  /** Deep-linked hit selection from `?hit=` (SCO-082 Phase B). */
  hitId?: string;
  /** Router-owned filter state, including browser back/forward updates. */
  routeFilters?: SearchFilters;
}) {
  const binding = useRouteSearchBinding({ mode, hitId, filters: routeFilters, navigate });
  return (
    <main className="ks-page">
      <div className="ks-shell">
        <header className="ks-header">
          <div className="ks-header-titles">
            <span className="ks-eyebrow">Search</span>
            <h1>Find anything you ran, opened, or decided</h1>
            <p>Search across sessions, skills, MCP tools, codebase, and context packs from the last {KNOWLEDGE_SEARCH_DEFAULTS.days} days.</p>
          </div>
        </header>

        <KnowledgeSearch binding={binding} navigate={navigate} variant="page" autoFocus />
      </div>

      <KnowledgeIndexFoot filters={binding.filters} />
    </main>
  );
}
