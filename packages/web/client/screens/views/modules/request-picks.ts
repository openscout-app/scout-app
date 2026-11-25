/*
 * What each Requests panel off the Requests page has picked, so a Request
 * panel beside it that follows picks can show that request without either
 * one moving the page. (On /requests the URL is the pick, and the panel that
 * follows the page reads it there.)
 *
 * A Requests panel publishes under its instance id and withdraws when its
 * pick is cleared or it goes (removed, replaced, or the view closes). A
 * Request panel shows the latest pick among the panels still there. Only one
 * view draws at a time, so those are its siblings.
 *
 * Request panels that follow the page count themselves in, on any route, so a
 * Requests panel knows whether a pick shows beside it: with none, the pick
 * opens under its row instead.
 *
 * "Latest" moves when a panel's pick changes or someone clicks the row it
 * already has; publishing the same pick again (a re-render, a reload
 * restoring it) keeps its place.
 */

export type RequestPicks = ReturnType<typeof createRequestPicks>;

export function createRequestPicks() {
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
      picks.set(from, { id, seq: was && !acted ? was.seq : ++seq });
      emit();
    },
    /** The panel left the view. */
    withdraw(from: string): void {
      if (picks.delete(from)) emit();
    },
    /** The latest pick among the Requests panels still there, or null. */
    latest(): string | null {
      return latest;
    },
    /** Count a Request panel that follows the page in; returns the release, which releases once. */
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
    /** A Request panel on the view shows picks. */
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

/** The window's picks: every Requests and Request panel reads this one. */
export const requestPicks = createRequestPicks();
