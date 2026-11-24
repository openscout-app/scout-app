/*
 * Done and Drop, with undo. The post leaves the list at once; the work move
 * goes to the runtime when the undo window closes, when another move replaces
 * it, or when the page goes away.
 *
 * Why hold it instead of moving and moving back: the default lifecycle has no
 * way back to In review from Done, and Restore takes Dropped to Backlog, so a
 * reverse move would not put the work where it was. Holding the move for a
 * few seconds is an undo that leaves no trace.
 *
 * Shared by the Feed and Home: one store, one toast.
 */
import { useSyncExternalStore } from "react";
import { api } from "../../lib/api.ts";
import type { WebWorkMoveResponse } from "../../lib/work-move.ts";
import { moveFor } from "./post-actions.ts";
import { recordMove } from "./feed-moves.ts";

export const UNDO_MS = 6_000;

export type HeldMove = {
  postId: string;
  workId: string;
  title: string;
  command: "done" | "drop";
  /** "held" until it is sent; "failed" keeps the post shown with the reason. */
  state: "held" | "sending" | "failed";
  error: string | null;
};

type Store = { moves: HeldMove[] };

let store: Store = { moves: [] };
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();

function set(moves: HeldMove[]) {
  store = { moves };
  for (const l of listeners) l();
}

function patch(postId: string, change: Partial<HeldMove> | null) {
  set(change === null ? store.moves.filter((m) => m.postId !== postId) : store.moves.map((m) => (m.postId === postId ? { ...m, ...change } : m)));
}

/** Why the runtime did not make the move, in one line. */
export function moveRefusal(answer: WebWorkMoveResponse): string | null {
  if (answer.applied) return null;
  const said = answer.decision.reasons.filter((r) => r.outcome === "fail" && !r.shadow).map((r) => r.message).filter(Boolean);
  return said.length ? said.join(" ") : `The runtime held the move (${answer.decision.verdict}).`;
}

async function send(move: HeldMove, keepalive = false) {
  timers.delete(move.postId);
  const { to, note } = moveFor(move.command);
  patch(move.postId, { state: "sending" });
  try {
    const answer = await api<WebWorkMoveResponse>(`/api/work/${encodeURIComponent(move.workId)}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to, note }),
      ...(keepalive ? { keepalive: true } : {}),
    });
    const refused = moveRefusal(answer);
    patch(move.postId, refused ? { state: "failed", error: refused } : null);
    if (!refused) recordMove(move.postId, move.command);
  } catch (error) {
    patch(move.postId, { state: "failed", error: error instanceof Error && error.message ? error.message : "The runtime did not answer." });
  }
}

/** Hide the post and send its move after the undo window. A second move sends the first at once. */
export function holdMove(input: { postId: string; workId: string; title: string; command: "done" | "drop" }) {
  for (const m of store.moves) if (m.state === "held") flush(m.postId);
  const move: HeldMove = { ...input, state: "held", error: null };
  set([...store.moves.filter((m) => m.postId !== input.postId), move]);
  timers.set(input.postId, setTimeout(() => void send(move), UNDO_MS));
}

/** Undo a held move: the post comes back and nothing reaches the runtime. */
export function undoMove(postId?: string) {
  const move = postId ? store.moves.find((m) => m.postId === postId) : [...store.moves].reverse().find((m) => m.state === "held");
  if (!move || move.state !== "held") return;
  clearTimeout(timers.get(move.postId));
  timers.delete(move.postId);
  patch(move.postId, null);
}

/** Close a failure line. */
export function dismissMove(postId: string) {
  const move = store.moves.find((m) => m.postId === postId);
  if (move?.state === "failed") patch(postId, null);
}

function flush(postId: string, keepalive = false) {
  const move = store.moves.find((m) => m.postId === postId);
  if (!move || move.state !== "held") return;
  clearTimeout(timers.get(postId));
  void send(move, keepalive);
}

/** Send every held move now: the page is going away. */
export function flushMoves(keepalive = true) {
  for (const m of store.moves) if (m.state === "held") flush(m.postId, keepalive);
}

if (typeof window !== "undefined") window.addEventListener("pagehide", () => flushMoves(true));

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useHeldMoves(): HeldMove[] {
  return useSyncExternalStore(subscribe, () => store.moves, () => store.moves);
}

/** Posts out of the list: held or being sent. A failed move shows its post again. */
export function hiddenPosts(moves: readonly HeldMove[]): Set<string> {
  return new Set(moves.filter((m) => m.state !== "failed").map((m) => m.postId));
}

/** For tests. */
export function resetMoves() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  set([]);
}
