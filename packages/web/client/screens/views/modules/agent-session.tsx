/**
 * Agent session — the session an agent's page is on, and the ways into it.
 *
 * Shows:  the session (short id, now or when it ended, cwd, full id, profile
 *         id) with Observe and Take over for its terminal; what it has been
 *         doing (files changed, with their diffs) outside the Trace tab; the
 *         tmux peek for a tmux agent; the Runtime readout; the trace context
 *         on the Trace tab; asks running for the agent. The page's inspector,
 *         as a panel.
 * Data:   /api/fleet (shared store), the agent's session catalog and its
 *         observe data, on open and on broker events. The roster from
 *         useScout().
 * Scope:  Agent: one agent, or "This page's agent" (the shipped Agent view).
 *         Following the page, the session is the page's (/sessions/:sid, else
 *         the agent's active one) and the Trace tab is ?tab=observe. Pinned,
 *         or on another view, it follows an Agent panel beside it showing
 *         the same agent, else the agent's active session.
 * Opens:  Observe and Take over: the agent's terminal (Take over replays a
 *         resumable harness's resume command first); a file: its diff; an
 *         ask: its conversation. Back returns to the page the panel is on.
 */
import { useCallback, useMemo } from "react";
import type { NavigateOptions } from "../../../lib/router.ts";
import { routeMachineId } from "../../../lib/router.ts";
import { filterAgentsByMachineScope } from "../../../lib/machine-scope.ts";
import type { Route } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { AgentContextPanel } from "../../agents/right.tsx";
import { followsAgentPage, panelAgentId, panelReturnTo, panelRoute } from "./agent-model.ts";
import { agentScope, asPageNavigate, useAgentPick, usePanelAgent } from "./agent-shared.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { Quiet } from "./shared.tsx";
import "./agent-views.css";

function AgentSession({ route, navigate, config }: ModuleProps) {
  const { agents, agentsLoaded } = useScout();
  const own = followsAgentPage(config, route);
  // on the page, the agents the page draws (its ?machineId=)
  const roster = useMemo(() => (own ? filterAgentsByMachineScope(agents, routeMachineId(route)) : agents), [agents, own, route]);
  const ref = panelAgentId(config, route);
  const agent = usePanelAgent(ref, roster);
  const pick = useAgentPick(own ? null : agent?.id ?? null);

  // off the page: the session an Agent panel beside it is on, as that agent's page would hold it
  const at = useMemo(
    () => (agent && !own ? panelRoute(agent.id, { of: agent.id, session: pick?.sessionId ?? "", tab: pick?.tab ?? "" }) : null),
    [agent, own, pick?.sessionId, pick?.tab],
  );
  const pageNavigate = asPageNavigate(navigate);
  const move = useCallback(
    (target: Route, options?: NavigateOptions) => {
      const returnTo = agent ? panelReturnTo(options?.returnTo, agent.id, route, [ref]) : options?.returnTo;
      pageNavigate(target, { ...options, ...(returnTo ? { returnTo } : {}) });
    },
    [agent, pageNavigate, ref, route],
  );
  const keep = useCallback(() => undefined, []);

  if (!ref) {
    return (
      <Quiet>
        {config.agent === FOLLOW_PAGE ? "Open an agent and its session follows here." : "Pick an agent from Scope, or follow this page's."}
      </Quiet>
    );
  }
  if (!agent) return <Quiet>{agentsLoaded ? "No agent answers to that name." : "Reading the roster…"}</Quiet>;

  if (own) {
    return (
      <div className="vw-ag vw-ag-session">
        <AgentContextPanel
          agent={agent}
          agents={agents}
          navigate={navigate}
          route={route}
          observeMode={route.tab === "observe"}
          showStaticIdentity={false}
        />
      </div>
    );
  }
  return (
    <div className="vw-ag vw-ag-session">
      <ModuleHead>
        <button type="button" className="vw-chip" onClick={() => navigate(at!)} title="Open this agent on its own page">
          Open full
        </button>
      </ModuleHead>
      <AgentContextPanel
        key={agent.id}
        agent={agent}
        agents={agents}
        navigate={move}
        route={at!}
        observeMode={at!.tab === "observe"}
        showStaticIdentity={false}
        onSelectSession={keep}
      />
    </div>
  );
}

export const agentSessionModule = defineModule({
  type: "agent-session",
  title: "Agent session",
  blurb: "The session an agent is on: Observe, Take over, files changed, runtime and asks",
  docs: {
    shows: "The session (id, when, cwd) with Observe and Take over; files it changed; the tmux peek; the Runtime readout; asks running for the agent.",
    data: "/api/fleet (shared store), the agent's session catalog and observe data, on open and on broker events.",
    opens: "Observe and Take over: the agent's terminal; a file: its diff; an ask: its conversation.",
  },
  size: { w: 3, h: 24 },
  minSize: { w: 3, h: 10 },
  scopes: [agentScope("No agent")],
  Component: AgentSession,
});
