/**
 * Agent activity — what agents are doing and what they said, newest first.
 *
 * Shows:  At the stations (each piece of work in progress, everyone on it,
 *         and a surface for what they are making), then one row per agent
 *         per day (who, /project, done or blocked, failures, how many posts,
 *         when, and the sentence it led with), a "seen to here" rule at your
 *         last visit, and Loading, failed and empty states. A row opens over
 *         the feed as a short article (floating and resizable when wide, a
 *         sheet when narrow; Esc closes it). On the feed's own page a peek
 *         (?select=, Home's peek) draws beside it: the agent's status,
 *         headline and readouts with Open · Observe · Clear.
 * Data:   /api/fleet (shared fleet store) on open and on fleet events;
 *         /api/tail/recent (each harness session's latest reply, 24h) on open
 *         and every 60s while Scout is in front; a post's thread from
 *         /api/messages or /api/session-ref when opened. The last visit is
 *         kept in this browser. A peek reads useProjectsInbox().
 * Scope:  Agent: every agent, one agent, or "This page's agent" on an
 *         agent's page (its asks and posts only; reading one agent never
 *         marks the whole feed seen).
 * Opens:  a station: its work item or conversation; a row: its article, whose links
 *         go to the conversation, session or terminal; a row with nothing to
 *         read: its thread. The peek: the agent, its session or
 *         conversation; Clear drops the peek from the page.
 */
import { useScout } from "../../../scout/Provider.tsx";
import { AgentsHomeStage } from "../../agents/AgentsHomeFeed.tsx";
import { ProjectsThreadAside } from "../../projects/ProjectsThreadAside.tsx";
import { feedPeek, pageAgentId } from "./agent-model.ts";
import { agentScope, usePanelAgent } from "./agent-shared.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { scopeValue } from "./panel-scope.ts";
import "../../projects/crew-workspaces.css";
import "./agent-views.css";

function AgentActivity({ route, navigate, config }: ModuleProps) {
  const { agents } = useScout();
  const ref = scopeValue(config.agent, pageAgentId(route));
  const agent = usePanelAgent(ref);
  const agentId = ref ? agent?.id ?? ref : null;
  return (
    <div className="vw-agf">
      {/* a new agent is a new feed: its open article and seen rule start fresh */}
      <AgentsHomeStage key={agentId ?? ""} agents={agents} navigate={navigate} agentId={agentId} />
      {feedPeek(route) && (
        <aside className="vw-agf-peek" aria-label="Selection">
          <ProjectsThreadAside route={route} navigate={navigate} />
        </aside>
      )}
    </div>
  );
}

export const agentActivityModule = defineModule({
  type: "agent-activity",
  title: "Agent activity",
  blurb: "What agents are doing and what they said, by day, with a seen-to-here rule",
  docs: {
    shows: "The stations (work in progress, everyone on it), then one row per agent per day with the sentence it led with; a row opens as a short article. On the feed's page, a peeked agent beside it.",
    data: "/api/fleet (shared store) on fleet events; /api/tail/recent every 60s while Scout is in front.",
    opens: "A station: its work item or conversation; a row: its article and its links; the peek: the agent or its session.",
  },
  size: { w: 9, h: 24 },
  minSize: { w: 4, h: 8 },
  scopes: [agentScope("All agents")],
  Component: AgentActivity,
});
