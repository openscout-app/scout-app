import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api, peekApiGet } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import type { WorkDetail, WorkItem } from "../../lib/types.ts";
import { createWorkMaterialPicks, createWorkStore, type WorkEntry, type WorkStore } from "./work-store.ts";

/*
 * The React side of work-store.ts: one detail store and one list store per
 * page, so the Work page and every Work panel share their reads.
 */

/** A remount paints the last read for this long while it refreshes. */
const ROUTE_CACHE_MAX_AGE_MS = 30_000;

export function workDetailPath(workId: string): string {
  return `/api/work/${encodeURIComponent(workId)}`;
}

function timers() {
  return {
    setTimer: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimer: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

let details: WorkStore<WorkDetail> | null = null;
function detailStore(): WorkStore<WorkDetail> {
  details ??= createWorkStore<WorkDetail>({
    fetch: (workId) => api<WorkDetail>(workDetailPath(workId)),
    peek: (workId) => peekApiGet<WorkDetail>(workDetailPath(workId), ROUTE_CACHE_MAX_AGE_MS),
    ...timers(),
  });
  return details;
}

let lists: WorkStore<WorkItem[]> | null = null;
function listStore(): WorkStore<WorkItem[]> {
  lists ??= createWorkStore<WorkItem[]>({
    fetch: (path) => api<WorkItem[]>(path),
    peek: (path) => peekApiGet<WorkItem[]>(path, ROUTE_CACHE_MAX_AGE_MS),
    ...timers(),
  });
  return lists;
}

function useEntry<T>(store: WorkStore<T>, key: string): WorkEntry<T> {
  const read = useCallback(() => store.get(key), [store, key]);
  // subscribed before it mounts, so the mount's own read is seen
  const entry = useSyncExternalStore(store.subscribe, read, read);
  useEffect(() => store.mount(key), [store, key]);
  return entry;
}

export type WorkDetailHandle = { detail: WorkDetail | null; error: string | null; loaded: boolean };

/**
 * One work item's detail, shared: warm from a read under 30s old, then read
 * fresh; read again once per burst of broker events (every event, as the
 * page always did). An empty id reads nothing.
 */
export function useWorkDetail(workId: string): WorkDetailHandle {
  const store = detailStore();
  const entry = useEntry(store, workId);
  useBrokerEvents(() => store.scheduleRefresh());
  return { detail: entry.value, error: entry.error, loaded: entry.loaded };
}

/**
 * A glance at one work item, for a card among many (the Agents stations):
 * the same shared read as useWorkDetail, but refreshed on a slow clock while
 * the page is in front instead of on every broker event. A detail read builds
 * the item's whole inventory, git included, so a page of cards that each
 * followed every event would keep one read per card in flight for good.
 */
export function useWorkGlance(workId: string, everyMs = 15_000): WorkDetailHandle {
  const store = detailStore();
  const entry = useEntry(store, workId);
  useEffect(() => {
    if (!workId) return undefined;
    const handle = setInterval(() => {
      if (document.visibilityState === "visible") store.refresh(workId);
    }, everyMs);
    return () => clearInterval(handle);
  }, [store, workId, everyMs]);
  return { detail: entry.value, error: entry.error, loaded: entry.loaded };
}

/** One poll per list path, however many panels read it. */
const polls = new Map<string, { readers: number; handle: ReturnType<typeof setInterval> }>();

function pollList(store: WorkStore<WorkItem[]>, path: string, everyMs: number): () => void {
  const running = polls.get(path);
  if (running) running.readers += 1;
  else {
    const handle = setInterval(() => {
      if (document.visibilityState === "visible") void store.load(path);
    }, everyMs);
    polls.set(path, { readers: 1, handle });
  }
  return () => {
    const poll = polls.get(path);
    if (!poll) return;
    poll.readers -= 1;
    if (poll.readers > 0) return;
    clearInterval(poll.handle);
    polls.delete(path);
  };
}

/** Read a work list again now, for a page's Refresh. */
export function reloadWorkList(path: string): Promise<void> {
  return listStore().load(path);
}

/** A work list (`/api/work?…`), shared by path, read again every `everyMs` while the page is visible. */
export function useWorkList(path: string, everyMs = 20_000): WorkEntry<WorkItem[]> {
  const store = listStore();
  const entry = useEntry(store, path);
  useEffect(() => (path ? pollList(store, path, everyMs) : undefined), [store, path, everyMs]);
  return entry;
}

const picks = createWorkMaterialPicks();

/** The file picked for this work item, shared by its Work item and Files panels. */
export function useWorkMaterialPick(workId: string): [string | null, (materialId: string | null) => void] {
  const read = useCallback(() => picks.picked(workId), [workId]);
  const picked = useSyncExternalStore(picks.subscribe, read, read);
  const pick = useCallback((materialId: string | null) => picks.pick(workId, materialId), [workId]);
  return [picked, pick];
}

/** Count this panel in as one that shows the work item's files (`show`), and read whether any does. */
export function useWorkFilesShown(workId: string, show: boolean): boolean {
  useEffect(() => (show && workId ? picks.showFiles(workId) : undefined), [show, workId]);
  const read = useCallback(() => picks.filesShown(workId), [workId]);
  return useSyncExternalStore(picks.subscribe, read, read);
}
