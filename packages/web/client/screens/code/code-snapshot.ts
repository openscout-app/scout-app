import { useEffect, useSyncExternalStore } from "react";
import { fetchRepoWatchSnapshot, getCachedRepoWatchSnapshot } from "../../scout/repo-watch/api.ts";
import type { RepoWatchSnapshot } from "../../scout/repo-watch/types.ts";

/*
 * The repo-watch snapshot every Code surface reads (the project picker, the
 * tree's git-status tints, slug links, the Changes panel). One quick read at
 * a time for the window: the page and every Code panel beside it share it,
 * so a root switch in one tree refreshes the tints in all of them.
 */

const listeners = new Set<() => void>();
let inFlight: Promise<RepoWatchSnapshot | null> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read the snapshot again (quick scan); concurrent callers share one read. A failure keeps the last one. */
export function refreshCodeSnapshot(): Promise<RepoWatchSnapshot | null> {
  inFlight ??= fetchRepoWatchSnapshot("quick", false, 20_000)
    .then(
      (snapshot) => snapshot,
      () => null,
    )
    .finally(() => {
      inFlight = null;
      for (const listener of listeners) listener();
    });
  return inFlight;
}

let pollers = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Keep the snapshot fresh: read now, then every `ms` while the window is
 * visible. Every holder shares one timer, so two Changes panels read once a
 * tick, not twice; the last release stops it. Returns the release.
 */
export function pollCodeSnapshot(ms: number): () => void {
  pollers += 1;
  if (pollers === 1) {
    void refreshCodeSnapshot();
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshCodeSnapshot();
    }, ms);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pollers -= 1;
    if (pollers === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

/** The shared snapshot; the first reader in a window with none asks for it. */
export function useCodeSnapshot(): RepoWatchSnapshot | null {
  const snapshot = useSyncExternalStore(subscribe, getCachedRepoWatchSnapshot, () => null);
  useEffect(() => {
    // the picker degrades to the route's root without it; the tree still works
    if (!getCachedRepoWatchSnapshot()) void refreshCodeSnapshot();
  }, []);
  return snapshot;
}
