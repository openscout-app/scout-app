/**
 * Changes — what changed in one checkout, file by file.
 *
 * Shows:  the branch and its shortstat, then each changed file Repo Watch
 *         lists (folder dim, name, its status letter), the open file marked,
 *         and "+N more in the diff" when Repo Watch lists fewer than it
 *         counts. The head counts the changed files. Quiet lines: Reading
 *         changes…, Clean on <branch>, a checkout Repo Watch does not list,
 *         Resolving "<project>"…, why a link missed, No repo selected.
 * Data:   the repo-watch quick snapshot every Code panel shares
 *         (screens/code/code-snapshot.ts): read on open and every 30s while
 *         the window is visible, on one timer for every Changes panel.
 * Scope:  root = "@route" follows the page (on Code the URL; on a project,
 *         repo or diff page that checkout), an absolute root, or "" for the
 *         repo of the file open beside it, else the last repo read.
 * Opens:  a file: on Code the URL, so Files and File follow; anywhere else
 *         the File panel beside it (code-pick.ts). Diff: the checkout's Repo
 *         Diff page.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  codeRouteFor,
  diffBadge,
  findWorktree,
  isInside,
  type CodeTarget,
} from "../../code/code-browser-model.ts";
import { prefetchFilePreview } from "../../code/code-preview.ts";
import { pollCodeSnapshot } from "../../code/code-snapshot.ts";
import { useCodeTarget } from "../../code/use-code-target.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { moreChanges, rootPlan, splitChangedPath } from "./code-panel-model.ts";
import { codePicks } from "./code-pick.ts";
import { CODE_CHANGES_ROOT_SCOPE } from "./code-scopes.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import "../../code/code-screen.css";
import "./code-panels.css";

export const CHANGES_REFRESH_MS = 30_000;

function CodeChanges({ instanceId, route, navigate, config }: ModuleProps) {
  const plan = rootPlan(config, route);
  const onRoute = plan.source === "route";
  const latest = useSyncExternalStore(codePicks.subscribe, codePicks.latest, codePicks.latest);
  // nothing chosen: the repo of the file open beside it, before the last repo read
  const besideRoot = plan.source === "last" ? latest?.root ?? null : null;
  const target: CodeTarget | null = besideRoot ? { root: besideRoot } : plan.target;
  // on Code the URL's file (restored as the page does) is the open one
  const state = useCodeTarget(target, { fallback: plan.fallback, restore: onRoute });
  const { root, snapshot } = state;
  const openFile = onRoute ? state.file : latest && root && isInside(root, latest.file) ? latest.file : null;
  const returnConversationId = onRoute && route.view === "code" ? route.returnConversationId ?? null : null;

  // one shared poll however many Changes panels are open
  useEffect(() => pollCodeSnapshot(CHANGES_REFRESH_MS), []);

  // a file picked here leaves File when this panel moves to another checkout, or goes
  useEffect(() => {
    const mine = codePicks.get(instanceId);
    if (mine && (!root || !isInside(root, mine.file))) codePicks.withdraw(instanceId);
  }, [instanceId, root]);
  useEffect(() => () => codePicks.withdraw(instanceId), [instanceId]);

  const open = useCallback((path: string) => {
    if (!root) return;
    if (onRoute) navigate(codeRouteFor(snapshot, root, path, { returnConversationId }));
    else codePicks.publish(instanceId, { root, file: path }, true);
  }, [instanceId, navigate, onRoute, returnConversationId, root, snapshot]);

  const active = useMemo(() => findWorktree(snapshot, root), [snapshot, root]);
  const status = active?.worktree.status;
  const files = status?.files ?? [];
  const more = status ? moreChanges(status.changedFiles, files.length) : 0;
  const branch = active?.worktree.branch.name ?? (active?.worktree.branch.detached ? "a detached head" : null);
  const openDiff = root ? () => navigate({ view: "repo-diff", path: root }) : null;

  return (
    <div className="vw-code-changes">
      <ModuleHead>
        {status ? <span className="hud-grid-count">{status.changedFiles}</span> : null}
        {openDiff ? (
          <button type="button" className="vw-chip" onClick={openDiff} title="Open this checkout's diff">
            Diff
          </button>
        ) : null}
      </ModuleHead>
      {active && status ? (
        <>
          <div className="vw-code-meta">
            {branch ? <span className="vw-code-branch">{branch}</span> : null}
            {active.worktree.diff.branchShortstat ? <span className="s-code-headStat">{active.worktree.diff.branchShortstat}</span> : null}
          </div>
          {files.length > 0 ? (
            <div className="vw-code-changeList" role="list" aria-label="Changed files">
              {files.map((change) => {
                const path = `${root}/${change.path}`;
                const { dir, name } = splitChangedPath(change.path);
                return (
                  <button
                    key={change.path}
                    type="button"
                    role="listitem"
                    className="s-code-node"
                    data-selected={path === openFile || undefined}
                    title={`${change.path} · ${change.status}`}
                    onClick={() => open(path)}
                    onMouseEnter={() => prefetchFilePreview(path)}
                  >
                    <span className="s-code-nodeName">
                      {dir ? <span className="vw-code-dir">{dir}</span> : null}
                      {name}
                    </span>
                    <span className="vw-code-letter">{diffBadge(change.status)}</span>
                  </button>
                );
              })}
              {more > 0 && openDiff ? (
                <button type="button" className="vw-code-more" onClick={openDiff}>
                  +{more} more in the diff
                </button>
              ) : null}
            </div>
          ) : status.changedFiles > 0 && openDiff ? (
            <button type="button" className="vw-code-more" onClick={openDiff}>
              {status.changedFiles} changed · open the diff
            </button>
          ) : (
            <Quiet>Clean{branch ? ` on ${branch}` : ""}.</Quiet>
          )}
        </>
      ) : root && !snapshot ? (
        <Quiet>Reading changes…</Quiet>
      ) : root ? (
        <Quiet>Repo Watch doesn't list this checkout yet, so its changes aren't known here.</Quiet>
      ) : state.phase === "resolving" ? (
        <Quiet>Resolving “{state.project}”…</Quiet>
      ) : state.phase === "failed" ? (
        <Quiet>{state.message}</Quiet>
      ) : (
        <Quiet>No repo selected.</Quiet>
      )}
    </div>
  );
}

export const codeChangesModule = defineModule({
  type: "code-changes",
  title: "Changes",
  blurb: "What changed in one checkout, file by file; open one to read it",
  docs: {
    shows: "Branch and shortstat, then each changed file with its status letter; the open file marked.",
    data: "The repo-watch quick snapshot every Code panel shares, on open and every 30s while visible.",
    opens: "A file: on Code the URL, anywhere else the File panel beside it. Diff: the checkout's Repo Diff.",
  },
  size: { w: 3, h: 8 },
  minSize: { w: 2, h: 5 },
  scopes: [CODE_CHANGES_ROOT_SCOPE],
  Component: CodeChanges,
});
