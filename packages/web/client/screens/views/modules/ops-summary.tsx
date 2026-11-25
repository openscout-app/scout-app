/**
 * Ops summary — what the fleet is waiting on and running: Ops › Control's inspector as a panel.
 *
 * Shows:  the last Tail pick, if one is held (Selection or Message, with its
 *         action); Ops Context (the Ops page it sits on: Runtime, Agents or
 *         Lanes, else Mission Control; when it refreshed) and four
 *         counts: waiting on the operator, active asks, agents online, agents
 *         working; Queue, the first five items waiting on the operator; Runs,
 *         the first five active asks; Recent activity, the seven agents that
 *         changed last.
 * Data:   loadFleet() on mount and again on every message.posted,
 *         flight.updated and collaboration.event.appended broker event;
 *         useScout().agents for the counts and Recent activity; the
 *         scout:ops-detail event for the last Tail pick.
 * Scope:  none.
 * Opens:  a Queue item or a Run: its conversation, or Ops › Control when
 *         it has none; an agent in Recent activity: its profile; the Tail
 *         pick's own action.
 */
import { useState } from "react";
import "../../../scout/slots/ctx-panel.css";
import { usePanelContent, type PanelContent } from "../../../components/hud-grid/HudGrid.tsx";
import { useScout } from "../../../scout/Provider.tsx";
import { OpsInspectorPanel } from "../../ops/inspector-panel.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./mission-panels.css";

function OpsSummary({ route, navigate }: ModuleProps) {
  const { agents } = useScout();
  // quiet (nothing waiting, out or working, no Tail pick): the grid folds the panel to its head row
  const [content, setContent] = useState<PanelContent | null>(null);
  usePanelContent(content);
  // Ops Context names the Ops page the panel sits on (Runtime, Agents, Lanes); anywhere else it reads as Mission Control
  const mode = route.view === "ops" && (route.mode === "atop" || route.mode === "agents" || route.mode === "lanes") ? route.mode : "mission";
  return (
    <div className="vw-ops-summary">
      <OpsInspectorPanel mode={mode} agents={agents} navigate={navigate} returnRoute={route} onContent={setContent} />
    </div>
  );
}

export const opsSummaryModule = defineModule({
  type: "ops-summary",
  title: "Ops summary",
  blurb: "What the fleet is waiting on, the runs in flight and who changed last",
  docs: {
    shows: "The last Tail pick, Ops Context with four counts, Queue (5), Runs (5), Recent activity (7).",
    data: "loadFleet() on mount and on broker message, flight and collaboration events; useScout().agents.",
    opens: "A Queue item or Run: its conversation, else Ops › Control; an agent's profile; the Tail pick's action.",
  },
  size: { w: 3, h: 10 },
  minSize: { w: 3, h: 8 },
  Component: OpsSummary,
});
