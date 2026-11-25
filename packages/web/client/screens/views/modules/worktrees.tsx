/**
 * Worktrees — a project's repository and every checkout of it, with what is
 * unfinished in each.
 *
 * Shows:  the repository card (name, root, current branch with a pulse when
 *         something is moving, last activity, sessions · agents · threads),
 *         then up to six worktrees: branch, path, +/- churn and its bar,
 *         files changed or clean, ahead/behind, staged · unstaged · untracked ·
 *         conflicts, diff layers and PRs on the branch; "+N more".
 * Data:   useProjectRepositoryState(root, worktree paths): the shared Repo
 *         Watch read, /api/repo-watch every 10s for every panel on the page
 *         (an expanded scan when the project is missing), each
 *         worktree's summary diff every 20s, /api/repo-prs every 60s; all
 *         paused while the tab is hidden. The project and its known worktrees
 *         come from useProjectsInbox(), the shared Projects loop.
 * Scope:  Project, by slug. "This page's project" follows /projects/:slug,
 *         and on /repos and /repo-diff the selected worktree's repo.
 *         On the Projects page the head names the project and its root.
 * Opens:  View diff: /repo-diff?path=<worktree>; Retry rescans; Repos (in the
 *         head, off the Repos routes): every repo at /repos?root=<root>. On
 *         the Projects page a click on a worktree previews it in the Session
 *         panel (?worktree=), ↑/↓ move it, double-click or Enter open its
 *         diff, ⌘-click opens the diff in a new tab, and the last row is
 *         every worktree (/repos?root=).
 */
import { useMemo } from "react";
import { routePath } from "../../../lib/router.ts";
import type { Route } from "../../../lib/types.ts";
import { shortHomePath } from "../../projects/project-overview-helpers.ts";
import { ProjectOverviewWithRepository, type WorktreeBrowse } from "../../projects/ProjectsInbox.tsx";
import { resolveProjectSlugFromRoot, sessionsForProject, threadsForProject } from "../../projects/projects-inbox-model.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { isProjectsPage, previewRoute } from "./projects-model.ts";
import { isModifiedClick, openRouteInNewTab, projectScope, usePanelProject, useProjectsPage } from "./projects-shared.tsx";
import { isReposRoute } from "./repos-panel.ts";
import { useReposPageRoot } from "./repos-shared.tsx";
import { Quiet } from "./shared.tsx";
import "./projects.css";

function Worktrees(props: ModuleProps) {
  return props.config.project === FOLLOW_PAGE && isReposRoute(props.route) ? <ReposPageWorktrees {...props} /> : <ProjectWorktrees {...props} />;
}

/** On the Repos routes the page's project is the selected worktree's repo. */
function ReposPageWorktrees(props: ModuleProps) {
  return <ProjectWorktrees {...props} repoRoot={useReposPageRoot(props.route)} />;
}

function ProjectWorktrees({ route, navigate, config, repoRoot }: ModuleProps & { repoRoot?: string | null }) {
  const { model, nowMs, page, loading, hasData } = useProjectsPage(route);
  const onRepos = repoRoot !== undefined;
  const { slug, project } = usePanelProject(route, onRepos ? (resolveProjectSlugFromRoot(model, repoRoot) ?? "") : config.project, model);
  const threads = useMemo(() => (slug ? threadsForProject(model.threads, slug) : []), [model.threads, slug]);
  const sessions = useMemo(() => (slug ? sessionsForProject(model.sessions, slug) : []), [model.sessions, slug]);
  if (onRepos && !slug) return <Quiet>{repoRoot ? (loading && !hasData ? "Reading projects…" : "This repo is not one of your projects; its worktrees are in Repos.") : "Pick a worktree in Repos to see its project."}</Quiet>;
  if (!slug) return <Quiet>Pick a project to see its worktrees, branches and diffs.</Quiet>;
  if (!project && loading && !hasData) return <Quiet>Reading projects…</Quiet>;
  const root = project?.root ?? sessions[0]?.projectRoot ?? threads[0]?.projectRoot ?? null;
  // on the Projects page this panel's head names the page's project, which has no panel of its own
  const naming = !onRepos && isProjectsPage(route) && project;
  const reposRoute: Route = { view: "repos", ...(root ? { root } : {}), ...(page.machineId ? { machineId: page.machineId } : {}) };
  // on the Projects page a worktree previews in place (?worktree=); its diff is the page to open
  const diffRoute = (path: string): Route => ({ view: "repo-diff", path });
  const browse: WorktreeBrowse | undefined = !onRepos && isProjectsPage(route) ? {
    selected: page.worktree ?? null,
    onSelect: (path, event, replace) => {
      if (event && isModifiedClick(event)) openRouteInNewTab(diffRoute(path));
      else navigate(previewRoute(page, { worktree: path }), { replace });
    },
    onOpen: (path) => navigate(diffRoute(path)),
    all: {
      href: routePath(reposRoute),
      onClick: (event) => {
        if (isModifiedClick(event)) return;
        event.preventDefault();
        navigate(reposRoute);
      },
    },
  } : undefined;
  return (
    <div className="vw-pj vw-pj-worktrees s-pi">
      <ModuleHead
        beside={naming ? (
          <span className="vw-dim vw-ell" title={root ?? undefined}>
            /{project.title}{root ? ` · ${shortHomePath(root)}` : ""}
          </span>
        ) : undefined}
      >
        {onRepos ? null : (
        <button
          type="button"
          className="vw-chip"
          title="Every repo and worktree in Repos"
          onClick={() => navigate(reposRoute)}
        >
          Repos
        </button>
        )}
      </ModuleHead>
      <ProjectOverviewWithRepository
        key={slug}
        project={project}
        threads={threads}
        sessions={sessions}
        route={{ ...page, projectSlug: slug }}
        navigate={navigate}
        nowMs={nowMs}
        showPullRequests={false}
        browse={browse}
      />
    </div>
  );
}

export const worktreesModule = defineModule({
  type: "worktrees",
  title: "Worktrees",
  blurb: "A project's repository and its worktrees: branch, churn, drift, unfinished work",
  docs: {
    shows: "The repository card, then up to six worktrees with branch, churn, files changed, ahead/behind, staged/unstaged/untracked/conflicts and PRs on the branch. On /repos and /repo-diff, the selected worktree's project.",
    data: "useProjectRepositoryState: the shared Repo Watch read (10s), worktree diffs every 20s, /api/repo-prs every 60s, paused while hidden.",
    opens: "View diff: /repo-diff?path=; Retry rescans; Repos: /repos?root=.",
  },
  size: { w: 6, h: 14 },
  minSize: { w: 4, h: 6 },
  scopes: [projectScope],
  Component: Worktrees,
});
