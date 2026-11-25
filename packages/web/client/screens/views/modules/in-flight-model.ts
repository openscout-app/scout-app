/*
 * In flight without React: which worktrees have work on them, across every
 * repo Repo Watch found, and how each one's line reads. The In flight panel
 * (in-flight.tsx) draws these rows; pure, so the rules test on their own.
 *
 * A worktree is in flight when it holds uncommitted changes, an open or
 * draft PR is on its branch, or someone is on it: an agent the broker
 * reports a state for (not offline), or a harness session working in it.
 * Registered agents with no endpoint carry no state and do not count, so a
 * project's own checkout is not in flight just for being a project.
 */
import type { Route } from "../../../lib/types.ts";
import type { RepoPullRequestItem } from "../../../scout/repo-watch/api.ts";
import type { RepoWatchSnapshot, RepoWatchWorktree } from "../../../scout/repo-watch/types.ts";
import { agentLive, agoFromMillis, branchChurnOf, churnOf, uniqueAgents } from "../../../scout/repo-watch/ui.ts";
import { canDiffWorktree, matchingWorktreeForPullRequest } from "../../repos/repos-model.ts";

/** Behind its upstream (git status's branch.ab, not main) by more than this reads underlined. */
export const FAR_BEHIND = 20;

/** How many lines the panel draws before "+N more". */
export const IN_FLIGHT_CAP = 12;

export type InFlightPr = { number: number; state: "open" | "draft"; title: string; url: string };

export type InFlightRow = {
  id: string;
  path: string;
  project: string;
  /** The branch, a short sha when detached, or the path's leaf. */
  branch: string;
  pr: InFlightPr | null;
  /** What the diff would show: the branch's commits plus staged and unstaged work. */
  churn: { add: number; del: number; files: number };
  ahead: number;
  behind: number;
  /** Uncommitted changes in the checkout. */
  dirty: boolean;
  /** Who is on it, live first: agent names, then harness sessions. */
  on: string[];
  /** Any of them working right now. */
  live: boolean;
  /** Newest activity: now while someone is live on it, else the last commit. Null when unknown. */
  activityAt: number | null;
  opens: Route;
};


function branchOf(wt: RepoWatchWorktree): string {
  if (wt.branch.detached) return wt.branch.head ? wt.branch.head.slice(0, 7) : "detached";
  return wt.branch.name ?? wt.name;
}

/** Open PRs by the worktree whose branch they are on; the first PR read wins a worktree. */
function prsByWorktree(snapshot: RepoWatchSnapshot, prs: readonly RepoPullRequestItem[]): Map<string, InFlightPr> {
  const out = new Map<string, InFlightPr>();
  for (const pr of prs) {
    const match = matchingWorktreeForPullRequest(pr, snapshot);
    if (!match || out.has(match.id)) continue;
    out.set(match.id, { number: pr.number, state: pr.isDraft ? "draft" : "open", title: pr.title, url: pr.url });
  }
  return out;
}

/** One worktree's line, in flight or not. */
export function inFlightRow(wt: RepoWatchWorktree, project: string, pr: InFlightPr | null, generatedAt: number): InFlightRow {
  // only who is working there now: an idle or offline agent, or a session file Tail once found in the
  // folder (which carries no activity time), is not someone on it — counting them put +229 on a checkout
  const agents = uniqueAgents(wt).filter(agentLive);
  const live = agents.length > 0;
  const on = agents.map((a) => a.name?.trim() || a.id);
  const branch = branchChurnOf(wt);
  const working = churnOf(wt);
  return {
    id: wt.id,
    path: wt.path,
    project,
    branch: branchOf(wt),
    pr,
    // the Repos table's count: the branch's files plus the working tree's (untracked included)
    churn: { add: branch.add + working.add, del: branch.del + working.del, files: branch.files + Math.max(working.files, wt.status.changedFiles) },
    ahead: wt.branch.ahead,
    behind: wt.branch.behind,
    dirty: !wt.status.clean,
    on,
    live,
    activityAt: live ? generatedAt : wt.lastCommitAt,
    opens: canDiffWorktree(wt) ? { view: "repo-diff", path: wt.path } : { view: "repos", root: wt.path },
  };
}

/** A checkout that is only dirty, with no commit in this long, was left, not in flight. */
export const LEFT_AFTER_MS = 14 * 24 * 60 * 60_000;

/** Someone on it or an open PR always; uncommitted changes only while the worktree has moved recently. */
export function isInFlight(row: InFlightRow, now: number): boolean {
  if (row.pr !== null || row.on.length > 0) return true;
  // no commit time (a fresh repo) cannot be called left
  return row.dirty && (row.activityAt === null || now - row.activityAt < LEFT_AFTER_MS);
}

/** Newest activity first; unknown last. Ties: someone live, then the bigger diff, then by name. */
export function compareInFlight(a: InFlightRow, b: InFlightRow): number {
  const at = (r: InFlightRow) => r.activityAt ?? -Infinity;
  if (at(a) !== at(b)) return at(b) - at(a);
  if (a.live !== b.live) return a.live ? -1 : 1;
  const churn = (r: InFlightRow) => r.churn.add + r.churn.del;
  if (churn(a) !== churn(b)) return churn(b) - churn(a);
  return `${a.project}/${a.branch}`.localeCompare(`${b.project}/${b.branch}`);
}

/** Every worktree with work on it, across every repo in the snapshot, newest activity first. */
export function inFlightRows(snapshot: RepoWatchSnapshot | null, prs: readonly RepoPullRequestItem[] | null | undefined): InFlightRow[] {
  if (!snapshot) return [];
  const byWorktree = prsByWorktree(snapshot, prs ?? []);
  const rows: InFlightRow[] = [];
  for (const project of snapshot.projects) {
    for (const wt of project.worktrees) {
      if (wt.isBare) continue;
      const row = inFlightRow(wt, project.name, byWorktree.get(wt.id) ?? null, snapshot.generatedAt);
      if (isInFlight(row, snapshot.generatedAt)) rows.push(row);
    }
  }
  return rows.sort(compareInFlight);
}

/** "↑6 ↓3", "even" with no drift; far marks a branch more than FAR_BEHIND behind. */
export function driftLabel(ahead: number, behind: number): { text: string; far: boolean } {
  if (!ahead && !behind) return { text: "even", far: false };
  return { text: [ahead ? `↑${ahead}` : "", behind ? `↓${behind}` : ""].filter(Boolean).join(" "), far: behind > FAR_BEHIND };
}

/** "codex · hume-7 +2" while someone is on it, else "quiet 1d" (or "quiet" with no commit time). */
export function whoLabel(row: Pick<InFlightRow, "on" | "activityAt">, now: number): string {
  if (row.on.length) return row.on.length > 1 ? `${row.on[0]} +${row.on.length - 1}` : row.on[0]!;
  return row.activityAt == null ? "quiet" : `quiet ${agoFromMillis(row.activityAt, now)}`;
}

/** The churn bar's width in px: log-scaled, 6 to 56. */
export function churnWidth(add: number, del: number): number {
  return Math.max(6, Math.min(56, Math.round(Math.log10(add + del + 1) * 18)));
}

/** "4 worktrees with work · 2 PRs" for the panel head's line. */
export function inFlightSummary(rows: readonly InFlightRow[]): string {
  const prs = rows.filter((r) => r.pr).length;
  const live = rows.filter((r) => r.live).length;
  return [
    `${rows.length} worktree${rows.length === 1 ? "" : "s"} with work`,
    prs ? `${prs} PR${prs === 1 ? "" : "s"}` : null,
    live ? `${live} live` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
