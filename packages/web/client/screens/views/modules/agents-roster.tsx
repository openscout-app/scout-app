/**
 * Agent roster — the fleet in counts, and where to go for each: Ops › Agents' rail as a panel.
 *
 * Shows:  Agents: Overview (every agent), Agents (online), Sessions, Alerts
 *         (asks failed or waiting on the operator); then Projects and
 *         Machines, the eight largest of each with their agent counts.
 * Data:   useScout().agents; /api/conversations on open and on
 *         conversation events; the fleet's active asks (shared store).
 * Scope:  none; the whole fleet.
 * Opens:  Overview: the inbox. Agents: Ops › Agents. Sessions: Sessions.
 *         Alerts: Activity.
 */
import "../../../scout/slots/ctx-panel.css";
import { OpsAgentsLeft } from "../../ops/left-agents.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./agents-panels.css";

function AgentsRoster({ navigate }: ModuleProps) {
  return (
    <div className="vw-agents-roster">
      <OpsAgentsLeft navigate={navigate} />
    </div>
  );
}

export const agentsRosterModule = defineModule({
  type: "agents-roster",
  title: "Agent roster",
  blurb: "The fleet in counts: online, sessions, alerts, by project and machine",
  docs: {
    shows: "Overview, Agents online, Sessions and Alerts counts; the eight largest projects and machines with their agent counts.",
    data: "useScout().agents; /api/conversations on open and on conversation events; the fleet's active asks.",
    opens: "The inbox, Ops › Agents, Sessions, Activity.",
  },
  size: { w: 4, h: 12 },
  minSize: { w: 2, h: 6 },
  maxPerView: 1,
  Component: AgentsRoster,
});
