/**
 * Project — one project's head: who works there and what it holds.
 *
 * Shows:  /name, ~/root and a digest (active · asking · agents · sessions),
 *         and the Worktrees and Rules links. With no project chosen: where
 *         work is live, a tile per asking or live project (its work now, its
 *         harnesses, its age); with none tracked yet, the composer that finds
 *         one or creates one from a pasted path with a default harness.
 * Data:   useProjectsInbox(), the shared Projects loop. Creating posts
 *         /api/onboarding/project.
 * Scope:  Project, by slug. "This page's project" follows /projects/:slug,
 *         through folded worktree slugs to the project they belong to.
 * Opens:  Worktrees: Repos for this root (/repos?root=); Rules: the project's
 *         AGENTS.md in Code; a live tile: its project's page; All projects
 *         (in the head, on the Projects view): the project list.
 */
import { useMemo } from "react";
import { HarnessCoin } from "../../../components/HarnessCoin.tsx";
import { timeAgoPast } from "../../../lib/time.ts";
import { ProjectScopeHeader, ProjectSurfaceState, ProjectZeroComposer } from "../../projects/ProjectsInbox.tsx";
import { projectsZeroPreviewEnabled } from "../../projects/ProjectsScreen.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { allProjectsRoute, isProjectsPage, liveProjectTiles, projectRoute } from "./projects-model.ts";
import { projectScope, usePanelProject, useProjectsPage } from "./projects-shared.tsx";
import { Quiet } from "./shared.tsx";
import "./projects.css";

/** The coins a tile shows before the rest fold into "+n". */
const TILE_COINS = 3;

/** Every project at once: where work is live, a tile each. */
function AllProjectsHead({ inbox, navigate }: { inbox: ReturnType<typeof useProjectsPage>; navigate: ModuleProps["navigate"] }) {
  const { model, page, nowMs } = inbox;
  const tiles = useMemo(() => liveProjectTiles(model), [model]);
  return (
    <header className="vw-pj-live">
      <div className="vw-pj-liveHead">
        <h1 className="vw-pj-liveTitle">{tiles.length > 0 ? "Live now" : "Nothing live right now"}</h1>
        <span className="vw-pj-liveSub">Pick a project for its root, branch, worktrees and rules.</span>
      </div>
      {tiles.length > 0 ? (
        <div className="vw-pj-tiles">
          {tiles.map((tile) => (
            <button
              key={tile.slug}
              type="button"
              className="vw-pj-tile"
              data-asking={tile.asking || undefined}
              onClick={() => navigate(projectRoute(page, tile.slug))}
            >
              <span className="vw-pj-tileMain">
                <span className="vw-pj-tileName">
                  /{tile.title}
                  {tile.branch ? <span className="vw-pj-tileBranch">{tile.branch}</span> : null}
                </span>
                <span className="vw-pj-tileNow" title={tile.work}>
                  {tile.asking ? (tile.work ? `Asking: ${tile.work}` : "Asking") : tile.work || "Working"}
                </span>
              </span>
              <span className="vw-pj-tileSide">
                <span className="vw-pj-tileCoins">
                  {tile.harnesses.slice(0, TILE_COINS).map((harness) => (
                    <HarnessCoin key={harness} harness={harness} size={20} />
                  ))}
                  {tile.harnesses.length > TILE_COINS ? <span className="vw-pj-tileMore">+{tile.harnesses.length - TILE_COINS}</span> : null}
                </span>
                <span className="vw-pj-tileAge">{timeAgoPast(tile.lastActivityAt, nowMs)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </header>
  );
}

function Project({ route, navigate, config }: ModuleProps) {
  const inbox = useProjectsPage(route);
  const { model, page, loading, error, hasData } = inbox;
  const { slug } = usePanelProject(route, config.project, model);
  const zero = projectsZeroPreviewEnabled();

  if (slug && !zero) {
    return (
      <div className="vw-pj vw-pj-project s-pi">
        {isProjectsPage(route) && (
          <ModuleHead>
            <button type="button" className="vw-chip" onClick={() => navigate(allProjectsRoute(page))} title="Back to the project list">
              All projects
            </button>
          </ModuleHead>
        )}
        <ProjectScopeHeader
          route={page}
          navigate={navigate}
          slug={slug}
          model={model}
          mode="overview"
          repoProject={null}
          variant="panel"
        />
      </div>
    );
  }
  if (loading && !hasData && !zero) return <Quiet>Reading projects…</Quiet>;
  if (error && !hasData && !zero) {
    return (
      <div className="vw-pj s-pi">
        <ProjectSurfaceState tone="error" title="Projects unavailable" detail={error} />
      </div>
    );
  }
  if (zero || model.projects.length === 0) {
    return (
      <div className="vw-pj vw-pj-zero s-pi">
        <ProjectZeroComposer route={page} navigate={navigate} projects={zero ? [] : model.projects} />
      </div>
    );
  }
  return (
    <div className="vw-pj vw-pj-project s-pi">
      <AllProjectsHead inbox={inbox} navigate={navigate} />
    </div>
  );
}

export const projectModule = defineModule({
  type: "project",
  title: "Project",
  blurb: "One project's head: digest and links to its worktrees and rules; where work is live across projects",
  docs: {
    shows: "The project's name, root and digest, and Worktrees and Rules links; with none chosen, a tile per asking or live project; the find-or-create composer when none is tracked.",
    data: "useProjectsInbox(), the shared Projects loop. Creating posts /api/onboarding/project.",
    opens: "Worktrees: /repos?root=; Rules: AGENTS.md in Code; a live tile: its project; All projects: the project list.",
  },
  size: { w: 9, h: 8 },
  minSize: { w: 4, h: 5 },
  scopes: [projectScope],
  Component: Project,
});
