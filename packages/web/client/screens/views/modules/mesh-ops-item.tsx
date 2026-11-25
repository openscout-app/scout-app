/**
 * Item — the open Mesh Ops item and what can be done with it.
 *
 * Shows:  a work item: its title and summary, the route strip (lab), Hold or
 *         Release, Accept or Clear, Open item, then State, Venue, Latest
 *         flight and Activity. A session: live, ended or lost, its harness,
 *         times and venue. Nothing open: each host with its item count.
 * Data:   the shared Mesh Ops store (mesh-ops/use-mesh-ops-items.ts), read
 *         with the view's scope so it never refetches over the board; actions
 *         POST /api/mesh-ops/items/:id/{hold|release|accept|clear}.
 * Scope:  none. On /mesh-ops it shows ?itemId=; elsewhere the board's pick.
 * Opens:  Open item: /work/:id.
 */
import { useEffect } from "react";
import { routeMachineId } from "../../../lib/router.ts";
import { meshOpsViewSnapshot, setMeshOpsSelection } from "../../../lib/mesh-ops-view-store.ts";
import { MeshOpsInspector } from "../../mesh-ops/right.tsx";
import { useMeshOpsItems } from "../../mesh-ops/use-mesh-ops-items.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { meshOpsFetchScope } from "./mesh-ops-panel-model.ts";
import "./mesh-panels.css";

function MeshOpsItem({ route }: ModuleProps) {
  const own = route.view === "mesh-ops";
  useMeshOpsItems(meshOpsFetchScope(own, routeMachineId(route)));
  // on /mesh-ops the URL's item is the open one, with or without the board beside it
  const pageItemId = route.view === "mesh-ops" ? route.itemId ?? null : undefined;
  useEffect(() => {
    if (pageItemId === undefined) return;
    if (meshOpsViewSnapshot().selectedItemId !== pageItemId) setMeshOpsSelection(pageItemId);
  }, [pageItemId]);
  return (
    <div className="vw-mesh-ops-item">
      <MeshOpsInspector />
    </div>
  );
}

export const meshOpsItemModule = defineModule({
  type: "mesh-ops-item",
  title: "Item",
  blurb: "The open Mesh Ops item, with Hold, Release, Accept and Clear",
  docs: {
    shows: "A work item's actions and detail, or a session's runtime detail; with none open, each host's item count.",
    data: "The shared Mesh Ops store; actions POST /api/mesh-ops/items/:id/<action>.",
    opens: "Open item: /work/:id.",
  },
  size: { w: 3, h: 16 },
  minSize: { w: 3, h: 8 },
  Component: MeshOpsItem,
});
