import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Route } from "../../lib/types.ts";
import { useContextMenu } from "../../components/ContextMenu.tsx";
import type {
  RepoWatchProject,
  RepoWatchSnapshot,
  RepoWatchWorktree,
} from "../../scout/repo-watch/types.ts";
import type { RepoPullRequestItem, RepoPullRequestSnapshot } from "../../scout/repo-watch/api.ts";
import { buildPullRequestMenuItems } from "../../scout/repo-watch/pull-request-actions.ts";
import { PullRequestAssignDialog } from "../../scout/repo-watch/PullRequestAssignDialog.tsx";
import { useScout } from "../../scout/Provider.tsx";
import { matchingWorktreeForPullRequest, prUpdatedAgo, pullRequestGroups } from "./repos-model.ts";
import "../../scout/repo-watch/console.css";

/**
 * Open pull requests on the Repos page, grouped by the selection: its branch,
 * then its repo, then the rest. Click (or right-click) a PR for its actions:
 * open on GitHub, copy, check out, select the worktree on its branch, open
 * its diff, or assign it to an agent for review (which follows the work).
 * The Repos screen draws it under the table; the Repos view's Pull requests
 * panel draws it on its own.
 */
export function ReposOpenPullRequests({
  snapshot,
  loading,
  error,
  selectedProject,
  selectedWorktree,
  repoSnapshot,
  onSelectWorktree,
  onOpenDiff,
  navigate,
  showEmpty = false,
}: {
  snapshot: RepoPullRequestSnapshot | null;
  loading: boolean;
  error: string | null;
  selectedProject: RepoWatchProject | null;
  selectedWorktree: RepoWatchWorktree | null;
  repoSnapshot: RepoWatchSnapshot | null;
  onSelectWorktree: (worktreeId: string) => void;
  onOpenDiff: (path: string) => void;
  navigate: (route: Route) => void;
  /** Say so when there are none, instead of drawing nothing (a panel of its own). */
  showEmpty?: boolean;
}) {
  const { agents } = useScout();
  const showContextMenu = useContextMenu();
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const [assignPr, setAssignPr] = useState<RepoPullRequestItem | null>(null);
  const [assignPending, setAssignPending] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const statusTimer = useRef<number | null>(null);

  const reportStatus = useCallback((message: string | null) => {
    setActionStatus(message);
    if (statusTimer.current != null) window.clearTimeout(statusTimer.current);
    if (message) {
      statusTimer.current = window.setTimeout(() => setActionStatus(null), 6_000);
    }
  }, []);

  useEffect(() => () => {
    if (statusTimer.current != null) window.clearTimeout(statusTimer.current);
  }, []);

  const closeAssign = useCallback(() => {
    if (assignPending) return;
    setAssignPr(null);
    setAssignError(null);
  }, [assignPending]);

  const projectsForAssign = useMemo(
    () => (repoSnapshot?.projects ?? []).map((project) => ({
      root: project.root,
      name: project.name,
    })),
    [repoSnapshot],
  );

  const pullRequests = snapshot?.pullRequests ?? [];
  const groups = pullRequestGroups(pullRequests, selectedProject, selectedWorktree);
  if (!showEmpty && !loading && !error && pullRequests.length === 0) return null;

  const openPrMenu = (event: ReactMouseEvent, pr: RepoPullRequestItem) => {
    event.preventDefault();
    showContextMenu(event, buildPullRequestMenuItems(pr, {
      matchingWorktree: matchingWorktreeForPullRequest(pr, repoSnapshot),
      onBeginAssign: (next) => {
        setAssignError(null);
        setAssignPr(next);
      },
      onSelectWorktreeId: onSelectWorktree,
      onOpenDiff,
      onStatus: reportStatus,
    }));
  };

  return (
    <section className="rw-open-prs" aria-label="Open pull requests">
      <div className="rw-open-prs-head">
        <div>
          <div className="rw-open-prs-eyebrow">Open PRs</div>
          <div className="rw-open-prs-title">
            {loading && pullRequests.length === 0 ? "Checking GitHub" : `${pullRequests.length} open`}
          </div>
          {actionStatus ? (
            <div className="rw-open-prs-status" role="status">{actionStatus}</div>
          ) : null}
        </div>
        {snapshot ? <span className="rw-open-prs-meta">gh</span> : null}
      </div>
      {pullRequests.length > 0 ? (
        <div className="rw-open-prs-list">
          {groups.map((group) => (
            <div key={group.key} className="rw-open-pr-group">
              {groups.length > 1 ? (
                <div className="rw-open-pr-group-label">{group.label}</div>
              ) : null}
              {group.items.map((pr) => (
                <button
                  key={pr.id}
                  type="button"
                  className="rw-open-pr"
                  title={`${pr.title} — click for actions`}
                  onClick={(event) => openPrMenu(event, pr)}
                  onContextMenu={(event) => openPrMenu(event, pr)}
                >
                  <span className="rw-open-pr-main">
                    <span className="rw-open-pr-number">#{pr.number}</span>
                    <span className="rw-open-pr-title" title={pr.title}>{pr.title}</span>
                  </span>
                  <span className="rw-open-pr-detail">
                    <span>{pr.repo}</span>
                    <span>{pr.headRefName || "head"} → {pr.baseRefName || "base"}</span>
                    {pr.isDraft ? <span>draft</span> : <span>open</span>}
                    {pr.author ? <span>@{pr.author}</span> : null}
                    <span>{prUpdatedAgo(pr.updatedAt, snapshot?.generatedAt ?? Date.now())}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="rw-open-prs-empty">
          {error ?? (loading ? "Reading pull requests…" : "No open pull requests returned.")}
        </div>
      )}

      {assignPr ? (
        <PullRequestAssignDialog
          pr={assignPr}
          agents={agents}
          projects={projectsForAssign}
          pending={assignPending}
          error={assignError}
          onClose={closeAssign}
          onPendingChange={setAssignPending}
          onError={setAssignError}
          onAssigned={(result) => {
            setAssignPr(null);
            setAssignError(null);
            reportStatus(result.message);
            if (result.flightId || result.conversationId || result.targetAgentId) {
              navigate({
                view: "follow",
                ...(result.flightId ? { flightId: result.flightId } : {}),
                ...(result.conversationId ? { conversationId: result.conversationId } : {}),
                ...(result.targetAgentId ? { targetAgentId: result.targetAgentId } : {}),
              });
            }
          }}
        />
      ) : null}
    </section>
  );
}

export default ReposOpenPullRequests;
