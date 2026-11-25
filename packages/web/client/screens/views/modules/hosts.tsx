/**
 * Hosts — every machine on the mesh with its agents: the Network rail as a panel.
 *
 * Shows:  agent search and state pills, the focus chip while the map is
 *         narrowed to some machines, then LAN and Tailnet, each machine
 *         with its agents (see more / see less) and its menu (show details,
 *         check now, pin, focus, hide, show all, reset position, copy;
 *         right-click, the ⋯ button, or Shift+F10). Drag a row, or pin it,
 *         to put a machine first in its group. Before the first read:
 *         "Reading the mesh…", or "Couldn't read the mesh.".
 * Data:   the shared Network loop (mesh/use-mesh-snapshot.ts): /api/mesh every
 *         10s and a machine sweep every 15s; agents from useScout().
 * Scope:  none. A machine click is the view's pick: the Machine panel beside
 *         it shows that machine and the Network map pans to it. On any page its
 *         ?machineId= picks first.
 * Opens:  an agent: its profile (Back returns here); Open full: /network.
 */
import { useMeshViewStore } from "../../../lib/mesh-view-store.ts";
import { MeshLeft } from "../../mesh/left.tsx";
import { useMeshSnapshot } from "../../mesh/use-mesh-snapshot.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { useMeshPageSeed } from "./mesh-shared.ts";
import { Quiet } from "./shared.tsx";
import "./mesh-panels.css";

function Hosts({ route, navigate }: ModuleProps) {
  const { error } = useMeshSnapshot();
  const { meshSnapshot } = useMeshViewStore();
  useMeshPageSeed(route);
  const own = route.view === "mesh";
  const head = !own && (
    <ModuleHead>
      <button type="button" className="vw-chip" onClick={() => navigate({ view: "mesh" })} title="Open the Network page">
        Open full
      </button>
    </ModuleHead>
  );
  if (!meshSnapshot) return <>{head}<Quiet>{error ? "Couldn't read the mesh." : "Reading the mesh…"}</Quiet></>;
  return (
    <div className="vw-mesh-rail">
      {head}
      <MeshLeft returnTo={own ? undefined : route} />
    </div>
  );
}

export const hostsModule = defineModule({
  type: "hosts",
  title: "Hosts",
  blurb: "Every machine on the mesh, with its agents",
  docs: {
    shows: "Search and state pills, then LAN and Tailnet. Each machine lists what is running on it. Drag a row, or pin it, to put that machine first.",
    data: "The shared Network loop: /api/mesh every 10s, a machine sweep every 15s.",
    opens: "A machine: the view's pick (Machine, the map); an agent: its profile; Open full: /network.",
  },
  size: { w: 3, h: 14 },
  minSize: { w: 3, h: 6 },
  Component: Hosts,
});
