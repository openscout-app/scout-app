/**
 * Pulling DOM focus is only ever correct when the operator asked to move
 * through the list. The dispatch feed re-renders whenever new traffic lands,
 * and the selected row's index shifts as rows come and go — if focus followed
 * that churn it would rip the caret out of whatever the operator is typing
 * into (the "Ask another agent" composer) and drop it on a list row, where
 * j/k/g/Enter are navigation shortcuts.
 *
 * Intent is therefore a numbered request, not a flag. Every operator move
 * increments `request`; the focus effect pulls focus exactly once per number
 * it has not consumed yet. Index changes that are not operator moves — the
 * clamp when rows disappear, selection tracking, Escape — keep the current
 * number, so they can never spend someone else's intent. A boolean cannot
 * make that guarantee: arming it for a move that leaves the index unchanged
 * (Enter on the already-focused row) commits no state, runs no effect, and
 * leaves the arm behind for the next unrelated index change to spend.
 */
export type LedgerFocusState = { index: number; request: number };

export const initialLedgerFocusState: LedgerFocusState = { index: -1, request: 0 };

/** An operator move: adopt the index and stamp a fresh focus request. */
export function ledgerFocusMove(current: LedgerFocusState, index: number): LedgerFocusState {
  return { index, request: current.request + 1 };
}

/**
 * A non-focusing index update (selection tracking, Escape, clamp): adopt the
 * index, keep the request number so no focus pull can result. Returns the
 * current state identity when nothing changes.
 */
export function ledgerFocusTrack(current: LedgerFocusState, index: number): LedgerFocusState {
  return index === current.index ? current : { index, request: current.request };
}

/** Rows disappeared under the selection: clamp without spending any intent. */
export function ledgerFocusClamp(current: LedgerFocusState, rowCount: number): LedgerFocusState {
  if (current.index < rowCount) return current;
  return ledgerFocusTrack(current, rowCount > 0 ? rowCount - 1 : -1);
}

/** The focus effect pulls focus only for a request number it has not consumed. */
export function shouldPullLedgerFocus(state: LedgerFocusState, consumedRequest: number): boolean {
  return state.request !== consumedRequest;
}

/**
 * Whether a key belongs to a ledger drawn in a view panel. Keys bind while
 * focus is inside the panel, and with `idle` also while nothing on the page
 * holds focus (on /dispatch, where the ledger is the page). A key another
 * handler already took, or one with a modifier (the panel's own ⇧/⌥+arrows,
 * the app's ⌘ shortcuts), passes by. Inputs are the DOM's, passed in so the
 * rule tests without one.
 */
export function ledgerKeyInPanel(
  key: { defaultPrevented: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean },
  where: { panel: { contains: (node: never) => boolean } | null; active: unknown; body: unknown; idle: boolean },
): boolean {
  if (key.defaultPrevented || key.altKey || key.metaKey || key.ctrlKey) return false;
  if (where.idle && (!where.active || where.active === where.body)) return true;
  return Boolean(where.panel && where.active && where.panel.contains(where.active as never));
}

/**
 * Whether Enter or Space opens the focused row of a ledger in a panel. Only
 * when it would press nothing else: on a row, on the panel itself, or with
 * nothing focused. On a control in the panel (a tab, Load older, the open
 * dispatch's Retry, a button in the panel head) it presses that control.
 */
export function ledgerActivationInPanel(where: { target: unknown; panel: unknown; body: unknown; inRow: boolean }): boolean {
  return where.inRow || !where.target || where.target === where.body || where.target === where.panel;
}
