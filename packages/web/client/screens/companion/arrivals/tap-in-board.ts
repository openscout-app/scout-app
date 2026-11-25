/**
 * Tap in on the live board: which row is selected, whether its panel is
 * open, at which level, and where the panel and its tether sit. Pure, so the
 * board's selection, keys and placement read the same in tests as on the
 * board.
 *
 *  - A click (or Return) on a row, a chip or a strip line opens its engage
 *    panel: its open request, the last few turns, the reply line. The same
 *    row folds it; another row swaps it there.
 *  - Details (everything else: what is going on, its ways in, the actions
 *    that aren't quick) is one step on: the engage panel's link, ⌘I, or
 *    Details in the row's right-click menu. Esc steps back to the engage
 *    panel, then folds it.
 *  - ↑/↓ move the cursor through the board's visual order; an open panel
 *    follows as the engage panel. Closed, they only move the cursor.
 *  - A row that leaves the board while tapped keeps its panel, as it last
 *    stood; nothing moves the selection but the operator.
 */

import { notchPlacement, TAP_IN_SIZE, tapInPlacement, tapInTether, type TapInEdge, type TapInKeyAction, type TapInNotch, type TapInPlacement, type TapInRect } from "./tap-in-model.ts";

/**
 * The selection: the cursor row, and whether its panel is open or folding
 * back. `folding` is the row a folding panel finishes on once ↑/↓ have moved
 * the cursor off it; without it the panel is on the cursor row.
 */
export type TapSel = { id: string | null; open: boolean; closing: boolean; folding?: string | null; details?: boolean };

export const TAP_CLOSED: TapSel = { id: null, open: false, closing: false };

const showing = (s: TapSel) => s.open && !s.closing;

/** The row the panel shows: the cursor row, or the row a fold the cursor left finishes on. */
export function panelRowOf(s: TapSel): string | null {
  return s.folding ?? s.id;
}

/** A tap on a row: the same row, open, folds the panel; any other row opens its engage panel (or swaps it there). */
export function tapRow(s: TapSel, id: string): TapSel {
  if (s.id === id && showing(s)) return { ...s, closing: true };
  return { id, open: true, closing: false };
}

/** An agent's Details, from anywhere: the panel on its row, a step past the engage panel. */
export function detailsTap(id: string): TapSel {
  return { id, open: true, closing: false, details: true };
}

/** Whether the panel shows Details (else the engage panel). */
export function showsDetails(s: TapSel): boolean {
  return Boolean(s.details);
}

/** Esc from Details: back to the engage panel on the same row. */
export function engageTap(s: TapSel): TapSel {
  return s.details ? { id: s.id, open: s.open, closing: s.closing, ...(s.folding ? { folding: s.folding } : {}) } : s;
}

/** Esc or the close button: the panel folds back toward the board. The cursor stays. */
export function closeTap(s: TapSel): TapSel {
  return showing(s) ? { ...s, closing: true } : s;
}

/** The fold finished: the panel is gone, the cursor stays on its row. */
export function closedTap(s: TapSel): TapSel {
  return s.closing ? { id: s.id, open: false, closing: false } : s;
}

/** Return: open the engage panel on the cursor row, or fold the panel. Nothing without a cursor. */
export function toggleTap(s: TapSel): TapSel {
  if (s.id === null) return s;
  return showing(s) ? { ...s, closing: true } : { id: s.id, open: true, closing: false };
}

/**
 * ↑/↓ through the board's visual order. An open panel follows the cursor as
 * the engage panel (Details stays where it was asked for); a folding one is
 * left to finish and the cursor moves alone. With no cursor,
 * ↓ takes the first row and ↑ the last. A cursor whose row has left the
 * board moves from where it stood (`lastIndex`): ↓ to the row that took its
 * place, ↑ to the one above it.
 */
export function moveCursor(s: TapSel, order: readonly string[], dir: 1 | -1, lastIndex = -1): TapSel {
  if (!order.length) return s;
  const clamp = (i: number) => Math.max(0, Math.min(order.length - 1, i));
  const i = s.id === null ? -1 : order.indexOf(s.id);
  const next = i >= 0 ? order[clamp(i + dir)]!
    : s.id !== null && lastIndex >= 0 ? order[clamp(dir > 0 ? lastIndex : lastIndex - 1)]!
      : dir > 0 ? order[0]! : order[order.length - 1]!;
  if (next === s.id) return s;
  // Folding: the panel finishes its fold on the row it was on; only the cursor moves.
  if (s.closing) return { id: next, open: true, closing: true, folding: panelRowOf(s), ...(s.details ? { details: true } : {}) };
  return { id: next, open: s.open, closing: false };
}

/** The row's class: tapped while its panel is open, the cursor otherwise (closed or folding). */
export function tapRowClass(s: TapSel, id: string): string {
  if (s.id !== id) return "";
  return showing(s) ? " is-tapped" : " is-cursor";
}

/**
 * The order ↑/↓ walk at S and M: what the widget draws, its live lines in
 * arrival order (not the board's Arrivals then Departures); S only as far
 * as its chips go.
 */
export function widgetWalk(lines: readonly { id: string }[], size: "s" | "m", chips: number): string[] {
  const ids = lines.map((r) => r.id);
  return size === "s" ? ids.slice(0, chips) : ids;
}

/** What a board key does to the selection (tapInKeyAction's prev, next and toggle); null when it is not the board's to move. */
export function tapKeyStep(action: TapInKeyAction | null, s: TapSel, order: readonly string[], lastIndex = -1): TapSel | null {
  if (action === "prev" || action === "next") return moveCursor(s, order, action === "next" ? 1 : -1, lastIndex);
  if (action === "toggle") return s.id === null ? null : toggleTap(s);
  return null;
}

export type EscapeLevel = "field" | "settings" | "scoutbot" | "composer" | "details" | "panel" | "board";

/**
 * One esc folds one level, nearest first: out of the panel's reply line
 * while it holds a draft (the draft and the panel stay), then settings,
 * Scoutbot, the composer when the key came from it, Details back to the
 * engage panel, the panel, the composer, and last the board.
 */
export function escapeLevel(at: { draftInPanel: boolean; settings: boolean; scoutbot: boolean; composing: boolean; inComposer: boolean; details?: boolean; panel: boolean }): EscapeLevel {
  if (at.draftInPanel) return "field";
  if (at.settings) return "settings";
  if (at.scoutbot) return "scoutbot";
  if (at.composing && at.inComposer) return "composer";
  if (at.panel && at.details) return "details";
  if (at.panel) return "panel";
  if (at.composing) return "composer";
  return "board";
}

/** A row gone from the board: with its panel closed the cursor goes with it; with it open the panel keeps it, and nothing moves. */
export function settleTap(s: TapSel, ids: ReadonlySet<string>): TapSel {
  if (s.id === null || s.open || ids.has(s.id)) return s;
  return TAP_CLOSED;
}

/** A row's rect from the board's rect and its offsets: where it sits, its glide and entrance transforms left out. */
export function rowRectIn(board: TapInRect, row: { offsetLeft: number; offsetTop: number; offsetWidth: number; offsetHeight: number }, border: { left: number; top: number } = { left: 0, top: 0 }): TapInRect {
  const left = board.left + border.left + row.offsetLeft;
  const top = board.top + border.top + row.offsetTop;
  return { left, top, right: left + row.offsetWidth, bottom: top + row.offsetHeight };
}

/**
 * Stack mode: the room the companion grows by (above a bottom corner's
 * board, below a top corner's) so the panel fits inside the host's window,
 * within the screen it has (`screenH`, the host's visible height less its
 * margins).
 */
export function stackRoom(rootH: number, screenH: number): number {
  const { MIN_H, GAP, INSET } = TAP_IN_SIZE;
  return Math.max(0, Math.min(MIN_H + GAP + INSET, Math.floor(screenH - rootH)));
}

/**
 * Where the panel and its tether sit for this board, viewport and row. `row`
 * is null when the tapped row has left the board. The engage panel and
 * Details sit in one place at the row, so going into Details grows the panel
 * where it stands instead of moving it.
 */
export function tapLayout(board: TapInRect, view: { width: number; height: number }, row: TapInRect | null, stack: boolean, notchEdge: TapInEdge | null = null): { placement: TapInPlacement; tether: TapInNotch | null } {
  // On a notch the panel is the notch grown, from its edge: no row to follow, so no tether.
  if (notchEdge) return { placement: notchPlacement(board, view, notchEdge), tether: null };
  const placement = engagePlacement(tapInPlacement(board, view, { stack }), row, view);
  return { placement, tether: row ? tapInTether(row, placement) : null };
}

/** The panel's room: below its row when this much is left, else it stands on the row's bottom. */
export const ENGAGE_ROOM = 240;
/** The panel's top sits this far above its row's top, so its head lines up with the row. */
export const ENGAGE_LIFT = 8;

/**
 * The panel (engage or Details) is as tall as what it holds, never the
 * board's height. Beside the board it sits at its row (and moves with the
 * cursor): it hangs from just above the row while there is room below, else
 * it stands on the row's bottom. In the stack it stands next to the board.
 */
export function engagePlacement(p: TapInPlacement, row: TapInRect | null, view: { width: number; height: number }): TapInPlacement {
  const { INSET } = TAP_IN_SIZE;
  if (p.mode === "stack") return { ...p, fit: { min: 0, grow: p.from === "bottom" ? "up" : "down" } };
  if (!row) return { ...p, fit: { min: 0, grow: p.fit?.grow ?? "down" } };
  const top = Math.max(INSET, row.top - ENGAGE_LIFT);
  const below = view.height - INSET - top;
  if (below >= ENGAGE_ROOM) return { ...p, box: { ...p.box, top, height: below }, fit: { min: 0, grow: "down" } };
  const bottom = Math.min(view.height - INSET, row.bottom + ENGAGE_LIFT);
  return { ...p, box: { ...p.box, top: INSET, height: Math.max(0, bottom - INSET) }, fit: { min: 0, grow: "up" } };
}
