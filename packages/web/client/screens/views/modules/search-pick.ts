import type { KnowledgeHit } from "../../../lib/knowledge-search.ts";

/*
 * What each Search panel that keeps its own search has selected, so a Result
 * panel on the same view can show it without either one moving the page.
 *
 * A Search panel publishes under its instance id and withdraws when it goes
 * (removed, replaced, or the view closes). A Result panel shows the latest
 * pick among the panels still there. Only one view draws at a time, so the
 * panels still there are the Result panel's siblings.
 *
 * "Latest" moves when someone acts in a panel: a pick by hand, or the answer
 * to a search they just edited. An answer that only refreshes (an index run
 * finished) keeps its place, so one panel's refresh never takes Result from
 * another the operator was reading.
 */

export type SearchPick = {
  /** The Search panel's instance id. */
  from: string;
  hit: KnowledgeHit;
  /** The query the moment answers, for highlighting and the preview. */
  query: string;
  /** Order of the last act in that panel: the highest is the latest. */
  seq: number;
  /** Clear this selection in its panel (Result's close button). */
  clear: () => void;
};

export type SearchPicks = ReturnType<typeof createSearchPicks>;

export function createSearchPicks() {
  const picks = new Map<string, SearchPick>();
  const listeners = new Set<() => void>();
  let seq = 0;
  let latest: SearchPick | null = null;

  function emit() {
    latest = null;
    for (const pick of picks.values()) if (!latest || pick.seq > latest.seq) latest = pick;
    for (const listener of listeners) listener();
  }

  return {
    /**
     * Set a panel's selection. `acted`: someone just acted in that panel, so
     * it becomes the latest; otherwise it keeps its place (a first pick always
     * takes a fresh one).
     */
    publish(from: string, pick: { hit: KnowledgeHit; query: string; clear: () => void }, acted: boolean): void {
      const was = picks.get(from);
      if (was && !acted && was.hit.id === pick.hit.id && was.query === pick.query) return;
      picks.set(from, { from, ...pick, seq: acted || !was ? ++seq : was.seq });
      emit();
    },
    /** The panel cleared its selection, or left the view. */
    withdraw(from: string): void {
      if (picks.delete(from)) emit();
    },
    get(from: string): SearchPick | null {
      return picks.get(from) ?? null;
    },
    latest(): SearchPick | null {
      return latest;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The window's picks: every Search and Result panel reads this one. */
export const searchPicks = createSearchPicks();
