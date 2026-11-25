import { useEffect, useMemo } from "react";
import { routeMachineId } from "../../../lib/router.ts";
import { setMeshSelection, useMeshViewStore } from "../../../lib/mesh-view-store.ts";
import type { Route } from "../../../lib/types.ts";
import type { ModuleScope } from "./contract.ts";
import { machineOptions } from "./mesh-panels-model.ts";

/*
 * What the Network panels share (Hosts, Network map, Machine, Rack). The read
 * itself is the shared Network loop, screens/mesh/use-mesh-snapshot.ts.
 */

/**
 * A deep link (?machineId=) picks that machine, as /network always did. Every
 * panel that follows the pick runs this, so the page's machine is picked
 * whichever of them the view holds.
 */
export function useMeshPageSeed(route: Route): void {
  const pageMachineId = routeMachineId(route);
  useEffect(() => {
    if (pageMachineId) setMeshSelection(pageMachineId, "node");
  }, [pageMachineId]);
}

/** A Machine scope over every machine the mesh knows. Its follow option tracks the page. */
export function machineScope(allLabel: string, followsPage: string): ModuleScope {
  return {
    key: "machine",
    allLabel,
    followsPage,
    useOptions: () => {
      const { meshSnapshot } = useMeshViewStore();
      return useMemo(() => machineOptions(meshSnapshot), [meshSnapshot]);
    },
  };
}
