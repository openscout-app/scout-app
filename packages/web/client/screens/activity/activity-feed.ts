import type { ActivityItem } from "../../lib/types.ts";

/**
 * The one /api/activity loop, shared by the Activity page and every Activity
 * panel. Pure — fetch, the cache peek, clocks and timers come in — so the
 * rules test without a DOM; the React side is use-activity-feed.ts.
 *
 *   - Counted: the first reader starts it (warm from a read under 30s old,
 *     then a fresh read) and the poll; the last reader stops the poll and any
 *     pending refresh. What was read stays, so the next reader paints at once.
 *   - One request is current. A newer read supersedes an older one, and a
 *     superseded answer is dropped.
 *   - A read that fails keeps the last good list and says why. With nothing
 *     shown, a first read or a Retry says it is reading; anything else (a
 *     refresh, a broker event, the poll) refreshes quietly behind what shows.
 *   - Broker data events coalesce: a burst is one read per 250ms.
 *   - It reads again every 15s while the page is visible.
 */

export type ActivityFeedState = {
  /** null: nothing read yet. */
  items: ActivityItem[] | null;
  error: string | null;
  /** A first read with nothing to show yet. */
  loading: boolean;
  /** A read behind what already shows (Refresh, an event, the poll). */
  refreshing: boolean;
  /** When the list last came back. */
  loadedAt: number | null;
};

export type ActivityReadMode = "initial" | "background" | "manual";

export type ActivityFeedDeps = {
  fetch: () => Promise<ActivityItem[]>;
  /** A recent cached read, for a warm start. */
  peek: () => ActivityItem[] | null;
  now: () => number;
  /** The page is in front: the poll skips a tick while it is not. */
  visible: () => boolean;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export type ActivityFeed = {
  /** Stable until it changes, so React can read it as a snapshot. */
  get: () => ActivityFeedState;
  subscribe: (listener: () => void) => () => void;
  /** Count a reader in; returns the release (calling it twice releases once). */
  mount: () => () => void;
  load: (mode?: ActivityReadMode) => Promise<void>;
  /** Coalesce a burst of broker data events into one background read. */
  scheduleRefresh: () => void;
  /** Readers counted in, for tests and diagnostics. */
  readers: () => number;
};

export const ACTIVITY_PATH = "/api/activity";
export const ACTIVITY_REFRESH_COALESCE_MS = 250;
export const ACTIVITY_POLL_MS = 15_000;
/** A remount paints the last read for this long while it refreshes. */
export const ACTIVITY_WARM_MS = 30_000;

const INITIAL: ActivityFeedState = Object.freeze({ items: null, error: null, loading: true, refreshing: false, loadedAt: null });

export function createActivityFeed(deps: ActivityFeedDeps): ActivityFeed {
  let state: ActivityFeedState = INITIAL;
  let readers = 0;
  let request = 0;
  let refreshTimer: unknown = null;
  let pollTimer: unknown = null;
  /** The cache was looked at in this idle spell: look once, so the snapshot holds still. */
  let warmed = false;
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  const set = (patch: Partial<ActivityFeedState>) => {
    state = { ...state, ...patch };
    emit();
  };

  /** Nothing read yet: paint the last cached read, once. */
  const warm = () => {
    if (warmed || state.items) return;
    warmed = true;
    const cached = deps.peek();
    if (cached) state = { ...state, items: cached, loading: false };
  };

  const get = () => {
    warm();
    return state;
  };

  const load = async (mode: ActivityReadMode = "initial") => {
    const id = ++request;
    warm();
    if (!state.items && mode !== "background") set({ loading: true, error: null });
    else set({ refreshing: true });
    try {
      const items = await deps.fetch();
      if (id !== request) return;
      set({ items, error: null, loadedAt: deps.now(), loading: false, refreshing: false });
    } catch (error) {
      if (id !== request) return;
      set({ error: error instanceof Error ? error.message : String(error), loading: false, refreshing: false });
    }
  };

  const poll = () => {
    pollTimer = deps.setTimer(() => {
      if (readers === 0) return;
      if (deps.visible()) void load("background");
      poll();
    }, ACTIVITY_POLL_MS);
  };

  const stop = () => {
    if (refreshTimer !== null) deps.clearTimer(refreshTimer);
    if (pollTimer !== null) deps.clearTimer(pollTimer);
    refreshTimer = null;
    pollTimer = null;
    // an answer still on its way is for nobody now
    request++;
    if (state.loading || state.refreshing) state = { ...state, loading: !state.items && !state.error, refreshing: false };
    warmed = false;
  };

  const mount = () => {
    readers++;
    if (readers === 1) {
      void load("initial");
      poll();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      readers--;
      if (readers === 0) stop();
    };
  };

  const scheduleRefresh = () => {
    if (refreshTimer !== null || readers === 0) return;
    refreshTimer = deps.setTimer(() => {
      refreshTimer = null;
      void load("background");
    }, ACTIVITY_REFRESH_COALESCE_MS);
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, subscribe, mount, load, scheduleRefresh, readers: () => readers };
}
