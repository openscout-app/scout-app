import type { TerminalSessionRecord } from "@openscout/protocol";
import { createTerminalNavOrder, type TerminalNavOrder } from "./terminal-nav-model.ts";
import type { TerminalNavHerdrSummary } from "./terminal-nav-row.ts";

/**
 * What the terminal index keeps between mounts, and how its keys move along
 * its rows. The index has two homes (the Terminals panel on bare /terminal,
 * the rail on a terminal deep link) in two different trees, so every crossing
 * mounts it afresh. It starts from what it last held instead of from nothing:
 * the sessions and herdr summaries it last read, its folds and its scroll.
 * Held for this page visit only; a reload starts clean, as the rail always
 * did. Pure, so it tests without a DOM.
 */

export type TerminalIndexLoad =
  | { state: "loading"; sessions: TerminalSessionRecord[] }
  | { state: "ready"; sessions: TerminalSessionRecord[] }
  | { state: "failed"; sessions: TerminalSessionRecord[]; error: string };

export type TerminalIndexMemory = {
  /** The last sessions read, or null before the first read lands. */
  sessions: TerminalSessionRecord[] | null;
  /** When those sessions were read (ms since epoch). */
  sessionsAt: number;
  /** The last herdr summaries, and the sessions they were read for. */
  herdr: {
    forSessions: TerminalSessionRecord[];
    summaries: ReadonlyMap<string, TerminalNavHerdrSummary>;
  } | null;
  inactiveExpanded: boolean;
  /** Available agents fold to one counted row until opened. */
  agentsExpanded: boolean;
  expandedStopped: ReadonlySet<string>;
  scrollTop: number;
  /** The projects cut's order, held still from its first draw (holdTerminalNavOrder). */
  navOrder: TerminalNavOrder;
};

export function createTerminalIndexMemory(): TerminalIndexMemory {
  return {
    sessions: null,
    sessionsAt: 0,
    herdr: null,
    inactiveExpanded: false,
    agentsExpanded: false,
    expandedStopped: new Set(),
    scrollTop: 0,
    navOrder: createTerminalNavOrder(),
  };
}

/** One per page: the panel and the rail are the same index. */
export const terminalIndexMemory = createTerminalIndexMemory();

export function rememberSessions(
  memory: TerminalIndexMemory,
  sessions: TerminalSessionRecord[],
  now: number,
): void {
  memory.sessions = sessions;
  memory.sessionsAt = now;
}

/**
 * A mount draws the last sessions read as ready, so it neither says Syncing
 * nor lists every agent as available while it reads again.
 */
export function seededIndexLoad(memory: TerminalIndexMemory): TerminalIndexLoad {
  return memory.sessions
    ? { state: "ready", sessions: memory.sessions }
    : { state: "loading", sessions: [] };
}

/** A mount reads now only when it holds nothing, or what it holds is a refresh old. */
export function indexNeedsRead(memory: TerminalIndexMemory, now: number, refreshMs: number): boolean {
  return !memory.sessions || now - memory.sessionsAt >= refreshMs;
}

export function seededHerdrSummaries(memory: TerminalIndexMemory): ReadonlyMap<string, TerminalNavHerdrSummary> {
  return memory.herdr?.summaries ?? new Map();
}

/** The summaries held were read for these very sessions: nothing new to read. */
export function herdrReadFor(memory: TerminalIndexMemory, sessions: TerminalSessionRecord[]): boolean {
  return memory.herdr != null && memory.herdr.forSessions === sessions;
}

export function rememberHerdr(
  memory: TerminalIndexMemory,
  sessions: TerminalSessionRecord[],
  summaries: ReadonlyMap<string, TerminalNavHerdrSummary>,
): void {
  memory.herdr = { forSessions: sessions, summaries };
}

/**
 * The index's row keys. Rows sit three deep (list > section > row > button),
 * with the stopped folds and the Inactive toggle between them, so the shared
 * list helper's direct-child selector finds none of them; the index walks its
 * own stops, in document order, at any depth.
 */
export const TERMINAL_INDEX_ROW_STOPS = [
  ".terminal-nav-row-select:not([disabled])",
  ".terminal-nav-stopped:not([disabled])",
  ".terminal-nav-inactive-toggle:not([disabled])",
].join(", ");

export type TerminalIndexStep = "next" | "prev" | "first" | "last";

/**
 * Arrows or j/k move one row; Home and End go to the ends. "g" is the app's
 * go chord (the shell takes it first), so it is not a key here. Any modifier
 * but Shift leaves the key to someone else.
 */
export function terminalIndexKeyStep(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
): TerminalIndexStep | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case "ArrowDown":
    case "j":
      return "next";
    case "ArrowUp":
    case "k":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

/**
 * The stop to focus, from the one holding focus (-1 when focus is elsewhere
 * in the list): down from nowhere is the first row, up from nowhere the last.
 * -1 when there is nothing to move to.
 */
export function terminalIndexRowTarget(step: TerminalIndexStep, current: number, length: number): number {
  if (length <= 0) return -1;
  switch (step) {
    case "first":
      return 0;
    case "last":
      return length - 1;
    case "next":
      return current < 0 ? 0 : Math.min(length - 1, current + 1);
    case "prev":
      return current < 0 ? length - 1 : Math.max(0, current - 1);
  }
}
