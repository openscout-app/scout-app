/**
 * The briefings archive, read once for everything that draws it: the
 * Briefings page, every Briefings panel, a Briefing panel showing the latest
 * one, and the Briefing scope's picker. Pure — fetch, timers and the clock
 * come in — so the rules test without a DOM; the React side is
 * use-briefings.ts.
 *
 *   - Counted: the first reader starts a poll (every 60s while the page is
 *     visible); the last one stops it. The list itself is kept, so a reader
 *     that comes back paints at once.
 *   - A reader reads now unless the list is under 30s old; the first one
 *     starts from a warm read (the API cache) when there is one.
 *   - One request at a time: Refresh during a read waits for that read.
 *   - A read that fails keeps the last list and says why.
 */
import type { BriefingSummary } from "./briefings-model.ts";

export type BriefingListState = {
  items: BriefingSummary[] | null;
  error: string | null;
  /** A read is out: Refresh says so and waits. */
  reading: boolean;
  /** When the list last read cleanly (0 = never). */
  at: number;
};

export type BriefingListDeps = {
  fetch: () => Promise<BriefingSummary[]>;
  /** A recent cached read, for a warm start. */
  peek: () => BriefingSummary[] | null;
  now: () => number;
  every: (run: () => void, ms: number) => unknown;
  stop: (handle: unknown) => void;
  /** The page is in front: a hidden page is not polled. */
  visible: () => boolean;
};

export type BriefingListStore = {
  get: () => BriefingListState;
  subscribe: (listener: () => void) => () => void;
  /** Count a reader in; returns the release. */
  mount: () => () => void;
  /** Read now (Refresh), or join the read already out. */
  refresh: () => Promise<void>;
  readers: () => number;
};

export const BRIEFINGS_EVERY_MS = 60_000;
/** A reader arriving within this of the last clean read paints it and reads nothing. */
export const BRIEFINGS_FRESH_MS = 30_000;

export function createBriefingListStore(deps: BriefingListDeps): BriefingListStore {
  let state: BriefingListState = { items: null, error: null, reading: false, at: 0 };
  let readers = 0;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<BriefingListState>) => {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  };

  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    set({ reading: true });
    inFlight = deps
      .fetch()
      .then(
        (items) => set({ items, error: null, reading: false, at: deps.now() }),
        (error: unknown) => set({ error: error instanceof Error ? error.message : String(error), reading: false }),
      )
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const mount = () => {
    readers += 1;
    if (readers === 1) {
      if (state.items === null) {
        const warm = deps.peek();
        if (warm) set({ items: warm });
      }
      timer = deps.every(() => {
        if (deps.visible()) void refresh();
      }, BRIEFINGS_EVERY_MS);
    }
    if (deps.now() - state.at > BRIEFINGS_FRESH_MS) void refresh();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      readers -= 1;
      if (readers === 0 && timer !== null) {
        deps.stop(timer);
        timer = null;
      }
    };
  };

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount,
    refresh,
    readers: () => readers,
  };
}
