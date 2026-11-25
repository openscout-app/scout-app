import { useEffect, useState, useSyncExternalStore } from "react";
import type { OperatorAttentionItem } from "../../lib/types.ts";
import { useOperatorRequests } from "../../lib/use-operator-requests.ts";
import { requestReceipts, type HeldRequests } from "./request-receipts.ts";

const NONE: readonly OperatorAttentionItem[] = [];

/**
 * What every Requests surface draws from: the shared operator-requests read
 * (/api/operator-attention on first use, every 15s while Scout is in front,
 * and on return), the receipts decisions left (request-receipts.ts), and the
 * rows both make, in one order for every surface. No reads of its own.
 */
export function useRequestRows(): {
  /** The source's open requests ([] before the first read). */
  live: readonly OperatorAttentionItem[];
  /** Open requests and the receipts the source no longer lists, in drawn order. */
  rows: OperatorAttentionItem[];
  held: HeldRequests;
  /** Read once: the source answered at least once. */
  read: boolean;
  error: string | null;
  loading: boolean;
} {
  const { state, error, loading } = useOperatorRequests();
  const held = useSyncExternalStore(requestReceipts.subscribe, requestReceipts.held, requestReceipts.held);
  const live = state?.items ?? NONE;
  return { live, rows: requestReceipts.rows(live), held, read: Boolean(state), error, loading };
}

/** Now, re-read each minute, so "updated 5m ago" stays honest on a page left open. */
export function useRequestClock(): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
