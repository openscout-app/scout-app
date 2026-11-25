/**
 * Mesh Ops hosts — the mesh read as item counts per machine, not a map.
 *
 * Shows:  everywhere (new · total), this host, each peer (new · total), and
 *         unattributed: items with no venue host.
 * Data:   the shared Mesh Ops store (mesh-ops/use-mesh-ops-items.ts), read
 *         with the view's scope; /api/mesh once per refresh for machine names.
 * Scope:  none. On /mesh-ops a row scopes the page (?machineId=, or
 *         unattributed); elsewhere it counts every machine.
 * Opens:  elsewhere, a row opens /mesh-ops on that host (or unattributed).
 */
import { MeshOpsLeft } from "../../mesh-ops/left.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./mesh-panels.css";

function MeshOpsHosts({ route }: ModuleProps) {
  return (
    <div className="vw-mesh-ops-hosts">
      <MeshOpsLeft offPage={route.view !== "mesh-ops"} />
    </div>
  );
}

export const meshOpsHostsModule = defineModule({
  type: "mesh-ops-hosts",
  title: "Mesh Ops hosts",
  blurb: "Item counts per machine, and items with no host",
  docs: {
    shows: "Everywhere, this host, each peer and unattributed, each with new and total counts.",
    data: "The shared Mesh Ops store; /api/mesh once per refresh for names.",
    opens: "On /mesh-ops a row scopes the page; elsewhere it opens /mesh-ops on that host.",
  },
  size: { w: 3, h: 14 },
  minSize: { w: 2, h: 6 },
  Component: MeshOpsHosts,
});
