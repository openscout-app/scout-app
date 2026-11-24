/*
 * What waits on the operator, read from the runtime's own collaboration records.
 *
 * The full app builds its attention queue from the broker's records, its flights and its terminal panes. The
 * standalone preview has only the public runtime API, so it reads the part of that queue the runtime records
 * itself: work items and questions whose next move is the operator's, declared by an agent (not the operator's
 * own ask coming back), recently updated, and not dismissed. Nothing is invented: a record that is not in the
 * runtime is not a decision.
 *
 * Rules follow the full app's fleet attention read and its feed join: a work item joins its post by id, a
 * question by its conversation.
 */
import type { FeedAttention } from "./post.ts";

/** A collaboration record as GET /v1/collaboration/records serves it; only what the join reads. */
export type RuntimeCollaborationRecord = {
  id: string;
  kind: string;
  state: string;
  title: string;
  conversationId?: string | null;
  createdById?: string | null;
  requestedById?: string | null;
  nextMoveOwnerId?: string | null;
  updatedAt: number;
  metadata?: Record<string, unknown> | null;
};

/** A collaboration event as GET /v1/collaboration/events serves it; only dismissals are read. */
export type RuntimeCollaborationEvent = { kind: string; recordId: string; actorId: string; at: number };

/** The operator's actor id on a local runtime. */
export const OPERATOR_ID = "operator";

/** A record untouched this long is history, not a request (the full app's ATTENTION_STALE_AFTER_MS). */
export const ATTENTION_STALE_MS = 7 * 86_400_000;

const LIVE: Record<string, readonly string[]> = {
  work_item: ["open", "working", "waiting", "review"],
  question: ["open", "answered"],
};

/** Why it waits, in a few words: the badge says this; the post's own words say what. */
export function attentionLabel(record: Pick<RuntimeCollaborationRecord, "kind" | "state">): string {
  if (record.kind === "question") return "Question for you";
  if (record.state === "review") return "Review requested";
  if (record.state === "waiting") return "Needs your decision";
  return "Needs your answer";
}

/** The request's own words, flattened and kept to a readable length; null when there are none. */
export function requestWords(title: string | null | undefined, max = 280): string | null {
  const flat = (title ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return null;
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function requester(record: RuntimeCollaborationRecord): string | null {
  const asked = record.metadata && typeof record.metadata.askedById === "string" ? record.metadata.askedById : null;
  return record.requestedById ?? asked ?? record.createdById ?? null;
}

/**
 * The records that wait on the operator, as the Feed joins them, newest first. `operators` are the ids the
 * operator acts as; a record one of them requested is their own ask ending, not an agent asking.
 */
export function attentionFromRecords(
  records: readonly RuntimeCollaborationRecord[],
  events: readonly RuntimeCollaborationEvent[],
  now: number,
  operators: readonly string[] = [OPERATOR_ID],
): FeedAttention[] {
  const ops = new Set(operators);
  const dismissedAt = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "dismissed" || !ops.has(e.actorId)) continue;
    dismissedAt.set(e.recordId, Math.max(e.at, dismissedAt.get(e.recordId) ?? 0));
  }
  return records
    .filter((r) => {
      if (!LIVE[r.kind]?.includes(r.state)) return false;
      if (!r.nextMoveOwnerId || !ops.has(r.nextMoveOwnerId)) return false;
      const by = requester(r);
      if (by && ops.has(by)) return false;
      if (!(r.updatedAt >= now - ATTENTION_STALE_MS)) return false;
      const dismissed = dismissedAt.get(r.id);
      return dismissed === undefined || dismissed < r.updatedAt;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .map((r) => ({
      id: `${r.kind}:${r.id}`,
      workId: r.kind === "work_item" ? r.id : null,
      conversationId: r.conversationId ?? null,
      label: attentionLabel(r),
      detail: requestWords(r.title),
    }));
}
