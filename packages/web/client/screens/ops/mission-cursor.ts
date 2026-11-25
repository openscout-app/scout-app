/**
 * Mission Control keyboard cursor.
 *
 * The wall is read in reading order: `h`/`l` step one pane and wrap across row
 * boundaries the way text does, `j`/`k` step a whole row. The rules live here,
 * pure, so the wall stays a dumb renderer and the motion is testable without a
 * DOM — the same split `mission-wall.ts` uses for tiling.
 */

export type WallCursorMove = "left" | "right" | "up" | "down" | "first" | "last";

/**
 * Where the cursor lands after `move`. Never returns an out-of-range index, and
 * never dead-ends: the ragged bottom row falls through to the final pane rather
 * than swallowing a `j`.
 */
export function moveWallCursor(
  current: number,
  count: number,
  cols: number,
  move: WallCursorMove,
): number {
  if (count <= 0) return -1;
  const last = count - 1;
  const width = Math.max(1, Math.floor(cols));

  // No cursor yet (or one left dangling by a re-tile): the first keypress plants
  // it at the edge the motion arrives from.
  if (current < 0 || current > last) {
    return move === "left" || move === "up" || move === "last" ? last : 0;
  }

  switch (move) {
    case "first":
      return 0;
    case "last":
      return last;
    case "left":
      return Math.max(0, current - 1);
    case "right":
      return Math.min(last, current + 1);
    case "up": {
      const next = current - width;
      // Already on the top row — hold rather than drift sideways into it.
      return next >= 0 ? next : current;
    }
    case "down": {
      const next = current + width;
      // The bottom row is usually short. Falling to the final pane keeps `j`
      // from going inert one row above the thing you were reaching for.
      return next <= last ? next : last;
    }
  }
}

/**
 * The wall's binding table. Vim motions plus the arrow keys they stand in for,
 * with `G`/End (and Home) for the ends — the same dialect Agent Lanes speaks,
 * widened from a list to a grid. Bare `g` is deliberately absent: the shell
 * owns it as the go-chord prefix (`g` then `h` is Home, `g` then `l` is Tail),
 * and it captures the key before any surface sees it, so binding it here would
 * only advertise a motion that can never fire.
 */
export function wallCursorMoveForKey(key: string): WallCursorMove | null {
  switch (key) {
    case "h":
    case "ArrowLeft":
      return "left";
    case "l":
    case "ArrowRight":
      return "right";
    case "k":
    case "ArrowUp":
      return "up";
    case "j":
    case "ArrowDown":
      return "down";
    case "Home":
      return "first";
    case "G":
    case "End":
      return "last";
    default:
      return null;
  }
}

/** What one Esc on the wall closes, innermost first, or null when there is nothing left to close. */
export type WallEscapeStep = "rail" | "selection" | "pin" | "cursor";

/**
 * The Esc ladder: the context rail, then the selection, then the pin, then
 * the cursor, one step per press. Null means the wall has nothing to close,
 * so the key is left for whoever is next (a grid's full view, the window's
 * Back): the wall takes the key only when it took a step.
 */
export function wallEscapeStep(state: {
  /** An open rail the wall draws itself; a docked Context panel is not the wall's to close. */
  railOpen: boolean;
  selected: number;
  pinned: boolean;
  cursor: boolean;
}): WallEscapeStep | null {
  if (state.railOpen) return "rail";
  if (state.selected > 0) return "selection";
  if (state.pinned) return "pin";
  if (state.cursor) return "cursor";
  return null;
}
