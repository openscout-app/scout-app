/**
 * Work reads shared by everything that draws a work item: the Work page and
 * every Work panel on a view. One store per kind of read (a work item's
 * detail by id, the work list by path), so five panels on one item make one
 * request, refresh once per burst of broker events, and agree on what they
 * show. Pure — fetch and timers come in — so the rules test without a DOM;
 * the React side is use-work-detail.ts.
 *
 *   - Keyed and counted: the first reader of a key starts it warm from the
 *     API cache (30s) and reads it fresh; the last reader leaves and the
 *     entry is dropped, with nothing kept alive.
 *   - One request per key is current. A newer one supersedes an older one;
 *     a superseded answer is dropped.
 *   - A refresh that fails keeps the last good value and says why. A 404
 *     (the item is gone) or a failure with nothing shown yet leaves no value.
 *   - Broker events coalesce: a burst asks for one background read of every
 *     mounted key per 250ms.
 */

export type WorkEntry<T> = {
  value: T | null;
  error: string | null;
  /** A read has settled (or a warm value was found): draw the value or say it is missing. */
  loaded: boolean;
};

export type WorkStoreDeps<T> = {
  fetch: (key: string) => Promise<T>;
  /** A recent cached read of this key, for a warm start. */
  peek: (key: string) => T | null;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export type WorkStore<T> = {
  /** The entry for a key: stable until it changes, so React can read it as a snapshot. */
  get: (key: string) => WorkEntry<T>;
  subscribe: (listener: () => void) => () => void;
  /** Count a reader of `key` in; returns the release. An empty key is never read. */
  mount: (key: string) => () => void;
  load: (key: string) => Promise<void>;
  /** Read one mounted key again, unless its read is still out (then once after it lands). */
  refresh: (key: string) => void;
  /** Coalesce a burst of broker events into one background read of every mounted key. */
  scheduleRefresh: () => void;
  /** Keys with readers, for tests and diagnostics. */
  mounted: () => string[];
};

export const WORK_REFRESH_COALESCE_MS = 250;

const EMPTY: WorkEntry<never> = Object.freeze({ value: null, error: null, loaded: true });

/** What an answer that failed says, and whether it means the key is gone. */
function failure(error: unknown): { text: string; gone: boolean } {
  const text = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: unknown } | null)?.status;
  return { text, gone: status === 404 };
}

export function createWorkStore<T>(deps: WorkStoreDeps<T>): WorkStore<T> {
  const entries = new Map<string, WorkEntry<T>>();
  /** What a reader sees before it mounts, computed once per idle spell so it holds still. */
  const idle = new Map<string, WorkEntry<T>>();
  const readers = new Map<string, number>();
  const requests = new Map<string, number>();
  /** Keys with a read on its way, and those a refresh asked for meanwhile. */
  const busy = new Set<string>();
  const stale = new Set<string>();
  const listeners = new Set<() => void>();
  let timer: unknown = null;

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };

  const fresh = (key: string): WorkEntry<T> => {
    const warm = deps.peek(key);
    return { value: warm, error: null, loaded: warm !== null };
  };

  const get = (key: string): WorkEntry<T> => {
    if (!key) return EMPTY;
    const live = entries.get(key);
    if (live) return live;
    let waiting = idle.get(key);
    if (!waiting) {
      // a render that never mounts leaves its idle entry behind; keep that bounded
      if (idle.size > 64) idle.clear();
      waiting = fresh(key);
      idle.set(key, waiting);
    }
    return waiting;
  };

  const set = (key: string, patch: Partial<WorkEntry<T>>) => {
    const current = entries.get(key);
    if (!current) return;
    entries.set(key, { ...current, ...patch });
    emit();
  };

  const load = async (key: string) => {
    if (!key || !entries.has(key)) return;
    const id = (requests.get(key) ?? 0) + 1;
    requests.set(key, id);
    busy.add(key);
    try {
      const value = await deps.fetch(key);
      if (requests.get(key) !== id) return;
      set(key, { value, error: null, loaded: true });
    } catch (error) {
      if (requests.get(key) !== id) return;
      const { text, gone } = failure(error);
      const shown = entries.get(key)?.value ?? null;
      set(key, { value: gone ? null : shown, error: text, loaded: true });
    } finally {
      if (requests.get(key) === id) {
        busy.delete(key);
        // events that came while this read was out get one read after it
        if (stale.delete(key) && entries.has(key)) void load(key);
      }
    }
  };

  const mount = (key: string) => {
    if (!key) return () => {};
    const count = readers.get(key) ?? 0;
    readers.set(key, count + 1);
    if (count === 0) {
      entries.set(key, get(key));
      idle.delete(key);
      void load(key);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (readers.get(key) ?? 1) - 1;
      if (left > 0) {
        readers.set(key, left);
        return;
      }
      readers.delete(key);
      entries.delete(key);
      // an answer still on its way is for nobody now
      requests.set(key, (requests.get(key) ?? 0) + 1);
      busy.delete(key);
      stale.delete(key);
      if (readers.size === 0 && timer !== null) {
        deps.clearTimer(timer);
        timer = null;
      }
    };
  };

  const refresh = (key: string) => {
    if (!entries.has(key)) return;
    if (busy.has(key)) stale.add(key);
    else void load(key);
  };

  const scheduleRefresh = () => {
    if (timer !== null || readers.size === 0) return;
    timer = deps.setTimer(() => {
      timer = null;
      // a read still out is not restarted: it would drop the answer on its
      // way, and a steady stream of events would starve the item for good
      for (const key of [...readers.keys()]) refresh(key);
    }, WORK_REFRESH_COALESCE_MS);
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, subscribe, mount, load, refresh, scheduleRefresh, mounted: () => [...readers.keys()] };
}

/**
 * Which file is picked, per work item, shared by the panels that show it: a
 * Made link in the Work item panel picks the file the Files panel previews.
 * The Files panels count themselves in, so the Work item panel knows whether
 * a pick will show anywhere (if not, it opens the file itself).
 */
export type WorkMaterialPicks = {
  picked: (workId: string) => string | null;
  pick: (workId: string, materialId: string | null) => void;
  /** Count a Files panel for this work item in; returns the release. */
  showFiles: (workId: string) => () => void;
  filesShown: (workId: string) => boolean;
  subscribe: (listener: () => void) => () => void;
};

export function createWorkMaterialPicks(): WorkMaterialPicks {
  const picks = new Map<string, string>();
  const files = new Map<string, number>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    picked: (workId) => picks.get(workId) ?? null,
    pick: (workId, materialId) => {
      if ((picks.get(workId) ?? null) === materialId) return;
      if (materialId) picks.set(workId, materialId);
      else picks.delete(workId);
      emit();
    },
    showFiles: (workId) => {
      files.set(workId, (files.get(workId) ?? 0) + 1);
      emit();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (files.get(workId) ?? 1) - 1;
        if (left > 0) files.set(workId, left);
        else {
          files.delete(workId);
          picks.delete(workId);
        }
        emit();
      };
    },
    filesShown: (workId) => (files.get(workId) ?? 0) > 0,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
