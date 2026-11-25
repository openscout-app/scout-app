import { useCallback, useMemo } from "react";
import { ReposOpenPullRequests } from "../../repos/ReposOpenPullRequests.tsx";
import { useReposDisplay } from "../../repos/repos-display.ts";
import { findById, pageRepoTarget, repoPrPaths } from "../../repos/repos-model.ts";
import { repoPagePick, useRepoPullRequests, useRepoSelection } from "../../repos/use-repo-watch.ts";
import type { ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { diffRoute, selectRoute } from "./repos-panel.ts";
import { ReposScope } from "./repos-shared.tsx";
import { Quiet } from "./shared.tsx";

/*
 * Pull requests on the Repos routes, following the page: the Repos page's
 * open-PR list for every repo's checkout, grouped by the selection (its
 * branch, its repo, the rest), with each PR's actions (open, copy, check out,
 * select its worktree, open its diff, assign for review). One gh read, shared
 * with the Repos list's OPEN PRS stat. prs.tsx draws this when its project
 * follows the page on /repos or /repo-diff.
 */
export function ReposPullRequests({ route, navigate }: ModuleProps) {
  const target = useMemo(() => pageRepoTarget(route), [route]);
  const selection = useRepoSelection(target);
  const { tone } = useReposDisplay();
  const { snapshot, phase, error } = selection.watch;
  const paths = useMemo(() => (snapshot ? repoPrPaths(snapshot) : []), [snapshot]);
  const prs = useRepoPullRequests(paths);
  const selectWorktree = useCallback(
    (id: string) => {
      const worktree = findById(snapshot, id).worktree;
      if (!worktree) return;
      repoPagePick.set(id);
      const dest = selectRoute(route, worktree.path);
      if (dest) navigate(dest.to, { replace: dest.replace });
    },
    [navigate, route, snapshot],
  );
  const openDiff = useCallback((path: string) => navigate(diffRoute(path)), [navigate]);
  if (!snapshot) return <Quiet>{phase === "error" ? `Couldn't read Repo Watch: ${error ?? "no snapshot"}` : "Reading repositories…"}</Quiet>;
  if (!paths.length) return <Quiet>No repos to read pull requests for.</Quiet>;
  return (
    <ReposScope tone={tone} className="vw-repos-prs">
      {prs.error ? (
        <ModuleHead>
          <button type="button" className="vw-chip" onClick={prs.reload} title={prs.error}>
            Retry
          </button>
        </ModuleHead>
      ) : null}
      <ReposOpenPullRequests
        snapshot={prs.data}
        loading={prs.loading}
        error={prs.error}
        selectedProject={selection.project}
        selectedWorktree={selection.worktree}
        repoSnapshot={snapshot}
        onSelectWorktree={selectWorktree}
        onOpenDiff={openDiff}
        navigate={navigate}
        showEmpty
      />
    </ReposScope>
  );
}
