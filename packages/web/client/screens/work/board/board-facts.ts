/**
 * The Kanban's facts: what the board read already says, counted, so the page
 * states it instead of leaving the operator to count cards. Pure functions
 * over the placed cards and the moves; nothing here judges or guesses.
 *
 * Failed runs are their own group. The runtime writes a failed flight as a
 * wait on the asker (`failedRun` on the item), so without this they fill
 * Waiting and hide the cards that wait on a real answer.
 */
import type { WebWorkBoardCard, WebWorkMove, WebWorkStation } from "../../../../shared/api/web.ts";
import { sessionPhase, waitingStation, workingStation } from "./board-model.ts";

export const isFailedRun = (card: WebWorkBoardCard) => Boolean(card.item.failedRun);

/** One column's line in the facts strip. */
export type FactLine = { key: string; label: string; count: number; detail: string | null };

/** A moment in plain words: "4m", "2h", "3d". */
export function shortAge(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Who the waits are on, busiest first: "2 on you, 1 on kepler". */
function waitingOn(cards: readonly WebWorkBoardCard[], nameOf: (id: string | null, name: string | null) => string): string | null {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const who = nameOf(card.item.nextMoveOwnerId, card.item.nextMoveOwnerName);
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([who, n]) => `${n} on ${who}`);
  return parts.length ? parts.join(", ") : null;
}

/**
 * One line per column the operator acts on, from the board as placed at `now`.
 * `nameOf` turns a next-move owner into a name ("you" for the operator).
 */
export function boardFacts(
  cards: readonly WebWorkBoardCard[],
  stations: readonly WebWorkStation[],
  now: number,
  nameOf: (id: string | null, name: string | null) => string,
): FactLine[] {
  const lines: FactLine[] = [];
  const working = workingStation(stations);
  const waiting = waitingStation(stations);
  const review = stations.find((s) => s.state === "review");
  const done = stations.filter((s) => s.state === "done").map((s) => s.id);

  if (working) {
    const here = cards.filter((c) => c.station === working.id);
    const since = here.map((c) => c.item.liveFlight?.startedAt ?? c.item.lastMeaningfulAt).filter((t): t is number => typeof t === "number" && t > 0);
    const detail = since.length ? `longest running ${shortAge(now - Math.min(...since))}` : null;
    lines.push({ key: "doing", label: working.name, count: here.length, detail });
  }
  // A session that went quiet is placed by its phase, not in Doing, so it gets its own line, shown only when there is one.
  const settled = new Set(stations.filter((s) => s.state === "done" || s.state === "cancelled").map((s) => s.id));
  const quiet = cards.filter((c) => !settled.has(c.station) && !isFailedRun(c) && sessionPhase(c.item, now) === "stale").length;
  if (quiet) lines.push({ key: "quiet", label: "Gone quiet", count: quiet, detail: null });
  if (waiting) {
    const here = cards.filter((c) => c.station === waiting.id && !isFailedRun(c));
    lines.push({ key: "waiting", label: waiting.name, count: here.length, detail: waitingOn(here, nameOf) });
  }
  const failed = cards.filter(isFailedRun);
  lines.push({ key: "failed", label: "Failed runs", count: failed.length, detail: null });
  if (review) {
    const here = cards.filter((c) => c.station === review.id);
    lines.push({ key: "review", label: review.name, count: here.length, detail: null });
  }
  // A move waiting on a review can sit in any column (most land in Done), so it is its own line.
  const pending = cards.filter((c) => c.reviewPending).length;
  if (pending) lines.push({ key: "to-review", label: "Moves to review", count: pending, detail: null });
  if (done.length) {
    const today = startOfDay(now);
    const closed = cards.filter((c) => done.includes(c.station) && c.item.updatedAt >= today).length;
    lines.push({ key: "done", label: "Done today", count: closed, detail: null });
  }
  return lines;
}

/** The newest moves of cards on the board, newest first, at most `limit`. */
export function latestMoves(moves: readonly WebWorkMove[], onBoard: (itemId: string) => boolean = () => true, limit = 5): WebWorkMove[] {
  return moves.filter((m) => onBoard(m.itemId)).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}
