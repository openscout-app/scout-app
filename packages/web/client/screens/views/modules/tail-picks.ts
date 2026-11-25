import type { TailEvent } from "../../../lib/types.ts";
import type { TailPanelKind } from "./tail-panel-model.ts";

/*
 * The event each Tail or Alerts panel last picked, so an Event panel on the
 * same view shows it beside the stream: what Ops' inspector showed for the
 * selected row, without the window-wide detail channel the inspector reads.
 *
 * An Event panel watches while it is on the view. A Tail panel publishes a
 * pick only while one watches (and it is not lifted into full view);
 * otherwise it opens its own detail sheet, as an embedded tail always has.
 * Every pick is an act, so the latest pick wins; a panel withdraws its pick
 * when it leaves the view, and Clear in the Event panel withdraws it too.
 */

export type TailPick = {
  /** The Tail or Alerts panel's instance id. */
  from: string;
  event: TailEvent;
  kind: TailPanelKind;
  /** Order of the pick: the highest is the latest. */
  seq: number;
};

export type TailPicks = ReturnType<typeof createTailPicks>;

export function createTailPicks() {
  const picks = new Map<string, TailPick>();
  const listeners = new Set<() => void>();
  let seq = 0;
  let viewers = 0;
  let latest: TailPick | null = null;

  function emit() {
    latest = null;
    for (const pick of picks.values()) if (!latest || pick.seq > latest.seq) latest = pick;
    for (const listener of listeners) listener();
  }

  return {
    /** A panel picked an event: it becomes the latest. */
    publish(from: string, event: TailEvent, kind: TailPanelKind): void {
      picks.set(from, { from, event, kind, seq: ++seq });
      emit();
    },
    /** The panel left the view, or its pick was cleared. */
    withdraw(from: string): void {
      if (picks.delete(from)) emit();
    },
    latest(): TailPick | null {
      return latest;
    },
    /** An Event panel is on the view. Returns its release; calling it twice releases once. */
    watch(): () => void {
      viewers++;
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        viewers--;
      };
    },
    /** Is an Event panel there to show a pick? */
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

/** The window's picks: every Tail, Alerts and Event panel reads this one. */
export const tailPicks = createTailPicks();
