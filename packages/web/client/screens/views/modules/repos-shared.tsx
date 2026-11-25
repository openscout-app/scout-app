import { useMemo, type ReactNode } from "react";
import type { Route } from "../../../lib/types.ts";
import type { Tone } from "../../../scout/repo-watch/ui.ts";
import { pageRepoTarget } from "../../repos/repos-model.ts";
import { useRepoSelection, useRepoWatch } from "../../repos/use-repo-watch.ts";
import type { ModuleScope } from "./contract.ts";
import "./repos.css";

/*
 * What the Repos view's modules share: the one Repo Watch read and the page's
 * pick (screens/repos/use-repo-watch.ts), the Checkout scope, and the tone
 * wrapper the Repo Watch palette resolves from. No module here polls on its
 * own; two panels on the same repo read one scan.
 */

/** The repo the page is on: the selected worktree's, else the URL's root. */
export function useReposPageRoot(route: Route): string | null {
  const target = useMemo(() => pageRepoTarget(route), [route]);
  const selection = useRepoSelection(target);
  return selection.project?.root ?? target.root;
}

/** The picker's options: every checkout in the scan, by repo and branch. */
function useCheckoutOptions() {
  const { snapshot } = useRepoWatch();
  return useMemo(() => {
    const out: Array<{ value: string; label: string }> = [];
    for (const project of snapshot?.projects ?? []) {
      for (const wt of project.worktrees) {
        const branch = wt.branch.name ?? (wt.branch.detached ? "detached" : wt.name);
        out.push({ value: wt.path, label: `${project.name} · ${branch}` });
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  }, [snapshot]);
}

/**
 * Checkout, by path. "This page's checkout" follows the page: the URL on
 * /repos and /repo-diff, the Repos list's pick elsewhere. Unset, the busiest
 * checkout on the machine.
 */
export const checkoutScope: ModuleScope = {
  key: "root",
  allLabel: "Busiest checkout",
  followsPage: "This page's checkout",
  useOptions: useCheckoutOptions,
};

/** The Repo Watch palette (tone) and studio tokens, for a module's body. */
export function ReposScope({ tone, className, children }: { tone: Tone; className: string; children: ReactNode }) {
  return (
    <div className={`vw-repos ${className} repo-watch-scope`}>
      <div className={`rw-scope tone-${tone}`}>{children}</div>
    </div>
  );
}
