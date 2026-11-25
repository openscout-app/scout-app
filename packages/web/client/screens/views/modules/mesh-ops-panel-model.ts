import type { Route, WebMeshOpsHost } from "../../../lib/types.ts";
import type { ModuleScopeOption } from "./contract.ts";
import { scopeValue } from "./follow-page.ts";

/*
 * The Mesh Ops panels' rules (the board, Item, Hosts), without React, so they
 * test on their own. README.md › "The modules" has the table.
 *
 * The Mesh Ops store holds one machine scope's items, so every Mesh Ops panel
 * on a view reads with the same scope, or they would refetch over each other:
 * the page's ?machineId= on /mesh-ops (the server filters, as the page always
 * did), every machine anywhere else. An off-page board narrows to its own
 * host in the browser.
 */

/** The machine scope every Mesh Ops panel on a view reads with. null = every machine. */
export function meshOpsFetchScope(onPage: boolean, pageMachineId: string | null): string | null {
  return onPage ? pageMachineId : null;
}

/**
 * The host an off-page board narrows to: its own pin, or the page's machine
 * when it follows the page. null = every host.
 */
export function boardHost(choice: string | undefined, pageMachineId: string | null): string | null {
  return scopeValue(choice, pageMachineId ?? undefined) || null;
}

/**
 * A host chip on an off-page board: pick that host, or every host. A chip on
 * the host already shown clears it (the strip passes null).
 */
export function boardHostPatch(nodeId: string | null): Record<string, string> {
  return { machine: nodeId ?? "" };
}

/** Open full: /mesh-ops scoped to the board's host (or every host), with its open item. */
export function meshOpsFullRoute(host: string | null, itemId: string | null): Route {
  // an explicit empty scope, so the page's own ?machineId= does not ride along
  return { view: "mesh-ops", machineId: host ?? "", ...(itemId ? { itemId } : {}) };
}

/** Hosts the Mesh Ops read knows, for a board's Host scope. */
export function hostOptions(hosts: readonly WebMeshOpsHost[]): ModuleScopeOption[] {
  return hosts.map((host) => ({ value: host.nodeId, label: host.label }));
}
