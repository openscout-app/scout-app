import type { MeshStatus } from "../../lib/types.ts";

/**
 * The Network loop: one read of /api/mesh and one machine sweep, shared by
 * everything that draws the mesh (the Network screen, and the Hosts, Network
 * map, Machine and Rack panels). Pure — fetch, sweep and timers come in — so
 * the cadence and race rules test without a DOM; the React side is
 * use-mesh-snapshot.ts.
 *
 *   - The first reader after none reads and sweeps at once, then reads every
 *     10s and sweeps every 15s while any reader is mounted, the cadence the
 *     Network screen always had. The last unmount stops both; the snapshot
 *     itself stays in the mesh view store, so a remount paints at once.
 *   - A newer read supersedes an older one; a superseded answer is dropped.
 *   - A background tick skips while the page is hidden.
 */

export type MeshLoopState = {
  /** No snapshot yet and one is on its way. */
  loading: boolean;
  /** A snapshot is drawn and a newer one is on its way. */
  refreshing: boolean;
  error: string | null;
  lastLoadedAt: number | null;
};

export type MeshLoadMode = "initial" | "background" | "manual";

export type MeshLoopDeps = {
  fetch: () => Promise<MeshStatus>;
  /** Hand a snapshot to the mesh view store. */
  apply: (mesh: MeshStatus) => void;
  /** Ask every machine for its reading (lib/mesh-node-state.ts). */
  sweep: () => void;
  now: () => number;
  visible: () => boolean;
  setInterval: (run: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export type MeshLoop = {
  getState: () => MeshLoopState;
  subscribe: (listener: () => void) => () => void;
  /** Count a reader in; returns the release. */
  mount: () => () => void;
  load: (mode?: MeshLoadMode) => Promise<void>;
};

export const MESH_READ_EVERY_MS = 10_000;
export const MESH_SWEEP_EVERY_MS = 15_000;

export function createMeshLoop(deps: MeshLoopDeps): MeshLoop {
  let state: MeshLoopState = { loading: true, refreshing: false, error: null, lastLoadedAt: null };
  const listeners = new Set<() => void>();
  let readers = 0;
  let timers: unknown[] = [];
  let latest = 0;

  const set = (patch: Partial<MeshLoopState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function load(mode: MeshLoadMode = "initial"): Promise<void> {
    const id = ++latest;
    if (state.lastLoadedAt === null && mode !== "background") set({ loading: true, error: null });
    else set({ refreshing: true });
    try {
      const data = await deps.fetch();
      if (id !== latest) return;
      deps.apply(data);
      set({ loading: false, refreshing: false, error: null, lastLoadedAt: deps.now() });
    } catch (cause) {
      if (id !== latest) return;
      set({ loading: false, refreshing: false, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }

  function mount(): () => void {
    readers += 1;
    if (readers === 1) {
      void load("initial");
      deps.sweep();
      timers = [
        deps.setInterval(() => {
          if (deps.visible()) void load("background");
        }, MESH_READ_EVERY_MS),
        deps.setInterval(() => {
          if (deps.visible()) deps.sweep();
        }, MESH_SWEEP_EVERY_MS),
      ];
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      readers -= 1;
      if (readers === 0) {
        for (const timer of timers) deps.clearInterval(timer);
        timers = [];
      }
    };
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mount,
    load,
  };
}
