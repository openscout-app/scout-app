/**
 * Agents directory — every agent with its live work, usage and cost: Ops › Agents as a panel.
 *
 * Shows:  the live count and the search (agents, tasks, projects, machines),
 *         four stats (Running of total, Tokens with the API equivalent, Avg
 *         latency, Billed), then one row per agent: state and name, active
 *         task, project, machine, active asks, sessions in 24h, a 24h
 *         throughput sparkline, average latency, input, cache read and
 *         write, output, API equivalent, billed, errors, last active.
 *         Sortable (busy agents stay on top within a sort); columns resize
 *         and keep their widths. Hovering a row previews the agent; ↑/↓ move,
 *         Enter pins the card, o opens, Esc clears, while focus is in the table.
 * Data:   loadFleet() (active asks), /api/conversations, /api/activity and
 *         /api/observe/agents for the agents shown, on open and 1.5s after
 *         any broker event; useScout().agents for the roster.
 * Scope:  Project ("This page's project" on a project page: any checkout of
 *         it, on the page's machine), Host, Harness, State (working,
 *         callable, offline), as the Agents panel scopes. Unscoped it lists
 *         every registered agent, retired ones too, as Ops › Agents did;
 *         scoped, retired agents drop out, as they do on Agents.
 * Opens:  a row: the agent's preview card; o or the card: the agent.
 */
import { useMemo } from "react";
import type { Agent } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { OpsAgentsView } from "../../ops/OpsAgentsView.tsx";
import { agentScopes, scopeAgents } from "./agents.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { canonicalSlug, inboxRoute, pageProjectSlug, projectRoots } from "./projects-model.ts";
import { useProjectsPage } from "./projects-shared.tsx";
import { Quiet } from "./shared.tsx";
import "./agents-panels.css";

/** Following the page needs the project's checkouts, which only the Projects loop knows: read it only then. */
function AgentsDirectory(props: ModuleProps) {
  return props.config.project === FOLLOW_PAGE ? <DirectoryOnPage {...props} /> : <Directory {...props} roots={null} machineId={null} />;
}

function DirectoryOnPage(props: ModuleProps) {
  const { model } = useProjectsPage(props.route);
  const slug = canonicalSlug(model, pageProjectSlug(props.route));
  const roots = useMemo(() => (slug ? projectRoots(model, slug) : null), [model, slug]);
  return <Directory {...props} roots={roots} machineId={inboxRoute(props.route).machineId ?? null} />;
}

function Directory({ navigate, config, roots, machineId }: ModuleProps & { roots: readonly string[] | null; machineId: string | null }) {
  const { agents, agentsLoaded } = useScout();
  const scoped = !!(config.project || config.host || config.harness || config.state);
  // one array per change, not per render: the directory reads again when its agents change
  const shown = useMemo<Agent[]>(
    () => (scoped ? scopeAgents(agents, config, roots, machineId) : agents),
    [agents, scoped, config.project, config.host, config.harness, config.state, roots, machineId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!agentsLoaded) return <Quiet>Reading the roster…</Quiet>;
  return (
    <div className="vw-agents-directory">
      <OpsAgentsView navigate={navigate} agents={shown} variant="panel" />
    </div>
  );
}

export const agentsDirectoryModule = defineModule({
  type: "agents-directory",
  title: "Agents directory",
  blurb: "Every agent with its active task, asks, sessions, latency, tokens and cost",
  docs: {
    shows: "The search, four stats (Running, Tokens, Avg latency, Billed), then one sortable row per agent with its work, usage and cost. A row previews the agent.",
    data: "loadFleet(), /api/conversations, /api/activity, /api/observe/agents, on open and 1.5s after broker events; useScout().agents.",
    opens: "A row: the agent's preview card; o or the card: the agent.",
  },
  size: { w: 8, h: 20 },
  minSize: { w: 5, h: 8 },
  scopes: agentScopes,
  Component: AgentsDirectory,
});
