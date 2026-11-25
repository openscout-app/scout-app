import { useCallback, useMemo, useRef } from "react";
import { DISPATCH_WINDOWS } from "../../broker/dispatch-focus.ts";
import { useDispatchQuery } from "../../broker/use-dispatch-ledger.ts";
import {
  mergeScope,
  scopeConfig,
  scopeFromConfig,
  scopeFromRoute,
  scopeRoute,
  type DispatchRouteScope,
} from "../../broker/dispatch-scope.ts";
import type { ModuleProps, ModuleScope, ModuleScopeOption } from "./contract.ts";

/*
 * Where a Dispatch panel (Ledger, Routes, Health) keeps what it is narrowed
 * to. On /dispatch the URL wins: every Dispatch panel there reads one scope
 * from the route (outcome, focus, Between, window), so focusing a node in
 * Routes narrows the Ledger and the counts, and a change is a navigation
 * (Back undoes it, the link carries it). Anywhere else each panel keeps its
 * own scope in its settings and never moves the page.
 */
export type DispatchPanelScope = {
  /** Drawn on /dispatch itself. */
  own: boolean;
  scope: DispatchRouteScope;
  setScope: (patch: Partial<DispatchRouteScope>) => void;
  /** The search box: shared by every panel on /dispatch; this panel's own elsewhere. */
  query: string;
  setQuery: (query: string) => void;
};

export function useDispatchPanelScope({ route, navigate, config, setConfig }: ModuleProps): DispatchPanelScope {
  const own = route.view === "broker";
  const { filter = "", focus = "", between = "", window = "" } = config;
  const held = useMemo(() => scopeFromConfig({ filter, focus, between, window }), [between, filter, focus, window]);
  const fromRoute = useMemo(() => scopeFromRoute(route), [route]);
  const scope = own ? fromRoute : held;
  // the host hands a fresh setConfig each render: hold the latest, keep setScope still
  const latest = useRef({ navigate, setConfig, route });
  latest.current = { navigate, setConfig, route };
  const setScope = useCallback((patch: Partial<DispatchRouteScope>) => {
    const { navigate: go, setConfig: save, route: at } = latest.current;
    if (own) go(scopeRoute(mergeScope(fromRoute, patch), at.view === "broker" ? at.attemptId : undefined));
    else save(scopeConfig(mergeScope(held, patch)));
  }, [fromRoute, held, own]);
  const [query, setQuery] = useDispatchQuery(own);
  return { own, scope, setScope, query, setQuery };
}

const OUTCOME_OPTIONS: readonly ModuleScopeOption[] = [
  { value: "delivered", label: "Delivered" },
  { value: "failed", label: "Needs attention" },
];
const WINDOW_OPTIONS: readonly ModuleScopeOption[] = DISPATCH_WINDOWS
  .filter((entry) => entry.value !== "all")
  .map((entry) => ({ value: entry.value, label: entry.label }));

/*
 * The outcome and window a Dispatch panel off /dispatch can be scoped to, for
 * the head's Scope picker. Not the module's `scopes`: on /dispatch the URL
 * holds them, and a picker there would change nothing.
 */
export const DISPATCH_OUTCOME_SCOPE: ModuleScope = { key: "filter", allLabel: "All outcomes", useOptions: () => OUTCOME_OPTIONS };
export const DISPATCH_WINDOW_SCOPE: ModuleScope = { key: "window", allLabel: "All loaded", useOptions: () => WINDOW_OPTIONS };
