/**
 * Repos — every repo and worktree on this machine, unfinished work first.
 *
 * Shows:  the Repos screen's list: Refresh (with its receipt) and Display
 *         (table or drift, warm · cool · mono); then the table (repos with
 *         their worktree tree, churn, files, drift, agents and sessions, OPEN
 *         PRS, sorting, the clean & idle tray, scan coverage, Scan more,
 *         diagnostics) or the drift ruler. Scanning, Couldn't load (Retry)
 *         and Scout Services need attention (Restart broker, Scan again,
 *         Scan more) when there is nothing to list.
 * Data:   the shared Repo Watch read (screens/repos/use-repo-watch.ts):
 *         /api/repo-watch every 10s while visible, one read for every Repos
 *         panel; /api/repo-prs for each repo's checkout, shared with Pull
 *         requests, every 2 min; diffs of the 12 likeliest worktrees warmed.
 * Scope:  none; one per view. On /repos and /repo-diff the URL holds the
 *         selection; elsewhere the panel keeps the checkout it selected
 *         (state) and the panels following the page show it.
 * Opens:  a row selects it: /repos?root=<checkout> (replaced, ?machineId=
 *         kept; from /repo-diff a new entry); a row's diff:
 *         /repo-diff?path=<checkout>.
 */
import { useCallback, useMemo } from "react";
import type { RepoWatchWorktree } from "../../../scout/repo-watch/types.ts";
import { ReposScreen } from "../../repos/ReposScreen.tsx";
import { repoPagePick } from "../../repos/use-repo-watch.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { diffRoute, listRepoTarget, selectRoute } from "./repos-panel.ts";
import "./repos.css";

function Repos({ route, navigate, config, setConfig }: ModuleProps) {
  const target = useMemo(() => listRepoTarget(route, config.root), [route, config.root]);
  const onSelect = useCallback(
    (worktree: RepoWatchWorktree) => {
      repoPagePick.set(worktree.id);
      const dest = selectRoute(route, worktree.path);
      if (dest) navigate(dest.to, { replace: dest.replace });
      else setConfig({ root: worktree.path });
    },
    [navigate, route, setConfig],
  );
  const onViewDiff = useCallback((path: string) => navigate(diffRoute(path)), [navigate]);
  const panel = useMemo(() => ({ target, onSelect, onViewDiff }), [target, onSelect, onViewDiff]);
  return (
    <div className="vw-repos vw-repos-list">
      <ReposScreen navigate={navigate} panel={panel} />
    </div>
  );
}

export const reposModule = defineModule({
  type: "repos",
  title: "Repos",
  blurb: "Every repo and worktree on this machine: churn, drift, agents, open PRs",
  docs: {
    shows: "Refresh and Display (table or drift, tone); the table of repos and worktrees with churn, files, drift, agents, open PRs, the clean & idle tray, scan coverage and Scan more; or the drift ruler.",
    data: "The shared Repo Watch read: /api/repo-watch every 10s while visible, one for every Repos panel; /api/repo-prs shared with Pull requests, every 2 min.",
    opens: "A row selects it: /repos?root= (replaced); its diff: /repo-diff?path=.",
  },
  size: { w: 8, h: 15 },
  minSize: { w: 5, h: 8 },
  state: ["root"],
  maxPerView: 1,
  Component: Repos,
});
