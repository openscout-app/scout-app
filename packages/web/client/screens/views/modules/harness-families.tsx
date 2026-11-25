/**
 * Harness families — what each harness has running inside it: workflows, workers and their tasks.
 *
 * Shows:  per harness (Claude Code, Codex, Claude workflows), its workflows
 *         and agents with status and stats, and up to three tasks each,
 *         when last observed; "nothing observed" when a harness reports
 *         none. Six agents at most per family.
 * Data:   GET /api/topology/snapshot, once on open.
 * Scope:  none; every harness on this machine.
 * Opens:  nothing.
 */
import { ObservedTopologyPanel } from "../../../components/ObservedTopologyPanel.tsx";
import { defineModule } from "./contract.ts";
import "./runtime-panels.css";

function HarnessFamilies() {
  return (
    <div className="vw-harness-families">
      <ObservedTopologyPanel title="Harness families" size="compact" maxAgents={6} maxTasks={3} showEmpty />
    </div>
  );
}

export const harnessFamiliesModule = defineModule({
  type: "harness-families",
  title: "Harness families",
  blurb: "Workflows, workers and tasks inside each harness",
  docs: {
    shows: "Per harness: its workflows and agents with status, and up to three tasks each.",
    data: "GET /api/topology/snapshot, once on open.",
    opens: "Nothing.",
  },
  size: { w: 12, h: 6 },
  minSize: { w: 4, h: 4 },
  Component: HarnessFamilies,
});
