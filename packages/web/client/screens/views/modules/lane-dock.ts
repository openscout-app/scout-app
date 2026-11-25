import type { AgentLane } from "../../ops/agent-lanes-model.ts";

/**
 * Where the Lanes panels meet. The deck owns the tail, the lanes it builds
 * from it and the lane deck (pins, widths, window); a Lane panel beside it
 * reads those lanes here instead of reading the tail a second time, and shows
 * the lane the deck picked. The roster asks whether a deck is on the view.
 *
 * On Ops › Lanes the pick is the page's (?sessionId=, once the router keeps
 * it); the dock still carries it, so a Lane panel set to the deck's pick
 * shows it too.
 */
export type LaneDeckReading = {
  /** Every lane the deck built in its window, before its project and harness scope. */
  lanes: readonly AgentLane[];
  /** The deck's window, as its chips name it: "30m". */
  horizonLabel: string;
  /** Session, profile and trace routes exist (false in the adapter-backed embeds). */
  navigationEnabled: boolean;
  /** Pin a lane's project to the deck as a lane of its own. */
  pinProject: (path: string) => void;
  /** A project lane already covers this path. */
  projectPinned: (path: string) => boolean;
};

export type LaneDockState = {
  /** Lane decks mounted now. A view holds one (maxPerView). */
  decks: number;
  /** Lane panels that show the deck's pick. With one, a pick goes there instead of the deck's own sheet. */
  followers: number;
  /** What the deck shows, published while it is mounted. */
  reading: LaneDeckReading | null;
  /** The lane the deck picked last, by lane id. */
  pick: string | null;
};

export type LaneDock = {
  get: () => LaneDockState;
  subscribe: (listener: () => void) => () => void;
  /** A deck mounted; returns its release. The reading and the pick clear when the last deck leaves. */
  mountDeck: () => () => void;
  /** A Lane panel that shows the deck's pick mounted; returns its release. */
  follow: () => () => void;
  /** The deck's reading. Skips one equal to the reading held. */
  publish: (reading: LaneDeckReading | null) => void;
  /** The deck picked a lane, or let go of it. */
  pick: (laneId: string | null) => void;
};

const IDLE: LaneDockState = { decks: 0, followers: 0, reading: null, pick: null };

function sameReading(a: LaneDeckReading | null, b: LaneDeckReading | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.lanes === b.lanes
    && a.horizonLabel === b.horizonLabel
    && a.navigationEnabled === b.navigationEnabled
    && a.pinProject === b.pinProject
    && a.projectPinned === b.projectPinned;
}

export function createLaneDock(): LaneDock {
  let state = IDLE;
  const listeners = new Set<() => void>();

  const set = (next: LaneDockState) => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  // A release runs once, so StrictMode's mount, unmount, mount counts true.
  const counted = (key: "decks" | "followers") => () => {
    set({ ...state, [key]: state[key] + 1 });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = Math.max(0, state[key] - 1);
      const gone = key === "decks" && count === 0;
      set({ ...state, [key]: count, reading: gone ? null : state.reading, pick: gone ? null : state.pick });
    };
  };

  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mountDeck: counted("decks"),
    follow: counted("followers"),
    publish: (reading) => {
      if (sameReading(state.reading, reading)) return;
      set({ ...state, reading });
    },
    pick: (laneId) => {
      const id = laneId?.trim() || null;
      if (state.pick === id) return;
      set({ ...state, pick: id });
    },
  };
}

/** The one dock every Lanes panel in this window shares. */
export const laneDock = createLaneDock();
