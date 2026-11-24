/*
 * Hide anything the Feed serves, on the Feed or on Home. The server keeps the
 * hide (POST /api/feed/hides) and leaves the item out of every Feed read from
 * then on; the page never reads the hides itself. Nothing reaches the runtime:
 * the work or thread is unchanged, and it shows again when it has something
 * newer (a new turn). Undo is the last hide, for a few seconds.
 *
 * Between the click and the Feed's next read, the item is held out here, as a
 * Done or a Drop is (pending-moves.ts), so it leaves at once.
 *
 * Shared by the Feed and Home: one store, one toast (MoveToast).
 */
import { useSyncExternalStore } from "react";
import { api } from "../../lib/api.ts";
import { refreshPage } from "../../lib/page-refresh.ts";
import { UNDO_MS } from "./pending-moves.ts";

/** What to hide: the item's id as the Feed serves it, its own time and a title for the toast. */
export type HideInput = { id: string; at: number; title: string };

export type RecentHide = HideInput & { state: "held" | "failed"; error: string | null };

type Store = { pending: ReadonlySet<string>; recent: RecentHide | null };

let store: Store = { pending: new Set(), recent: null };
let recentTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<Store>) {
  store = { ...store, ...next };
  for (const l of listeners) l();
}

function pending(id: string, held: boolean): ReadonlySet<string> {
  const next = new Set(store.pending);
  if (held) next.add(id);
  else next.delete(id);
  return next;
}

function holdRecent(recent: RecentHide | null) {
  if (recentTimer) clearTimeout(recentTimer);
  recentTimer = recent?.state === "held" ? setTimeout(() => { if (store.recent === recent) set({ recent: null }); }, UNDO_MS) : null;
  set({ recent });
}

function why(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The web server did not answer.";
}

/** The server has the change: read the page again, then stop holding the item out ourselves. */
async function settle(id: string) {
  await refreshPage().catch(() => undefined);
  set({ pending: pending(id, false) });
}

/** Hide an item now. If the server refuses, the item comes back with the reason. */
export function hideItem(input: HideInput) {
  set({ pending: pending(input.id, true) });
  holdRecent({ ...input, state: "held", error: null });
  api("/api/feed/hides", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: input.id, at: input.at }),
  }).then(
    () => settle(input.id),
    (error: unknown) => {
      set({ pending: pending(input.id, false) });
      holdRecent({ ...input, state: "failed", error: why(error) });
    },
  );
}

/** Bring back the last hide. Returns whether there was one to undo. */
export function undoHide(): boolean {
  const recent = store.recent;
  if (!recent || recent.state !== "held") return false;
  holdRecent(null);
  set({ pending: pending(recent.id, false) });
  void api(`/api/feed/hides?id=${encodeURIComponent(recent.id)}`, { method: "DELETE" })
    .then(() => refreshPage())
    .catch(() => undefined);
  return true;
}

/** Close a failure line. */
export function closeHideFailure() {
  if (store.recent?.state === "failed") holdRecent(null);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function useStore(): Store {
  return useSyncExternalStore(subscribe, () => store, () => store);
}

/** Items hidden a moment ago that the Feed's last read still had. */
export function usePendingHides(): ReadonlySet<string> {
  return useStore().pending;
}

/** The last hide, for the toast. */
export function useRecentHide(): RecentHide | null {
  return useStore().recent;
}

/** For tests. */
export function resetHides() {
  if (recentTimer) clearTimeout(recentTimer);
  recentTimer = null;
  set({ pending: new Set(), recent: null });
}
