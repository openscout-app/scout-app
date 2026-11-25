/**
 * Agent — one agent's page in a panel: its sessions, config, trace and chat.
 *
 * Shows:  the tab bar (Sessions · Config · Trace · Message, with "Project"
 *         back on the agent's page), then the tab. Sessions: the agent's
 *         head (avatar, name, handle, essentials, Edit config, + New
 *         session) and its recent sessions, the selected one opened inline
 *         with Continue or Resume. Config: its definitions. Trace: the
 *         session's live trace. Message: its conversation, or Open chat.
 *         "Agent not found." when nothing on the roster answers to it.
 * Data:   the roster (useScout().agents, on the page's ?machineId=);
 *         /api/conversations on open and on broker events; the agent's
 *         session catalog on open, again at 3s and on broker events; the
 *         trace every 2.5s while live and on the Trace tab.
 * Scope:  Agent: one agent, or "This page's agent" (the shipped Agent view),
 *         which follows /agents/:id and /projects/:slug/agents/:id. There the
 *         URL holds the tab (?tab=), the session and the conversation, so
 *         Back undoes a tab. Pinned, or on any other view, the panel keeps
 *         them itself (live state, not a choice) and never moves the page.
 * Opens:  Open full: the agent's page with the panel's tab and session; New
 *         session: its session page; Resume: the session's page; a trace's
 *         or chat's own links where they point.
 */
import { useCallback, useMemo } from "react";
import type { NavigateOptions } from "../../../lib/router.ts";
import type { Route } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { ProjectAgentProfile } from "../../projects/ProjectAgentProfile.tsx";
import { followsAgentPage, panelAgentId, panelMove, panelReturnTo, panelRoute } from "./agent-model.ts";
import { agentScope, asPageNavigate, usePanelAgent, usePublishAgentPick } from "./agent-shared.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { Quiet } from "./shared.tsx";
import "./agent-views.css";

function AgentPanel(props: ModuleProps) {
  const { route, navigate, config } = props;
  // on the agent's page the panel is the page: the URL holds its tab and session
  if (followsAgentPage(config, route)) {
    return (
      <div className="vw-ag vw-ag-profile">
        <ProjectAgentProfile route={route} navigate={navigate} />
      </div>
    );
  }
  const id = panelAgentId(config, route);
  if (!id) {
    return (
      <Quiet>
        {config.agent === FOLLOW_PAGE ? "Open an agent and its page follows here." : "Pick an agent from Scope, or follow this page's."}
      </Quiet>
    );
  }
  return <AgentOffPage {...props} agentRef={id} />;
}

/** Pinned, or on another view: the panel keeps its own tab, session and conversation. */
function AgentOffPage({ instanceId, route: page, navigate, config, setConfig, agentRef }: ModuleProps & { agentRef: string }) {
  const { agentsLoaded } = useScout();
  const agent = usePanelAgent(agentRef);
  const agentId = agent?.id ?? agentRef;
  const at = useMemo(() => panelRoute(agentId, config), [agentId, config]);
  const pageNavigate = asPageNavigate(navigate);

  // the same agent's tab, session or chat stays here; anything else is a real move, and Back comes to this page
  const move = useCallback(
    (target: Route, options?: NavigateOptions) => {
      const patch = panelMove(agentId, target, [agentRef]);
      if (patch) {
        setConfig(patch);
        return;
      }
      const returnTo = panelReturnTo(options?.returnTo, agentId, page, [agentRef]);
      pageNavigate(target, { ...options, ...(returnTo ? { returnTo } : {}) });
    },
    [agentId, agentRef, page, pageNavigate, setConfig],
  );
  // choosing a session is a move to it on this agent's page: the tab and chat stay
  const select = useCallback((sessionId: string) => move({ ...at, sessionId }), [at, move]);

  usePublishAgentPick(instanceId, agent ? { agentId: agent.id, sessionId: at.sessionId ?? null, tab: at.tab ?? null } : null);

  if (!agentsLoaded) return <Quiet>Reading the roster…</Quiet>;
  return (
    <div className="vw-ag vw-ag-profile">
      <ModuleHead>
        <button type="button" className="vw-chip" onClick={() => navigate(at)} title="Open this agent on its own page">
          Open full
        </button>
      </ModuleHead>
      <ProjectAgentProfile key={agentId} route={at} navigate={move} onSelectSession={select} back={false} />
    </div>
  );
}

export const agentModule = defineModule({
  type: "agent",
  title: "Agent",
  blurb: "One agent's page: its sessions, config, live trace and chat",
  docs: {
    shows: "The tab bar (Sessions · Config · Trace · Message) and the tab: the agent's head and recent sessions with Continue or Resume, its definitions, the live trace, or its conversation.",
    data: "The roster; /api/conversations and the agent's session catalog on open and on broker events; the trace every 2.5s while live.",
    opens: "Open full: the agent's page with the panel's tab and session; New session and Resume: the session's page.",
  },
  size: { w: 6, h: 24 },
  minSize: { w: 4, h: 12 },
  scopes: [agentScope("No agent")],
  state: ["of", "tab", "session", "conversation"],
  Component: AgentPanel,
});
