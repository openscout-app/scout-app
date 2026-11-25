import type { MissionCursorContext } from "../../ops/mission-wall.ts";

/**
 * Where the Mission panels meet. The wall owns the firehose, the cursor and
 * the lane reading behind it; a Session context panel beside it reads that
 * reading here instead of the wall drawing its own rail over the grid. The
 * roster and the context panel ask it whether a wall is on the view at all.
 *
 * The filters, search, selection and the wall's visible list stay in the
 * mission-control store (lib/mission-control-store.ts) the screen already
 * shares with its left rail.
 */
export type MissionDockState = {
  /** Mission walls mounted now. A view holds one (maxPerView). */
  walls: number;
  /** Session context panels mounted now. With one, the wall draws no rail of its own. */
  docks: number;
  /** What the wall's cursor is on, published while a context panel is docked. */
  context: MissionCursorContext | null;
};

export type MissionDock = {
  get: () => MissionDockState;
  subscribe: (listener: () => void) => () => void;
  /** A wall mounted; returns its release. The context clears when the last wall leaves. */
  mountWall: () => () => void;
  /** A context panel mounted; returns its release. */
  dock: () => () => void;
  /** The wall's cursor reading. Skips a reading equal to the one held. */
  publish: (context: MissionCursorContext | null) => void;
};

const IDLE: MissionDockState = { walls: 0, docks: 0, context: null };

function sameContext(a: MissionCursorContext | null, b: MissionCursorContext | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.cursorId === b.cursorId && a.log === b.log && a.lane === b.lane;
}

export function createMissionDock(): MissionDock {
  let state = IDLE;
  const listeners = new Set<() => void>();

  const set = (next: MissionDockState) => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  // A release runs once, so StrictMode's mount, unmount, mount counts true.
  const counted = (key: "walls" | "docks") => () => {
    set({ ...state, [key]: state[key] + 1 });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = Math.max(0, state[key] - 1);
      const context = key === "walls" && count === 0 ? null : state.context;
      set({ ...state, [key]: count, context });
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
    mountWall: counted("walls"),
    dock: counted("docks"),
    publish: (context) => {
      if (sameContext(state.context, context)) return;
      set({ ...state, context });
    },
  };
}

/** The one dock every Mission panel in this window shares. */
export const missionDock = createMissionDock();
