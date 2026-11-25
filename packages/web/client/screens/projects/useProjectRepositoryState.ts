import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchRepoPullRequests,
  getCachedRepoPullRequests,
  type RepoPullRequestItem,
  type RepoPullRequestSnapshot,
} from "../../scout/repo-watch/api.ts";
import type { RepoWatchProject } from "../../scout/repo-watch/types.ts";
import { fetchRepoDiffSnapshot } from "../../scout/repo-diff/cache.ts";
import type { ScoutRepoDiffSnapshot } from "../../scout/repo-diff/types.ts";
import { rootStatus } from "../repos/repo-watch-store.ts";
import { repoWatchStore, useRepoWatch, useWantRoot } from "../repos/use-repo-watch.ts";
import { repoProjectForRoot } from "./project-overview-helpers.ts";

const DIFF_REFRESH_MS = 20_000;
const PR_REFRESH_MS = 60_000;
const DIFF_LAYERS = ["branch", "unstaged", "staged"] as const;

/** Run the callback when the tab returns to the foreground — pairs with
   visibility-gated intervals so background tabs stay quiet but the surface
   catches up the moment it is visible again. */
export function onVisible(callback: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === "visible") callback();
  };
  window.addEventListener("focus", handler);
  document.addEventListener("visibilitychange", handler);
  return () => {
    window.removeEventListener("focus", handler);
    document.removeEventListener("visibilitychange", handler);
  };
}

function normalizedPaths(projectRoot: string | null, worktreePaths: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const path of [projectRoot, ...worktreePaths]) {
    const trimmed = path?.trim();
    if (trimmed) paths.add(trimmed.replace(/\/+$/u, ""));
  }
  return [...paths].slice(0, 6);
}

function pathLeaf(path: string): string {
  return path.replace(/\/+$/u, "").split("/").pop()?.toLocaleLowerCase() ?? path.toLocaleLowerCase();
}

function pullRequestMatchesProject(
  pr: RepoPullRequestItem,
  projectRoot: string,
  project: RepoWatchProject | null,
): boolean {
  if (pr.path === projectRoot || project?.worktrees.some((worktree) => worktree.path === pr.path)) return true;
  const repoLeaf = pr.repo.split("/").pop()?.toLocaleLowerCase();
  return repoLeaf === (project?.name.toLocaleLowerCase() ?? pathLeaf(projectRoot));
}

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") {
    return "The repository scan timed out.";
  }
  return error instanceof Error ? error.message : String(error);
}

export type ProjectRepositoryState = {
  project: RepoWatchProject | null;
  pullRequests: RepoPullRequestItem[];
  pullRequestsLoading: boolean;
  pullRequestWarnings: string[];
  repoLoading: boolean;
  repoError: string | null;
  diffSnapshots: ReadonlyMap<string, ScoutRepoDiffSnapshot>;
  diffErrors: ReadonlyMap<string, string>;
  diffLoading: boolean;
  refresh: () => void;
};

export function useProjectRepositoryState(
  projectRoot: string | null,
  worktreePaths: readonly string[] = [],
): ProjectRepositoryState {
  const pathsKey = normalizedPaths(projectRoot, worktreePaths).join("\0");
  const paths = useMemo(() => pathsKey ? pathsKey.split("\0") : [], [pathsKey]);
  // The page's one Repo Watch read, shared with every Repos panel and every
  // other project on the page; a project the scan lacks gets one expanded scan.
  const watch = useRepoWatch();
  useWantRoot(projectRoot);
  const [pullRequestSnapshot, setPullRequestSnapshot] = useState<RepoPullRequestSnapshot | null>(() => getCachedRepoPullRequests());
  const [pullRequestsLoading, setPullRequestsLoading] = useState(Boolean(projectRoot));
  const [diffLoading, setDiffLoading] = useState(Boolean(projectRoot));
  const [pullRequestError, setPullRequestError] = useState<string | null>(null);
  const [diffSnapshots, setDiffSnapshots] = useState<Map<string, ScoutRepoDiffSnapshot>>(() => new Map());
  const [diffErrors, setDiffErrors] = useState<Map<string, string>>(() => new Map());
  const [refreshEpoch, setRefreshEpoch] = useState(0);

  const refresh = useCallback(() => {
    // a forced scan for the whole page; a missing project gets another look
    void repoWatchStore.refresh();
    setRefreshEpoch((value) => value + 1);
  }, []);

  useEffect(() => {
    if (paths.length === 0) {
      setDiffLoading(false);
      setDiffErrors(new Map());
      return;
    }
    let cancelled = false;
    let inFlight = false;
    let firstLoad = true;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      if (!cancelled) setDiffLoading(true);
      const results = await Promise.allSettled(
        paths.map((path) => fetchRepoDiffSnapshot(path, [...DIFF_LAYERS], {
          force: refreshEpoch > 0 && firstLoad,
          tier: "summary",
        })),
      );
      firstLoad = false;
      if (!cancelled) {
        const nextSnapshots = new Map<string, ScoutRepoDiffSnapshot>();
        const nextErrors = new Map<string, string>();
        results.forEach((result, index) => {
          const path = paths[index]!;
          if (result.status === "fulfilled") nextSnapshots.set(path, result.value.snapshot);
          else nextErrors.set(path, errorMessage(result.reason));
        });
        setDiffSnapshots((current) => {
          const next = new Map(current);
          for (const path of paths) next.delete(path);
          for (const [path, value] of nextSnapshots) next.set(path, value);
          return next;
        });
        setDiffErrors(nextErrors);
        setDiffLoading(false);
      }
      inFlight = false;
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, DIFF_REFRESH_MS);
    const offVisible = onVisible(() => void load());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      offVisible();
    };
  }, [paths, refreshEpoch]);

  useEffect(() => {
    if (paths.length === 0) {
      setPullRequestsLoading(false);
      setPullRequestError(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const next = await fetchRepoPullRequests(paths);
        if (!cancelled) {
          setPullRequestSnapshot(next);
          setPullRequestError(null);
        }
      } catch (error) {
        if (!cancelled) setPullRequestError(errorMessage(error));
      } finally {
        inFlight = false;
        if (!cancelled) setPullRequestsLoading(false);
      }
    };
    setPullRequestsLoading(true);
    setPullRequestError(null);
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, PR_REFRESH_MS);
    const offVisible = onVisible(() => void load());
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      offVisible();
    };
  }, [paths, refreshEpoch]);

  const project = useMemo(() => repoProjectForRoot(watch.snapshot, projectRoot), [projectRoot, watch.snapshot]);
  // reading: the first scan, or the expanded look for a project the scan lacks
  const repoLoading = Boolean(projectRoot) && !project &&
    (watch.phase === "loading" || rootStatus(watch, projectRoot) === "looking");
  const repoError = !projectRoot || project || repoLoading
    ? null
    : watch.error ?? "Repo Watch did not include this project in its latest scan.";
  const pullRequests = useMemo(
    () => projectRoot
      ? (pullRequestSnapshot?.pullRequests ?? []).filter((pr) => pullRequestMatchesProject(pr, projectRoot, project))
      : [],
    [project, projectRoot, pullRequestSnapshot],
  );
  const pullRequestWarnings = useMemo(() => {
    const warnings = pullRequestSnapshot?.paths.some((path) => paths.includes(path))
      ? pullRequestSnapshot.warnings
      : [];
    return pullRequestError ? [pullRequestError, ...warnings] : warnings;
  }, [paths, pullRequestError, pullRequestSnapshot]);

  return {
    project,
    pullRequests,
    pullRequestsLoading,
    pullRequestWarnings,
    repoLoading,
    repoError,
    diffSnapshots,
    diffErrors,
    diffLoading,
    refresh,
  };
}
