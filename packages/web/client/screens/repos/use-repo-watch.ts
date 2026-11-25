import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  fetchRepoPullRequests,
  fetchRepoWatchSnapshot,
  getCachedRepoWatchSnapshot,
} from "../../scout/repo-watch/api.ts";
import { createRepoPrStore, repoPrKey, type RepoPrEntry } from "./repo-prs-store.ts";
import { createPagePick, createRepoWatchStore, type RepoWatchState } from "./repo-watch-store.ts";
import {
  findById,
  pickToWrite,
  resolveRepoSelection,
  type RepoSelection,
  type RepoTarget,
} from "./repos-model.ts";

/*
 * The browser side of the Repos stores: one Repo Watch read, one PR read per
 * set of checkouts, and the page's pick, each shared by every reader on the
 * page. The rules live in the pure stores; these hooks only mount them.
 */

function onVisible(callback: () => void): () => void {
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

const timers = {
  setInterval: (fn: () => void, ms: number) => window.setInterval(fn, ms),
  clearInterval: (handle: unknown) => window.clearInterval(handle as number),
  visible: () => document.visibilityState === "visible",
};

export const repoWatchStore = createRepoWatchStore({
  fetch: fetchRepoWatchSnapshot,
  peek: getCachedRepoWatchSnapshot,
  now: () => Date.now(),
  onVisible,
  ...timers,
});

export const repoPrStore = createRepoPrStore({
  fetch: fetchRepoPullRequests,
  now: () => Date.now(),
  ...timers,
});

export const repoPagePick = createPagePick();

/** The page's Repo Watch read; the first reader starts the poll, the last stops it. */
export function useRepoWatch(): RepoWatchState {
  useEffect(() => repoWatchStore.mount(), []);
  return useSyncExternalStore(repoWatchStore.subscribe, repoWatchStore.getState, repoWatchStore.getState);
}

/** Ask for a root in the scan: one expanded scan when the standard one lacks it. */
export function useWantRoot(root: string | null | undefined): void {
  useEffect(() => (root ? repoWatchStore.want(root) : undefined), [root]);
}

/** Open PRs for these checkouts, shared with any other reader of the same set. */
export function useRepoPullRequests(paths: readonly string[]): RepoPrEntry & { reload: () => void } {
  const key = repoPrKey(paths);
  useEffect(() => repoPrStore.mount(key ? key.split("\n") : []), [key]);
  const get = useCallback(() => repoPrStore.get(key), [key]);
  const entry = useSyncExternalStore(repoPrStore.subscribe, get, get);
  const reload = useCallback(() => {
    if (key) void repoPrStore.reload(key.split("\n"));
  }, [key]);
  return { ...entry, reload };
}

/** The page's pick, held while this reader is mounted. */
export function useRepoPick(): string | null {
  useEffect(() => repoPagePick.hold(), []);
  return useSyncExternalStore(repoPagePick.subscribe, repoPagePick.get, repoPagePick.get);
}

export type RepoSelectionView = RepoSelection & {
  watch: RepoWatchState;
  /** Make a worktree the page's pick. */
  pick: (id: string) => void;
};

/**
 * The worktree a reader shows (resolveRepoSelection), kept in step with the
 * page's pick (pickToWrite), with the store's state alongside.
 */
export function useRepoSelection(target: RepoTarget): RepoSelectionView {
  const watch = useRepoWatch();
  const picked = useRepoPick();
  useWantRoot(target.root);
  const { snapshot } = watch;
  const selection = useMemo(
    () => resolveRepoSelection(snapshot, target.root, picked, target.mode),
    [snapshot, target.root, target.mode, picked],
  );
  const pickFound = useMemo(() => findById(snapshot, picked).worktree !== null, [snapshot, picked]);
  const write = pickToWrite(target, selection, picked, pickFound);
  useEffect(() => {
    if (write) repoPagePick.set(write);
  }, [write]);
  return { ...selection, watch, pick: repoPagePick.set };
}
