import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  EMPTY_SEARCH_FILTERS,
  KNOWLEDGE_SEARCH_DEFAULTS,
  type KnowledgeHit,
  type SearchFilters,
} from "../../lib/knowledge-search.ts";
import type { Route, SearchMode } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { fetchKnowledgeStatus, fetchSearchFacets, searchKnowledge, startIndexSessions } from "./knowledge-search-api.ts";
import {
  createKnowledgeSearchStore,
  indexBusy,
  knowledgeSearchFilterKey,
  type KnowledgeAnswer,
  type KnowledgeIndexState,
} from "./knowledge-search-store.ts";
import { answerPick } from "./search-keys.ts";
import { isSearchUnanswered } from "./search-loading.ts";

/** The window's one knowledge store: every Search surface reads and drives this. */
export const knowledgeSearchStore = createKnowledgeSearchStore({
  fetchStatus: fetchKnowledgeStatus,
  startIndex: startIndexSessions,
  fetchFacets: fetchSearchFacets,
});

/**
 * How long a search may run before the surface admits it is running.
 *
 * Longer than the 180ms input debounce, so a burst of typing followed by a
 * fast answer never flashes a loading state; short enough that a real wait is
 * acknowledged before it feels like nothing happened.
 */
const SEARCH_GRACE_MS = 220;

const NO_ANSWER: KnowledgeAnswer = { hits: [], mode: "index", basic: null };

export type KnowledgeIndex = KnowledgeIndexState & {
  busy: boolean;
  hasIndex: boolean;
  /** Update index: a forced run. */
  refresh: () => void;
};

/**
 * The index, live. Opening any Search surface asks for the background refresh
 * (once, however many open together), and keeps status moving while it runs.
 */
export function useKnowledgeIndex(): KnowledgeIndex {
  const state = useSyncExternalStore(knowledgeSearchStore.subscribe, knowledgeSearchStore.getState, knowledgeSearchStore.getState);
  useEffect(() => {
    void knowledgeSearchStore.open();
  }, []);
  useEffect(() => knowledgeSearchStore.watch(), []);
  const refresh = useCallback(() => void knowledgeSearchStore.refresh(true), []);
  return { ...state, busy: indexBusy(state), hasIndex: (state.status?.chunks ?? 0) > 0, refresh };
}

/** This surface shows the index status (the page foot, a Search index panel): Search panels leave index failures to it. */
export function useShowsIndexStatus(): void {
  useEffect(() => knowledgeSearchStore.showStatus(), []);
}

/** Facet values for the Agent and Project chips, read once the index has content and after each run. */
export function useSearchFacets(index: KnowledgeIndex) {
  useEffect(() => {
    if (index.hasIndex) knowledgeSearchStore.loadFacets();
  }, [index.hasIndex, index.runs]);
  return index.facets;
}

/** How a moment came to be selected: someone chose it, or an answer landed and the surface picked one. */
export type SearchPickHow = "operator" | "answer";

export type SearchSelection = {
  /** The moment shown as selected, or null. */
  id: string | null;
  pick: (hit: KnowledgeHit, filters: SearchFilters, how: SearchPickHow) => void;
  clear: () => void;
};

/**
 * Where a search keeps its filters and its selected moment: the URL on the
 * Search page, a panel's settings elsewhere. KnowledgeSearch draws the same
 * either way.
 */
export type KnowledgeSearchBinding = {
  /** The filters as kept. Changes from outside (Back and Forward) mirror into the field. */
  filters: SearchFilters;
  /** Every edit that changes what is searched (typing, a chip, Clear). */
  change: (next: SearchFilters) => void;
  selection: SearchSelection;
  /** Each answer, so the owner can select a moment in it (or not). */
  answer: (hits: KnowledgeHit[], filters: SearchFilters) => void;
  /**
   * A moment the kept selection names that the list should select when it
   * holds it: the URL's ?hit=, which Back and Forward move under the list.
   */
  wanted?: string | null;
};

export type KnowledgeSearchRun = {
  filterKey: string;
  answer: KnowledgeAnswer;
  /** Typed, and not answered yet: the debounce counts. */
  unanswered: boolean;
  /** Typed and waiting, for the debounce or the request. */
  waiting: boolean;
  /** Waiting longer than one grace beat: show the spinner and the skeleton. */
  pending: boolean;
  searching: boolean;
  failed: boolean;
  error: string | null;
  /** Ask again now (Enter). */
  run: (filters: SearchFilters) => void;
};

/**
 * One search: debounced 180ms, the request before it aborted, answers for an
 * older filter set dropped. Starts from the last answer for the same filters,
 * and asks again when an index run finishes.
 */
export function useKnowledgeSearch(
  filters: SearchFilters,
  onAnswer: (hits: KnowledgeHit[], filters: SearchFilters) => void,
  runs: number,
): KnowledgeSearchRun {
  const filterKey = knowledgeSearchFilterKey(filters);
  const [seed] = useState(() => knowledgeSearchStore.answerFor(filterKey) ?? null);
  const [answer, setAnswer] = useState<KnowledgeAnswer>(seed ?? NO_ANSWER);
  // The filter set `answer` actually answers. Between a keystroke and its
  // response the list still holds the previous query's results, and counting
  // those would put a confident "0 sessions" under a query nobody has searched.
  const [settledKey, setSettledKey] = useState<string | null>(seed ? filterKey : null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;

  const run = useCallback(async (next: SearchFilters) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const current = ++generation.current;
    const requestKey = knowledgeSearchFilterKey(next);
    const isCurrent = () => !controller.signal.aborted && current === generation.current
      && requestKey === knowledgeSearchFilterKey(filtersRef.current);
    const trimmed = next.query.trim();
    if (!trimmed) {
      setAnswer(NO_ANSWER);
      setSettledKey(requestKey);
      setFailedKey(null);
      setSearching(false);
      onAnswerRef.current([], next);
      return;
    }
    setSearching(true);
    setFailedKey(null);
    try {
      setError(null);
      const response = await searchKnowledge(trimmed, next, controller.signal);
      if (!isCurrent()) return;
      const landed: KnowledgeAnswer = { hits: response.hits, mode: response.mode ?? "index", basic: response.basic ?? null };
      setAnswer(landed);
      setSettledKey(requestKey);
      setFailedKey(null);
      knowledgeSearchStore.remember(requestKey, landed);
      knowledgeSearchStore.applyStatus(response.status);
      onAnswerRef.current(response.hits, next);
    } catch (err) {
      if (isCurrent()) {
        setFailedKey(requestKey);
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (current === generation.current) setSearching(false);
    }
  }, []);

  // Re-run whenever what is searched changes. Without an index the server
  // answers from a basic scan of recent transcripts.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void run(filtersRef.current);
    }, KNOWLEDGE_SEARCH_DEFAULTS.debounceMs);
    return () => {
      window.clearTimeout(timer);
      abort.current?.abort();
    };
  }, [filterKey, run]);

  // An index run finished: ask the live query again against the fresh index.
  const seenRuns = useRef(runs);
  useEffect(() => {
    if (runs === seenRuns.current) return;
    seenRuns.current = runs;
    const live = filtersRef.current;
    if (live.query.trim()) void run(live);
  }, [runs, run]);

  const trimmed = filters.query.trim();
  const unanswered = isSearchUnanswered({ query: trimmed, filterKey, settledFilterKey: settledKey, failedFilterKey: failedKey });
  const waiting = Boolean(trimmed) && (unanswered || searching);

  // The spinner and the skeleton wait out one grace beat together: a warm
  // index answers in a frame or two, and a loading shape that fast reads as a flicker.
  useEffect(() => {
    if (!waiting) {
      setPending(false);
      return;
    }
    const timer = window.setTimeout(() => setPending(true), SEARCH_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  return {
    filterKey,
    answer,
    unanswered,
    waiting,
    pending,
    searching,
    failed: failedKey === filterKey,
    error,
    run: (next) => void run(next),
  };
}

type Navigate = (route: Route, options?: { replace?: boolean }) => void;

/**
 * The selected moment as the Search route keeps it: ?hit=, and the hit Scout
 * holds for it (useScout().selectedKnowledgeHit). Picking writes the URL with
 * replace, so the Result beside the list and Back agree.
 */
export function useRouteSelection(): SearchSelection {
  const { selectedKnowledgeHit, inspectKnowledgeHit, clearKnowledgeHit } = useScout();
  const id = selectedKnowledgeHit?.id ?? null;
  return useMemo(() => ({
    id,
    // an answer carries the filters it answers into the URL; a click keeps the route's
    pick: (hit, filters, how) => (how === "answer" ? inspectKnowledgeHit(hit, filters.query, filters) : inspectKnowledgeHit(hit, filters.query)),
    clear: clearKnowledgeHit,
  }), [id, inspectKnowledgeHit, clearKnowledgeHit]);
}

/**
 * The Search page's binding: the URL holds the filters and the selected moment
 * (/search?q=&source=&harness=&project=&time=&hit=). Every edit rewrites the
 * URL with replace and drops ?hit=; each answer selects the deep-linked moment,
 * else the first. Used by the page (web, Basic, the macOS embed) and by the
 * Search panel that follows the Search view.
 */
export function useRouteSearchBinding({
  mode,
  hitId,
  filters,
  navigate,
}: {
  /** Kept for route compatibility (/search/indexer): carried through every edit. */
  mode?: SearchMode;
  hitId?: string;
  filters?: SearchFilters;
  navigate: Navigate;
}): KnowledgeSearchBinding {
  const selection = useRouteSelection();
  const change = useCallback((next: SearchFilters) => {
    navigate({ view: "search", ...(mode ? { mode } : {}), filters: next }, { replace: true });
  }, [mode, navigate]);
  const answer = useCallback((hits: KnowledgeHit[], answered: SearchFilters) => {
    const next = answerPick(hits, hitId);
    if (next) selection.pick(next, answered, "answer");
    else selection.clear();
  }, [hitId, selection]);
  return {
    // a bare /search holds no filters: an empty search, so Back to it clears the field
    filters: filters ?? EMPTY_SEARCH_FILTERS,
    change,
    selection,
    answer,
    wanted: hitId ?? null,
  };
}
