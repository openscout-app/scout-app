/**
 * Worktree — one checkout's state: what changed, who is on it, and an Ask.
 *
 * Shows:  the Repos context pane for the checkout: branch, upstream and
 *         drift, churn, changed files, attention reasons, attached agents and
 *         sessions, last commit; the Ask composer (to Scout or an attached
 *         agent, with the worktree's state attached). Reading, a repo the
 *         scan lacks ("looking wider", then "no repo at"), or nothing picked.
 * Data:   the shared Repo Watch read (no read of its own), so it matches the
 *         Repos list beside it; a missing root gets one expanded scan.
 * Scope:  Checkout: "This page's checkout" follows /repos?root= and
 *         /repo-diff?path= (elsewhere the Repos list's pick); a path pins one;
 *         unset, the busiest checkout.
 * Opens:  nothing; Ask posts to Scout (/api/send) or the agent (/api/ask).
 */
import { useMemo } from "react";
import { ReposContextPane } from "../../repos/right.tsx";
import { rootStatus } from "../../repos/repo-watch-store.ts";
import { useReposDisplay } from "../../repos/repos-display.ts";
import { useRepoSelection } from "../../repos/use-repo-watch.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { panelRepoTarget } from "./repos-panel.ts";
import { checkoutScope } from "./repos-shared.tsx";
import { Quiet } from "./shared.tsx";
import "./repos.css";

function RepoWorktree({ route, config }: ModuleProps) {
  const target = useMemo(() => panelRepoTarget(route, config.root), [route, config.root]);
  const selection = useRepoSelection(target);
  const { tone } = useReposDisplay();
  const { snapshot, phase, error } = selection.watch;
  if (!snapshot) return <Quiet>{phase === "error" ? `Couldn't read Repo Watch: ${error ?? "no snapshot"}` : "Reading repositories…"}</Quiet>;
  if (selection.missing) {
    const looking = rootStatus(selection.watch, target.root) === "looking";
    return <Quiet>{looking ? "Looking wider for this repo…" : `Repo Watch has no repo at ${target.root}.`}</Quiet>;
  }
  if (!selection.worktree) return <Quiet>{snapshot.projects.length ? "Pick a worktree in Repos to see its state." : "No repos in the last scan."}</Quiet>;
  return (
    <div className="vw-repos vw-repo-worktree repo-watch-scope">
      <ReposContextPane
        worktree={selection.worktree}
        project={selection.project}
        generatedAt={snapshot.generatedAt}
        tone={tone}
      />
    </div>
  );
}

export const repoWorktreeModule = defineModule({
  type: "repo-worktree",
  title: "Worktree",
  blurb: "One checkout: branch, drift, churn, files, agents and sessions, with an Ask",
  docs: {
    shows: "The Repos context pane: branch and drift, churn, changed files, attention, agents and sessions, last commit, and the Ask composer.",
    data: "The shared Repo Watch read, no read of its own; one expanded scan for a repo the scan lacks.",
    opens: "Nothing; Ask posts to Scout or the attached agent.",
  },
  size: { w: 4, h: 15 },
  minSize: { w: 3, h: 8 },
  scopes: [checkoutScope],
  Component: RepoWorktree,
});
