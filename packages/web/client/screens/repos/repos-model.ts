import type { Route } from "../../lib/types.ts";
import type { RepoPullRequestItem, RepoPullRequestSnapshot } from "../../scout/repo-watch/api.ts";
import type { PullRequestWorktreeMatch } from "../../scout/repo-watch/pull-request-actions.ts";
import type { RepoWatchProject, RepoWatchSnapshot, RepoWatchWorktree } from "../../scout/repo-watch/types.ts";
import { agoFromMillis, attentionRank, branchChurnOf, churnOf } from "../../scout/repo-watch/ui.ts";

/*
 * The Repos screen's rules, pure so they test without a DOM: which worktree a
 * page selects, which pull requests go with it, and which diffs to warm. The
 * screen (ReposScreen.tsx), the Repos view's panels and the shared Repo Watch
 * read (repo-watch-store.ts) all read them from here.
 */

// ── paths ────────────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  return path.trim().replace(/\/+$/u, "").replace(/^\/Users\/[^/]+(?=\/|$)/u, "~");
}

/** The same checkout, written with or without a trailing slash or ~. */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a === b || normalizePath(a) === normalizePath(b);
}

/** The repo a root names: its own root, or any of its worktrees. */
export function projectForRoot(snapshot: RepoWatchSnapshot | null, root: string | null | undefined): RepoWatchProject | null {
  if (!snapshot || !root) return null;
  for (const project of snapshot.projects) {
    if (samePath(project.root, root) || project.worktrees.some((wt) => samePath(wt.path, root))) return project;
  }
  return null;
}

export function findById(
  snapshot: RepoWatchSnapshot | null,
  id: string | null,
): { worktree: RepoWatchWorktree | null; project: RepoWatchProject | null } {
  if (!snapshot || !id) return { worktree: null, project: null };
  for (const project of snapshot.projects) {
    for (const wt of project.worktrees) {
      if (wt.id === id) return { worktree: wt, project };
    }
  }
  return { worktree: null, project: null };
}

// ── selection ────────────────────────────────────────────────────────────

/* The default selection — the most-relevant worktree so the context pane isn't
 * empty on load: worst attention first, then live-agent count, then churn. */
export function pickDefaultWorktree(
  projects: readonly RepoWatchProject[],
): RepoWatchWorktree | null {
  let best: RepoWatchWorktree | null = null;
  let bestScore = -Infinity;
  for (const project of projects) {
    for (const wt of project.worktrees) {
      const liveAgents = wt.agents.filter(
        (a) => (a.state ?? "").toLowerCase() === "active",
      ).length;
      const score =
        (4 - attentionRank(wt.attention)) * 1_000_000 +
        liveAgents * 10_000 +
        wt.status.changedFiles;
      if (score > bestScore) {
        bestScore = score;
        best = wt;
      }
    }
  }
  return best;
}

export type RepoSelection = {
  project: RepoWatchProject | null;
  worktree: RepoWatchWorktree | null;
  /** A root was asked for and the scan holds no repo for it. */
  missing: boolean;
  /** The worktree is a default pick, not one the root or a hand named: keep it, so later scans don't move it. */
  seed: boolean;
};

const NONE: RepoSelection = { project: null, worktree: null, missing: false, seed: false };

/**
 * The worktree a Repos panel shows.
 *
 * "page" reads a Repos URL the way the Repos page always did. A root that is
 * one worktree's own path (not its repo's root) selects that worktree. A root
 * that names a repo (its root, which is also its main checkout) keeps the
 * worktree picked by hand (or seeded) in that repo, else picks the repo's
 * busiest. No root keeps the pick, else the busiest anywhere.
 *
 * "exact" reads a panel's own setting: the checkout at that path, else the
 * busiest worktree of the repo the path belongs to.
 */
export function resolveRepoSelection(
  snapshot: RepoWatchSnapshot | null,
  root: string | null | undefined,
  picked: string | null,
  mode: "page" | "exact",
): RepoSelection {
  if (!snapshot) return NONE;
  const pick = mode === "page" ? findById(snapshot, picked) : { worktree: null, project: null };
  if (root) {
    const project = projectForRoot(snapshot, root);
    if (!project) return { ...NONE, missing: true };
    const exact = project.worktrees.find((wt) => samePath(wt.path, root)) ?? null;
    if (exact && (mode === "exact" || !samePath(exact.path, project.root))) {
      return { project, worktree: exact, missing: false, seed: false };
    }
    if (pick.worktree && pick.project?.id === project.id) {
      return { project, worktree: pick.worktree, missing: false, seed: false };
    }
    const fallback = pickDefaultWorktree([project]);
    return { project, worktree: fallback, missing: false, seed: fallback !== null };
  }
  if (pick.worktree) return { project: pick.project, worktree: pick.worktree, missing: false, seed: false };
  const fallback = pickDefaultWorktree(snapshot.projects);
  return fallback ? { ...findById(snapshot, fallback.id), missing: false, seed: true } : NONE;
}

/** Whether a worktree has anything to diff: changed files, a branch delta, or commits ahead (the table's diff button rule). */
export function canDiffWorktree(wt: RepoWatchWorktree): boolean {
  const branch = branchChurnOf(wt);
  const files = branch.files + Math.max(churnOf(wt).files, wt.status.changedFiles);
  return files > 0 || branch.has || wt.branch.ahead > 0;
}

// ── scans ────────────────────────────────────────────────────────────────

export function isBudgetLimitedSnapshot(snapshot: RepoWatchSnapshot): boolean {
  return snapshot.warnings.some((warning) =>
    /scan budget|stopped discovery|stopped scanning/i.test(warning),
  );
}

export function isSmallerSnapshot(
  next: RepoWatchSnapshot,
  previous: RepoWatchSnapshot,
): boolean {
  return next.totals.worktrees < previous.totals.worktrees ||
    next.totals.projects < previous.totals.projects;
}

export function repoWatchErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  ) {
    return "Repo Watch scan timed out; keeping the last available snapshot.";
  }
  return error instanceof Error ? error.message : String(error);
}

export function shortstatFiles(shortstat: string | null): number {
  if (!shortstat) return 0;
  const match = /(\d+)\s+files?\s+changed/.exec(shortstat);
  return match ? Number(match[1]) : 0;
}

/** The worktrees whose diffs are worth warming, most likely to be opened first. */
export function prefetchWorktreePaths(
  snapshot: RepoWatchSnapshot,
  selectedId: string | null,
): string[] {
  const scored: Array<{ path: string; score: number }> = [];
  for (const project of snapshot.projects) {
    for (const wt of project.worktrees) {
      const dirty =
        wt.status.staged +
        wt.status.unstaged +
        wt.status.untracked +
        wt.status.conflicts;
      const liveAgents = wt.agents.filter(
        (a) => (a.state ?? "").toLowerCase() === "active",
      ).length;
      const branchFiles = shortstatFiles(wt.diff.branchShortstat);
      const workingFiles = Math.max(
        wt.status.changedFiles,
        shortstatFiles(wt.diff.stagedShortstat) + shortstatFiles(wt.diff.unstagedShortstat),
      );
      const drift = wt.branch.ahead + wt.branch.behind;
      const attached = liveAgents + wt.sessions.length;
      if (dirty === 0 && attached === 0 && branchFiles === 0 && drift === 0) continue;
      scored.push({
        path: wt.path,
        score:
          (wt.id === selectedId ? 10_000_000 : 0) +
          (4 - attentionRank(wt.attention)) * 100_000 +
          liveAgents * 10_000 +
          wt.sessions.length * 5_000 +
          drift * 1_000 +
          branchFiles * 250 +
          dirty * 100 +
          workingFiles,
      });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .map((item) => item.path);
}

// ── pull requests ────────────────────────────────────────────────────────

/** One checkout per repo, the paths gh reads open PRs for. */
export function repoPrPaths(snapshot: RepoWatchSnapshot): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const project of snapshot.projects) {
    const path = project.worktrees[0]?.path ?? project.root;
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function prUpdatedAgo(updatedAt: string | null, generatedAt: number): string {
  if (!updatedAt) return "updated";
  const time = Date.parse(updatedAt);
  return Number.isFinite(time) ? agoFromMillis(time, generatedAt) : "updated";
}

export function openPullRequestStatTitle(snapshot: RepoPullRequestSnapshot | null): string | null {
  const pullRequests = snapshot?.pullRequests ?? [];
  if (pullRequests.length === 0) return null;
  const visible = pullRequests.slice(0, 8).map((pr) =>
    `${pr.repo}#${pr.number}: ${pr.title}`,
  );
  const hidden = pullRequests.length - visible.length;
  return [
    "Open pull requests from gh.",
    ...visible,
    hidden > 0 ? `+${hidden} more` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function pullRequestMatchesProject(
  pr: RepoPullRequestItem,
  project: RepoWatchProject | null,
): boolean {
  if (!project) return false;
  if (pr.path === project.root || project.worktrees.some((wt) => wt.path === pr.path)) {
    return true;
  }
  const repoLeaf = pr.repo.split("/").pop()?.toLowerCase();
  return repoLeaf === project.name.toLowerCase();
}

export function pullRequestMatchesBranch(
  pr: RepoPullRequestItem,
  worktree: RepoWatchWorktree | null,
): boolean {
  const branch = worktree?.branch.name?.trim();
  return Boolean(branch && pr.headRefName === branch);
}

export function matchingWorktreeForPullRequest(
  pr: RepoPullRequestItem,
  snapshot: RepoWatchSnapshot | null | undefined,
): PullRequestWorktreeMatch | null {
  if (!snapshot) return null;
  const head = pr.headRefName?.trim();
  if (!head) return null;
  const matches: PullRequestWorktreeMatch[] = [];
  for (const project of snapshot.projects) {
    for (const worktree of project.worktrees) {
      if (worktree.branch.name?.trim() !== head) continue;
      matches.push({
        id: worktree.id,
        path: worktree.path,
        branch: head,
      });
    }
  }
  if (matches.length === 0) return null;
  if (pr.path) {
    const exact = matches.find((item) => item.path === pr.path);
    if (exact) return exact;
  }
  return matches[0] ?? null;
}

export type PullRequestGroup = { key: "branch" | "project" | "other"; label: string; items: RepoPullRequestItem[] };

/** Open PRs grouped by the selection: its branch, then its repo, then the rest. */
export function pullRequestGroups(
  pullRequests: readonly RepoPullRequestItem[],
  project: RepoWatchProject | null,
  worktree: RepoWatchWorktree | null,
): PullRequestGroup[] {
  const selectedBranch = worktree?.branch.name ?? null;
  const ofProject = pullRequests.filter((pr) => pullRequestMatchesProject(pr, project));
  const onBranch = ofProject.filter((pr) => pullRequestMatchesBranch(pr, worktree));
  const restOfProject = ofProject.filter((pr) => !pullRequestMatchesBranch(pr, worktree));
  const other = pullRequests.filter((pr) => !pullRequestMatchesProject(pr, project));
  const groups: Array<PullRequestGroup | null> = [
    onBranch.length > 0 ? {
      key: "branch",
      label: selectedBranch ? `Selected branch · ${selectedBranch}` : "Selected branch",
      items: onBranch,
    } : null,
    restOfProject.length > 0 ? {
      key: "project",
      label: project ? `${project.name} PRs` : "Selected project",
      items: restOfProject,
    } : null,
    other.length > 0 ? {
      key: "other",
      label: ofProject.length > 0 ? "Other open PRs" : "Open PRs",
      items: other,
    } : null,
  ];
  return groups.filter((group): group is PullRequestGroup => group !== null);
}

// ── what a reader shows ──────────────────────────────────────────────────

/**
 * What a Repos reader shows. `root` is a checkout or repo path; `mode` reads
 * it the page's way or exactly (see resolveRepoSelection). A reader that
 * `writes` follows the page and keeps the page's pick in step. One that
 * `leads` holds the root itself (the URL on the Repos routes, the list's own
 * setting elsewhere), so what it shows becomes the pick.
 */
export type RepoTarget = { root: string | null; mode: "page" | "exact"; leads: boolean; writes: boolean };

/**
 * The Repos routes' own target: /repos?root= read the page's way (a repo
 * root keeps the pick in that repo), /repo-diff?path= exactly. Off those
 * routes, the page's pick.
 */
export function pageRepoTarget(route: Route): RepoTarget {
  if (route.view === "repos") return { root: route.root?.trim() || null, mode: "page", leads: true, writes: true };
  if (route.view === "repo-diff") return { root: route.path.trim() || null, mode: "exact", leads: true, writes: true };
  return { root: null, mode: "page", leads: false, writes: true };
}

/**
 * The pick a reader writes back, or null to leave it. A default it seeded
 * (so later scans don't move it), what the URL shows on its own route, or
 * anything when the pick is gone. Never a pinned panel's.
 */
export function pickToWrite(
  target: RepoTarget,
  selection: RepoSelection,
  picked: string | null,
  pickFound: boolean,
): string | null {
  const id = selection.worktree?.id ?? null;
  if (!target.writes || !id || id === picked) return null;
  return selection.seed || target.leads || !pickFound ? id : null;
}
