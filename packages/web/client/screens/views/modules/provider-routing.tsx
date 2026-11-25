/**
 * Routing — where each kind of work should go, and each harness's default.
 *
 * Shows:  By task: each role's suggested model, the next two, and the quota
 *         behind the pick. Then Model defaults: each harness's default model
 *         and effort. Advisory; it dispatches nothing.
 * Data:   the shared Providers loop feeds the core routing map, which follows
 *         the runtime catalog; defaults come from /api/runner/options.
 * Scope:  none. The stored module id (provider-routing) stays stable.
 * Opens:  nothing; Open full: /providers.
 */
import { ModelDefaults, TaskRouting } from "../../harnesses/HarnessesScreen.tsx";
import { routeMachineId } from "../../../lib/router.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import "./providers-panels.css";

function ProviderRouting({ route, navigate }: ModuleProps) {
  return (
    <div className="vw-hs">
      {route.view !== "harnesses" && (
        <ModuleHead>
          <button type="button" className="vw-chip" onClick={() => navigate({ view: "harnesses" })} title="Open the Providers page">
            Open full
          </button>
        </ModuleHead>
      )}
      <TaskRouting />
      <ModelDefaults machineId={routeMachineId(route)} />
    </div>
  );
}

export const providerRoutingModule = defineModule({
  type: "provider-routing",
  title: "Routing",
  blurb: "The suggested model for each kind of work, and each harness's default",
  docs: {
    shows: "By task: the suggested model, the next two, and the quota behind the pick. Then each harness's default model and effort. Advisory; dispatches nothing.",
    data: "The shared Providers loop feeds the core routing map (it follows the runtime catalog); defaults come from /api/runner/options.",
    opens: "Nothing; both lists are read-only.",
  },
  fit: true,
  size: { w: 12, h: 26 },
  minSize: { w: 6, h: 12 },
  Component: ProviderRouting,
});
