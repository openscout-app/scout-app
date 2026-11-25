import type { BrokerEvent } from "./sse.ts";

/**
 * What a runtime event says about the request list. Kept free of the socket
 * client so it can be tested directly.
 *
 * The runtime emits `collaboration.upserted` with the whole record when it
 * raises a permission request or an operator question, and again when it
 * settles one: decided from a phone, answered in the terminal, dismissed, or
 * ended with its session. That event is the deterministic signal; no read of
 * the session and no model is involved.
 */
export type RequestEvent = {
  /** The request-list ids the record answers, once it is no longer open. Empty while it is open. */
  settled: string[];
};

type RecordLike = { id?: unknown; state?: unknown; metadata?: Record<string, unknown> | null };

const OPERATOR_QUESTION_PREFIX = "operator-question:";

/** The request-list ids one runtime record backs: its permission row, or its operator question. */
export function requestIdsForRecord(record: { id: string; metadata?: Record<string, unknown> | null }): string[] {
  const ids: string[] = [];
  if (record.metadata?.permissionRequest) ids.push(`permission:${record.id}`);
  const messageId = typeof record.metadata?.operatorNeedMessageId === "string"
    ? record.metadata.operatorNeedMessageId
    : record.id.startsWith(OPERATOR_QUESTION_PREFIX) ? record.id.slice(OPERATOR_QUESTION_PREFIX.length) : null;
  if (messageId) ids.push(`need:${messageId}`);
  return ids;
}

/** Null when the event is not about a request the list shows. */
export function readRequestEvent(event: BrokerEvent): RequestEvent | null {
  if (event.kind !== "collaboration.upserted") return null;
  const record = (event.payload as { record?: RecordLike } | undefined)?.record;
  if (!record || typeof record.id !== "string" || !record.id) return null;
  const ids = requestIdsForRecord({ id: record.id, metadata: record.metadata ?? null });
  if (ids.length === 0) return null;
  return { settled: record.state === "open" ? [] : ids };
}
