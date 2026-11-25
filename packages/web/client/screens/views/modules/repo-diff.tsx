/**
 * Diff — a worktree's diff: branch, staged and unstaged changes, file by file.
 *
 * Shows:  the repo diff viewer: layers, the file list, each file's hunks,
 *         comments. On /repo-diff, the URL's diff with its layers, files and
 *         session (Close returns to Repos with that checkout); elsewhere the
 *         followed checkout's, with Open as page. Quiet when the checkout is
 *         clean and level with its base.
 * Data:   /api/repo-diff through the diff cache (in-flight reads shared,
 *         fresh for 30s; the Repos list warms the likeliest 12). The checkout
 *         comes from the shared Repo Watch read.
 * Scope:  Checkout: "This page's checkout" follows /repo-diff?path= and
 *         /repos?root= (elsewhere the Repos list's pick); a path pins one;
 *         unset, the busiest checkout.
 * Opens:  Open as page: /repo-diff?path=<checkout>; Close (on /repo-diff):
 *         /repos?root=<checkout>.
 */
import { useMemo } from "react";
import { RepoDiffViewerLazy } from "../../../scout/repo-diff/RepoDiffViewerLazy.tsx";
import { pathLeaf } from "../../../scout/repo-watch/ui.ts";
import { RepoDiffPageScreen } from "../../repos/RepoDiffPageScreen.tsx";
import { rootStatus } from "../../repos/repo-watch-store.ts";
import { canDiffWorktree } from "../../repos/repos-model.ts";
import { useRepoSelection } from "../../repos/use-repo-watch.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { closeDiffRoute, diffFollowsRoute, diffRoute, panelRepoTarget } from "./repos-panel.ts";
import { checkoutScope } from "./repos-shared.tsx";
import { Quiet } from "./shared.tsx";
import "./repos.css";

function RepoDiff(props: ModuleProps) {
  const { route, navigate, config } = props;
  if (diffFollowsRoute(route, config.root)) {
    return (
      <div className="vw-repos vw-repo-diff">
        <RepoDiffPageScreen
          path={route.path}
          layers={route.layers}
          files={route.files}
          sessionId={route.sessionId}
          agentId={route.agentId}
          include={route.include}
          navigate={navigate}
          onClose={() => navigate(closeDiffRoute(route.path))}
        />
      </div>
    );
  }
  return <WorktreeDiff {...props} />;
}

function WorktreeDiff({ route, navigate, config }: ModuleProps) {
  const target = useMemo(() => panelRepoTarget(route, config.root), [route, config.root]);
  const selection = useRepoSelection(target);
  const { snapshot, phase, error } = selection.watch;
  if (!snapshot) return <Quiet>{phase === "error" ? `Couldn't read Repo Watch: ${error ?? "no snapshot"}` : "Reading repositories…"}</Quiet>;
  if (selection.missing) {
    const looking = rootStatus(selection.watch, target.root) === "looking";
    return <Quiet>{looking ? "Looking wider for this repo…" : `Repo Watch has no repo at ${target.root}.`}</Quiet>;
  }
  const worktree = selection.worktree;
  if (!worktree) return <Quiet>{snapshot.projects.length ? "Pick a worktree in Repos to see its diff." : "No repos in the last scan."}</Quiet>;
  const name = worktree.branch.name ?? pathLeaf(worktree.path);
  if (!canDiffWorktree(worktree)) return <Quiet>{`${name} is clean and level with its base: nothing to diff.`}</Quiet>;
  const path = worktree.path;
  return (
    <div className="vw-repos vw-repo-diff">
      <RepoDiffViewerLazy key={path} path={path} onOpenAsPage={() => navigate(diffRoute(path))} />
    </div>
  );
}

export const repoDiffModule = defineModule({
  type: "repo-diff",
  title: "Diff",
  blurb: "A worktree's diff, file by file: the page's, the selected checkout's, or one you pin",
  docs: {
    shows: "The repo diff viewer: layers, files, hunks and comments. On /repo-diff the URL's diff (layers, files, session); elsewhere the followed checkout's, quiet when it is clean.",
    data: "/api/repo-diff through the diff cache (shared in-flight reads, fresh 30s); the checkout from the shared Repo Watch read.",
    opens: "Open as page: /repo-diff?path=; Close on /repo-diff: /repos?root=.",
  },
  size: { w: 12, h: 20 },
  minSize: { w: 5, h: 10 },
  scopes: [checkoutScope],
  Component: RepoDiff,
});
