import type { TerminalListItem } from "../../lib/terminal-sessions.ts";
import { surfaceKey } from "../../lib/terminal-sessions.ts";
import { isStoppedHostItem } from "./terminal-nav-model.ts";
import { terminalSessionActivityAt } from "./session-table.ts";

/**
 * Where bare /terminal lands when the workspace it would show has nothing
 * running: the terminal you last opened, if it still runs, else the one most
 * recently active. A saved workspace whose every tile stopped is a black pane
 * with "Start it again", which is the wrong first thing to see while other
 * terminals run. Pure, so it tests without a DOM.
 */

const LAST_TERMINAL_KEY = "scout.terminal.last-surface";

export function isRunningTerminalItem(item: TerminalListItem): boolean {
  return !isStoppedHostItem(item) && item.surface.state !== "exited";
}

export function landingTerminalItem(
  items: readonly TerminalListItem[],
  lastSurfaceKey: string | null,
  /** Work moving right now (an agent in a turn) leads, as it does in the list. */
  isWorking: (item: TerminalListItem) => boolean = () => false,
): TerminalListItem | null {
  const running = items.filter(isRunningTerminalItem);
  if (running.length === 0) return null;
  const last = lastSurfaceKey ? running.find((item) => surfaceKey(item.surface) === lastSurfaceKey) : undefined;
  if (last) return last;
  let best: TerminalListItem | null = null;
  let bestAt = Number.NEGATIVE_INFINITY;
  for (const item of running) {
    const at = isWorking(item) ? Number.POSITIVE_INFINITY : terminalSessionActivityAt(item) ?? Number.NEGATIVE_INFINITY;
    if (best === null || at > bestAt) {
      best = item;
      bestAt = at;
    }
  }
  return best;
}

/** The terminal last opened on its own page, kept per browser; a convenience, so failures are ignored. */
export function readLastTerminalSurface(): string | null {
  try {
    return window.localStorage.getItem(LAST_TERMINAL_KEY);
  } catch {
    return null;
  }
}

export function rememberLastTerminalSurface(key: string): void {
  try {
    window.localStorage.setItem(LAST_TERMINAL_KEY, key);
  } catch {
    // private window or blocked storage: landing falls back to the most recent
  }
}

// Once per page visit: the first arrival lands on something running; going
// back to Terminals after that shows the workspaces as they are.
let landedThisVisit = false;

export function claimTerminalLanding(): boolean {
  if (landedThisVisit) return false;
  landedThisVisit = true;
  return true;
}
