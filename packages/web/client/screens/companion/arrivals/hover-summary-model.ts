import { timeAgoPast } from "../../../lib/time";
import { plainLine, requestLine, type CornerThread } from "../system-corner/system-corner-model.ts";
import { remarkOf, rowName, rowNow, sinceOf } from "./arrivals-model.ts";

/*
 * The hover summary: rest the pointer on a figure, a strip, a board row or a
 * chip for about a second and a quiet line or two says who it is, where it
 * works, its state and since when, and its open ask or its latest line. It
 * takes no pointer and holds no controls; a click still opens the engage
 * panel. Pure functions only (HoverSummary.tsx draws it).
 */

/** How long the pointer rests on an agent before its summary shows. */
export const HOVER_REST_MS = 1000;

/**
 * Board rows and chips are hit regions of their own inside the board's
 * (later regions win in the host's hit test), so the host can say which one
 * the pointer rests on: WebKit runs no hover in a panel that is not key.
 */
export const HOVER_HIT = "hover:";
export function hoverHitId(id: string): string {
  return `${HOVER_HIT}${id}`;
}

/** The agent a reported region is: a board row or chip (`hover:`), or a figure or strip on the desk (`plate:`). */
export function hoverIdOf(hit: string | null, prefix: string = HOVER_HIT): string | null {
  return hit?.startsWith(prefix) ? hit.slice(prefix.length) || null : null;
}

export type HoverSummaryView = {
  name: string;
  /** Its project, unless the name already says it. */
  where: string;
  /** The board's word for its state (WORKING, ASKING, DONE…). */
  state: string;
  asking: boolean;
  /** Since when it is in that state: "now", or "2m ago". */
  since: string;
  /** Its open ask, verb and subject, else its latest line; empty when there is neither. */
  ask: { verb: string; subject: string } | null;
  line: string;
};

/**
 * `named`: the name the board's row wears (the namer's, session-titles.ts),
 * so the summary names the row as the row does. Without one, the row's name
 * as one plain line: a session named by its ask carries the ask's markdown.
 */
export function hoverSummary(t: CornerThread, now: number, named?: string | null): HoverSummaryView {
  const name = named?.trim() || plainLine(rowName(t), 90) || rowName(t);
  const project = t.project?.trim() ?? "";
  const state = remarkOf(t);
  const ago = timeAgoPast(sinceOf(t), now);
  const ask = t.request ? requestLine(t.request) : null;
  return {
    name,
    where: project && project !== name ? project : "",
    state,
    asking: state === "ASKING",
    since: !ago || ago === "now" ? ago : `${ago} ago`,
    ask: ask ? { verb: ask.verb, subject: plainLine(ask.subject, 140) } : null,
    line: plainLine(rowNow(t), 140),
  };
}

type Box = { left: number; top: number; width: number; height: number };
const PAD = 8;

/**
 * Where the summary sits. Beside the board when one is given (a row or a
 * chip): on the side of the board with room for it, level with the row.
 * Else (a figure, a strip, or a board with no room beside it) above what the
 * pointer rests on, or below it when there is no room above; always inside
 * the view.
 */
export function hoverSpot(anchor: Box, size: { width: number; height: number }, view: { width: number; height: number }, beside: Box | null = null, hangFrom: "top" | "bottom" | null = null, gap = 8): { left: number; top: number } {
  const clampX = (x: number) => Math.round(Math.min(Math.max(PAD, x), Math.max(PAD, view.width - size.width - PAD)));
  const clampY = (y: number) => Math.round(Math.min(Math.max(PAD, y), Math.max(PAD, view.height - size.height - PAD)));
  // A board hanging from the top or bottom edge (the notch) is wide and centred: its sides are no place for a
  // card. It drops below the board (or rises above it), under the chip, where the panel opens on a click.
  if (beside && hangFrom) {
    const left = clampX(anchor.left + anchor.width / 2 - size.width / 2);
    return { left, top: hangFrom === "top" ? clampY(beside.top + beside.height + gap) : clampY(beside.top - gap - size.height) };
  }
  if (beside) {
    const level = clampY(anchor.top + anchor.height / 2 - size.height / 2);
    const leftRoom = beside.left - gap - PAD;
    const rightRoom = view.width - (beside.left + beside.width) - gap - PAD;
    if (leftRoom >= size.width && leftRoom >= rightRoom) return { left: Math.round(beside.left - gap - size.width), top: level };
    if (rightRoom >= size.width) return { left: Math.round(beside.left + beside.width + gap), top: level };
  }
  const left = clampX(anchor.left + anchor.width / 2 - size.width / 2);
  const above = anchor.top - gap - size.height;
  if (above >= PAD) return { left, top: Math.round(above) };
  return { left, top: clampY(anchor.top + anchor.height + gap) };
}
