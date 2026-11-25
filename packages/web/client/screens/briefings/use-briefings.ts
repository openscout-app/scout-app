import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api, peekApiGet } from "../../lib/api.ts";
import { createWorkStore, type WorkStore } from "../work/work-store.ts";
import { BRIEFINGS_LIST_PATH, briefingDetailPath, type BriefingDetail, type BriefingSummary } from "./briefings-model.ts";
import { createBriefingListStore, type BriefingListState, type BriefingListStore } from "./briefings-store.ts";

/*
 * The React side of the briefings reads: one archive read and one read per
 * briefing, shared by the Briefings page and every Briefings panel, so two
 * panels never read twice.
 */

/** A remount paints the last read for this long while it reads again. */
const ROUTE_CACHE_MAX_AGE_MS = 30_000;

let list: BriefingListStore | null = null;
function listStore(): BriefingListStore {
  list ??= createBriefingListStore({
    fetch: () => api<{ briefings: BriefingSummary[] }>(BRIEFINGS_LIST_PATH).then((res) => res.briefings ?? []),
    peek: () => peekApiGet<{ briefings: BriefingSummary[] }>(BRIEFINGS_LIST_PATH, ROUTE_CACHE_MAX_AGE_MS)?.briefings ?? null,
    now: () => Date.now(),
    every: (run, ms) => setInterval(run, ms),
    stop: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    visible: () => typeof document === "undefined" || document.visibilityState === "visible",
  });
  return list;
}

/** The archive, newest first: one read for every reader, polled every 60s while visible. */
export function useBriefingList(): BriefingListState & { refresh: () => void } {
  const store = listStore();
  const state = useSyncExternalStore(store.subscribe, store.get, store.get);
  useEffect(() => store.mount(), [store]);
  const refresh = useCallback(() => void store.refresh(), [store]);
  return { ...state, refresh };
}

/*
 * One briefing by id: the Work store's keyed, counted read (screens/work/
 * work-store.ts), so every panel on one briefing shares it. A briefing the
 * archive no longer holds (it keeps the newest 100) answers 404: that reads
 * as gone (null), not as an error.
 */
let details: WorkStore<BriefingDetail | null> | null = null;
function detailStore(): WorkStore<BriefingDetail | null> {
  details ??= createWorkStore<BriefingDetail | null>({
    fetch: (id) =>
      api<BriefingDetail>(briefingDetailPath(id)).catch((error: unknown) => {
        if ((error as { status?: unknown } | null)?.status === 404) return null;
        throw error;
      }),
    peek: (id) => peekApiGet<BriefingDetail>(briefingDetailPath(id), ROUTE_CACHE_MAX_AGE_MS),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return details;
}

export type BriefingHandle = {
  detail: BriefingDetail | null;
  error: string | null;
  /** A read has settled: draw the briefing, or say it is gone. */
  loaded: boolean;
  /** The archive no longer holds it. */
  gone: boolean;
};

/** One briefing, shared: warm from a read under 30s old, then read fresh. An empty id reads nothing. */
export function useBriefingDetail(id: string): BriefingHandle {
  const store = detailStore();
  const read = useCallback(() => store.get(id), [store, id]);
  // subscribed before it mounts, so the mount's own read is seen
  const entry = useSyncExternalStore(store.subscribe, read, read);
  useEffect(() => store.mount(id), [store, id]);
  const detail = entry.value ?? null;
  return { detail, error: entry.error, loaded: entry.loaded, gone: Boolean(id) && entry.loaded && !detail && !entry.error };
}

/** Read one briefing again (Try again, or the archive says it changed). */
export function reloadBriefing(id: string): void {
  if (id) void detailStore().load(id);
}

/** Refresh: the archive, and every briefing open anywhere, once. */
export function refreshBriefings(): void {
  void listStore().refresh();
  detailStore().scheduleRefresh();
}
