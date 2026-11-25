import { bucketAgentsByMachine } from "../../../lib/mesh-buckets.ts";
import type { MeshStatus, Route } from "../../../lib/types.ts";
import type { ModuleScopeOption } from "./contract.ts";
import { FOLLOW_PAGE, scopeValue } from "./follow-page.ts";

/*
 * The Network panels' rules (Hosts, Network map, Machine, Rack), without
 * React, so they test on their own. README.md › "The modules" has the table.
 *
 * One selection drives them: the mesh view store's picked machine. On
 * /network the URL's ?machineId= seeds it (as the page always did) and a
 * Hosts, map or Rack click changes it; on any other view a Hosts click picks
 * the same way, so a Machine panel beside it follows.
 */

/**
 * The machine a Machine panel shows: none (the Network summary) when nothing
 * is chosen, the picked machine when it follows the page, else its own.
 */
export function machineShown(choice: string | undefined, picked: string | null): string | null {
  if (!choice) return null;
  return choice === FOLLOW_PAGE ? picked : choice;
}

/** Whether the Machine panel's machine is its own pin (its foot button then unpins). */
export function machinePinned(choice: string | undefined): boolean {
  return Boolean(choice) && choice !== FOLLOW_PAGE;
}

/**
 * The machine a Network map narrows its agents to: the page's ?machineId= when
 * it follows the page, its own pin, or every machine. null = every machine.
 */
export function mapMachineScope(choice: string | undefined, pageMachineId: string | null): string | null {
  return scopeValue(choice, pageMachineId ?? undefined) || null;
}

/** Every machine the mesh knows, for a Machine scope: this host, peers, then tailnet devices. */
export function machineOptions(mesh: MeshStatus | null): ModuleScopeOption[] {
  if (!mesh) return [];
  return bucketAgentsByMachine([], mesh).map((bucket) => ({ value: bucket.machineId, label: bucket.machineLabel }));
}

/**
 * Open full: the Network page on this machine (its ?machineId= picks it), or
 * bare, with an explicit empty scope so the page's own machine does not ride along.
 */
export function meshFullRoute(machineId: string | null): Route {
  return { view: "mesh", machineId: machineId ?? "" };
}
