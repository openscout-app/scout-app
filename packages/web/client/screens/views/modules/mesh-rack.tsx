/**
 * Rack — every machine as a rack unit, or a mini map of the canvas.
 *
 * Shows:  a one-line reach summary, and when opened, each host's last
 *         activity, last contact with us, and a ping. Not a second hide list.
 * Data:   the shared Network loop (mesh/use-mesh-snapshot.ts); machine
 *         readings from the sweep (useMeshNodeStates()); agents from useScout().
 * Scope:  none.
 * Opens:  nothing; a unit picks its machine for Machine and the map.
 */
import { useMeshViewStore } from "../../../lib/mesh-view-store.ts";
import { MeshCanvasMinimap } from "../../../scout/slots/MeshCanvasMinimap.tsx";
import { useMeshSnapshot } from "../../mesh/use-mesh-snapshot.ts";
import { defineModule } from "./contract.ts";
import { Quiet } from "./shared.tsx";
import "./mesh-panels.css";

function Rack() {
  const { error } = useMeshSnapshot();
  const { meshSnapshot } = useMeshViewStore();
  if (!meshSnapshot) return <Quiet>{error ? "Couldn't read the mesh." : "Reading the mesh…"}</Quiet>;
  return (
    <div className="vw-mesh-rack">
      <MeshCanvasMinimap />
    </div>
  );
}

export const meshRackModule = defineModule({
  type: "mesh-rack",
  title: "Rack",
  blurb: "Every machine as a rack unit, or a mini map",
  docs: {
    shows: "A reach summary. Open it for last activity, last contact, and a ping per host.",
    data: "The shared Network loop; machine readings from the sweep.",
    opens: "Nothing; a unit picks its machine for Machine and the map.",
  },
  size: { w: 3, h: 8 },
  minSize: { w: 2, h: 3 },
  fit: true,
  Component: Rack,
});
