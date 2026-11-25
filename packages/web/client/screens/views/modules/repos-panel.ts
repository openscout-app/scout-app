import type { Route } from "../../../lib/types.ts";
import { pageRepoTarget, type RepoTarget } from "../../repos/repos-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * The Repos view's rules, pure so they test without a DOM. The modules (the
 * Repos list, Worktree, Diff, and Worktrees / Pull requests when they follow
 * the page) read the page through these.
 *
 * The view is drawn on the Repos routes themselves, so the URL holds the
 * selection: /repos?root=<checkout> (with ?machineId=) selects a worktree,
 * /repo-diff?path=<checkout>&layer=&file=&sessionId=&agentId=&include= opens
 * one diff. A panel elsewhere keeps its choice in config.
 */

export type ReposRoute = Extract<Route, { view: "repos" | "repo-diff" }>;

/** The Repos view's own routes: the list and one diff. */
export function isReposRoute(route: Route): route is ReposRoute {
  return route.view === "repos" || route.view === "repo-diff";
}

/**
 * A panel's target from its root setting: "This page's checkout" (@route)
 * follows the page (the URL on the Repos routes, the list's pick elsewhere);
 * a path pins one checkout; "" shows the busiest checkout on the machine.
 */
export function panelRepoTarget(route: Route, value: string | undefined): RepoTarget {
  if (value === FOLLOW_PAGE) return pageRepoTarget(route);
  return { root: value?.trim() || null, mode: "exact", leads: false, writes: false };
}

/**
 * The Repos list's target. On the Repos routes, the URL. Elsewhere its own
 * setting (the checkout it last selected), and it leads the page's pick, so
 * panels following the page there show what it selects.
 */
export function listRepoTarget(route: Route, configRoot: string | undefined): RepoTarget {
  if (isReposRoute(route)) return pageRepoTarget(route);
  return { root: configRoot?.trim() || null, mode: "page", leads: true, writes: true };
}

/**
 * Where selecting a worktree goes. On /repos the URL's root, replaced (a
 * selection on its own route, like a toggle), keeping ?machineId=. From
 * /repo-diff back to /repos with that checkout, as a new entry so Back
 * returns to the diff. Elsewhere nowhere: the list keeps it in config.
 */
export function selectRoute(route: Route, path: string): { to: Route; replace: boolean } | null {
  if (route.view === "repos") {
    return { to: { view: "repos", root: path, ...(route.machineId ? { machineId: route.machineId } : {}) }, replace: true };
  }
  if (route.view === "repo-diff") return { to: { view: "repos", root: path }, replace: false };
  return null;
}

/** A worktree's diff: /repo-diff?path=, the same view with the diff following the URL. */
export function diffRoute(path: string): Route {
  return { view: "repo-diff", path };
}

/** Close on /repo-diff: back to /repos with that checkout selected. */
export function closeDiffRoute(path: string): Route {
  return { view: "repos", root: path };
}

/** Whether the Diff panel draws the URL's diff (on /repo-diff, following the page) or a worktree's. */
export function diffFollowsRoute(route: Route, value: string | undefined): route is Extract<Route, { view: "repo-diff" }> {
  return value === FOLLOW_PAGE && route.view === "repo-diff";
}
