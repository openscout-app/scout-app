/**
 * Agents — who is on, and what they are doing, scoped however you like.
 *
 * Shows:  agents in three groups, Working · Callable · Offline, each row an
 *         avatar, name, project and state or last seen. Retired agents are left out.
 * Data:   the roster in Scout context (useScout().agents); live, no polling here.
 * Scope:  Project (projectRoot), Host (authority node), Harness, State
 *         (working / callable / offline). Each is a picker in the panel header;
 *         any combination works, and each Agents panel keeps its own. Project
 *         can follow the page ("This page's project", on /projects/:slug):
 *         then every agent in any checkout of it (root, worktrees, the
 *         workspaces its sessions ran in), read from the shared Projects loop,
 *         on the page's machine (?machineId=) as that loop is.
 * Opens:  the agent.
 */
import { AgentAvatar } from "../../../components/AgentAvatar.tsx";
import { harnessLabel, normalizeHarnessKey } from "../../../components/HarnessMark.tsx";
import { isAgentOnline, normalizeAgentState, agentStateLabel } from "../../../lib/agent-state.ts";
import { agentMatchesMachineScope } from "../../../lib/machine-scope.ts";
import { timeAgo } from "../../../lib/time.ts";
import type { Agent } from "../../../lib/types.ts";
import { useMemo } from "react";
import { useScout } from "../../../scout/Provider.tsx";
import { openAgent } from "../../../scout/slots/openAgent.ts";
import { defineModule, type ModuleConfig, type ModuleProps, type ModuleScope } from "./contract.ts";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { canonicalSlug, inboxRoute, pageProjectSlug, projectRoots, rootIn } from "./projects-model.ts";
import { useProjectsPage } from "./projects-shared.tsx";
import { Quiet, baseName, optionsFrom, pathLabels } from "./shared.tsx";

export type AgentPresence = "working" | "callable" | "offline";

export function agentPresence(agent: Agent): AgentPresence {
  const state = normalizeAgentState(agent.state, agent);
  if (state === "in_turn" || state === "in_flight") return "working";
  return isAgentOnline(agent.state, agent) ? "callable" : "offline";
}

const hostOf = (a: Agent) => a.authorityNodeId ?? a.homeNodeId;
const hostName = (a: Agent) => a.authorityNodeName ?? a.homeNodeName ?? hostOf(a) ?? "";
const harnessOf = (a: Agent) => (a.harness ? normalizeHarnessKey(a.harness) : null);

/**
 * Pure, so scoping tests without a DOM. A project that follows the page
 * matches any of `roots` (the page project's checkouts); with none, every
 * project. It also keeps to the page's machine (?machineId=), as the
 * Projects loop the roots came from does.
 */
export function scopeAgents(
  agents: readonly Agent[],
  config: ModuleConfig,
  roots?: readonly string[] | null,
  pageMachineId?: string | null,
): Agent[] {
  const following = config.project === FOLLOW_PAGE;
  const inProject = (a: Agent) =>
    !config.project || (following ? !roots || rootIn(roots, a.projectRoot) : a.projectRoot === config.project);
  return agents.filter(
    (a) =>
      !a.retiredFromFleet &&
      inProject(a) &&
      (!following || agentMatchesMachineScope(a, pageMachineId ?? null)) &&
      (!config.host || hostOf(a) === config.host) &&
      (!config.harness || harnessOf(a) === config.harness) &&
      (!config.state || agentPresence(a) === config.state),
  );
}

const live = () => useScout().agents.filter((a) => !a.retiredFromFleet);

export const agentScopes: readonly ModuleScope[] = [
  {
    key: "project",
    allLabel: "All projects",
    followsPage: "This page's project",
    useOptions: () => {
      const opts = optionsFrom(live(), (a) => a.projectRoot);
      const labels = pathLabels(opts.map((o) => o.value));
      return opts.map((o) => ({ ...o, label: labels.get(o.value) ?? o.value }));
    },
  },
  {
    key: "host",
    allLabel: "All hosts",
    useOptions: () => {
      const agents = live();
      return optionsFrom(agents, hostOf, (id) => hostName(agents.find((a) => hostOf(a) === id)!));
    },
  },
  { key: "harness", allLabel: "Any harness", useOptions: () => optionsFrom(live(), harnessOf, (k) => harnessLabel(k)) },
  {
    key: "state",
    allLabel: "Any state",
    useOptions: () => [
      { value: "working", label: "Working" },
      { value: "callable", label: "Callable" },
      { value: "offline", label: "Offline" },
    ],
  },
];

const GROUPS: readonly { key: AgentPresence; label: string }[] = [
  { key: "working", label: "Working" },
  { key: "callable", label: "Callable" },
  { key: "offline", label: "Offline" },
];

/** Following the page needs the project's checkouts, which only the Projects loop knows: read it only then. */
function Agents(props: ModuleProps) {
  return props.config.project === FOLLOW_PAGE ? <AgentsOnPage {...props} /> : <AgentList {...props} roots={null} machineId={null} />;
}

function AgentsOnPage(props: ModuleProps) {
  const { model } = useProjectsPage(props.route);
  const slug = canonicalSlug(model, pageProjectSlug(props.route));
  const roots = useMemo(() => (slug ? projectRoots(model, slug) : null), [model, slug]);
  return <AgentList {...props} roots={roots} machineId={inboxRoute(props.route).machineId ?? null} />;
}

function AgentList({ navigate, config, roots, machineId }: ModuleProps & { roots: readonly string[] | null; machineId: string | null }) {
  const { agents, agentsLoaded, route } = useScout();
  if (!agentsLoaded) return <Quiet>Reading the roster…</Quiet>;
  const scoped = scopeAgents(agents, config, roots, machineId);
  if (!scoped.length) return <Quiet>{agents.length ? "No agents in this scope." : "No agents yet."}</Quiet>;
  const showProject = !config.project || (config.project === FOLLOW_PAGE && !roots);
  return (
    <div className="vw-rows">
      {GROUPS.map(({ key, label }) => {
        const group = scoped.filter((a) => agentPresence(a) === key);
        if (!group.length) return null;
        return (
          <section key={key} className={`vw-group vw-group--${key}`}>
            <div className="vw-group-head">
              <span>{label}</span>
              <span className="vw-num">{group.length}</span>
            </div>
            <ul>
              {group.map((a) => (
                <li key={a.id}>
                  <button type="button" className="vw-row vw-row--agent" onClick={() => openAgent(navigate, a, { from: "home", returnTo: route })}>
                    <AgentAvatar agent={a} size={20} />
                    <span className="vw-strong vw-ell">{a.name}</span>
                    <span className="vw-dim vw-ell">{showProject && a.projectRoot ? baseName(a.projectRoot) : a.branch ?? ""}</span>
                    <span className="vw-dim vw-num">{key === "working" ? agentStateLabel(a.state, a) : timeAgo(a.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export const agentsModule = defineModule({
  type: "agents",
  title: "Agents",
  blurb: "Who is on, scoped by project, host, harness or state",
  docs: {
    shows: "Agents grouped Working · Callable · Offline, with project and state.",
    data: "useScout().agents, the live roster.",
    opens: "The agent.",
  },
  size: { w: 4, h: 10 },
  minSize: { w: 3, h: 5 },
  scopes: agentScopes,
  Component: Agents,
});
