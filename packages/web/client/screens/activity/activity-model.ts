import { filterActivityByMachineScope } from "../../lib/machine-scope.ts";
import { formatClockTimestamp, normalizeTimestampMs, timeAgo, type TimestampInput } from "../../lib/time.ts";
import type { ActivityItem, Route } from "../../lib/types.ts";

/*
 * The Activity log's rules, without React: which records show, how each one
 * is labelled and grouped, what it links to, and the facts its details list.
 * The Activity page and every Activity panel read these; activity-model.test.ts
 * holds them.
 */

// ── Labels ──────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  "agent.registered": "registered",
  "agent.online": "came online",
  "agent.offline": "went offline",
  "flight.started": "started task",
  "message.sent": "sent message",
  "message.received": "received message",
  "collaboration.ask": "asked a question",
  "collaboration.answer": "answered",
  ask_sent: "sent a request",
  ask_working: "working",
  flight_created: "started task",
  message_sent: "sent",
  message_received: "received",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replace(/[._]/g, " ");
}

/**
 * Conversations and activity describe communication and motion, not harness
 * verdicts. Delivery failures belong to the broker diagnostics surface.
 */
export const HIDDEN_TURN_VERDICT_KINDS: ReadonlySet<string> = new Set([
  "ask_failed",
  "ask_replied",
  "flight.completed",
  "flight.updated",
  "flight_updated",
]);

// ── Grouping ────────────────────────────────────────────────────────────────

export type ActivityCategory = "presence" | "work" | "message" | "collaboration" | "system";

export type ActivityTone = "notice" | "working" | "completed" | "failed";

/** The page's groups, in the order a picker lists them. */
export const ACTIVITY_CATEGORIES: readonly ActivityCategory[] = ["presence", "work", "message", "collaboration", "system"];

export const ACTIVITY_CATEGORY_META: Record<ActivityCategory, { label: string; tone: ActivityTone }> = {
  presence: { label: "Presence", tone: "notice" },
  work: { label: "Execution", tone: "working" },
  message: { label: "Delivery", tone: "completed" },
  collaboration: { label: "Coordination", tone: "working" },
  system: { label: "System", tone: "notice" },
};

export function activityCategory(kind: string): ActivityCategory {
  if (kind.startsWith("agent.") || kind.includes("registered") || kind.includes("online") || kind.includes("offline")) {
    return "presence";
  }
  if (kind.startsWith("flight") || kind.startsWith("ask_")) return "work";
  if (kind.startsWith("message")) return "message";
  if (kind.startsWith("collaboration")) return "collaboration";
  return "system";
}

export function isActivityCategory(value: string | undefined): value is ActivityCategory {
  return Boolean(value) && (ACTIVITY_CATEGORIES as readonly string[]).includes(value!);
}

// ── One record's text ───────────────────────────────────────────────────────

export function actorInitial(name: string | null): string {
  return (name ?? "system").charAt(0).toUpperCase();
}

export function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export function pathLeaf(value: string | null): string | null {
  if (!value) return null;
  const segments = value.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? value;
}

/** The record's headline: its title, else who did what. */
export function activityTitle(item: ActivityItem): string {
  return item.title ?? `${item.actorName ?? "system"} ${kindLabel(item.kind)}`;
}

/**
 * The line under the headline: the summary when it says more than the title.
 * Where the record came from is already on the row (Workspace, Thread), so a
 * record with no summary draws no line rather than a raw id or a placeholder.
 */
export function activitySummary(item: ActivityItem): string | null {
  const summary = item.summary?.trim();
  if (!summary) return null;
  const title = item.title?.trim().replace(/(?:…|\.\.\.)$/, "").trimEnd() ?? "";
  // A title cut from the summary says the same thing twice; Details has the rest.
  if (title && summary.startsWith(title)) return null;
  return summary;
}

// ── Which records show ──────────────────────────────────────────────────────

export type ActivityFilter = {
  /** The page's machine scope: agent ids on that machine, null = every machine. */
  agentIds: Set<string> | null;
  /** A workspace root, "" = every project. */
  project?: string;
  /** One of the page's groups, "" = every kind. */
  category?: string;
};

/**
 * What a list shows: harness verdicts left out, the page's machine (as the
 * page always kept it), then a panel's project and group; newest first.
 */
export function visibleActivity(items: readonly ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  const category = isActivityCategory(filter.category) ? filter.category : null;
  return filterActivityByMachineScope([...items], filter.agentIds)
    .filter((item) => !HIDDEN_TURN_VERDICT_KINDS.has(item.kind))
    .filter((item) => !filter.project || item.workspaceRoot === filter.project)
    .filter((item) => !category || activityCategory(item.kind) === category)
    .sort((a, b) => b.ts - a.ts);
}

// ── Where a record goes ─────────────────────────────────────────────────────

export type ActivityJump = { key: string; label: string; title: string; route: Route };

/** Every page a record links to, in the page's order: thread, work, agent, session, follow. */
export function activityJumps(item: ActivityItem): ActivityJump[] {
  const jumps: ActivityJump[] = [];
  if (item.conversationId) {
    jumps.push({
      key: "thread",
      label: "Thread",
      title: `Open thread ${shortId(item.conversationId)}`,
      route: { view: "conversation", conversationId: item.conversationId },
    });
  }
  if (item.recordId) {
    jumps.push({ key: "work", label: "Work", title: "Open work item", route: { view: "work", workId: item.recordId } });
  }
  if (item.agentId) {
    const agentLabel = item.agentName ?? "Agent";
    jumps.push({ key: "agent", label: agentLabel, title: `Open agent ${agentLabel}`, route: { view: "agents-v2", agentId: item.agentId } });
  }
  if (item.sessionId) {
    jumps.push({ key: "session", label: "Session", title: "Open session", route: { view: "sessions", sessionId: item.sessionId } });
  }
  if (item.flightId || item.invocationId) {
    jumps.push({
      key: "follow",
      label: "Follow",
      title: "Follow live execution",
      route: {
        view: "follow",
        ...(item.flightId ? { flightId: item.flightId } : {}),
        ...(item.invocationId ? { invocationId: item.invocationId } : {}),
        ...(item.conversationId ? { conversationId: item.conversationId } : {}),
      },
    });
  }
  return jumps;
}

/** A terminal can be reached from the record: it names an agent or a session. */
export function activityHasTerminal(item: ActivityItem): boolean {
  return Boolean(item.agentId || item.sessionId);
}

// ── Its details ─────────────────────────────────────────────────────────────

export type ActivityFact = { label: string; value: string; code?: boolean };

/** The details the page showed for an open record, in its order. */
export function activityFacts(item: ActivityItem, recorded: (ts: number) => string): ActivityFact[] {
  const facts: (ActivityFact | null)[] = [
    { label: "Event", value: item.kind, code: true },
    { label: "Recorded", value: recorded(item.ts) },
    { label: "Actor", value: item.actorName ?? "system" },
    item.agentName ? { label: "Agent", value: item.agentName } : null,
    { label: "Workspace", value: item.workspaceRoot ?? "Not attached" },
    { label: "Thread", value: item.conversationId ? shortId(item.conversationId) : "Not attached" },
    item.recordId ? { label: "Work", value: shortId(item.recordId) } : null,
    item.sessionId ? { label: "Session", value: shortId(item.sessionId) } : null,
    item.flightId ? { label: "Flight", value: shortId(item.flightId) } : null,
    item.invocationId ? { label: "Invocation", value: shortId(item.invocationId) } : null,
    { label: "Record id", value: item.id, code: true },
  ];
  return facts.filter((fact): fact is ActivityFact => fact !== null);
}

// ── The read's state line ───────────────────────────────────────────────────

export type ActivitySyncState = {
  loading: boolean;
  error: string | null;
  /** Something is drawn: a failed refresh keeps showing it. */
  shown: boolean;
  loadedAt: number | null;
};

/** The page's sync note: reading, updated when, or the snapshot kept through a failed refresh. */
export function activitySyncNote(state: ActivitySyncState, nowMs = Date.now()): string {
  if (state.loading) return "Loading audit ledger...";
  if (state.error && state.shown) {
    return `Showing last confirmed snapshot from ${state.loadedAt ? timeAgo(state.loadedAt, nowMs) : "earlier"}`;
  }
  return state.loadedAt ? `Updated ${timeAgo(state.loadedAt, nowMs)}` : "Waiting for first snapshot";
}

/**
 * The second line of an entry's stamp, under its age: the wall-clock time for
 * today, the date for an older day. One short line; the full timestamp is the
 * stamp's title.
 */
export function activityStampLabel(ts: TimestampInput, nowMs = Date.now()): string {
  const tsMs = normalizeTimestampMs(ts);
  if (tsMs === null) return "";
  if (new Date(tsMs).toDateString() === new Date(nowMs).toDateString()) return formatClockTimestamp(tsMs);
  return new Date(tsMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
