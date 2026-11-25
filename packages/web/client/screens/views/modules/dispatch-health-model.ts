import { brokerContextCounts } from "../../broker/broker-context.ts";
import type { DispatchNode, DispatchRowModel } from "../../broker/dispatch-focus.ts";

/*
 * What the Health panel reads off the dispatches in scope. Pure, so it tests
 * without a DOM. It takes the scoped rows (focus, window and search, before
 * the outcome tab), the same set the Ledger's tab counts come from, so the
 * two panels never disagree.
 */

export type DispatchRouteShare = { label: string; count: number; share: number };

export type DispatchBusiestRoute = {
  from: DispatchNode;
  to: DispatchNode;
  count: number;
  attention: number;
};

export type DispatchHealth = {
  total: number;
  delivered: number;
  attention: number;
  pending: number;
  /** Share of the total, 0 to 1; null when nothing is in scope. */
  deliveredShare: number | null;
  attentionShare: number | null;
  /** How dispatches were routed (direct, channel, broadcast), busiest first, top five. */
  routeMix: DispatchRouteShare[];
  /** The sender and destination pair with the most dispatches. */
  busiest: DispatchBusiestRoute | null;
  /** The newest dispatches that need attention. */
  needsAttention: DispatchRowModel[];
  latestAt: number | null;
};

export const HEALTH_ATTENTION_LIMIT = 4;

export function dispatchHealth(rows: readonly DispatchRowModel[], attentionLimit = HEALTH_ATTENTION_LIMIT): DispatchHealth {
  let delivered = 0;
  let attention = 0;
  let pending = 0;
  let latestAt: number | null = null;
  const pairs = new Map<string, DispatchBusiestRoute>();
  for (const row of rows) {
    if (row.delivery === "delivered") delivered += 1;
    else if (row.delivery === "attention") attention += 1;
    else pending += 1;
    if (latestAt === null || row.attempt.ts > latestAt) latestAt = row.attempt.ts;
    const key = `${row.from.key}\u0000${row.to.key}`;
    const pair = pairs.get(key) ?? { from: row.from, to: row.to, count: 0, attention: 0 };
    pair.count += 1;
    if (row.delivery === "attention") pair.attention += 1;
    pairs.set(key, pair);
  }
  const total = rows.length;
  let busiest: DispatchBusiestRoute | null = null;
  for (const pair of pairs.values()) {
    if (!busiest
      || pair.count > busiest.count
      || (pair.count === busiest.count && `${pair.from.label}${pair.to.label}`.localeCompare(`${busiest.from.label}${busiest.to.label}`) < 0)) {
      busiest = pair;
    }
  }
  return {
    total,
    delivered,
    attention,
    pending,
    deliveredShare: total > 0 ? delivered / total : null,
    attentionShare: total > 0 ? attention / total : null,
    routeMix: brokerContextCounts(rows.map((row) => row.attempt)).map((entry) => ({
      ...entry,
      share: total > 0 ? entry.count / total : 0,
    })),
    // a lone route says nothing a panel needs to point at
    busiest: busiest && pairs.size > 1 ? busiest : null,
    needsAttention: rows
      .filter((row) => row.delivery === "attention")
      .sort((left, right) => right.attempt.ts - left.attempt.ts)
      .slice(0, attentionLimit),
    latestAt,
  };
}

/** "92%", or "<1%" for a share too small to round up, so one failure never reads as none. */
export function healthPercent(share: number | null): string {
  if (share === null) return "—";
  if (share > 0 && share < 0.005) return "<1%";
  return `${Math.round(share * 100)}%`;
}
