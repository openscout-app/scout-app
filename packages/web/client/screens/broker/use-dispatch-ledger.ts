import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, peekApiGet } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import type { BrokerDiagnostics, BrokerRouteAttempt } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { brokerMessageFeedRows } from "./broker-display.ts";
import { brokerDiagnosticsUrl } from "./broker-query.ts";
import { createDispatchLedger, isDispatchLedgerEvent, type DispatchLedger, type DispatchLedgerState } from "./dispatch-ledger.ts";
import { applyDispatchScope, dispatchNodeCatalog, dispatchRowModel, type DispatchNode, type DispatchRowModel, type DispatchScopeResult } from "./dispatch-focus.ts";
import { toDispatchScope, type DispatchRouteScope } from "./dispatch-scope.ts";

/*
 * The React side of the dispatch ledger (dispatch-ledger.ts): one store per
 * page, so the Dispatch screen and every Dispatch panel on a view share one
 * read of /api/broker, one refresh per burst of broker events, and the same
 * Load older pages.
 */

/** A remount paints the last page for this long while it refreshes. */
const ROUTE_CACHE_MAX_AGE_MS = 30_000;

let ledger: DispatchLedger | null = null;

function dispatchLedger(): DispatchLedger {
  ledger ??= createDispatchLedger({
    fetch: (cursor) => api<BrokerDiagnostics>(brokerDiagnosticsUrl(cursor)),
    peek: () => peekApiGet<BrokerDiagnostics>(brokerDiagnosticsUrl(), ROUTE_CACHE_MAX_AGE_MS),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return ledger;
}

export type DispatchLedgerHandle = DispatchLedgerState & {
  load: DispatchLedger["load"];
  loadOlder: DispatchLedger["loadOlder"];
};

/** The shared ledger, read while mounted; refreshed on broker traffic. */
export function useDispatchLedger(): DispatchLedgerHandle {
  const store = dispatchLedger();
  // Before it mounts, a reader draws the page a first mount starts from (the
  // cached page if recent), so nothing stale paints; subscribed first, so the
  // mount's own read is seen.
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => store.mount(), [store]);
  useBrokerEvents((event) => {
    if (isDispatchLedgerEvent(event.kind)) store.scheduleRefresh();
  });
  return { ...state, load: store.load, loadOlder: store.loadOlder };
}

/**
 * The feed as the ledger lists it: one row per message, its body from the
 * dialogue, read as dispatch rows with sender and destination nodes.
 */
export function useDispatchRows(broker: BrokerDiagnostics | null): {
  feedRows: BrokerRouteAttempt[];
  rowModels: DispatchRowModel[];
  nodeCatalog: Map<string, DispatchNode>;
} {
  const { agents, operatorName } = useScout();
  const feedRows = useMemo(() => {
    if (!broker) return [];
    const messageBodies = new Map(broker.dialogue.map((message) => [message.id, message.body]));
    return brokerMessageFeedRows(broker.attempts).map((attempt) => {
      const body = attempt.messageId ? messageBodies.get(attempt.messageId) : null;
      return body && body !== attempt.detail ? { ...attempt, detail: body } : attempt;
    });
  }, [broker]);
  const rowModels = useMemo(
    () => feedRows.map((attempt) => dispatchRowModel(attempt, agents, operatorName)),
    [agents, feedRows, operatorName],
  );
  const nodeCatalog = useMemo(() => dispatchNodeCatalog(rowModels, agents), [agents, rowModels]);
  return { feedRows, rowModels, nodeCatalog };
}

/** Now, re-read each minute, so "Last hour" stays honest on a page left open. */
export function useMinuteClock(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return nowMs;
}

/** Everything a Dispatch panel draws from: the ledger, its rows, and the rows a scope matches. */
export function useDispatchLedgerView(scope: DispatchRouteScope, query: string): DispatchLedgerHandle & {
  rowModels: DispatchRowModel[];
  nodeCatalog: Map<string, DispatchNode>;
  result: DispatchScopeResult;
} {
  const handle = useDispatchLedger();
  const { rowModels, nodeCatalog } = useDispatchRows(handle.broker);
  const nowMs = useMinuteClock();
  const result = useMemo(
    () => applyDispatchScope(rowModels, toDispatchScope(scope, query), nowMs),
    [nowMs, query, rowModels, scope],
  );
  return { ...handle, rowModels, nodeCatalog, result };
}

// ── The page's search ───────────────────────────────────────────────────────

/*
 * On /dispatch the search box narrows every panel, as it narrowed the whole
 * screen: the ledger, the routes and the counts read one matching set. It is
 * not in the URL (it never was), so it lives here while a panel on the page
 * reads it, and clears when the last one goes.
 */
let pageQuery = "";
let pageQueryReaders = 0;
const pageQueryListeners = new Set<() => void>();

function setPageQuery(next: string) {
  if (next === pageQuery) return;
  pageQuery = next;
  for (const listener of [...pageQueryListeners]) listener();
}

function subscribePageQuery(listener: () => void) {
  pageQueryListeners.add(listener);
  return () => {
    pageQueryListeners.delete(listener);
  };
}

const readPageQuery = () => pageQuery;

/**
 * The search box. `shared` on /dispatch (one query for every panel there);
 * anywhere else the panel keeps its own, for this visit only.
 */
export function useDispatchQuery(shared: boolean): [string, (query: string) => void] {
  const [own, setOwn] = useState("");
  const page = useSyncExternalStore(subscribePageQuery, readPageQuery, readPageQuery);
  useEffect(() => {
    if (!shared) return;
    pageQueryReaders += 1;
    return () => {
      pageQueryReaders -= 1;
      if (pageQueryReaders === 0) setPageQuery("");
    };
  }, [shared]);
  const set = useCallback((query: string) => (shared ? setPageQuery(query) : setOwn(query)), [shared]);
  return [shared ? page : own, set];
}
