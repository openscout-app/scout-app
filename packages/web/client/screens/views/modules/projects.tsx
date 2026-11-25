/**
 * Projects — every project Scout tracks, to find, sort, filter and add to.
 *
 * Shows:  find, sort (Recent · Name) and Add project (by path), then the
 *         All · Asking · Live · Idle lens with a count on each, then one row
 *         per project: /name, ~/root, worktrees, last activity, and Asking or
 *         Active when it is. The page's project is marked.
 * Data:   useProjectsInbox(), the one shared Projects loop (conversations,
 *         fleet and tail discovery; every 60s and on change). No request of
 *         its own. It follows the page's machine (?machineId=) and
 *         ?ephemeral=1.
 * Scope:  Host: only that machine's projects (the page's ?machineId= when
 *         unset). The lens is ?state= on the Projects view (replaced as it is
 *         toggled), and kept in the panel anywhere else.
 * Opens:  the project's page, /projects/:slug, keeping ?machineId= and
 *         ?ephemeral=1.
 */
import { useMemo } from "react";
import { api } from "../../../lib/api.ts";
import { agentMachineIds } from "../../../lib/machine-scope.ts";
import type { Agent, MeshStatus, ProjectStateFilter } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { ProjectsRail } from "../../projects/ProjectsRail.tsx";
import { projectsZeroPreviewEnabled } from "../../projects/ProjectsScreen.tsx";
import { isAgentPage } from "./agent-model.ts";
import { agentPresence, agentScopes } from "./agents.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { asStateFilter, inboxRoute, isProjectsPage, pageProjectSlug, withStateFilter } from "./projects-model.ts";
import "./projects.css";
import { usePolled } from "./shared.tsx";

type ProjectRow = { root: string; branch: string | null; working: number; total: number };

/** Agent project roots, busiest first. Pull requests reads these for the repos to ask gh about. */
export function projectRows(agents: readonly Agent[]): ProjectRow[] {
  const by = new Map<string, ProjectRow>();
  for (const a of agents) {
    if (!a.projectRoot) continue;
    const row = by.get(a.projectRoot) ?? { root: a.projectRoot, branch: a.branch, working: 0, total: 0 };
    row.total++;
    if (agentPresence(a) === "working") row.working++;
    by.set(a.projectRoot, row);
  }
  return [...by.values()].sort((a, b) => b.working - a.working || b.total - a.total || a.root.localeCompare(b.root));
}

/**
 * Projects with a checkout on THIS machine, busiest first: the ones a local
 * process (gh, a pty) can actually open. Peers' paths may not exist here.
 */
export function useLocalProjects(): { rows: ProjectRow[]; ready: boolean } {
  const { agents, agentsLoaded } = useScout();
  const mesh = usePolled(() => api<MeshStatus>("/api/mesh"), 60_000);
  const local = mesh.data?.localNode?.id ?? null;
  const here = agents.filter((a) => !a.retiredFromFleet && (!local || agentMachineIds(a, local).has(local)));
  return { rows: projectRows(here), ready: agentsLoaded && (!!mesh.data || !!mesh.error) };
}

function Projects({ route, navigate, config, setConfig }: ModuleProps) {
  const scout = useScout();
  const own = isProjectsPage(route);
  const filter = own ? route.stateFilter : asStateFilter(config.state);
  const onFilter = (next: ProjectStateFilter | undefined) => {
    if (isProjectsPage(route)) scout.navigate(withStateFilter(route, next), { replace: true });
    else setConfig({ state: next ?? "" });
  };
  // the list reads the page's machine (or its own Host) and ephemeral flag, and marks the page's project
  // (an agent's page under /projects/:slug marks its project, as the page's rail did)
  const slug = pageProjectSlug(route) ?? (isAgentPage(route) ? route.projectSlug : undefined);
  const host = config.host || "";
  const railRoute = useMemo(
    () => ({ ...inboxRoute(route), ...(host ? { machineId: host } : {}), ...(slug ? { projectSlug: slug } : {}) }),
    [host, route, slug],
  );
  return (
    <div className="vw-pj vw-pj-list">
      <ProjectsRail
        variant="panel"
        route={railRoute}
        navigate={navigate}
        zeroPreview={projectsZeroPreviewEnabled()}
        stateFilter={filter}
        onStateFilter={onFilter}
      />
    </div>
  );
}

export const projectsModule = defineModule({
  type: "projects",
  title: "Projects",
  blurb: "Every project Scout tracks: find, sort, filter by state, add one",
  docs: {
    shows: "Find and Add project; the state lens (All, then each state a project is in) and the sort; one line per project with its name and its last activity, or Asking.",
    data: "useProjectsInbox(), the shared Projects loop (60s and on change); no request of its own.",
    opens: "The project's page, /projects/:slug.",
  },
  size: { w: 3, h: 14 },
  minSize: { w: 3, h: 6 },
  scopes: agentScopes.filter((s) => s.key === "host"),
  Component: Projects,
});
