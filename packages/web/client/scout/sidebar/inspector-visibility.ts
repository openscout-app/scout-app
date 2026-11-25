import type { Route } from "../../lib/types.ts";
import { pageOwnsSides } from "../../screens/views/composed-routes.ts";

export type InspectorSelectionState = {
  hasBrokerAttempt: boolean;
  hasKnowledgeHit: boolean;
};

/**
 * Whether the current route has context that earns the inspector column.
 *
 * Keep this aligned with `resolveRightPane` plus the shell-owned Ops/Broker
 * inspectors. Routes whose resolver returns `null` must not reserve an empty
 * panel. Directory routes only gain the panel after a concrete selection.
 */
export function routeHasMeaningfulInspector(
  route: Route,
  selection: InspectorSelectionState,
): boolean {
  // a composed view's panels hold what the inspector would
  if (pageOwnsSides(route)) return false;
  switch (route.view) {
    case "agents-v2":
      return Boolean(route.agentId || route.selectedAgentId || route.sessionId);
    case "agent-info":
    case "conversation":
    case "mesh":
    case "mesh-ops":
    case "terminal":
      return true;
    case "ops":
      return route.mode !== "lanes" && route.mode !== "world" && route.mode !== "week";
    case "sessions":
      // Each session slot owns its inspector; never reserve a second shell rail.
      return false;
    case "messages":
      return Boolean(route.conversationId);
    case "search":
      return Boolean(route.hitId && selection.hasKnowledgeHit);
    // Dispatch is retired in scout-app (redirects to Control); never reserve a shell inspector.
    case "broker":
    // the work page draws its own detail pane
    case "work":
    case "requests":
    case "activity":
    case "briefings":
    case "rooms":
    case "code":
    case "follow":
    case "harnesses":
    case "inbox":
    // Status's grid holds its own panels
    case "status":
    // Changes draws the worktree's details itself (ChangesPage)
    case "repos":
    case "repo-diff":
    case "settings":
    case "views":
    case "boards":
    case "review":
    case "canvas":
    case "feed":
    case "voice":
      return false;
  }
}
