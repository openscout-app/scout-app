import type { OpsMode, Route } from "../../lib/types.ts";

/**
 * The composed Ops modes. Control (bare /ops opens on it): roster, wall,
 * session context and ops summary; ?sessionId= is the wall's cursor. Tail with
 * its filter and follow ids, and Alerts (/ops/issues, /ops/errors,
 * /ops/warnings): the stream reads them from the URL; Event, Following and
 * Requests · Active draw what the inspector and the rail did. In flight
 * (mode advisor; /ops/in-flight, /ops/advisor): In flight and Stale, and
 * ?plan= is the Plan panel's selection. Lanes: roster, deck, the lane it
 * opened, ops summary and Requests · Active; ?sessionId= is the Lane panel's
 * lane. World (/ops/world, mode week): the HUD with its two side columns as
 * panels; ?source= and ?data= are the HUD's. The floor (/ops/fleet) keeps its
 * own screen.
 */
const OPS_COMPOSITIONS: Partial<Record<OpsMode, string>> = {
  mission: "ops-control",
  tail: "ops-tail",
  issues: "ops-issues",
  advisor: "ops-advisor",
  atop: "ops-runtime",
  agents: "ops-agents",
  lanes: "ops-lanes",
  // Cockpit: Home's old grid, under its old view id so saved arrangements carry over
};

/**
 * The shipped composition an app route draws, or null for a route that still
 * draws its own screen. Pane resolvers, the sidebar and the inspector rule
 * all ask here, so a composed route never also gets the rail or inspector
 * its panels replace. Pure, so it tests without a DOM.
 *
 * Terminals composes its home, and the Terminal view every terminal deep
 * link (an agent's, a session's, a herdr layout, a fresh host terminal).
 * Search composes every Search URL; Projects its list and project pages;
 * Agents its feed and Agent every agent's page; Dispatch all of /dispatch;
 * Work /work and /work/:id; Briefings /briefings and /briefings/:id;
 * Network, Mesh Ops, Providers and Code all of theirs, since those URLs
 * are their selection. /repos and /repo-diff are the Changes page, which
 * draws itself in one of two fixed layouts (screens/repos/ChangesPage.tsx). Ops
 * composes Control (and bare /ops), Tail, Alerts, In flight (its ?plan=,
 * /ops/advisor and the legacy /ops/plan), Runtime, Agents, World (its ?source= and
 * ?data=) and Lanes (?sessionId= is its lane), under the Ops strip
 * (OpsFrame); the floor (/ops/fleet) keeps its own screen. /embed/ops never
 * asks, so the native World keeps the full screen. Activity composes all
 * of /activity: ?event= is its open record, ?machineId= narrows the log.
 * Requests composes /requests: ?request= is the open request (bare, the
 * first open one); /embed/requests keeps the page.
 * Sessions composes /sessions, /sessions/:ref and /flights/:id/observe: the
 * slot screen drew all three as one deck (a board beside the session), so
 * the path's session, ?machineId= and a flight's ?session= and ?compare=
 * are the selection the Session board and Session thread follow.
 * Home composes / (and the legacy /fleet, which parses to it): its panels
 * follow the page's ?machineId=; /embed/home draws the same panels (its NativeAreaScreen).
 *
 * Full-bleed still: /agent/:conversationId, and /follow/*, which
 * replaces itself with the page a receipt's ids resolve to. The embeds
 * (/embed/*) never ask, since they draw their screens themselves.
 */
/**
 * The route's page replaces the rail and the inspector: a composition (its
 * panels hold what they would), or Home's front page (/ and /embed/home,
 * screens/home/front-page), which is the whole page by design.
 */
export function pageOwnsSides(route: Route): boolean {
  return route.view === "inbox" || composedViewFor(route) !== null;
}

export function composedViewFor(route: Route): string | null {
  if (route.view === "terminal" && !route.agentId && !route.terminalSessionId && !route.terminalSurfaceKey && !route.terminalBackend) {
    return "terminals";
  }
  // one terminal's page: its panels follow the terminal and the ?mode= the URL names
  if (route.view === "terminal") return "terminal";
  // every Search URL: the panels read the query, filters and ?hit= from it
  if (route.view === "search") return "search";
  // the project list and a project's page with its facets. Not bare /projects
  // (the Agents feed) and not /projects/:slug/agents/:id (an agent's page),
  // which draw Agents and Agent below. The same test as nav-destinations'
  // isProjectListRoute.
  if (route.view === "agents-v2" && !route.agentId && (route.projectSlug || route.indexView === "projects")) {
    // a project's page opens on its snapshot (Overview), and looks at it by sessions or by
    // worktrees once either is asked for or something is picked (projects-model › pageLooksBy)
    if (!route.projectSlug) return "projects";
    if (route.pr || route.worktree || route.by === "worktrees") return "projects-worktrees";
    if (route.by === "sessions" || route.sessionId || route.selectedAgentId || route.indexView === "sessions" || route.indexView === "agents") return "project";
    return "project-snapshot";
  }
  // an agent's page: /agents/:id and /projects/:slug/agents/:id, with its
  // ?tab=, session or conversation; the Agent panels follow the page's agent
  if (route.view === "agents-v2" && route.agentId) return "agent";
  // the rest of agents-v2 is the Agents feed: bare /agents and /projects?view=sessions
  // (and an old /projects?view=agents), with its ?select= or session peek
  if (route.view === "agents-v2") return "agents";
  // every Dispatch URL: the panels read the outcome, focus, Between, window
  // and the open dispatch from it; the Ledger draws the detail the inspector did
  // /work/board is the lifecycle board and its ledger. /work and /work/:id
  // are a fixed page (screens/work/WorkPage.tsx), not a composition
  if (route.view === "work" && route.board) return "work-board";
  // all of /activity: the log follows the page, ?event= opens a record in
  // Activity details and ?machineId= narrows the log
  if (route.view === "activity") return "activity";
  // every Network URL: ?machineId= picks the machine the panels follow
  if (route.view === "mesh") return "mesh";
  // every Mesh Ops URL: ?machineId= scopes the read, ?itemId= opens the item
  if (route.view === "mesh-ops") return "mesh-ops";
  // /providers (the harnesses view), its ?machineId= included
  if (route.view === "harnesses") return "providers";
  // every Code URL: the panels read the root, file, lines and the conversation
  // that handed the file in from it. /embed/code never asks (it draws the page)
  if (route.view === "ops") return OPS_COMPOSITIONS[route.mode ?? "mission"] ?? null;
  // /voice carries no selection; its panels share one session (screens/voice/voice-session.ts)
  if (route.view === "voice") return "voice";
  // /briefings and /briefings/:id: the Briefing panel follows the page's
  // briefing; bare /briefings, the list leads and the Briefing panel waits
  if (route.view === "briefings") return "briefings";
  // /sessions, /sessions/:ref and /flights/:id/observe: the board marks the
  // page's session and a pick writes it; the thread follows it (on bare
  // /sessions, the board's first row), a flight's ?session= and ?compare= too
  if (route.view === "sessions") return "sessions";
  // /requests and /requests?request=: the Request panel follows the page's
  // request, and with none named shows the first open one
  if (route.view === "requests") return "requests";
  return null;
}
