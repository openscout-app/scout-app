/**
 * Agent card — one agent at a glance, to keep beside anything.
 *
 * Shows:  the agent's avatar, name and handle; its live actions (Observe,
 *         Trace, Take over, as it offers them); the tmux peek for a tmux
 *         agent; its state and when it last changed; who else is on the mesh
 *         near it; asks running for it; identity (provider, protocol, class,
 *         role, harness, transport, host); skills; project, branch and cwd;
 *         capabilities; its running sessions. The inspector's full card, as on
 *         /agent/:conversationId.
 * Data:   /api/fleet (shared store), the agent's session catalog and its
 *         observe data, on open and on broker events. The roster from
 *         useScout().
 * Scope:  Agent: one agent (pin one to keep it on Watch), or "This page's
 *         agent" on an agent's page.
 * Opens:  Open: the agent's page; its live actions: its terminal or trace;
 *         an agent on the mesh: that agent; an ask: its conversation; a
 *         running session: that session. Back returns to this page.
 */
import { AgentContextPanel } from "../../agents/right.tsx";
import { useScout } from "../../../scout/Provider.tsx";
import { openAgent } from "../../../scout/slots/openAgent.ts";
import { isAgentPage, panelAgentId } from "./agent-model.ts";
import { agentScope, asPageNavigate, usePanelAgent } from "./agent-shared.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { Quiet } from "./shared.tsx";
import "./agent-views.css";

function AgentCard({ route, navigate, config }: ModuleProps) {
  const { agents, agentsLoaded } = useScout();
  const ref = panelAgentId(config, route);
  const agent = usePanelAgent(ref);
  if (!ref) {
    return (
      <Quiet>
        {config.agent === FOLLOW_PAGE ? "Open an agent and its card follows here." : "Pick an agent from Scope to keep its card here."}
      </Quiet>
    );
  }
  if (!agent) return <Quiet>{agentsLoaded ? "No agent answers to that name." : "Reading the roster…"}</Quiet>;
  const onItsPage = isAgentPage(route) && route.agentId === agent.id;
  return (
    <div className="vw-ag vw-ag-card">
      {!onItsPage && (
        <ModuleHead>
          <button
            type="button"
            className="vw-chip"
            onClick={() => openAgent(asPageNavigate(navigate), agent, { from: "inspector", returnTo: route })}
            title="Open this agent's page"
          >
            Open
          </button>
        </ModuleHead>
      )}
      <AgentContextPanel key={agent.id} agent={agent} agents={agents} navigate={navigate} route={route} observeMode={false} />
    </div>
  );
}

export const agentCardModule = defineModule({
  type: "agent-card",
  title: "Agent card",
  blurb: "One agent at a glance: state, live actions, asks, identity and running sessions",
  docs: {
    shows: "Avatar, name and handle; live actions; state; who is near it on the mesh; asks running for it; identity, skills, project and capabilities; running sessions.",
    data: "/api/fleet (shared store), the agent's session catalog and observe data, on open and on broker events.",
    opens: "Open: the agent's page; live actions: its terminal or trace; a mesh agent, an ask or a session: that.",
  },
  size: { w: 3, h: 16 },
  minSize: { w: 3, h: 8 },
  scopes: [agentScope("No agent")],
  Component: AgentCard,
});
