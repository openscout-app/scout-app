import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { remarkOf, sinceOf, type Remark } from "./arrivals-model.ts";

/*
 * What a click on the companion offers: a few things to do now, picked from
 * the board's own rows, the most useful first. Each one is a single action
 * with a call behind it (CompanionChoices draws them with Tap in's reads and
 * acts); the full board stays one quiet press away.
 *
 *  1. Answer: the oldest open ask, with its own answers or Allow / Deny.
 *  2. Reply: a line to the agent that spoke last.
 *  3. Catch up: up to two rows that changed since the operator last looked.
 *  4. Jump: the most recent active session, or its terminal.
 *  5. New: a new ask in the project the operator is working in.
 */

export const CHOICES_MAX = 5;
/** Catch up says this many rows at most; the board has the rest. */
export const CATCH_UP_LINES = 2;
/** Where the last look is kept: a choice card that closed, or the board opened. */
export const LOOKED_KEY = "scout:companion:looked-at";

export type CompanionChoice =
  | { kind: "answer"; t: CornerThread; more: number }
  | { kind: "reply"; t: CornerThread }
  | { kind: "catch-up"; since: number | null; rows: CornerThread[]; more: number }
  | { kind: "jump"; t: CornerThread }
  | { kind: "new"; project: string | null };

export type ChoiceFacts = {
  /** When the operator last looked; null when never (Catch up then says what changed last). */
  lookedAt: number | null;
  /** New can be offered: the board can start a conversation. */
  canStart: boolean;
};

const latest = (a: CornerThread, b: CornerThread) => b.at - a.at;

export function companionChoices(threads: readonly CornerThread[], facts: ChoiceFacts): CompanionChoice[] {
  const out: CompanionChoice[] = [];

  const asking = threads.filter((t) => t.state === "asking").sort((a, b) => a.at - b.at);
  const ask = asking[0] ?? null;
  if (ask) out.push({ kind: "answer", t: ask, more: asking.length - 1 });

  // The agent that spoke last, not the one waiting on an answer.
  const reply = threads.filter((t) => t.state !== "asking").sort(latest)[0] ?? null;
  if (reply) out.push({ kind: "reply", t: reply });

  const taken = new Set([ask?.id, reply?.id]);
  const changed = threads
    .filter((t) => t.state !== "asking" && !taken.has(t.id) && (facts.lookedAt === null || sinceOf(t) > facts.lookedAt))
    .sort((a, b) => sinceOf(b) - sinceOf(a));
  if (changed.length) out.push({ kind: "catch-up", since: facts.lookedAt, rows: changed.slice(0, CATCH_UP_LINES), more: Math.max(0, changed.length - CATCH_UP_LINES) });

  const active = threads.filter((t) => t.state === "working" || t.state === "asking").sort(latest)[0] ?? null;
  if (active) out.push({ kind: "jump", t: active });

  if (facts.canStart) {
    const project = [reply, active, ask, ...changed].find((t) => t?.project)?.project ?? null;
    out.push({ kind: "new", project });
  }
  return out.slice(0, CHOICES_MAX);
}

/**
 * While the card is open it holds what it opened with, so the reply line does
 * not move to another agent mid-draft: the same rows, read fresh. Only the ask
 * moves on, to the next one, once its answer is in.
 */
export function holdChoices(held: readonly CompanionChoice[], threads: readonly CornerThread[], facts: ChoiceFacts): CompanionChoice[] {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const fresh = (t: CornerThread) => byId.get(t.id) ?? t;
  const answer = companionChoices(threads, facts).find((c) => c.kind === "answer");
  const kept = held.flatMap((c): CompanionChoice[] => {
    switch (c.kind) {
      case "answer": return [];
      case "reply": case "jump": return [{ ...c, t: fresh(c.t) }];
      case "catch-up": return [{ ...c, rows: c.rows.map(fresh) }];
      case "new": return [c];
    }
  });
  return [...(answer ? [answer] : []), ...kept].slice(0, CHOICES_MAX);
}

/** A changed row in a few words: who, and what it did. */
export function changeWord(remark: Remark): string {
  switch (remark) {
    case "WORKING": return "is working";
    case "QUIET": return "went quiet";
    case "DONE": return "finished";
    case "STOPPED": return "stopped";
    case "COMPACT": return "is compacting";
    case "ENDED": return "ended";
    case "IDLE": return "is idle";
    case "ASKING": return "is asking";
    case "READY": return "is ready";
  }
}

export function changeOf(t: CornerThread): string {
  return changeWord(remarkOf(t));
}

export function readLookedAt(): number | null {
  try {
    const n = Number(localStorage.getItem(LOOKED_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeLookedAt(at: number): void {
  try { localStorage.setItem(LOOKED_KEY, String(Math.round(at))); } catch {}
}

/** ↑ and ↓ through the card's controls, wrapping. */
export function stepChoice(i: number, n: number, by: 1 | -1): number {
  if (n <= 0) return -1;
  if (i < 0) return by > 0 ? 0 : n - 1;
  return (i + by + n) % n;
}
