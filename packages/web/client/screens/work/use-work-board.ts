/**
 * The work board's data: one read of `/api/work/board` and `/api/work/moves`,
 * shared by every panel on the page, read again on runtime work events and
 * every 15s while visible. Moves and reviews go to the runtime through the web
 * server, then the board reads again: the runtime's answer is the board.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api } from "../../lib/api.ts";
import { useBrokerEventsRefresh, type BrokerEvent } from "../../lib/sse.ts";
import type { WebWorkBoard, WebWorkMove, WebWorkMoveDecision, WebWorkMoveResponse } from "../../../shared/api/web.ts";

export type WorkBoardState = {
  board: WebWorkBoard | null;
  moves: WebWorkMove[];
  error: string | null;
  /** When the board was last read: what a stale board says it shows. */
  readAt: number | null;
  /** The last answer for a card: what the runtime said about its move. */
  answers: Record<string, WebWorkMoveResponse & { at: number }>;
  pending: Record<string, string>;
};

let state: WorkBoardState = { board: null, moves: [], error: null, readAt: null, answers: {}, pending: {} };

/** The board as it stands now, outside React: a move's follow-up reads the board it reloaded. */
export const readWorkBoardState = () => state;
const listeners = new Set<() => void>();
let lifecycleId = "";
let inflight: Promise<void> | null = null;

function set(patch: Partial<WorkBoardState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export async function loadWorkBoard(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const query = lifecycleId ? `?lifecycle=${encodeURIComponent(lifecycleId)}` : "";
      const [board, moves] = await Promise.all([
        api<WebWorkBoard>(`/api/work/board${query}`),
        api<{ moves: WebWorkMove[] }>("/api/work/moves"),
      ]);
      set({ board, moves: moves.moves, error: null, readAt: Date.now() });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function pickWorkLifecycle(id: string) {
  if (id === lifecycleId) return;
  lifecycleId = id;
  set({ board: null });
  void loadWorkBoard();
}

export async function moveWorkCard(
  workId: string,
  to: string,
  extra: { note?: string; claim?: boolean; waitingOn?: { label: string } } = {},
): Promise<WebWorkMoveResponse | null> {
  set({ pending: { ...state.pending, [workId]: to } });
  try {
    const answer = await api<WebWorkMoveResponse>(`/api/work/${encodeURIComponent(workId)}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, ...extra }),
    });
    set({ answers: { ...state.answers, [workId]: { ...answer, at: Date.now() } } });
    await loadWorkBoard();
    return answer;
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) });
    return null;
  } finally {
    const { [workId]: _done, ...rest } = state.pending;
    set({ pending: rest });
  }
}

/**
 * What the runtime would answer a move, without making it: the same checks,
 * nothing recorded. The board asks while a card is held, so each column can
 * say what a drop would do before it happens.
 */
export async function previewWorkMove(workId: string, to: string): Promise<WebWorkMoveDecision | null> {
  try {
    const answer = await api<WebWorkMoveResponse>(`/api/work/${encodeURIComponent(workId)}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, dryRun: true }),
    });
    return answer.decision;
  } catch {
    return null;
  }
}

export async function reviewWorkMove(move: WebWorkMove, verdict: "confirm" | "reopen" | "consult", note?: string): Promise<void> {
  try {
    await api(`/api/work/${encodeURIComponent(move.itemId)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moveId: move.id, revision: move.revision ?? 0, verdict, ...(note ? { note } : {}) }),
    });
    // The review settles the move, so the card's last answer no longer holds.
    clearWorkAnswer(move.itemId);
  } catch (error) {
    set({ error: error instanceof Error ? error.message : String(error) });
  }
  await loadWorkBoard();
}

export function clearWorkAnswer(workId: string) {
  const { [workId]: _gone, ...rest } = state.answers;
  set({ answers: rest });
}

const isWorkEvent = (event: BrokerEvent) =>
  event.kind === "collaboration.upserted" || event.kind === "collaboration.event.appended";

let readers = 0;
let poll: ReturnType<typeof setInterval> | null = null;

export function useWorkBoard(): WorkBoardState {
  const subscribe = useCallback((l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    readers += 1;
    if (readers === 1) {
      void loadWorkBoard();
      poll = setInterval(() => document.visibilityState === "visible" && void loadWorkBoard(), 15_000);
    }
    return () => {
      readers -= 1;
      if (readers === 0 && poll) { clearInterval(poll); poll = null; }
    };
  }, []);
  useBrokerEventsRefresh(isWorkEvent, () => void loadWorkBoard(), 400);
  return snapshot;
}
