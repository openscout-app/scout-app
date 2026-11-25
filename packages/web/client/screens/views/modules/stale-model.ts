/*
 * Stale without React: Host Advisor's Unattended reading (host-advisor-model.ts
 * › unattendedItems) narrowed to what went quiet but still holds something.
 * A prompted relay process quiet past two hours still owns its pid; a
 * conversation whose last turn is past two hours still holds its thread. A
 * diverged build branch holds nothing and is left out (In flight shows
 * branches). Oldest first, one action each, the Unattended reading's own.
 * Pure, so the rules test on their own.
 */
import type { Route } from "../../../lib/types.ts";
import { extractProjectName, formatDuration, type UnattendedItem } from "../../ops/host-advisor-model.ts";

/** Quiet this long, in seconds, before something reads as stale. */
export const STALE_AFTER_SECONDS = 2 * 3600;

export type StaleRow = {
  id: string;
  /** A session that owns a process, or a relay that holds a thread. */
  kind: "session" | "relay";
  name: string;
  /** "claude · openscout", "relay · lattices". */
  where: string;
  ageSeconds: number;
  ageLabel: string;
  holds: string;
  action: { label: string; route: Route } | null;
};

/** The Unattended action, in the panel's words: Tail Process opens Tail, Open Chat the chat. */
const ACTION_LABEL: Partial<Record<UnattendedItem["kind"], string>> = {
  stalled_relay: "Open in Tail",
  unresumed_session: "Open chat",
};

function staleRow(item: UnattendedItem): StaleRow | null {
  if (item.ageSeconds == null || item.ageSeconds < STALE_AFTER_SECONDS) return null;
  const project = item.projectRoot ? extractProjectName(item.projectRoot) : "workspace";
  const label = ACTION_LABEL[item.kind];
  const action = label && item.actionRoute ? { label, route: item.actionRoute } : null;
  if (item.kind === "stalled_relay" && item.pid != null) {
    return {
      id: item.id,
      kind: "session",
      name: item.title,
      where: `${item.harness || "harness"} · ${project}`,
      ageSeconds: item.ageSeconds,
      ageLabel: formatDuration(item.ageSeconds),
      holds: `holds pid ${item.pid}`,
      action,
    };
  }
  if (item.kind === "unresumed_session" && item.conversationId) {
    return {
      id: item.id,
      kind: "relay",
      name: item.title,
      where: `relay · ${project}`,
      ageSeconds: item.ageSeconds,
      ageLabel: formatDuration(item.ageSeconds),
      holds: "holds a thread",
      action,
    };
  }
  return null;
}

/** What went quiet past two hours and still holds a process or a thread, oldest first. */
export function staleRows(items: readonly UnattendedItem[]): StaleRow[] {
  return items
    .map(staleRow)
    .filter((row): row is StaleRow => row !== null)
    .sort((a, b) => b.ageSeconds - a.ageSeconds || a.name.localeCompare(b.name));
}
