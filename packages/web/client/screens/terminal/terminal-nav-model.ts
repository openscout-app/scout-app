import type { TerminalListItem } from "../../lib/terminal-sessions.ts";
import type { TerminalRexPlace } from "../../../shared/api/terminal-sources.ts";
import { terminalSessionActivityAt } from "./session-table.ts";

/**
 * The rail is an index with three cuts of the same terminals: by project, by
 * recency, and by the window each one is open in. Both are pure — the same items and context in always produce the
 * same sections out — so the ordering rules live here and are tested here.
 *
 * Two things both cuts agree on:
 *
 * - **Working leads.** A terminal where work is moving right now (an agent in
 *   a turn, a herdr pane reporting `working`) sorts as "now", whatever its
 *   recorded activity time says. The caller decides what counts as working.
 * - **Stopped folds.** A herdr session whose server is down still exists and
 *   still reattaches, but it is not a place anything is happening. Sections
 *   carry their stopped sessions separately so the rail can fold them to one
 *   line instead of listing them among live terminals.
 */
export type TerminalNavMode = "projects" | "recent" | "windows";

export type TerminalNavSection = {
  key: string;
  label: string;
  /** Running terminals, working first, then most recent. */
  items: TerminalListItem[];
  /** Stopped host sessions that belong here, folded by the rail. */
  stopped: TerminalListItem[];
  /** Latest activity across the section's running items; null when unknown. */
  latestActivity: number | null;
  /** True when anything in the section is working now. */
  working: boolean;
};

export type TerminalNavContext = {
  now?: number;
  /** Work is moving in this terminal right now. */
  isWorking?: (item: TerminalListItem) => boolean;
  /** Overrides the record's project, e.g. from a live herdr topology. */
  projectOf?: (item: TerminalListItem) => string | null;
  /** The Rex block the terminal is open in, when it is open in Rex. */
  rexOf?: (item: TerminalListItem) => TerminalRexPlace | null;
  /** The app its client runs in ("Ghostty"), when one is attached outside Rex. */
  appOf?: (item: TerminalListItem) => string | null;
};

export const TERMINAL_NAV_MODES: ReadonlyArray<{
  id: TerminalNavMode;
  label: string;
  title: string;
}> = [
  { id: "projects", label: "Projects", title: "Group by project" },
  { id: "recent", label: "Recent", title: "Group by last activity" },
  { id: "windows", label: "Windows", title: "Group by the window each terminal is open in" },
];

/** What the windows cut calls the terminals no app has open. */
export const NOT_ATTACHED_LABEL = "Not attached";

/** Labels that name an absence rather than a place; they sink to the bottom. */
const CATCH_ALL_PROJECTS = new Set(["backend-only", "unscoped"]);
export const HOME_PROJECT_LABEL = "Home";

/**
 * A herdr session is `live` while its server answers; anything else means the
 * server is down (herdr has no detach — tmux's "detached" means running with
 * nobody looking, herdr's means stopped).
 */
export function isStoppedHostItem(item: TerminalListItem): boolean {
  return item.surface.backend === "herdr" && item.surface.state !== "live";
}

/** A terminal opened in the home directory itself, not in a project under it. */
function isHomeDirectory(path: string | null | undefined): boolean {
  return /^\/(?:Users|home)\/[^/]+\/?$/u.test(path?.trim() ?? "");
}

export function projectLabel(item: TerminalListItem, context: TerminalNavContext = {}): string {
  const override = context.projectOf?.(item);
  if (override) return override;
  if (isHomeDirectory(item.session.cwd)) return HOME_PROJECT_LABEL;
  return item.project;
}

function sinks(label: string): boolean {
  return CATCH_ALL_PROJECTS.has(label) || label === HOME_PROJECT_LABEL;
}

function compareNames(left: TerminalListItem, right: TerminalListItem): number {
  return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" });
}

/** Working first, then most recent activity, then name; unknown activity last. */
function orderItems(items: TerminalListItem[], context: TerminalNavContext): TerminalListItem[] {
  const working = (item: TerminalListItem) => context.isWorking?.(item) ?? false;
  return [...items].sort((left, right) => {
    const workingRank = Number(working(right)) - Number(working(left));
    if (workingRank !== 0) return workingRank;
    const leftAt = terminalSessionActivityAt(left) ?? -1;
    const rightAt = terminalSessionActivityAt(right) ?? -1;
    if (leftAt !== rightAt) return rightAt - leftAt;
    return compareNames(left, right);
  });
}

function latestActivity(items: TerminalListItem[]): number | null {
  const times = items.map(terminalSessionActivityAt).filter((value): value is number => value !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

function indexByProjects(items: TerminalListItem[], context: TerminalNavContext): TerminalNavSection[] {
  const byProject = new Map<string, TerminalListItem[]>();
  for (const item of items) {
    const label = projectLabel(item, context);
    const group = byProject.get(label);
    if (group) group.push(item);
    else byProject.set(label, [item]);
  }
  const sections = [...byProject.entries()].map(([label, groupItems]): TerminalNavSection => {
    const running = groupItems.filter((item) => !isStoppedHostItem(item));
    return {
      key: `project:${label}`,
      label,
      items: orderItems(running, context),
      stopped: [...groupItems.filter(isStoppedHostItem)].sort(compareNames),
      latestActivity: latestActivity(running),
      working: running.some((item) => context.isWorking?.(item) ?? false),
    };
  });
  // The project you touched last sits on top; a project with work moving now
  // outranks any recorded time. Places that name an absence sink.
  return sections.sort((left, right) => {
    if (sinks(left.label) !== sinks(right.label)) return sinks(left.label) ? 1 : -1;
    if (left.working !== right.working) return left.working ? -1 : 1;
    const leftAt = left.latestActivity ?? -1;
    const rightAt = right.latestActivity ?? -1;
    if (leftAt !== rightAt) return rightAt - leftAt;
    return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
  });
}

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

type RecentBucket = "working" | "hour" | "today" | "yesterday" | "week" | "older" | "unknown";

const RECENT_BUCKETS: ReadonlyArray<{ key: RecentBucket; label: string }> = [
  { key: "working", label: "Working now" },
  { key: "hour", label: "Last hour" },
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "older", label: "Older" },
  { key: "unknown", label: "No activity reported" },
];

/** Local midnight at the start of the day containing `now`. */
function startOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function indexByRecent(items: TerminalListItem[], context: TerminalNavContext, now: number): TerminalNavSection[] {
  const today = startOfDay(now);
  const yesterday = today - DAY_MS;
  const bucketOf = (item: TerminalListItem): RecentBucket => {
    if (context.isWorking?.(item)) return "working";
    const at = terminalSessionActivityAt(item);
    if (at === null) return "unknown";
    if (now - at < HOUR_MS) return "hour";
    if (at >= today) return "today";
    if (at >= yesterday) return "yesterday";
    if (now - at < 7 * DAY_MS) return "week";
    return "older";
  };
  const running = items.filter((item) => !isStoppedHostItem(item));
  const sections = RECENT_BUCKETS.map((bucket): TerminalNavSection => {
    const bucketItems = running.filter((item) => bucketOf(item) === bucket.key);
    return {
      key: bucket.key,
      label: bucket.label,
      items: orderItems(bucketItems, context),
      stopped: [],
      latestActivity: latestActivity(bucketItems),
      working: bucket.key === "working",
    };
  }).filter((section) => section.items.length > 0);
  const stopped = items.filter(isStoppedHostItem);
  if (stopped.length > 0) {
    sections.push({
      key: "stopped",
      label: "Stopped",
      items: [],
      stopped: [...stopped].sort(compareNames),
      latestActivity: null,
      working: false,
    });
  }
  return sections;
}

/** A Rex window by its label, else its place in the session ("Window 2"). */
export function rexWindowName(place: TerminalRexPlace): string {
  return place.window ?? (place.windowIndex ? `Window ${place.windowIndex}` : "Not in a window");
}

/** A Rex window's name as a section says it: its session, then the window. */
export function rexWindowLabel(place: TerminalRexPlace): string {
  const window = rexWindowName(place);
  return place.session ? `${place.session} › ${window}` : window;
}

type WindowSection = TerminalNavSection & { rex: TerminalRexPlace | null };

/**
 * Rex's own layout, read back: one section per Rex window, a session's
 * windows in Rex's order and each window's terminals in its layout's reading
 * order. Sessions take turns as projects do (working, then most recent).
 * Terminals open in another app group under that app, and the ones no app
 * has open come last.
 */
function indexByWindows(items: TerminalListItem[], context: TerminalNavContext): TerminalNavSection[] {
  const groups = new Map<string, { label: string; items: TerminalListItem[]; rex: TerminalRexPlace | null }>();
  for (const item of items) {
    const rex = context.rexOf?.(item) ?? null;
    const app = rex ? null : context.appOf?.(item) ?? null;
    const key = rex ? `rex:${rex.sessionId}:${rex.windowId ?? "none"}` : app ? `app:${app}` : "none";
    const group = groups.get(key) ?? { label: rex ? rexWindowLabel(rex) : app ?? NOT_ATTACHED_LABEL, items: [], rex };
    group.items.push(item);
    groups.set(key, group);
  }
  const blockIndex = (item: TerminalListItem) => context.rexOf?.(item)?.blockIndex ?? Number.MAX_SAFE_INTEGER;
  const sections = [...groups.entries()].map(([key, group]): WindowSection => {
    const running = group.items.filter((item) => !isStoppedHostItem(item));
    const ordered = orderItems(running, context);
    return {
      key,
      label: group.label,
      // in Rex, where it sits in its window; elsewhere, working then recent
      items: group.rex ? [...ordered].sort((left, right) => blockIndex(left) - blockIndex(right)) : ordered,
      stopped: [...group.items.filter(isStoppedHostItem)].sort(compareNames),
      latestActivity: latestActivity(running),
      working: running.some((item) => context.isWorking?.(item) ?? false),
      rex: group.rex,
    };
  });
  // A Rex session ranks by its liveliest window; its windows keep Rex's order.
  const sessionRank = new Map<string, { working: boolean; at: number }>();
  for (const section of sections) {
    if (!section.rex) continue;
    const rank = sessionRank.get(section.rex.sessionId) ?? { working: false, at: -1 };
    sessionRank.set(section.rex.sessionId, {
      working: rank.working || section.working,
      at: Math.max(rank.at, section.latestActivity ?? -1),
    });
  }
  const tier = (section: WindowSection) => (section.rex ? 0 : section.key === "none" ? 2 : 1);
  const rankOf = (section: WindowSection) => section.rex
    ? sessionRank.get(section.rex.sessionId)!
    : { working: section.working, at: section.latestActivity ?? -1 };
  sections.sort((left, right) => {
    if (tier(left) !== tier(right)) return tier(left) - tier(right);
    if (left.rex && right.rex && left.rex.sessionId === right.rex.sessionId) {
      return (left.rex.windowIndex ?? Number.MAX_SAFE_INTEGER) - (right.rex.windowIndex ?? Number.MAX_SAFE_INTEGER);
    }
    const leftRank = rankOf(left);
    const rightRank = rankOf(right);
    if (leftRank.working !== rightRank.working) return leftRank.working ? -1 : 1;
    if (leftRank.at !== rightRank.at) return rightRank.at - leftRank.at;
    return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" });
  });
  return sections.map(({ rex: _rex, ...section }) => section);
}

export function groupTerminalNavItems(
  items: TerminalListItem[],
  mode: TerminalNavMode,
  context: TerminalNavContext = {},
): TerminalNavSection[] {
  const now = context.now ?? Date.now();
  if (mode === "windows") return indexByWindows(items, context);
  return mode === "recent"
    ? indexByRecent(items, context, now)
    : indexByProjects(items, context);
}

/**
 * The order the projects cut was first drawn in, held for the page visit.
 * Section keys in order, and each section's terminal ids in order.
 */
export type TerminalNavOrder = {
  sections: string[];
  items: Map<string, string[]>;
};

export function createTerminalNavOrder(): TerminalNavOrder {
  return { sections: [], items: new Map() };
}

function holdKeys<T>(ranked: T[], keyOf: (value: T) => string, held: string[]): { ordered: T[]; keys: string[] } {
  const byKey = new Map(ranked.map((value) => [keyOf(value), value] as const));
  const kept = held.filter((key) => byKey.has(key));
  const keptSet = new Set(kept);
  const added = ranked.map(keyOf).filter((key) => !keptSet.has(key));
  const keys = [...kept, ...added];
  return { ordered: keys.map((key) => byKey.get(key)!), keys };
}

/**
 * Holds the projects cut still under the operator's hand. The first draw
 * ranks as indexByProjects does (working, then most recent). Every later draw
 * keeps each project and each terminal where it already sits; a project or
 * terminal seen for the first time joins after the held ones in rank order,
 * and one that is gone leaves its place. Work moving now shows on the row (its
 * working mark), never by moving it. Places that name an absence still sink.
 * A reload ranks afresh. Records the order it returns in `order`.
 */
export function holdTerminalNavOrder(
  sections: TerminalNavSection[],
  order: TerminalNavOrder,
): TerminalNavSection[] {
  const held = holdKeys(sections, (section) => section.key, order.sections);
  order.sections = held.keys;
  const result = held.ordered.map((section) => {
    const items = holdKeys(section.items, (item) => item.id, order.items.get(section.key) ?? []);
    order.items.set(section.key, items.keys);
    return { ...section, items: items.ordered };
  });
  for (const key of [...order.items.keys()]) {
    if (!order.sections.includes(key)) order.items.delete(key);
  }
  // stable: held order inside each half
  return result.sort((left, right) => Number(sinks(left.label)) - Number(sinks(right.label)));
}

/** Persisted modes from before the index had these cuts map onto the nearest one. */
export function normalizeTerminalNavMode(value: unknown): TerminalNavMode {
  if (value === "windows") return "windows";
  if (value === "recent" || value === "time" || value === "attention") return "recent";
  return "projects";
}
