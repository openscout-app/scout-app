import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../lib/api.ts";
import { RECENT_REPLAY_PATH } from "../../lib/tail-recent-replay.ts";
import { isBrokerDataEvent, useBrokerEvents } from "../../lib/sse.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import { useOperatorRequests } from "../../lib/use-operator-requests.ts";
import type { MeshStatus, OperatorAttentionItem, SessionEntry, TailDiscoveredTranscript, TailDiscoverySnapshot, TailEvent } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { createSessionRowsMemo, type SessionBoardRow } from "./session-board-model.ts";
import { createSessionBoardStore, type SessionBoardSnapshot, type SessionBoardStore } from "./session-board-store.ts";

/*
 * The React side of session-board-store.ts: one board read for the window,
 * shared by the slot screen and every Sessions panel, and one row build.
 */

let store: SessionBoardStore | null = null;
function boardStore(): SessionBoardStore {
  store ??= createSessionBoardStore({
    legacy: () => api<SessionEntry[]>("/api/sessions"),
    conversations: () => api<SessionEntry[]>("/api/conversations?limit=250"),
    discover: () => api<TailDiscoverySnapshot>("/api/tail/discover"),
    recent: () => api<{ events: TailEvent[] }>(RECENT_REPLAY_PATH),
    localNode: () => api<MeshStatus>("/api/mesh").then((mesh) => mesh.localNode?.id ?? mesh.health.nodeId ?? null),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    visible: () => typeof document === "undefined" || document.visibilityState === "visible",
    now: Date.now,
  });
  return store;
}

/** Read the board again now, e.g. after a session is renamed. */
export const refreshSessionBoard = (): Promise<void> => boardStore().refresh();

const rowsMemo = createSessionRowsMemo();
const NO_TRANSCRIPTS: TailDiscoveredTranscript[] = [];
const NO_ITEMS: OperatorAttentionItem[] = [];

function useSnapshot(): SessionBoardSnapshot {
  const s = boardStore();
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

function useRows(snapshot: SessionBoardSnapshot, attention: readonly OperatorAttentionItem[]): SessionBoardRow[] {
  const { agents, operatorName } = useScout();
  return rowsMemo({
    conversations: snapshot.conversations,
    transcripts: snapshot.discovery?.transcripts ?? NO_TRANSCRIPTS,
    events: snapshot.events,
    agents,
    attention,
    now: snapshot.now,
    operatorName,
    localNodeId: snapshot.localNodeId,
  });
}

/**
 * The session board: its rows, whether it is reading, and Refresh. Counts
 * this reader in, so the shared poll runs while anything draws the board.
 */
export function useSessionBoard() {
  const s = boardStore();
  const requests = useOperatorRequests();
  const snapshot = useSnapshot();
  useEffect(() => s.mount(), [s]);
  // the store coalesces: one read per second however many panels hear the burst
  useBrokerEvents((event) => {
    if (isBrokerDataEvent(event)) s.requestRefresh();
  });
  // every reader passes each live event on; the store keeps one copy
  useTailEvents((event) => s.pushLive(event));
  const rows = useRows(snapshot, requests.state?.items ?? NO_ITEMS);
  return {
    rows,
    loading: snapshot.loading,
    reading: snapshot.reading,
    error: snapshot.error,
    refresh: s.refresh,
    now: snapshot.now,
    requests,
    localNodeId: snapshot.localNodeId,
  };
}

/**
 * The board's rows as already read, for a scope picker beside a panel that
 * reads them. It counts nothing in and starts no read of its own.
 */
export function useSessionBoardRows(): SessionBoardRow[] {
  const requests = useOperatorRequests();
  return useRows(useSnapshot(), requests.state?.items ?? NO_ITEMS);
}
