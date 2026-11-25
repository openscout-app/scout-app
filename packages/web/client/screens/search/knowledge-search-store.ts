import type {
  IndexStartResponse,
  KnowledgeHit,
  KnowledgeStatus,
  SearchFilters,
  SearchResponse,
} from "../../lib/knowledge-search.ts";
import { KNOWLEDGE_SEARCH_DEFAULTS, serializeSearchFiltersToParams } from "../../lib/knowledge-search.ts";
import { latestIndexFailure } from "./search-loading.ts";
import type { SearchPrimitivesResponse } from "./search-primitives.ts";

/**
 * One store for every Search surface in the window: the full Search page (web,
 * Basic, the macOS embed), and the Search, Result and Search index panels a
 * view holds. Each reads it through a hook in use-knowledge-search.ts.
 *
 * It owns the index lifecycle, so it runs once however many surfaces are open:
 * the incremental run a surface asks for when it opens (skipped while one runs,
 * or when this window indexed in the last 5 minutes), one 1.5s status poll
 * while the server indexes, following a run another caller started, and
 * counting each finished run so search re-asks its query and facets reload.
 * It also keeps the facet primitives and the last answers by filter set, so a
 * remount paints at once and two panels never evict each other's answer.
 *
 * No React here: the lifecycle tests with a fake server
 * (knowledge-search-store.test.ts).
 */

/**
 * How long a completed index run suppresses the open-time incremental
 * re-index. Long enough that hopping between screens never pays the POST
 * twice, short enough that transcripts written mid-session become searchable
 * on a later visit without a manual reindex.
 */
export const KNOWLEDGE_SEARCH_REINDEX_TTL_MS = 5 * 60_000;

/** How often status is re-read while the server indexes. */
export const INDEX_POLL_MS = 1500;

/** Answers kept for warm starts: enough for a few panels and a little history. */
const ANSWER_CACHE_SIZE = 12;

/** Canonical identity for "these results answer these filters". */
export function knowledgeSearchFilterKey(filters: SearchFilters): string {
  return serializeSearchFiltersToParams(filters).toString();
}

/** What the server answered for one filter set. */
export type KnowledgeAnswer = {
  hits: KnowledgeHit[];
  /** "basic" = a scan of recent transcripts, while there is no index or it is building. */
  mode: NonNullable<SearchResponse["mode"]>;
  basic: SearchResponse["basic"] | null;
};

export type KnowledgeIndexState = {
  status: KnowledgeStatus | null;
  /** Status has been read (or reading it failed for good): "Loading index" is over. */
  statusLoaded: boolean;
  /** A start request is out: Update index, or the run a surface asked for on opening. */
  starting: boolean;
  /** Why the last run could not start or did not finish. Cleared when a new run is asked for. */
  error: string | null;
  /** Finished runs this window has seen. Search re-asks and facets reload when it moves. */
  runs: number;
  facets: SearchPrimitivesResponse | null;
  /** The `runs` value facets were last read at; null = never read. */
  facetsRun: number | null;
  /**
   * Surfaces showing the index status right now (the Search page's foot, a
   * Search index panel). While one does, a Search panel leaves index failures
   * to it instead of saying them twice.
   */
  shown: number;
};

export type KnowledgeSearchDeps = {
  fetchStatus: () => Promise<KnowledgeStatus>;
  startIndex: (force: boolean) => Promise<IndexStartResponse>;
  fetchFacets: () => Promise<SearchPrimitivesResponse>;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Whether the server is indexing. Older servers do not report `indexing`; the job table stands in. */
export function serverIndexing(status: KnowledgeStatus | null): boolean {
  if (!status) return false;
  return status.indexing !== undefined ? Boolean(status.indexing) : status.activeJobs.length > 0;
}

/** The index is being built or refreshed: a start is out, or the server runs one. */
export function indexBusy(state: Pick<KnowledgeIndexState, "starting" | "status">): boolean {
  return state.starting || serverIndexing(state.status);
}

/** Sessions indexed of sessions found in the running job, or null when the server has not counted yet. */
export function indexProgress(status: KnowledgeStatus | null): { indexed: number; discovered: number } | null {
  const job = status?.activeJobs[0];
  const discovered = job?.progress.discovered ?? 0;
  if (!job || discovered <= 0) return null;
  return { indexed: Math.min(discovered, job.progress.indexed ?? 0), discovered };
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

/**
 * The index in one line, as the Search page's foot and the Search index panel
 * say it. `updated` is the status time already formatted (a clock label).
 */
export function indexStatusLine(state: Pick<KnowledgeIndexState, "starting" | "status" | "statusLoaded">, updated: string): string {
  const { status } = state;
  const days = KNOWLEDGE_SEARCH_DEFAULTS.days;
  const hasIndex = (status?.chunks ?? 0) > 0;
  if (indexBusy(state)) {
    const progress = indexProgress(status);
    if (progress) return `Indexing sessions in the background · ${formatCount(progress.indexed)} of ${formatCount(progress.discovered)}`;
    return hasIndex
      ? `Refreshing last ${days} days in the background`
      : `Building the index for the last ${days} days in the background`;
  }
  if (hasIndex) return `${formatCount(status?.chunks ?? 0)} moments · last ${days} days · updated ${updated || "just now"}`;
  return state.statusLoaded ? "No index yet · basic search" : "Loading index";
}

export type KnowledgeSearchStore = ReturnType<typeof createKnowledgeSearchStore>;

export function createKnowledgeSearchStore(deps: KnowledgeSearchDeps) {
  const clock = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((run: () => void, ms: number) => globalThis.setTimeout(run, ms));
  const clearTimer = deps.clearTimer ?? ((handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  let state: KnowledgeIndexState = {
    status: null,
    statusLoaded: false,
    starting: false,
    error: null,
    runs: 0,
    facets: null,
    facetsRun: null,
    shown: 0,
  };
  /** When this window last saw a run finish well (epoch ms). */
  let indexedAt: number | null = null;
  /** When a run was last asked for: failures older than this are not news. */
  let requestedAt: number | null = null;
  let opening: Promise<void> | null = null;
  let starting: Promise<void> | null = null;
  let facetsLoading: Promise<void> | null = null;
  let watchers = 0;
  let timer: unknown = null;
  let polling = false;
  const listeners = new Set<() => void>();
  const answers = new Map<string, KnowledgeAnswer>();

  function set(patch: Partial<KnowledgeIndexState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
    schedule();
  }

  /**
   * Take a status from anywhere (status read, poll, a search answer) and
   * notice a run ending. `finished` says a run just ended without the poll
   * seeing it go (an older server answers the start with the finished run).
   */
  function applyStatus(next: KnowledgeStatus, finished = false) {
    const was = serverIndexing(state.status);
    const patch: Partial<KnowledgeIndexState> = { status: next, statusLoaded: true };
    // A run that failed before any in-progress status was seen still counts.
    const failure = latestIndexFailure(next, requestedAt);
    if (failure) patch.error = failure;
    if (finished || (was && !serverIndexing(next))) {
      const last = next.lastIndex;
      if (last && !last.ok) patch.error = `Indexing failed: ${last.error ?? "unknown error"}`;
      else indexedAt = clock();
      patch.runs = state.runs + 1;
    }
    set(patch);
  }

  /** Re-read status on a short beat while the server indexes and someone is looking. */
  function schedule() {
    const want = watchers > 0 && serverIndexing(state.status);
    if (!want) {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      return;
    }
    if (timer !== null || polling) return;
    timer = setTimer(() => {
      timer = null;
      polling = true;
      deps.fetchStatus()
        .then(applyStatus, () => undefined)
        .finally(() => {
          polling = false;
          schedule();
        });
    }, INDEX_POLL_MS);
  }

  /**
   * Ask for an index run without waiting on it. Search keeps answering (from
   * the basic scan until the index has content); the poll follows progress.
   * One start at a time: a second ask joins the first.
   */
  function refresh(force = false): Promise<void> {
    if (starting) return starting;
    requestedAt = clock();
    set({ starting: true, error: null });
    starting = (async () => {
      try {
        const response = await deps.startIndex(force);
        if (response.status) {
          // An older server indexed to completion before answering.
          applyStatus(response.status, true);
        } else {
          if (state.status) {
            applyStatus({ ...state.status, indexing: response.indexing ?? null, lastIndex: response.lastIndex ?? null });
          }
          applyStatus(await deps.fetchStatus());
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Another run (other parameters) is already going: follow that one.
        if (/already running/i.test(message)) {
          try {
            applyStatus(await deps.fetchStatus());
          } catch {
            // the poll surfaces a lasting failure
          }
        } else {
          set({ error: message, statusLoaded: true });
        }
      } finally {
        starting = null;
        set({ starting: false });
      }
    })();
    return starting;
  }

  /**
   * What a Search surface does when it opens: read status, then refresh the
   * default window in the background, unless a run is going or this window
   * indexed recently and the index still has content. Surfaces opening
   * together share one pass.
   */
  function open(): Promise<void> {
    if (opening) return opening;
    opening = (async () => {
      let fresh: KnowledgeStatus | null = null;
      try {
        fresh = await deps.fetchStatus();
        applyStatus(fresh);
      } catch {
        // Starting the index below surfaces a hard failure if status is also unavailable.
      }
      if (fresh?.indexing) return;
      const recentlyIndexed = indexedAt !== null && clock() - indexedAt < KNOWLEDGE_SEARCH_REINDEX_TTL_MS;
      if (recentlyIndexed && (fresh?.chunks ?? 0) > 0) return;
      await refresh(false);
    })().finally(() => {
      opening = null;
    });
    return opening;
  }

  /** Read the facet values once the index has content, and again after each finished run. */
  function loadFacets(): void {
    if ((state.status?.chunks ?? 0) <= 0 || state.facetsRun === state.runs || facetsLoading) return;
    const run = state.runs;
    facetsLoading = deps.fetchFacets()
      .then(
        (facets) => set({ facets, facetsRun: run }),
        // no facets is a quiet fallback: the chip rows that need them stay hidden
        () => set({ facetsRun: run }),
      )
      .finally(() => {
        facetsLoading = null;
        // a run that finished while this read was out
        if (state.facetsRun !== state.runs) loadFacets();
      });
  }

  return {
    getState: (): KnowledgeIndexState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Keep status moving while the server indexes; returns the release. */
    watch(): () => void {
      watchers += 1;
      schedule();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        watchers -= 1;
        schedule();
      };
    },
    /** A surface that shows the index status mounted; returns the release. */
    showStatus(): () => void {
      set({ shown: state.shown + 1 });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        set({ shown: state.shown - 1 });
      };
    },
    open,
    refresh,
    applyStatus,
    loadFacets,
    answerFor(key: string): KnowledgeAnswer | undefined {
      return answers.get(key);
    },
    remember(key: string, answer: KnowledgeAnswer): void {
      answers.delete(key);
      answers.set(key, answer);
      while (answers.size > ANSWER_CACHE_SIZE) {
        const oldest = answers.keys().next().value;
        if (oldest === undefined) break;
        answers.delete(oldest);
      }
    },
  };
}
