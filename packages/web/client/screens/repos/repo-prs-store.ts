import type { RepoPullRequestSnapshot } from "../../scout/repo-watch/api.ts";

/*
 * Open pull requests, one read per set of checkouts. The Repos list's OPEN
 * PRS stat and a Pull requests panel on the Repos view ask for the same paths,
 * so they share one gh read instead of two. Pure: fetch, the clock and the
 * timers are injected (repo-prs-store.test.ts).
 *
 * A set is read when its first reader arrives (unless a read under two
 * minutes old is held), again every two minutes while the tab is visible,
 * and at once on reload (Retry). The last read stays through a failed one.
 */

export const REPO_PRS_REFRESH_MS = 120_000;
/** The server reads at most 12 checkouts; a set is keyed by what it reads. */
const MAX_PATHS = 12;

export type RepoPrEntry = {
  data: RepoPullRequestSnapshot | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number;
};

const EMPTY: RepoPrEntry = { data: null, error: null, loading: false, fetchedAt: 0 };

export type RepoPrStoreDeps = {
  fetch: (paths: readonly string[]) => Promise<RepoPullRequestSnapshot>;
  now: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  visible: () => boolean;
};

export type RepoPrStore = {
  key: (paths: readonly string[]) => string;
  get: (key: string) => RepoPrEntry;
  subscribe: (listener: () => void) => () => void;
  /** A reader of this set arrives; returns its leave. */
  mount: (paths: readonly string[]) => () => void;
  reload: (paths: readonly string[]) => Promise<void>;
};

export function repoPrKey(paths: readonly string[]): string {
  return paths.slice(0, MAX_PATHS).join("\n");
}

export function createRepoPrStore(deps: RepoPrStoreDeps): RepoPrStore {
  const entries = new Map<string, RepoPrEntry>();
  const inFlight = new Map<string, Promise<void>>();
  const readers = new Map<string, { count: number; timer: unknown }>();
  const listeners = new Set<() => void>();

  const put = (key: string, patch: Partial<RepoPrEntry>) => {
    entries.set(key, { ...(entries.get(key) ?? EMPTY), ...patch });
    for (const listener of [...listeners]) listener();
  };

  const read = (paths: readonly string[]): Promise<void> => {
    const key = repoPrKey(paths);
    const running = inFlight.get(key);
    if (running) return running;
    put(key, { loading: true });
    const run = deps.fetch(paths.slice(0, MAX_PATHS)).then(
      (data) => put(key, { data, error: null, loading: false, fetchedAt: deps.now() }),
      (error: unknown) => put(key, { error: error instanceof Error ? error.message : String(error), loading: false }),
    ).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, run);
    return run;
  };

  return {
    key: repoPrKey,
    get: (key) => entries.get(key) ?? EMPTY,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount(paths) {
      const key = repoPrKey(paths);
      if (!key) return () => {};
      const current = readers.get(key);
      if (current) {
        current.count += 1;
      } else {
        const held = entries.get(key);
        if (!held?.data || deps.now() - held.fetchedAt >= REPO_PRS_REFRESH_MS) void read(paths);
        const timer = deps.setInterval(() => {
          if (deps.visible()) void read(paths);
        }, REPO_PRS_REFRESH_MS);
        readers.set(key, { count: 1, timer });
      }
      let left = false;
      return () => {
        if (left) return;
        left = true;
        const entry = readers.get(key);
        if (!entry) return;
        entry.count -= 1;
        if (entry.count > 0) return;
        deps.clearInterval(entry.timer);
        readers.delete(key);
      };
    },
    reload: (paths) => (repoPrKey(paths) ? read(paths) : Promise.resolve()),
  };
}
