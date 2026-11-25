/*
 * Search's keys: "/" focuses the field, j and k walk the moments, Esc clears
 * the selection (or, with no results, every filter). Pure, so the rules test
 * without a DOM; KnowledgeSearch reads the event into this shape.
 *
 * On the Search page the keys are the screen's, from anywhere. On the Search
 * view they stay the screen's, except inside another kind of panel (a terminal
 * someone added beside it keeps its own j and k). A Search panel on any other
 * view answers only while focus is inside it. Esc belongs to the grid while a
 * panel is in full view (leave full view first), and on a panel's frame (the
 * grid unfocuses it).
 */

export type SearchKeyInput = {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  /** Focus is in a text field: typing, not a command. */
  inField: boolean;
  /** Focus is where this search answers keys: anywhere, or inside its panel. */
  inScope: boolean;
  /** Focus is inside a panel that is not one of Search's. */
  inOtherPanel: boolean;
  /** Focus is on a grid panel's own frame, which takes Esc to unfocus. */
  onPanelFrame: boolean;
  /** A grid panel is in full view, which takes Esc to leave it. */
  fullView: boolean;
};

export type SearchKeyAction = "focus" | "next" | "prev" | "escape" | null;

export function searchKeyAction(input: SearchKeyInput): SearchKeyAction {
  if (!input.inScope || input.inField) return null;
  // ⌘K, ⌃J and friends belong to the app
  if (input.meta || input.ctrl || input.alt) return null;
  if (input.key === "/") return "focus";
  if (input.inOtherPanel) return null;
  if (input.key === "Escape") return input.fullView || input.onPanelFrame ? null : "escape";
  if (input.key === "j") return "next";
  if (input.key === "k") return "prev";
  return null;
}

/** The moment j or k lands on: from nothing selected, j takes the first; both stop at the ends. */
export function stepMoment(ids: readonly string[], currentId: string | null, step: "next" | "prev"): string | null {
  if (ids.length === 0) return null;
  const at = currentId ? ids.indexOf(currentId) : -1;
  const next = step === "next" ? Math.min(ids.length - 1, at + 1) : Math.max(0, at - 1);
  return ids[next] ?? null;
}

/** The moment an answer selects: the one the selection already names (a deep link, a pick kept across a reload), else the first. */
export function answerPick<T extends { id: string }>(hits: readonly T[], wanted: string | null | undefined): T | null {
  return (wanted ? hits.find((hit) => hit.id === wanted) : undefined) ?? hits[0] ?? null;
}
