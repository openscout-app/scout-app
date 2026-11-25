import type { RepoWatchInteractiveScanDepth } from "../../scout/repo-watch/api.ts";
import type { RepoWatchSnapshot } from "../../scout/repo-watch/types.ts";
import {
  isBudgetLimitedSnapshot,
  isSmallerSnapshot,
  projectForRoot,
  repoWatchErrorMessage,
} from "./repos-model.ts";

/*
 * One Repo Watch read for the page. Every surface that shows repo state (the
 * Repos list, its context and diff panels, a Worktrees panel, the Repos
 * screen) reads /api/repo-watch through this store, so two panels on the same
 * repo never poll twice. Pure: fetch, the cache peek, timers and visibility
 * are injected, so the rules test without a DOM (repo-watch-store.test.ts).
 *
 * The rules are the Repos screen's: a warm start from the last snapshot this
 * session read; a standard scan, falling back once to an expanded one while
 * nothing has loaded; a budget-limited scan never replaces a fuller one; up to
 * three empty scans in a row are ridden out; a forced refresh leaves a
 * receipt. A root a panel wants that the scan lacks gets one expanded scan
 * (the Worktrees panel's rule); the store then scans at that depth until the
 * last reader leaves.
 */

export const REPO_WATCH_REFRESH_MS = 10_000;
export const STANDARD_SCAN_TIMEOUT_MS = 15_000;
export const EXPANDED_SCAN_TIMEOUT_MS = 45_000;
export const INITIAL_FALLBACK_TIMEOUT_MS = 45_000;
const MAX_EMPTY_STREAK = 3;

export type RepoWatchPhase = "loading" | "ready" | "error";

export type RepoWatchState = {
  snapshot: RepoWatchSnapshot | null;
  phase: RepoWatchPhase;
  /** The last read's trouble; the snapshot (if any) is still the last good one. */
  error: string | null;
  depth: RepoWatchInteractiveScanDepth;
  /** A forced refresh is under way. */
  refreshing: boolean;
  /** A Scan more (expanded, forced) is under way. */
  scanMorePending: boolean;
  /** When the last forced refresh landed: the receipt. */
  refreshedAt: number | null;
  /** Roots an expanded scan is looking for. */
  looking: readonly string[];
  /** Roots an expanded scan looked for and did not find. */
  missing: readonly string[];
};

export type RepoWatchStoreDeps = {
  fetch: (depth: RepoWatchInteractiveScanDepth, force: boolean, timeoutMs: number) => Promise<RepoWatchSnapshot>;
  /** The last snapshot anything in this session read: the warm start. */
  peek: () => RepoWatchSnapshot | null;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  visible: () => boolean;
  /** Call back when the tab comes back to the foreground; returns the unsubscribe. */
  onVisible: (fn: () => void) => () => void;
};

export type RepoWatchStore = {
  getState: () => RepoWatchState;
  subscribe: (listener: () => void) => () => void;
  /** A reader arrives; the first starts the poll. Returns its leave. */
  mount: () => () => void;
  /** A panel wants this root in the scan; one expanded scan if it is missing. Returns its release. */
  want: (root: string) => () => void;
  /** Rescan now, forced, with a receipt; roots missing get another look. */
  refresh: () => Promise<void>;
  /** Scan wider (expanded, forced) and stay at that depth. */
  scanMore: () => Promise<void>;
  /** After a failed first read: back to loading, read again. */
  retry: () => Promise<void>;
};

const rootKey = (root: string): string => root.trim().replace(/\/+$/u, "").replace(/^\/Users\/[^/]+(?=\/|$)/u, "~");

/** Where a wanted root stands in the store: in the scan, being looked for, looked for and missing, or not asked. */
export function rootStatus(state: RepoWatchState, root: string | null | undefined): "found" | "looking" | "missing" | "unknown" {
  if (!root) return "unknown";
  if (projectForRoot(state.snapshot, root)) return "found";
  const key = rootKey(root);
  if (state.looking.includes(key)) return "looking";
  if (state.missing.includes(key)) return "missing";
  return "unknown";
}

export function createRepoWatchStore(deps: RepoWatchStoreDeps): RepoWatchStore {
  let state: RepoWatchState = {
    snapshot: null,
    phase: "loading",
    error: null,
    depth: "standard",
    refreshing: false,
    scanMorePending: false,
    refreshedAt: null,
    looking: [],
    missing: [],
  };
  const listeners = new Set<() => void>();
  let readers = 0;
  let timer: unknown = null;
  let offVisible: (() => void) | null = null;
  let inFlight = 0;
  let seq = 0;
  /** A result from a read started before this one is stale: a newer explicit read supersedes it. */
  let floor = 0;
  let hasData = false;
  let emptyStreak = 0;
  const wanted = new Map<string, number>();
  const attempted = new Set<string>();

  const set = (patch: Partial<RepoWatchState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const accept = (data: RepoWatchSnapshot) => {
    emptyStreak = 0;
    hasData = true;
    const missing = state.missing.filter((key) => !projectForRoot(data, key));
    set({ snapshot: data, error: null, phase: "ready", missing });
  };

  type LoadOptions = { depth?: RepoWatchInteractiveScanDepth; force?: boolean; scanMore?: boolean };

  const load = async (options: LoadOptions = {}): Promise<void> => {
    if (inFlight > 0 && !options.force) return;
    inFlight += 1;
    const id = ++seq;
    if (options.force) floor = id;
    const depth = options.depth ?? state.depth;
    if (options.scanMore) set({ scanMorePending: true });
    if (options.force && !options.scanMore) set({ refreshing: true });
    try {
      let data = await deps.fetch(
        depth,
        options.force ?? false,
        depth === "expanded" ? EXPANDED_SCAN_TIMEOUT_MS : STANDARD_SCAN_TIMEOUT_MS,
      );
      let acceptedDepth = depth;
      if (!hasData && depth === "standard" && !options.force && data.projects.length === 0) {
        try {
          const expanded = await deps.fetch("expanded", true, INITIAL_FALLBACK_TIMEOUT_MS);
          if (expanded.projects.length > 0) {
            data = expanded;
            acceptedDepth = "expanded";
          }
        } catch {
          // Fall through to the empty state's controls rather than an endless "Scanning".
        }
      }
      if (id < floor) return;
      const previous = state.snapshot;
      if (
        previous &&
        hasData &&
        isBudgetLimitedSnapshot(data) &&
        (data.projects.length === 0 || isSmallerSnapshot(data, previous))
      ) {
        set({ error: "Scan budget was reached; keeping the last fuller Repo Watch snapshot.", phase: "ready" });
        return;
      }
      // The broker's scan races a budget and sometimes comes back empty while
      // repos exist: ride out a few before believing they are gone.
      if (!options.force && data.projects.length === 0 && hasData && emptyStreak < MAX_EMPTY_STREAK) {
        emptyStreak += 1;
        set({ phase: "ready" });
        return;
      }
      accept(data);
      if (options.scanMore || acceptedDepth !== depth) set({ depth: acceptedDepth });
      if (options.force && !options.scanMore) set({ refreshedAt: deps.now() });
    } catch (error) {
      if (id < floor) return;
      set({ error: repoWatchErrorMessage(error), ...(hasData ? {} : { phase: "error" as const }) });
    } finally {
      inFlight -= 1;
      if (options.scanMore) set({ scanMorePending: false });
      if (options.force && !options.scanMore) set({ refreshing: false });
      void lookForWanted();
    }
  };

  /** One expanded scan for each wanted root the snapshot lacks and nothing has looked for yet. */
  const lookForWanted = async (): Promise<void> => {
    // Never beside another read: a read under way calls back here when it lands
    if (readers === 0 || inFlight > 0) return;
    const keys = [...wanted.keys()].filter((key) => !attempted.has(key) && !projectForRoot(state.snapshot, key));
    if (keys.length === 0) return;
    for (const key of keys) attempted.add(key);
    set({ looking: [...new Set([...state.looking, ...keys])] });
    inFlight += 1;
    const id = ++seq;
    // a forced read (Refresh, Scan more) started after this one owns the snapshot and the misses
    let stale = false;
    try {
      const expanded = await deps.fetch("expanded", false, EXPANDED_SCAN_TIMEOUT_MS);
      if (id < floor) {
        stale = true;
        return;
      }
      const found = keys.filter((key) => projectForRoot(expanded, key));
      if (found.length > 0 && expanded.projects.length > 0) {
        accept(expanded);
        set({ depth: "expanded" });
      }
      const lost = keys.filter((key) => !found.includes(key));
      set({ missing: [...new Set([...state.missing, ...lost])] });
    } catch (error) {
      if (id < floor) {
        stale = true;
        return;
      }
      set({ missing: [...new Set([...state.missing, ...keys])], error: repoWatchErrorMessage(error) });
    } finally {
      inFlight -= 1;
      set({ looking: state.looking.filter((key) => !keys.includes(key)) });
      if (stale) {
        // look again, against the newer snapshot, for what it still lacks
        for (const key of keys) attempted.delete(key);
        void lookForWanted();
      }
    }
  };

  const start = () => {
    if (!state.snapshot && !hasData) {
      const warm = deps.peek();
      if (warm) {
        hasData = true;
        set({ snapshot: warm, phase: "ready" });
      }
    }
    void load();
    timer = deps.setInterval(() => {
      if (deps.visible()) void load();
    }, REPO_WATCH_REFRESH_MS);
    offVisible = deps.onVisible(() => void load());
  };

  const stop = () => {
    if (timer !== null) deps.clearInterval(timer);
    timer = null;
    offVisible?.();
    offVisible = null;
    wanted.clear();
    attempted.clear();
    set({ depth: "standard", missing: [], looking: [] });
  };

  return {
    getState() {
      // Warm start on the very first paint: the last snapshot this session read
      if (!state.snapshot && !hasData) {
        const warm = deps.peek();
        if (warm) {
          hasData = true;
          state = { ...state, snapshot: warm, phase: "ready" };
        }
      }
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount() {
      readers += 1;
      if (readers === 1) start();
      let left = false;
      return () => {
        if (left) return;
        left = true;
        readers -= 1;
        if (readers === 0) stop();
      };
    },
    want(root) {
      const key = rootKey(root);
      if (!key) return () => {};
      wanted.set(key, (wanted.get(key) ?? 0) + 1);
      void lookForWanted();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const n = (wanted.get(key) ?? 1) - 1;
        if (n <= 0) wanted.delete(key);
        else wanted.set(key, n);
      };
    },
    async refresh() {
      attempted.clear();
      set({ missing: [] });
      await load({ force: true });
    },
    scanMore: () => load({ depth: "expanded", force: true, scanMore: true }),
    async retry() {
      set({ phase: "loading" });
      await load();
    },
  };
}

/*
 * The page's pick: the worktree the Repos list last selected, shared by every
 * panel that follows the page. It lives while anything reads it, so the
 * selection holds still across scans and between /repos and /repo-diff, and
 * clears when the last reader leaves (as the Repos screen's state did).
 */
export type PagePick = {
  get: () => string | null;
  set: (id: string | null) => void;
  subscribe: (listener: () => void) => () => void;
  /** A reader arrives; returns its leave. The last to leave clears the pick. */
  hold: () => () => void;
};

export function createPagePick(): PagePick {
  let value: string | null = null;
  let holders = 0;
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (next === value) return;
    value = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: () => value,
    set,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    hold() {
      holders += 1;
      let left = false;
      return () => {
        if (left) return;
        left = true;
        holders -= 1;
        if (holders === 0) set(null);
      };
    },
  };
}
