/**
 * The folded board as a strip (Studio /studies/companion-board-fold, D,
 * picked 2026-10-16): one line of agent cells in the order they arrived, each
 * a project tile, its harness coin and a tick per board pass of what the
 * agent did. An ask breaks in as the one full row above it. Past its slots
 * the strip turns a page on each pass, so every agent comes round.
 */

import type { TailEvent } from "../../../lib/types.ts";
import { parseSessionRouteRef } from "../../../../shared/session-route-ref.ts";
import { PASS_MS } from "./board-motion.ts";
import { stripMarkup } from "../plain-text.ts";
import { plainLine } from "./TapText.tsx";

/** How the board folds (··· › Folded): today's one row, or a strip of this many slots. */
export type BoardFolded = "row" | "3" | "5" | "8";
export const BOARD_FOLDED: readonly BoardFolded[] = ["row", "3", "5", "8"];
export const DEFAULT_BOARD_FOLDED: BoardFolded = "5";

export function parseBoardFolded(value: string | null | undefined): BoardFolded {
  return BOARD_FOLDED.includes(value as BoardFolded) ? (value as BoardFolded) : DEFAULT_BOARD_FOLDED;
}

/** Passes a cell plots: 8 × 30 s, four minutes. */
export const STRIP_PASSES = 8;

/**
 * Per session, what it did in each of the last `passes` board passes ending
 * at `passAt`, oldest first: its tool calls and its own words, counted.
 */
export function passActivity(events: readonly TailEvent[], passAt: number, passes = STRIP_PASSES, passMs = PASS_MS): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const from = passAt - passes * passMs;
  for (const e of events) {
    if (e.kind !== "tool" && e.kind !== "assistant") continue;
    if (e.ts < from || e.ts >= passAt) continue;
    const slot = Math.min(passes - 1, Math.floor((e.ts - from) / passMs));
    let counts = out.get(e.sessionId);
    if (!counts) {
      counts = new Array<number>(passes).fill(0);
      out.set(e.sessionId, counts);
    }
    counts[slot] += 1;
  }
  return out;
}

/** Activity follows the resolved harness session; older rows can carry only a session pin. */
export function plottedSession(pinId: string | null | undefined, sessionRef?: string | null): string | null {
  return parseSessionRouteRef(sessionRef)?.refId
    ?? (pinId?.startsWith("session:") ? pinId.slice("session:".length) : null);
}

/** Arrival order: who was already here keeps their place, newcomers join the end, and anyone gone leaves. */
export function arrivalOrder(previous: readonly string[], ids: readonly string[]): string[] {
  const here = new Set(ids);
  const kept = previous.filter((id) => here.has(id));
  const known = new Set(kept);
  return [...kept, ...ids.filter((id) => !known.has(id))];
}

/** The page of `order` the strip shows on a pass: all of it when it fits, else one page per pass, round and round. */
export function stripPage<T>(order: readonly T[], slots: number, passAt: number, passMs = PASS_MS): { shown: T[]; page: number; pages: number } {
  if (order.length <= slots) return { shown: [...order], page: 0, pages: 1 };
  const pages = Math.ceil(order.length / slots);
  const page = Math.floor(passAt / passMs) % pages;
  return { shown: order.slice(page * slots, page * slots + slots), page, pages };
}

/** A plot's bar heights in 0..max: scaled to the busiest pass on the strip, so cells compare; an idle pass draws nothing. */
export function barHeights(counts: readonly number[], busiest: number, max = 13): number[] {
  return counts.map((c) => (c <= 0 || busiest <= 0 ? 0 : Math.max(2, Math.round((Math.min(c, busiest) / busiest) * max))));
}

/** Keep working, asking and unread sessions visible until their activity is known. */
export function stripWorthy(remark: string, asking: boolean): boolean {
  return asking || remark === "WORKING" || remark === "ASKING" || remark === "READY" || remark === "IDLE";
}

/** The demo's plots (?demo=1): busy while working, flat otherwise, steady per agent, keyed by row id. */
export function demoPassActivity(rows: readonly { id: string; remark: string }[], passAt: number, passes = STRIP_PASSES, passMs = PASS_MS): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const last = Math.floor(passAt / passMs);
  for (const r of rows) {
    let h = 0;
    for (const c of r.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const counts: number[] = [];
    for (let k = last - passes + 1; k <= last; k++) {
      const wave = Math.abs(Math.sin(h * 0.001 + k * 1.7)) * 0.6 + Math.abs(Math.sin(h * 0.003 + k * 0.45)) * 0.4;
      counts.push(r.remark === "WORKING" ? Math.round(2 + wave * 10) : 0);
    }
    out.set(r.id, counts);
  }
  return out;
}

/** A line that just finished stays this long, saying done, before it leaves the strip. */
export const DONE_LINGER_MS = 2 * 60_000;

/** Each session's latest step, for stream lines: its newest tool call or words, one line. */
/** What an agent did last: a tool it ran, or what it said. */
export type LatestStep = { text: string; at: number; kind: "tool" | "assistant" };

export function latestStepBySession(events: readonly TailEvent[]): Map<string, LatestStep> {
  const out = new Map<string, LatestStep>();
  for (const e of events) {
    if (e.kind !== "tool" && e.kind !== "assistant") continue;
    // an MCP tool reads by its server and name, not its wire prefix
    // what it said reads as words, without its Markdown; a tool call keeps its literal text
    const text = e.kind === "assistant"
      ? plainLine(e.summary)
      : stripMarkup(e.summary).replace(/\s+/g, " ").trim().replace(/^mcp__([^_]+)__/, "$1 · ");
    if (!text) continue;
    const prior = out.get(e.sessionId);
    if (!prior || e.ts >= prior.at) out.set(e.sessionId, { text, at: e.ts, kind: e.kind });
  }
  return out;
}
