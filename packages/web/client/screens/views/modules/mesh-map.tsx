/**
 * Network map — the machines and their agents, as a map or a tree.
 *
 * Shows:  Map or Tree, density (map), the agent filter and state pills (All ·
 *         In turn · Callable), the sync time and Refresh; then the canvas
 *         (machine sections to drag, collapse, hide and zoom; agent cards on
 *         hover) or the agent tree (↑↓ move, enter pins, o opens, esc clears).
 * Data:   the shared Network loop (mesh/use-mesh-snapshot.ts: /api/mesh 10s,
 *         sweep 15s); agents from useLocalAgents(); mode, density, filters and
 *         machine positions in the mesh view store.
 * Scope:  Machine: only that machine's agents. "This page's machine" follows
 *         the page's ?machineId= (none: every machine). One per view: it owns
 *         the map's pan, zoom and layout.
 * Opens:  an agent: its profile; a machine header picks it for Machine.
 */
import { routeMachineId } from "../../../lib/router.ts";
import { MeshScreen } from "../../mesh/MeshScreen.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { mapMachineScope } from "./mesh-panels-model.ts";
import { machineScope } from "./mesh-shared.ts";
import "./mesh-panels.css";

function MeshMap({ route, navigate, config }: ModuleProps) {
  // MeshScreen picks the page's ?machineId= itself, as on /network
  return (
    <div className="vw-mesh-map">
      <MeshScreen navigate={navigate} machineId={mapMachineScope(config.machine, routeMachineId(route))} embedded />
    </div>
  );
}

export const meshMapModule = defineModule({
  type: "mesh-map",
  title: "Network map",
  blurb: "Machines and their agents, as a map or a tree",
  docs: {
    shows: "Map or Tree, density, the agent filter and state pills, sync and Refresh; then the canvas or the agent tree.",
    data: "The shared Network loop; agents from useLocalAgents().",
    opens: "An agent: its profile; a machine header picks it for Machine.",
  },
  size: { w: 6, h: 22 },
  minSize: { w: 4, h: 10 },
  scopes: [machineScope("Every machine", "This page's machine")],
  maxPerView: 1,
  Component: MeshMap,
});
