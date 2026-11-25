/**
 * Project agents — the durable agents behind the work, as cards.
 *
 * Shows:  a project's one coding agent as a card: avatar (turned a little
 *         away until you come to the card, then facing you and following
 *         the pointer; it breathes), harness marks, status, headline, root and
 *         sessions, last work and age. With no project chosen: Role agents,
 *         then each project's agent.
 * Data:   useProjectsInbox(), the shared Projects loop, and the roster in
 *         Scout context. No request of its own.
 * Scope:  Project, by slug. "This page's project" follows /projects/:slug.
 * Opens:  Open project (its page), Browse code (Code), Chat (its
 *         conversation), Inspect (the agent's profile).
 */
import { useMemo } from "react";
import { AgentDirectory, ProjectAgentDirectory } from "../../projects/CrewWorkspaces.tsx";
import { buildCrewMembers } from "../../projects/crew-workspaces-model.ts";
import { threadsForProject } from "../../projects/projects-inbox-model.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { projectScope, usePanelProject, useProjectsPage } from "./projects-shared.tsx";
import { Quiet } from "./shared.tsx";
import "./projects.css";

function ProjectAgents({ route, navigate, config }: ModuleProps) {
  const { model, agents, nowMs, page, loading, hasData } = useProjectsPage(route);
  const { slug, project } = usePanelProject(route, config.project, model);
  const threads = useMemo(() => (slug ? threadsForProject(model.threads, slug) : []), [model.threads, slug]);
  const members = useMemo(
    () => (slug ? [] : buildCrewMembers(model.projects, model.threads, agents, page.machineId ?? null)),
    [agents, model.projects, model.threads, page.machineId, slug],
  );
  if (loading && !hasData) return <Quiet>Reading agents…</Quiet>;
  if (slug && !project) return <Quiet>This project has no agent yet.</Quiet>;
  return (
    <div className="vw-pj vw-pj-crew s-pi">
      {slug && project ? (
        <ProjectAgentDirectory project={project} threads={threads} route={{ ...page, projectSlug: slug }} navigate={navigate} nowMs={nowMs} />
      ) : (
        <div className="cw-root">
          <AgentDirectory members={members} route={page} navigate={navigate} nowMs={nowMs} allEmpty={members.length === 0} />
        </div>
      )}
    </div>
  );
}

export const projectAgentsModule = defineModule({
  type: "project-agents",
  title: "Project agents",
  blurb: "The durable agents behind the work, as cards: a project's agent, or every role and project agent",
  docs: {
    shows: "A project's agent as a card with status, headline, root, sessions and last work; Role agents and every project's agent when none is chosen.",
    data: "useProjectsInbox(), the shared Projects loop, and the roster; no request of its own.",
    opens: "Open project, Browse code, Chat, Inspect.",
  },
  size: { w: 3, h: 14 },
  minSize: { w: 3, h: 7 },
  scopes: [projectScope],
  Component: ProjectAgents,
});
