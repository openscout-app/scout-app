/**
 * Project details — the right side of a project's page: its facts, read-only.
 *
 * Shows:  where the project lives (host and root), its worktrees and their
 *         branches, the agents who worked there with their harnesses, and its
 *         sessions (live and in all). With no project chosen, a line saying so.
 * Data:   useProjectsInbox(), the shared Projects loop; nothing of its own.
 * Scope:  Project, by slug: the page's project.
 * Opens:  a worktree in Changes (/repos?root=).
 */
import { useMemo } from "react";
import { HarnessCoin } from "../../../components/HarnessCoin.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { projectScope, usePanelProject, useProjectsPage } from "./projects-shared.tsx";
import { worktreeLabel, type ProjectsInboxModel } from "../../projects/projects-inbox-model.ts";
import { Quiet } from "./shared.tsx";
import "./project-details.css";

type Worker = { name: string; harness: string; lastActivityAt: number };

/** Everyone who worked in the project, newest first, once per name and harness. */
export function projectWorkers(model: ProjectsInboxModel, slug: string): Worker[] {
  const byKey = new Map<string, Worker>();
  for (const entry of [...model.threads, ...model.sessions]) {
    if (entry.projectSlug !== slug || !entry.agentName) continue;
    const key = `${entry.agentName}\u0000${entry.harness}`;
    const seen = byKey.get(key);
    if (!seen || seen.lastActivityAt < entry.lastActivityAt) {
      byKey.set(key, { name: entry.agentName, harness: entry.harness, lastActivityAt: entry.lastActivityAt });
    }
  }
  return [...byKey.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="vw-pd-sec">
      <h3 className="vw-pd-title">{title}</h3>
      {children}
    </section>
  );
}

function ProjectDetails({ route, navigate, config }: ModuleProps) {
  const { model } = useProjectsPage(route);
  const { slug, project } = usePanelProject(route, config.project, model);
  const workers = useMemo(() => (slug ? projectWorkers(model, slug) : []), [model, slug]);

  if (!slug || !project) return <Quiet>Pick a project for its details.</Quiet>;
  const host = "machineId" in route && route.machineId ? route.machineId : "This host";

  return (
    <div className="vw-pd">
      <Section title="Where">
        <div className="vw-pd-line">{host}</div>
        {project.root ? <div className="vw-pd-line vw-pd-path" title={project.root}>{project.root}</div> : null}
      </Section>
      <Section title={project.worktrees.length === 1 ? "Worktree" : `Worktrees, ${project.worktrees.length}`}>
        {project.worktrees.length === 0 ? <div className="vw-pd-line vw-pd-dim">None found</div> : null}
        {project.worktrees.map((worktree) => (
          <button
            key={worktree.root}
            type="button"
            className="vw-pd-row"
            title={worktree.root}
            onClick={() => navigate({ view: "repos", root: worktree.root })}
          >
            <span className="vw-pd-rowMain">{worktreeLabel(worktree)}</span>
            {worktree.working ? <span className="vw-pd-live">working</span> : null}
          </button>
        ))}
      </Section>
      <Section title="Worked here">
        {workers.length === 0 ? <div className="vw-pd-line vw-pd-dim">No agents yet</div> : null}
        {workers.map((worker) => (
          <div key={`${worker.name}:${worker.harness}`} className="vw-pd-row vw-pd-static">
            <HarnessCoin harness={worker.harness} size={16} />
            <span className="vw-pd-rowMain">{worker.name}</span>
          </div>
        ))}
      </Section>
      <Section title="Sessions">
        <div className="vw-pd-line">
          {project.liveSessionCount > 0 ? `${project.liveSessionCount} live, ` : ""}
          {project.sessionCount} in all
        </div>
      </Section>
    </div>
  );
}

export const projectDetailsModule = defineModule({
  type: "project-details",
  title: "Details",
  blurb: "One project's facts: where it lives, its worktrees, who worked there and its sessions",
  docs: {
    shows: "The project's host and root, its worktrees with their branches, the agents who worked there with their harnesses, and its session counts.",
    data: "useProjectsInbox(), the shared Projects loop.",
    opens: "A worktree in Changes (/repos?root=).",
  },
  size: { w: 3, h: 20 },
  minSize: { w: 2, h: 8 },
  scopes: [projectScope],
  Component: ProjectDetails,
});
