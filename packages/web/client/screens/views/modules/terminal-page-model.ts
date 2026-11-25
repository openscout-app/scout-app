import type { Route } from "../../../lib/types.ts";
import type { ModuleConfig, ModuleScope, ModuleScopeOption } from "./contract.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { targetIdentity, targetKind, targetRoute, type TerminalMode, type TerminalRoute } from "./terminal-target-model.ts";

/*
 * The terminal a page names, and how it is open. The Terminal view draws on
 * every terminal deep link (/terminal/<agent>, a session, a herdr layout, a
 * fresh host terminal); its panels follow that terminal ("This page's
 * terminal") or keep their own pick (terminal-target-model.ts). Pure, so it
 * tests without a DOM.
 */

/** The scope key Terminal session and Terminal details follow the page with. */
export const TERMINAL_SCOPE_KEY = "terminal";

const NO_OPTIONS: readonly ModuleScopeOption[] = [];

/**
 * Their one scope: follow the page's terminal, or (unset) keep the panel's
 * own pick, which the panel's own picker chooses, not this one.
 */
export const TERMINAL_SCOPE: ModuleScope = {
  key: TERMINAL_SCOPE_KEY,
  allLabel: "Picked in this panel",
  followsPage: "This page's terminal",
  useOptions: () => NO_OPTIONS,
};

/** The terminal the page names, or null: bare /terminal (the Terminals view) and every other route name none. */
export function pageTerminal(route: Route): TerminalRoute | null {
  if (route.view !== "terminal") return null;
  return route.agentId || route.terminalSessionId || route.terminalSurfaceKey || route.terminalBackend ? route : null;
}

/** Whether a panel follows the page's terminal rather than keeping its own pick. */
export function followsPageTerminal(config: ModuleConfig): boolean {
  return config[TERMINAL_SCOPE_KEY] === FOLLOW_PAGE;
}

/**
 * What a panel draws: the page's terminal when it follows the page (null on a
 * page that names none), else the terminal its settings keep, at rest.
 */
export function panelTerminal(config: ModuleConfig, route: Route): { following: boolean; target: TerminalRoute | null } {
  const following = followsPageTerminal(config);
  return { following, target: following ? pageTerminal(route) : targetRoute(config) };
}

/**
 * How a terminal is open, the way the terminal itself reads its route: an
 * explicit mode wins; an agent named with no mode is taken over (the relay's
 * control mode for no mode is takeover); a host terminal is always driven; a
 * herdr layout draws its projection whatever the mode; a session with no
 * mode is its summary. The index, the details and the session panel all mark
 * Observe and Take over from this one answer.
 */
export function terminalMode(route: TerminalRoute): TerminalMode | null {
  const kind = targetKind(route);
  if (kind === "host") return "takeover";
  if (kind === "herdr") return null;
  if (route.mode) return route.mode;
  return kind === "agent" ? "takeover" : null;
}

/**
 * The route a mode button opens on the page: the same terminal in that mode.
 * Only an agent or a session has two ways to be open; anything else has none.
 */
export function pageModeRoute(route: TerminalRoute, mode: TerminalMode): TerminalRoute | null {
  const kind = targetKind(route);
  if (kind === "agent") return { view: "terminal", agentId: route.agentId, mode };
  if (kind !== "session" || (!route.terminalSessionId && !route.terminalSurfaceKey)) return null;
  return {
    view: "terminal",
    ...(route.terminalSessionId ? { terminalSessionId: route.terminalSessionId } : {}),
    ...(route.terminalSurfaceKey ? { terminalSurfaceKey: route.terminalSurfaceKey } : {}),
    mode,
  };
}

/**
 * Which terminal the page's route names, not how it is watched: the key a
 * following panel mounts its terminal under. A new route object for the same
 * terminal, or a change of mode, keeps it, so nothing reconnects on a
 * re-render; the terminal itself remounts its relay when the mode changes, as
 * the full page always did. A host terminal is also named by what it runs, its
 * tab and its zellij socket, since those pick its relay session.
 */
export function pageTerminalKey(route: TerminalRoute | null): string {
  if (!route) return "";
  const host = route.terminalBackend ? [route.terminalAgent, route.terminalTabId, route.zellijSocketDir].map((v) => v ?? "").join("|") : "";
  return host ? `${targetIdentity(route)}|${host}` : targetIdentity(route);
}
