/*
 * What each Briefings panel off the Briefings page has picked, so a Briefing
 * panel beside it that follows picks can show it without either one moving
 * the page. (On /briefings the URL is the pick, and none of this is used.)
 *
 * A Briefings panel publishes under its instance id and withdraws when it
 * goes (removed, replaced, or the view closes). A Briefing panel shows the
 * latest pick among the panels still there. Only one view draws at a time, so
 * the panels still there are the Briefing panel's siblings.
 *
 * Briefing panels that follow picks count themselves in, so a Briefings panel
 * knows whether a pick will show anywhere: with none, a row opens the
 * briefing's own page instead.
 *
 * "Latest" moves when a panel's pick changes or someone clicks the row it
 * already has; publishing the same pick again (a re-render, a reload
 * restoring it) keeps its place.
 */

export type BriefingPicks = ReturnType<typeof createBriefingPicks>;

export function createBriefingPicks() {
  const picks = new Map<string, { id: string; seq: number }>();
  const listeners = new Set<() => void>();
  let seq = 0;
  let latest: string | null = null;
  let followers = 0;

  function emit() {
    let best: { id: string; seq: number } | null = null;
    for (const pick of picks.values()) if (!best || pick.seq > best.seq) best = pick;
    latest = best?.id ?? null;
    for (const listener of [...listeners]) listener();
  }

  return {
    /** Set a panel's pick ("" withdraws it). `acted`: someone just clicked it, so it is the latest. */
    publish(from: string, id: string, acted = false): void {
      if (!id) {
        if (picks.delete(from)) emit();
        return;
      }
      const was = picks.get(from);
      if (was && was.id === id && !acted) return;
      picks.set(from, { id, seq: ++seq });
      emit();
    },
    /** The panel left the view. */
    withdraw(from: string): void {
      if (picks.delete(from)) emit();
    },
    /** The latest pick among the Briefings panels still there, or null. */
    latest(): string | null {
      return latest;
    },
    /** Count a Briefing panel that shows picks in; returns the release. */
    follow(): () => void {
      followers += 1;
      emit();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        followers -= 1;
        emit();
      };
    },
    /** A Briefing panel on the view shows picks. */
    followed(): boolean {
      return followers > 0;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The window's picks: every Briefings and Briefing panel reads this one. */
export const briefingPicks = createBriefingPicks();
