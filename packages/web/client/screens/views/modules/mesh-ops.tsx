/**
 * Mesh Ops — work and sessions across machines, by how recently each moved.
 *
 * Shows:  triage tabs with counts (Active · Moving · Done · Archive), group by
 *         family or host, the host strip (all, each host with its new, live
 *         and session counts, unattributed), then the rows in groups, new
 *         first, ended sessions folded under Done and Archive, the last-look
 *         divider; lab toggles in dev builds.
 * Data:   /api/mesh-ops (limit 200) into the shared Mesh Ops store
 *         (mesh-ops/use-mesh-ops-items.ts), read again on broker events
 *         (collaboration, flight, message) at most every 750ms; the clock
 *         ticks every 30s.
 * Scope:  on /mesh-ops the URL's ?machineId= and ?itemId=, as the page always
 *         was. Elsewhere Host ("This page's machine" follows the page's
 *         ?machineId=; a host chip pins one) and the open item (state). One
 *         per view: the triage tab, grouping and lab toggles are the store's.
 * Opens:  a row: the Item panel; Open full: /mesh-ops on this host and item.
 */
import { useMemo } from "react";
import { routeMachineId } from "../../../lib/router.ts";
import { useMeshOpsViewStore } from "../../../lib/mesh-ops-view-store.ts";
import { MeshOpsList, type MeshOpsBoardControl } from "../../mesh-ops/content.tsx";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { boardHost, boardHostPatch, hostOptions, meshOpsFullRoute } from "./mesh-ops-panel-model.ts";
import "./mesh-panels.css";

function MeshOpsBoard({ route, navigate, config, setConfig }: ModuleProps) {
  const own = route.view === "mesh-ops";
  const host = boardHost(config.machine, routeMachineId(route));
  const itemId = config.item || null;
  const control = useMemo<MeshOpsBoardControl | undefined>(
    () =>
      own
        ? undefined
        : {
            hostId: host,
            itemId,
            selectHost: (nodeId) => setConfig(boardHostPatch(nodeId)),
            selectItem: (id) => setConfig({ item: id }),
          },
    [own, host, itemId, setConfig],
  );
  return (
    <div className="vw-mesh-ops">
      {!own && (
        <ModuleHead>
          <button type="button" className="vw-chip" onClick={() => navigate(meshOpsFullRoute(host, itemId))} title="Open this on the Mesh Ops page">
            Open full
          </button>
        </ModuleHead>
      )}
      <MeshOpsList route={route} navigate={navigate} control={control} />
    </div>
  );
}

const hostScope: ModuleScope = {
  key: "machine",
  allLabel: "Every host",
  followsPage: "This page's machine",
  useOptions: () => {
    const { hosts } = useMeshOpsViewStore();
    return useMemo(() => hostOptions(hosts), [hosts]);
  },
};

export const meshOpsModule = defineModule({
  type: "mesh-ops",
  title: "Mesh Ops",
  blurb: "Work and sessions across machines, by how recently each moved",
  docs: {
    shows: "Triage tabs with counts, group by family or host, the host strip, then rows newest first.",
    data: "/api/mesh-ops into the shared Mesh Ops store, read again on broker events (750ms at most); a 30s clock.",
    opens: "A row: the Item panel; Open full: /mesh-ops on this host and item.",
  },
  size: { w: 6, h: 22 },
  minSize: { w: 4, h: 10 },
  scopes: [hostScope],
  state: ["item"],
  maxPerView: 1,
  Component: MeshOpsBoard,
});
