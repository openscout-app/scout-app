import type { OperatorAttentionItem } from "../../lib/types.ts";
import { stableRequestItems } from "./requests-model.ts";
import type { RequestActionFeedback } from "./use-request-actions.ts";

/*
 * The receipts a decision leaves, shared by every Requests surface: the
 * Requests page (the native embed draws it whole) and every Requests and
 * Request panel. A card that was answered keeps its place, and its receipt,
 * across the source's snapshot update, whichever surface sent the answer and
 * whichever one shows it. These are local presentation receipts, never a
 * replacement for the source's request state. Pure (no React), so it tests
 * on its own; use-request-rows.ts reads it.
 */

export type HeldRequest = { item: OperatorAttentionItem; feedback: RequestActionFeedback };
export type HeldRequests = ReadonlyMap<string, HeldRequest>;

/** A card's identity: the request, the decision it offers and its permission version. A new revision is a new card. */
export function requestRevision(item: OperatorAttentionItem): string {
  return JSON.stringify([item.id, item.approval ?? item.answer ?? null, item.permission?.version ?? null]);
}

/** The feedback held for this card, when it was held for this same revision. */
export function heldFeedback(held: HeldRequests, item: OperatorAttentionItem): RequestActionFeedback | undefined {
  const entry = held.get(item.id);
  return entry && requestRevision(entry.item) === requestRevision(item) ? entry.feedback : undefined;
}

/** The source dropped this request: only its receipt is left. */
export function isSettled(live: readonly OperatorAttentionItem[], id: string): boolean {
  return !live.some((item) => item.id === id);
}

/**
 * Every row a Requests surface lists: the source's open requests, then the
 * receipts it no longer lists, in the order they were last drawn (a live item
 * keeps its place when its severity, age or badge changes; a new one goes
 * last).
 */
export function requestRows(
  previous: readonly OperatorAttentionItem[],
  live: readonly OperatorAttentionItem[],
  held: HeldRequests,
): OperatorAttentionItem[] {
  const items = [...live];
  for (const [id, entry] of held) if (isSettled(live, id)) items.push(entry.item);
  return stableRequestItems(previous, items);
}

export type RequestReceipts = ReturnType<typeof createRequestReceipts>;

export function createRequestReceipts() {
  let held: HeldRequests = new Map();
  const listeners = new Set<() => void>();
  // one order for every surface: the rows last drawn, and what they were drawn from
  let drawn: { live: readonly OperatorAttentionItem[]; held: HeldRequests; rows: OperatorAttentionItem[] } | null = null;

  function change(next: Map<string, HeldRequest>) {
    held = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    /** A card's feedback: sending and recorded hold the card; a failure lets it go. */
    record(item: OperatorAttentionItem, feedback: RequestActionFeedback): void {
      const next = new Map(held);
      if (feedback.phase === "failed") next.delete(item.id);
      else next.set(item.id, { item, feedback });
      change(next);
    },
    /** Dismiss receipt: the card goes from every surface. */
    dismiss(id: string): void {
      if (!held.has(id)) return;
      const next = new Map(held);
      next.delete(id);
      change(next);
    },
    /** The receipts, as one snapshot (a new map on each change). */
    held(): HeldRequests {
      return held;
    },
    /** The rows every surface lists, the same array while neither input changed. */
    rows(live: readonly OperatorAttentionItem[]): OperatorAttentionItem[] {
      if (drawn && drawn.live === live && drawn.held === held) return drawn.rows;
      const rows = requestRows(drawn?.rows ?? [], live, held);
      drawn = { live, held, rows };
      return rows;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The window's receipts: the Requests page and every Requests panel read this one. */
export const requestReceipts = createRequestReceipts();
