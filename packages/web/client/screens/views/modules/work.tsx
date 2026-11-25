/**
 * Work — tracked work items, most recently moved first.
 *
 * Shows:  title, phase, who has the next move, and when it last moved.
 *         Items that want the operator (Blocked, Awaiting your review) are
 *         marked in place of their phase. The page's own work item is
 *         marked as current. The count in the head.
 * Data:   GET /api/work?limit=40 (active work), or with Show set
 *         /api/work?active=false&limit=60 (done too), every 20s, one read per
 *         page however many panels show it. On the page's ?machineId=, only
 *         work an agent on that machine owns or has the next move on.
 * Scope:  Owner: only work an agent owns. Show: active work, or active and
 *         done.
 * Opens:  the work item (/work/:id).
 */
import { useMemo } from "react";
import { machineScopedAgentIds } from "../../../lib/machine-scope.ts";
import { routeMachineId } from "../../../lib/router.ts";
import { timeAgo } from "../../../lib/time.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { useWorkList } from "../../work/use-work-detail.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import { filterWorkByAgents, pageWorkId, workListPath, workListRows, workRoute, workRowMark } from "./work-view-model.ts";
import "./work-panels.css";

const ownerScope: ModuleScope = {
  key: "owner",
  allLabel: "Any owner",
  useOptions: () =>
    useScout()
      .agents.filter((a) => !a.retiredFromFleet)
      .map((a) => ({ value: a.id, label: a.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
};

const SHOW_OPTIONS = [{ value: "all", label: "Active and done" }] as const;

const showScope: ModuleScope = {
  key: "show",
  allLabel: "Active work",
  useOptions: () => SHOW_OPTIONS,
};

function Work({ route, navigate, config }: ModuleProps) {
  const { agents } = useScout();
  const { value: data, error } = useWorkList(workListPath(config.show));
  const machineId = routeMachineId(route);
  const agentIds = useMemo(() => machineScopedAgentIds(agents, machineId), [agents, machineId]);
  const items = useMemo(() => workListRows(filterWorkByAgents(data ?? [], agentIds), config.owner), [agentIds, config.owner, data]);
  const current = pageWorkId(route);

  if (!data) return <Quiet>{error ? "Couldn't read work." : "Reading work…"}</Quiet>;
  if (!items.length) return <Quiet>{config.show === "all" ? "No tracked work." : "No active work. Show done work from Scope."}</Quiet>;
  return (
    <>
      <ModuleHead>
        <span className="hud-grid-count" title={`${items.length} work items`}>{items.length}</span>
      </ModuleHead>
      <ul className="vw-rows" aria-label="Work">
        {items.map((w) => {
          const mark = workRowMark(w);
          return (
            <li key={w.id}>
              <button
                type="button"
                className="vw-row vw-row--work"
                aria-current={w.id === current ? "true" : undefined}
                onClick={() => navigate(workRoute(w.id))}
              >
                <span className="vw-strong vw-ell">{w.title}</span>
                <span className={mark ? "vw-kind vw-ell" : "vw-dim vw-ell"}>{mark ?? w.currentPhase}</span>
                <span className="vw-dim vw-ell">{w.nextMoveOwnerName ?? w.ownerName ?? ""}</span>
                <span className="vw-dim vw-num">{timeAgo(w.lastMeaningfulAt)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export const workModule = defineModule({
  type: "work",
  title: "Work",
  blurb: "Tracked work, most recently moved first",
  docs: {
    shows: "Work items: title, phase (or Blocked, Awaiting your review), next move, last moved; the page's item marked.",
    data: "/api/work?limit=40, or done too with Show; every 20s, one read per page; the page's ?machineId= narrows it.",
    opens: "The work item.",
  },
  size: { w: 6, h: 10 },
  minSize: { w: 3, h: 4 },
  scopes: [ownerScope, showScope],
  Component: Work,
});
