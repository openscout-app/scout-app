import { useEffect, useSyncExternalStore } from "react";
import { api, peekApiGet } from "../../lib/api.ts";
import { createBudgetsLoop, type BudgetsLoop, type BudgetsState, type ServiceBudgets } from "./service-budgets-loop.ts";

/*
 * The React side of the Providers loop (service-budgets-loop.ts): one read of
 * /api/service-budgets per page, however many plan and provider panels are
 * drawn, so Plans & quotas no longer polls on its own.
 */

/** A remount paints the last reading for this long while it refreshes. */
const ROUTE_CACHE_MAX_AGE_MS = 30_000;

let loop: BudgetsLoop | null = null;

function budgetsLoop(): BudgetsLoop {
  loop ??= createBudgetsLoop({
    fetch: (force) => api<ServiceBudgets>(`/api/service-budgets${force ? "?refresh=1" : ""}`),
    peek: () => peekApiGet<ServiceBudgets>("/api/service-budgets", ROUTE_CACHE_MAX_AGE_MS),
    now: () => Date.now(),
    visible: () => typeof document === "undefined" || document.visibilityState === "visible",
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (run, ms) => setInterval(run, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  });
  return loop;
}

export type ServiceBudgetsHandle = BudgetsState & { load: BudgetsLoop["load"] };

/**
 * The shared plans reading, kept while mounted. `fresh` (the Providers screen
 * and its panels) also asks the server to read every provider again once,
 * 600ms after the first read, the way the Providers page always did.
 */
export function useServiceBudgets(options: { fresh?: boolean } = {}): ServiceBudgetsHandle {
  const store = budgetsLoop();
  const fresh = options.fresh === true;
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => store.mount({ fresh }), [store, fresh]);
  return { ...state, load: store.load };
}
