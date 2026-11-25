import { normalizeTimestampMs } from "./time.ts";
import type { ActivityItem } from "./types.ts";

type Foldable = Pick<ActivityItem, "kind" | "ts" | "actorName" | "title" | "summary" | "messageId" | "recordId">;

const instantKey = (item: Foldable) => `${item.actorName ?? ""}\u0000${normalizeTimestampMs(item.ts) ?? item.ts}`;

/**
 * One ask writes up to three activity rows at the same instant: its work item
 * (collaboration_event), the request message (message_posted) and the
 * invocation (invocation_recorded). They fold into the invocation's row, which
 * names the agent, session and thread. It takes the work item's title as its
 * headline, keeps the ask's text as its summary, and keeps the work item's link.
 */
export function foldAskEchoes<T extends Foldable>(items: readonly T[]): T[] {
  const invocations = items.filter((item) => item.kind === "invocation_recorded");
  if (invocations.length === 0) return [...items];
  const askMessages = new Set(invocations.map((item) => item.messageId).filter(Boolean));
  const invocationAt = new Map<string, T>();
  for (const invocation of invocations) {
    if (!invocation.recordId) invocationAt.set(instantKey(invocation), invocation);
  }
  const workFor = new Map<T, T>();
  const kept: T[] = [];
  for (const item of items) {
    if (item.kind === "message_posted" && item.messageId && askMessages.has(item.messageId)) continue;
    if (item.kind === "collaboration_event" && item.recordId) {
      const invocation = invocationAt.get(instantKey(item));
      if (invocation && !workFor.has(invocation)) {
        workFor.set(invocation, item);
        continue;
      }
    }
    kept.push(item);
  }
  return kept.map((item) => {
    const work = workFor.get(item);
    if (!work) return item;
    return {
      ...item,
      recordId: work.recordId,
      title: work.title ?? item.title,
      summary: work.title && item.title ? item.title : item.summary,
    };
  });
}
