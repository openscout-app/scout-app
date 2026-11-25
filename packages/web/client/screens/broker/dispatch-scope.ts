import type { DispatchFilter, DispatchWindow, Route } from "../../lib/types.ts";
import { parseDispatchWindow, type DispatchScope } from "./dispatch-focus.ts";

/**
 * What a Dispatch view is narrowed to: outcome, focus, Between, window. The
 * same four live in two places. On /dispatch they are the URL, so a view can
 * be linked and every panel on the page reads one scope. A Ledger, Routes or
 * Health panel on any other view keeps its own in the panel's settings. The
 * search box is neither: it is for this visit only.
 */
export type DispatchRouteScope = {
  filter: DispatchFilter;
  focus: string[];
  /** Only with two or more focused. */
  between: boolean;
  window: DispatchWindow;
};

export type DispatchBrokerRoute = Extract<Route, { view: "broker" }>;

export const EMPTY_DISPATCH_SCOPE: DispatchRouteScope = { filter: "all", focus: [], between: false, window: "all" };

const FILTERS: readonly DispatchFilter[] = ["all", "delivered", "failed"];

function parseFilter(value: string | null | undefined): DispatchFilter {
  return FILTERS.includes(value as DispatchFilter) ? (value as DispatchFilter) : "all";
}

function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
}

/** Drop what cannot stand: repeated or blank keys, Between with fewer than two. */
function settle(scope: DispatchRouteScope): DispatchRouteScope {
  const focus = uniqueKeys(scope.focus);
  return { ...scope, focus, between: scope.between && focus.length >= 2 };
}

export function scopeFromRoute(route: Route): DispatchRouteScope {
  if (route.view !== "broker") return EMPTY_DISPATCH_SCOPE;
  return settle({
    filter: route.filter ?? "all",
    focus: route.focus ?? [],
    between: Boolean(route.between),
    window: route.window ?? "all",
  });
}

/** The canonical /dispatch route for a scope: defaults left out, as the router writes them. */
export function scopeRoute(scope: DispatchRouteScope, attemptId?: string | null): DispatchBrokerRoute {
  const settled = settle(scope);
  return {
    view: "broker",
    ...(attemptId ? { attemptId } : {}),
    ...(settled.filter !== "all" ? { filter: settled.filter } : {}),
    ...(settled.focus.length > 0 ? { focus: settled.focus } : {}),
    ...(settled.between ? { between: true } : {}),
    ...(settled.window !== "all" ? { window: settled.window } : {}),
  };
}

export function mergeScope(current: DispatchRouteScope, patch: Partial<DispatchRouteScope>): DispatchRouteScope {
  return settle({ ...current, ...patch });
}

/** Settings keys a panel keeps its scope under. */
export const DISPATCH_SCOPE_KEYS = ["filter", "focus", "between", "window"] as const;

export function scopeFromConfig(config: Readonly<Record<string, string>>): DispatchRouteScope {
  let focus: string[] = [];
  try {
    const parsed: unknown = config.focus ? JSON.parse(config.focus) : [];
    if (Array.isArray(parsed)) focus = parsed.filter((key): key is string => typeof key === "string");
  } catch {
    // a hand-edited or old setting: no focus rather than a broken panel
  }
  return settle({
    filter: parseFilter(config.filter),
    focus,
    between: config.between === "1",
    window: parseDispatchWindow(config.window) ?? "all",
  });
}

/** Every scope key, so a merge clears what is back at its default ("" clears a key). */
export function scopeConfig(scope: DispatchRouteScope): Record<(typeof DISPATCH_SCOPE_KEYS)[number], string> {
  const settled = settle(scope);
  return {
    filter: settled.filter === "all" ? "" : settled.filter,
    focus: settled.focus.length > 0 ? JSON.stringify(settled.focus) : "",
    between: settled.between ? "1" : "",
    window: settled.window === "all" ? "" : settled.window,
  };
}

/** The scope plus the search box, as applyDispatchScope reads it. */
export function toDispatchScope(scope: DispatchRouteScope, query: string): DispatchScope {
  return { nodes: scope.focus, between: scope.between, window: scope.window, query, outcome: scope.filter };
}

/** Narrowed by anything at all: focus, window, outcome or search. */
export function scopeIsActive(scope: DispatchRouteScope, query = ""): boolean {
  return scope.focus.length > 0 || scope.window !== "all" || scope.filter !== "all" || query.trim().length > 0;
}

/** "All routes", "Involving Opus, Codex", "Between Opus and Codex". */
export function dispatchScopeTitle(scope: DispatchRouteScope, labelOf: (key: string) => string): string {
  if (scope.focus.length === 0) return "All routes";
  const names = scope.focus.map(labelOf);
  return scope.between ? `Between ${names.join(" and ")}` : `Involving ${names.join(", ")}`;
}
