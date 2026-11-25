import type { BrokerDiagnostics, BrokerHistoryKey } from "../../lib/types.ts";

/**
 * The dispatch ledger: one read of /api/broker shared by everything that
 * draws dispatches (the Dispatch screen, and the Ledger, Routes and Health
 * panels of the Dispatch view). Pure — fetch and timers come in — so the
 * paging, coalescing and race rules test without a DOM; the React side is
 * use-dispatch-ledger.ts.
 *
 *   - One page at a time is current. A newer request supersedes an older
 *     one, whatever kind either is; a superseded answer is dropped.
 *   - Broker events coalesce: a burst asks for one background read per 250ms.
 *   - Load older appends a page. A refresh keeps the older pages under the
 *     new first page when the two overlap, so Load older survives traffic.
 *   - The first mount after none starts the way the screen always did: warm
 *     from the API cache (30s), then a fresh read. The last unmount drops the
 *     timer and keeps nothing alive.
 */

export type DispatchLedgerState = {
  broker: BrokerDiagnostics | null;
  /** No page yet and one is on its way. */
  loading: boolean;
  /** A page is shown and a newer one is on its way. */
  refreshing: boolean;
  loadingOlder: boolean;
  error: string | null;
};

export type DispatchLoadMode = "initial" | "background" | "manual";

export type DispatchLedgerDeps = {
  /** One page of /api/broker, from `cursor` back, or the newest page. */
  fetch: (cursor?: string) => Promise<BrokerDiagnostics>;
  /** The newest page if a recent read is cached, for a warm start. */
  peek: () => BrokerDiagnostics | null;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

export type DispatchLedger = {
  getState: () => DispatchLedgerState;
  subscribe: (listener: () => void) => () => void;
  /** Count a reader in; returns the release. */
  mount: () => () => void;
  load: (mode?: DispatchLoadMode) => Promise<void>;
  loadOlder: () => Promise<void>;
  /** Coalesce a burst of broker events into one background read. */
  scheduleRefresh: () => void;
};

export const DISPATCH_REFRESH_COALESCE_MS = 250;

/** The broker events that change what the ledger shows. */
const LEDGER_EVENT_KINDS = new Set([
  "message.posted",
  "delivery.planned",
  "delivery.attempted",
  "delivery.state.changed",
  "scout.dispatched",
]);

export function isDispatchLedgerEvent(kind: string): boolean {
  return LEDGER_EVENT_KINDS.has(kind);
}

/** Append an older page of one history to what is loaded. */
export function mergeBrokerPage(
  current: BrokerDiagnostics,
  next: BrokerDiagnostics,
  key: BrokerHistoryKey,
): BrokerDiagnostics {
  return {
    ...next,
    source: current.source,
    attempts: key === "attempts" ? [...current.attempts, ...next.attempts] : current.attempts,
    failedQueries: key === "failedQueries" ? [...current.failedQueries, ...next.failedQueries] : current.failedQueries,
    failedDeliveries: key === "failedDeliveries" ? [...current.failedDeliveries, ...next.failedDeliveries] : current.failedDeliveries,
    dialogue: key === "dialogue" ? [...current.dialogue, ...next.dialogue] : current.dialogue,
    ledger: {
      ...next.ledger,
      cursors: {
        ...current.ledger.cursors,
        [key]: next.ledger.cursors[key],
      },
      hasMore: {
        ...current.ledger.hasMore,
        [key]: next.ledger.hasMore[key],
      },
    },
  };
}

/**
 * A fresh newest page, with the older dispatches already paged in kept under
 * it. Only when the new page overlaps what is loaded: a page with nothing in
 * common means more arrived than a page holds, and keeping the old rows
 * would leave a silent gap, so the new page stands alone.
 */
export function refreshBrokerPage(
  current: BrokerDiagnostics | null,
  next: BrokerDiagnostics,
  pagedOlder: boolean,
): BrokerDiagnostics {
  if (!current || !pagedOlder || next.attempts.length === 0) return next;
  const loaded = new Set(current.attempts.map((attempt) => attempt.id));
  if (!next.attempts.some((attempt) => loaded.has(attempt.id))) return next;
  const fresh = new Set(next.attempts.map((attempt) => attempt.id));
  const oldest = Math.min(...next.attempts.map((attempt) => attempt.ts));
  const older = current.attempts.filter((attempt) => !fresh.has(attempt.id) && attempt.ts <= oldest);
  if (older.length === 0) return next;
  return {
    ...next,
    attempts: [...next.attempts, ...older],
    ledger: {
      ...next.ledger,
      cursors: { ...next.ledger.cursors, attempts: current.ledger.cursors.attempts },
      hasMore: { ...next.ledger.hasMore, attempts: current.ledger.hasMore.attempts },
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createDispatchLedger(deps: DispatchLedgerDeps): DispatchLedger {
  /** A fresh start: the cached page if it is recent, else nothing yet. */
  const fresh = (): DispatchLedgerState => {
    const warm = deps.peek();
    return { broker: warm, loading: warm === null, refreshing: false, loadingOlder: false, error: null };
  };
  let state: DispatchLedgerState | null = null;
  /** What a reader sees before it mounts: computed once per idle spell, so it holds still. */
  let idle: DispatchLedgerState | null = null;
  const listeners = new Set<() => void>();
  let requestId = 0;
  let readers = 0;
  let timer: unknown = null;
  /** Older pages are loaded under the first one. */
  let pagedOlder = false;

  const current = (): DispatchLedgerState => (readers > 0 && state ? state : (idle ??= fresh()));

  const set = (patch: Partial<DispatchLedgerState>) => {
    state = { ...current(), ...patch };
    for (const listener of [...listeners]) listener();
  };

  /** Whoever is current when its answer lands clears every in-flight flag: a superseded request never will. */
  const settle = (id: number) => {
    if (id === requestId) set({ loading: false, refreshing: false, loadingOlder: false });
  };

  const load = async (mode: DispatchLoadMode = "initial") => {
    const id = ++requestId;
    if (!current().broker && mode !== "background") set({ loading: true, error: null });
    else set({ refreshing: true });
    try {
      const next = await deps.fetch();
      if (id !== requestId) return;
      const broker = refreshBrokerPage(current().broker, next, pagedOlder);
      pagedOlder = broker !== next;
      set({ broker, error: null });
    } catch (error) {
      if (id !== requestId) return;
      set({ error: errorText(error) });
    } finally {
      settle(id);
    }
  };

  const loadOlder = async () => {
    const { broker: loaded, loadingOlder } = current();
    if (!loaded || loadingOlder) return;
    const cursor = loaded.ledger.cursors.attempts;
    if (!cursor || !loaded.ledger.hasMore.attempts) return;
    const id = ++requestId;
    set({ loadingOlder: true, error: null });
    try {
      const next = await deps.fetch(cursor);
      if (id !== requestId) return;
      const latest = current().broker;
      pagedOlder = true;
      set({ broker: latest ? mergeBrokerPage(latest, next, "attempts") : next });
    } catch (error) {
      if (id !== requestId) return;
      set({ error: errorText(error) });
    } finally {
      settle(id);
    }
  };

  const scheduleRefresh = () => {
    if (timer !== null || readers === 0) return;
    timer = deps.setTimer(() => {
      timer = null;
      void load("background");
    }, DISPATCH_REFRESH_COALESCE_MS);
  };

  const mount = () => {
    readers += 1;
    if (readers === 1) {
      // A fresh start, as each mount of the screen used to be: anything still
      // in flight from before is superseded, and only a recent read paints —
      // the same page the reader already drew before it mounted.
      requestId += 1;
      pagedOlder = false;
      state = idle ?? fresh();
      idle = null;
      void load("initial");
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      readers -= 1;
      if (readers > 0) return;
      if (timer !== null) deps.clearTimer(timer);
      timer = null;
      // nobody is left to draw an answer still on its way
      requestId += 1;
      state = null;
      idle = null;
    };
  };

  return {
    getState: current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount,
    load,
    loadOlder,
    scheduleRefresh,
  };
}
