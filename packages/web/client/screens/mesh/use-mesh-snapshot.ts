import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../lib/api.ts";
import { sweepMeshNodeStates } from "../../lib/mesh-node-state.ts";
import { setMeshSnapshot } from "../../lib/mesh-view-store.ts";
import type { MeshStatus } from "../../lib/types.ts";
import { createMeshLoop, type MeshLoop, type MeshLoopState } from "./mesh-snapshot-loop.ts";

/*
 * The React side of the Network loop (mesh-snapshot-loop.ts): one /api/mesh
 * read and one machine sweep per page, however many mesh panels are drawn.
 * The snapshot lands in the mesh view store (useMeshViewStore().meshSnapshot).
 */

let loop: MeshLoop | null = null;

function meshLoop(): MeshLoop {
  loop ??= createMeshLoop({
    fetch: () => api<MeshStatus>("/api/mesh"),
    apply: setMeshSnapshot,
    sweep: () => void sweepMeshNodeStates(),
    now: () => Date.now(),
    visible: () => typeof document === "undefined" || document.visibilityState === "visible",
    setInterval: (run, ms) => setInterval(run, ms),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  });
  return loop;
}

export type MeshSnapshotHandle = MeshLoopState & { load: MeshLoop["load"] };

/** Keep the mesh read while mounted; returns its load state and a manual load. */
export function useMeshSnapshot(): MeshSnapshotHandle {
  const store = meshLoop();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => store.mount(), [store]);
  return { ...state, load: store.load };
}
