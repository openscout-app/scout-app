import { useRef } from "react";
import type { MachineBucket } from "../../lib/mesh-buckets.ts";
import { clearMachinePosition, setMeshSelection, showAllMachines, soloMachine, toggleMachineVisibility } from "../../lib/mesh-view-store.ts";
import { refreshMeshNodeState } from "../../lib/mesh-node-state.ts";
import { useMeshNodeState } from "../../lib/use-mesh-node-state.ts";
import { NodeMenu, nodeMenuRowProps, type NodeMenuHandle } from "./NodeMenu.tsx";
import { buildNodeMenuActions } from "./node-actions.ts";
import { HOST_NODE_H, HOST_NODE_W, hostFace, type HostMapNode } from "./host-map.ts";

function localPlatform(): string {
  if (typeof navigator === "undefined") return "scout";
  const ua = navigator.userAgent;
  if (/iPhone|iPad/i.test(ua)) return "ios";
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  if (/Android/i.test(ua)) return "android";
  if (/Linux/i.test(ua)) return "linux";
  return "scout";
}

/**
 * One host on the map. The same object you drag, right-click, and open.
 * Opening it is a separate step: this face stays the node.
 */
export function HostNode({
  bucket,
  node,
  selected,
  hidden,
  anyHidden,
  machineIds,
  onPointerDown,
  onOpen,
}: {
  bucket: MachineBucket;
  node: HostMapNode;
  selected: boolean;
  hidden: boolean;
  anyHidden: boolean;
  machineIds: string[];
  onPointerDown: (event: React.PointerEvent, node: HostMapNode) => void;
  onOpen: (node: HostMapNode) => void;
}) {
  const menu = useRef<NodeMenuHandle | null>(null);
  const entry = useMeshNodeState(bucket.machineId);
  const view = entry?.view ?? null;
  const face = hostFace(bucket);
  const mark = face.platform || (face.role === "here" ? localPlatform() : face.role === "device" ? "device" : "scout");

  return (
    <div
      data-machine-id={bucket.machineId}
      className={[
        "mesh-host-node",
        selected && "is-selected",
        hidden && "is-hidden",
        !bucket.online && "is-offline",
        face.place === "cloud" && "is-cloud",
        face.role === "here" && "is-here",
        face.role === "device" && "is-device",
        node.pinned && "is-pinned",
      ].filter(Boolean).join(" ")}
      style={{ left: node.x, top: node.y, width: HOST_NODE_W, height: HOST_NODE_H }}
      {...nodeMenuRowProps(menu)}
    >
      <NodeMenu
        ref={menu}
        machineLabel={bucket.machineLabel}
        className="mesh-machine-menu-btn"
        actions={buildNodeMenuActions({
          machineId: bucket.machineId,
          machineLabel: bucket.machineLabel,
          nodeId: view?.node?.id ?? bucket.node?.nodeId ?? null,
          brokerUrl: view?.node?.brokerUrl ?? bucket.node?.brokerUrl ?? null,
          hidden,
          anyHidden,
          positioned: node.pinned,
          canCopy: typeof navigator !== "undefined" && Boolean(navigator.clipboard),
          checking: entry?.loading ?? false,
          on: {
            select: () => onOpen(node),
            refresh: (id) => void refreshMeshNodeState(id),
            focus: (id) => { soloMachine(id, machineIds); setMeshSelection(id, "node"); },
            toggleHidden: (id) => toggleMachineVisibility(id),
            showAll: () => showAllMachines(),
            clearPosition: (id) => clearMachinePosition(id),
            copy: (text) => void navigator.clipboard?.writeText(text),
          },
        })}
      />
      <button
        type="button"
        className="mesh-host-node-body"
        onPointerDown={(event) => onPointerDown(event, node)}
        onClick={() => setMeshSelection(bucket.machineId, "node")}
        onDoubleClick={() => onOpen(node)}
        title={`${bucket.machineLabel}. ${face.line}. Double-click to open. Drag to move.`}
      >
        <span className="mesh-host-node-mark" aria-hidden>{mark}</span>
        <span className="mesh-host-node-copy">
          <span className="mesh-host-node-name">{bucket.machineLabel}</span>
          <span className="mesh-host-node-line">{face.line}</span>
        </span>
      </button>
    </div>
  );
}
