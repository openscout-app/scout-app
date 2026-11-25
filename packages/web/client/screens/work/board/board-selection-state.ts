import type { Route } from "../../../lib/types.ts";

export type BoardSelection = { item: string | null; full: boolean };
export type BoardSelectionAction =
  | { type: "select"; value: string | null | ((old: string | null) => string | null) }
  | { type: "expand" | "collapse" };

export function boardSelection(route: Route, local: BoardSelection): BoardSelection {
  return route.view === "work" && route.board
    ? { item: route.boardItem ?? null, full: Boolean(route.boardFull) }
    : local;
}

/** Only the dedicated board owns URL selection; embedded boards own local state. */
export function updateBoardSelection(route: Route, local: BoardSelection, action: BoardSelectionAction): { route?: Route; local: BoardSelection } {
  const current = boardSelection(route, local);
  const next = action.type === "select"
    ? { item: typeof action.value === "function" ? action.value(current.item) : action.value, full: false }
    : { ...current, full: action.type === "expand" && Boolean(current.item) };
  return route.view === "work" && route.board
    ? { route: { ...route, boardItem: next.item ?? undefined, boardFull: next.full }, local }
    : { local: next };
}
