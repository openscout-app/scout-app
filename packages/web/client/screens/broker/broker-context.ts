import type { BrokerRouteAttempt } from "../../lib/types.ts";
import { brokerAttemptIsFailure } from "./broker-display.ts";

/*
 * Dispatch context: the small tallies the shell's Dispatch context panel
 * (right.tsx) and the Dispatch view's Health panel both read. Pure, so they
 * test without a DOM.
 */

export function brokerContextPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function brokerContextKindLabel(kind: BrokerRouteAttempt["kind"]): string {
  switch (kind) {
    case "success":
      return "sent";
    case "failed_query":
      return "query";
    case "failed_delivery":
      return "delivery";
    default:
      return "attempt";
  }
}

export function brokerContextRouteLabel(route: string | null): string {
  switch (route) {
    case "dm":
      return "direct";
    case "channel":
      return "channel";
    case "broadcast":
      return "broadcast";
    case null:
      return "no route";
    default:
      return route;
  }
}

export function brokerContextCounts(rows: BrokerRouteAttempt[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = brokerContextRouteLabel(row.route);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5);
}

export function brokerContextKindCounts(rows: BrokerRouteAttempt[]): {
  sent: number;
  query: number;
  delivery: number;
  failures: number;
} {
  const counts = { sent: 0, query: 0, delivery: 0, failures: 0 };
  for (const row of rows) {
    if (row.kind === "success") {
      counts.sent += 1;
    } else if (row.kind === "failed_query") {
      counts.query += 1;
    } else if (row.kind === "failed_delivery" || row.kind === "delivery_attempt") {
      counts.delivery += 1;
    }
    if (brokerAttemptIsFailure(row)) counts.failures += 1;
  }
  return counts;
}
