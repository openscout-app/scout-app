/**
 * Machine — one machine up close, or the network counted in machines.
 *
 * Shows:  with a machine: its reach and Refresh, what is running there
 *         (workload, roster), its sessions and work in flight, its identity
 *         and capabilities, and this broker's issues on this machine's own
 *         card; a foot button clears the pick (Unpin when pinned). Without
 *         one: the Network summary (machines responding, this host's agents by
 *         state and harness, peers) and the Join mesh switch.
 * Data:   the shared Network loop (mesh/use-mesh-snapshot.ts: /api/mesh 10s,
 *         sweep 15s); the machine's own reading, deep-loaded once per pick
 *         (lib/mesh-node-state.ts); agents from useLocalAgents().
 * Scope:  Machine. "This page's machine" follows the view's pick (a Hosts,
 *         map or Rack click; on any page its ?machineId=); pick one to pin it.
 *         Unset: the Network summary.
 * Opens:  Open full: /network on this machine; Join mesh and Leave post
 *         /api/mesh/join and /api/mesh/leave.
 */
import { useMeshViewStore } from "../../../lib/mesh-view-store.ts";
import { MeshInspectorPanel } from "../../mesh/right.tsx";
import { useMeshSnapshot } from "../../mesh/use-mesh-snapshot.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { machinePinned, machineShown, meshFullRoute } from "./mesh-panels-model.ts";
import { machineScope, useMeshPageSeed } from "./mesh-shared.ts";
import "./mesh-panels.css";

function Machine({ route, navigate, config, setConfig }: ModuleProps) {
  useMeshSnapshot();
  useMeshPageSeed(route);
  const { selectedId, selectedType } = useMeshViewStore();
  const shown = machineShown(config.machine, selectedType === "node" ? selectedId : null);
  const pinned = machinePinned(config.machine);
  return (
    <div className="vw-mesh-machine">
      {route.view !== "mesh" && (
        <ModuleHead>
          <button type="button" className="vw-chip" onClick={() => navigate(meshFullRoute(shown))} title="Open this on the Network page">
            Open full
          </button>
        </ModuleHead>
      )}
      {/* following: the foot button clears the view's pick, as the inspector's always did */}
      <MeshInspectorPanel machineId={shown} {...(pinned ? { onClear: () => setConfig({ machine: "" }), clearLabel: "Unpin" } : {})} />
    </div>
  );
}

export const machineModule = defineModule({
  type: "machine",
  title: "Machine",
  blurb: "One machine up close, or the network in machines",
  docs: {
    shows: "A machine's reach, what runs there, its sessions, work and identity; with none, the Network summary and Join mesh.",
    data: "The shared Network loop; the machine's own reading, once per pick.",
    opens: "Open full: /network on this machine; Join mesh and Leave.",
  },
  size: { w: 3, h: 16 },
  minSize: { w: 3, h: 8 },
  scopes: [machineScope("The network", "This page's machine")],
  Component: Machine,
});
