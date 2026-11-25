/**
 * A session on another host is addressed by the host's label, then the same
 * session ref a local session already uses. The roster id stays off the page.
 */

import { hostApiPath } from "../../lib/chat-host.ts";

export type HostAddress = {
  id: string;
  name: string;
  displayName?: string | null;
  isSelf: boolean;
  hostNames?: readonly string[];
};

export type HostAddressMatch =
  | { kind: "one"; machine: HostAddress }
  | { kind: "none" }
  | { kind: "many" };

function addLabel(labels: Set<string>, value: string | null | undefined): void {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return;
  labels.add(trimmed);
  const first = trimmed.split(".")[0];
  if (first) labels.add(first);
}

/** Names a roster row can be called in a page path. */
export function hostAddressLabels(machine: HostAddress): string[] {
  const labels = new Set<string>();
  addLabel(labels, machine.displayName);
  addLabel(labels, machine.name);
  for (const host of machine.hostNames ?? []) addLabel(labels, host);
  return [...labels];
}

export function matchHostAddress(machines: readonly HostAddress[], label: string): HostAddressMatch {
  const needle = label.trim().toLowerCase();
  if (!needle) return { kind: "none" };
  const hits = machines.filter((machine) => hostAddressLabels(machine).includes(needle));
  if (hits.length === 1) return { kind: "one", machine: hits[0]! };
  if (hits.length === 0) return { kind: "none" };
  return { kind: "many" };
}

export function hostAddressError(label: string, match: HostAddressMatch): string | null {
  if (match.kind === "one") return null;
  if (match.kind === "many") return `${label} names more than one host.`;
  return `No host named ${label}.`;
}

/** Summary read. A peer goes through the host proxy; this Mac reads locally. */
export function hostSessionRefUrl(machine: HostAddress, ref: string): string {
  const path = `/api/session-ref/${encodeURIComponent(ref)}?view=summary`;
  return machine.isSelf ? path : hostApiPath(machine.id, path);
}
