import type { ActivityItem } from "../../../lib/types.ts";

/*
 * The event each Activity panel that keeps its own selection has picked, so an
 * Activity details panel on the same view shows it beside the list without
 * either one moving the page. (On /activity, Activity details reads the URL
 * instead: activity-view-model.ts › detailsSource.)
 *
 * A panel publishes under its instance id and withdraws when its pick is
 * cleared or it leaves the view. Activity details shows the latest pick among
 * the panels still there; only one view draws at a time, so those are its
 * siblings. A pick by hand takes the latest place; a panel restoring its
 * saved pick after a reload keeps its place, so it never takes the details
 * panel from a pick the operator just made.
 *
 * Activity details watches while it is on the view, and the lists read
 * `watched()` to decide whether a pick opens beside them or under its row.
 */

export type ActivityPick = {
  /** The Activity panel's instance id. */
  from: string;
  item: ActivityItem;
  /** Order of the last pick by hand in that panel: the highest is the latest. */
  seq: number;
  /** Clear this selection in its panel (Activity details' Clear). */
  clear: () => void;
};

export type ActivityPicks = ReturnType<typeof createActivityPicks>;

export function createActivityPicks() {
  const picks = new Map<string, ActivityPick>();
  const listeners = new Set<() => void>();
  let seq = 0;
  let viewers = 0;
  let latest: ActivityPick | null = null;

  function emit() {
    latest = null;
    for (const pick of picks.values()) if (!latest || pick.seq > latest.seq) latest = pick;
    for (const listener of [...listeners]) listener();
  }

  return {
    /**
     * Set a panel's selection. `acted`: picked by hand, so it becomes the
     * latest; otherwise (a saved pick restored) it keeps its place, and a
     * first pick always takes a fresh one.
     */
    publish(from: string, pick: { item: ActivityItem; clear: () => void }, acted: boolean): void {
      const was = picks.get(from);
      if (was && !acted && was.item.id === pick.item.id) return;
      picks.set(from, { from, ...pick, seq: acted || !was ? ++seq : was.seq });
      emit();
    },
    /** The panel cleared its selection, or left the view. */
    withdraw(from: string): void {
      if (picks.delete(from)) emit();
    },
    get(from: string): ActivityPick | null {
      return picks.get(from) ?? null;
    },
    latest(): ActivityPick | null {
      return latest;
    },
    /** An Activity details panel is on the view. Returns its release; calling it twice releases once. */
    watch(): () => void {
      viewers++;
      if (viewers === 1) emit();
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        viewers--;
        if (viewers === 0) emit();
      };
    },
    /** Is an Activity details panel there to show a pick? */
    watched(): boolean {
      return viewers > 0;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The window's picks: every Activity and Activity details panel reads this one. */
export const activityPicks = createActivityPicks();
