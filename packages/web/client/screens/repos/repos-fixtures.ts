import type { RepoWatchProject, RepoWatchSnapshot, RepoWatchWorktree } from "../../scout/repo-watch/types.ts";

/* Snapshot builders for the Repos tests: only the fields the rules read vary. */

export function worktree(id: string, path: string, patch: Partial<RepoWatchWorktree> & {
  changedFiles?: number;
  branchName?: string;
  ahead?: number;
  attention?: RepoWatchWorktree["attention"];
  live?: number;
  branchShortstat?: string | null;
} = {}): RepoWatchWorktree {
  const { changedFiles = 0, branchName = id, ahead = 0, live = 0, branchShortstat = null, ...rest } = patch;
  return {
    id,
    path,
    name: id,
    isBare: false,
    branch: { name: branchName, upstream: null, head: null, detached: false, ahead, behind: 0, isMain: false, diverged: false },
    status: { clean: changedFiles === 0, staged: 0, unstaged: changedFiles, untracked: 0, conflicts: 0, changedFiles, files: [] },
    diff: { branchShortstat, unstagedShortstat: null, stagedShortstat: null },
    attention: "quiet",
    attentionReasons: [],
    agents: Array.from({ length: live }, (_, i) => ({ id: `${id}-a${i}`, name: null, state: "active", harness: null })),
    sessions: [],
    hints: [],
    lastCommitAt: null,
    scannedAt: 0,
    error: null,
    ...rest,
  };
}

export function project(id: string, root: string, worktrees: RepoWatchWorktree[]): RepoWatchProject {
  return {
    id,
    name: id,
    root,
    commonGitDir: `${root}/.git`,
    attention: "quiet",
    attentionReasons: [],
    worktrees,
    stats: { worktrees: worktrees.length, dirtyWorktrees: 0, conflictedWorktrees: 0, attachedAgents: 0, attachedSessions: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
    hints: [],
  };
}

export function snapshot(projects: RepoWatchProject[], warnings: string[] = []): RepoWatchSnapshot {
  return {
    generatedAt: 1_000,
    projects,
    totals: {
      projects: projects.length,
      worktrees: projects.reduce((n, p) => n + p.worktrees.length, 0),
      dirtyWorktrees: 0,
      conflictedWorktrees: 0,
      attentionWorktrees: 0,
      attachedAgents: 0,
      attachedSessions: 0,
    },
    warnings,
  };
}

/** Two repos: scout (main + a feature worktree with changes) and site (main only). */
export function twoRepos(): RepoWatchSnapshot {
  return snapshot([
    project("scout", "/example/me/dev/scout", [
      worktree("scout-main", "/example/me/dev/scout", { branchName: "main" }),
      worktree("scout-feat", "/example/me/dev/scout-wt/feat", { branchName: "feat", changedFiles: 4, live: 1 }),
    ]),
    project("site", "/example/me/dev/site", [
      worktree("site-main", "/example/me/dev/site", { branchName: "main", changedFiles: 1 }),
    ]),
  ]);
}
