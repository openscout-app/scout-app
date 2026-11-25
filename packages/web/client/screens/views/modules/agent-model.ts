import type { AgentTab, Route } from "../../../lib/types.ts";
import type { ModuleConfig } from "./contract.ts";
import { FOLLOW_PAGE, scopeValue } from "./follow-page.ts";

/*
 * The Agents and Agent views' rules, pure so they test without a DOM. The
 * modules (agent-activity, agent, agent-session, agent-card) read the page
 * through these.
 *
 * Both views are drawn on the Agents routes themselves, so the URL holds the
 * selection: bare /agents (the feed, with ?select= for a peek),
 * and an agent's page, /agents/:id and /projects/:slug/agents/:id, with ?tab=,
 * its session (/sessions/:sid) or conversation (/c/:cid) and ?machineId=.
 * A panel anywhere else keeps its choices in config and never moves the page.
 */

export type AgentsRoute = Extract<Route, { view: "agents-v2" }>;
export type AgentPageRoute = AgentsRoute & { agentId: string };

/** An agent's page: the Agent view's routes. The same test as composedViewFor's "agent". */
export function isAgentPage(route: Route): route is AgentPageRoute {
  return route.view === "agents-v2" && Boolean(route.agentId);
}

/**
 * The Agents feed: bare /agents and /projects?view=sessions, not
 * the project list, a project, or an agent. composedViewFor's "agents".
 */
export function isAgentsFeed(route: Route): route is AgentsRoute {
  return route.view === "agents-v2" && !route.agentId && !route.projectSlug && route.indexView !== "projects";
}

/** The page's agent, for a panel that follows the page. */
export function pageAgentId(route: Route): string | undefined {
  return isAgentPage(route) ? route.agentId : undefined;
}

/** The agent a panel shows: the page's when it follows the page, else its own pick ("" = none). */
export function panelAgentId(config: ModuleConfig, route: Route): string {
  return scopeValue(config.agent, pageAgentId(route));
}

/**
 * The panel draws the page itself: it follows the page and the page is an
 * agent's. Then the URL holds its tab and session, and its moves are the page's.
 */
export function followsAgentPage(config: ModuleConfig, route: Route): route is AgentPageRoute {
  return config.agent === FOLLOW_PAGE && isAgentPage(route);
}

const TABS: ReadonlySet<string> = new Set<AgentTab>(["profile", "config", "observe", "message"]);

export function asAgentTab(value: string | undefined): AgentTab | undefined {
  return value && TABS.has(value) ? (value as AgentTab) : undefined;
}

/**
 * The agent page an Agent panel off its page draws: the agent, and the tab,
 * session and conversation it holds. What it holds belongs to one agent
 * (`of`), so choosing another agent in Scope starts that one fresh.
 */
export function panelRoute(agentId: string, config: ModuleConfig): AgentPageRoute {
  const held = config.of === agentId;
  const tab = held ? asAgentTab(config.tab) : undefined;
  return {
    view: "agents-v2",
    agentId,
    ...(tab ? { tab } : {}),
    ...(held && config.session ? { sessionId: config.session } : {}),
    ...(held && config.conversation ? { conversationId: config.conversation } : {}),
  };
}

/** The target names this agent: its id, or the name the panel was given (an alias the roster resolves). */
const namesAgent = (target: Route, agentId: string, aliases: readonly string[]) =>
  target.view === "agents-v2" && !!target.agentId && (target.agentId === agentId || aliases.includes(target.agentId));

/**
 * A move inside an Agent panel off its page. The same agent's tab, session or
 * conversation stays in the panel, as a settings patch; anything else (a
 * terminal, a session's page, another agent) is a real move: null.
 */
export function panelMove(agentId: string, target: Route, aliases: readonly string[] = []): Record<string, string> | null {
  if (target.view !== "agents-v2" || !namesAgent(target, agentId, aliases)) return null;
  return {
    of: agentId,
    tab: target.tab ?? "",
    session: target.sessionId ?? "",
    conversation: target.conversationId ?? "",
  };
}

/**
 * Where Back from a real move lands. The screens name their own agent page;
 * off that page it means the page the panel sits on.
 */
export function panelReturnTo(returnTo: Route | undefined, agentId: string, page: Route, aliases: readonly string[] = []): Route | undefined {
  if (!returnTo) return undefined;
  return namesAgent(returnTo, agentId, aliases) ? page : returnTo;
}

/** The feed's peek: an agent (?select=) or a session the page selected. The feed's panel draws it, as the inspector did. */
export function feedPeek(route: Route): route is AgentsRoute {
  return isAgentsFeed(route) && Boolean(route.selectedAgentId || route.sessionId);
}
