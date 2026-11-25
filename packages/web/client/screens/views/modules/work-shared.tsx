import { useMemo } from "react";
import { machineScopedAgentIds } from "../../../lib/machine-scope.ts";
import { routeMachineId } from "../../../lib/router.ts";
import type { Route } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { useWorkList } from "../../work/use-work-detail.ts";
import type { ModuleConfig, ModuleProps, ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import { offersOpenFull, panelWork, workListPath, workOptions, workRoute, type PanelWork } from "./work-view-model.ts";
import "./work-panels.css";

/*
 * What the Work view's panels share: the Work item scope, which item a panel
 * shows, its head (Open full, Unpin) and its empty line. Every panel on one
 * work item reads one shared detail (screens/work/use-work-detail.ts); none
 * reads /api/work/:id on its own.
 */

/** The picker's options: recent work, active and done, from the one shared list read. */
function useWorkOptions() {
  const { value } = useWorkList(workListPath("all"));
  return useMemo(() => workOptions(value ?? []), [value]);
}

/** Work item, by id: "This page's work item" follows /work/:id (and an Ops Tail or Follow link's workId). */
export const workScope: ModuleScope = {
  key: "work",
  allLabel: "No work item",
  followsPage: "This page's work item",
  useOptions: useWorkOptions,
};

/** The work item this panel shows, and the page's machine scope (null = every machine). */
export function usePanelWork(route: Route, config: ModuleConfig): PanelWork & { agentIds: Set<string> | null } {
  const { agents } = useScout();
  const machineId = routeMachineId(route);
  const agentIds = useMemo(() => machineScopedAgentIds(agents, machineId), [agents, machineId]);
  return { ...panelWork(route, config.work), agentIds };
}

/** Open full when the panel is not the page's own item; Unpin when it is pinned to one. */
export function WorkPanelHead({ route, navigate, setConfig, work }: Pick<ModuleProps, "route" | "navigate" | "setConfig"> & { work: PanelWork }) {
  return (
    <ModuleHead>
      {offersOpenFull(route, work) && (
        <button type="button" className="vw-chip" onClick={() => navigate(workRoute(work.workId))} title="Open this work item on its own page">
          Open full
        </button>
      )}
      {work.workId && !work.following && (
        <button type="button" className="vw-chip" onClick={() => setConfig({ work: "" })} title="Stop showing this work item">
          Unpin
        </button>
      )}
    </ModuleHead>
  );
}

/** What a panel with no work item says. */
export function WorkPanelEmpty({ work }: { work: PanelWork }) {
  return (
    <Quiet>
      {work.following ? "Pick a work item in Work and it opens here." : "Pick a work item from Scope, or follow this page's."}
    </Quiet>
  );
}
