/**
 * Requests · Active — the fleet's queue, as the Ops rail shows it.
 *
 * Shows:  Requests: asks and work waiting on the operator, in the fleet's order, with
 *         a count ("All clear" when none). Active: asks still out, with each
 *         agent's state, with a count ("No active requests" when none). The
 *         rail shows the first 4 and 10; the panel shows them all.
 * Data:   loadFleet() (GET /api/fleet, the shared fleet store), on open and on
 *         message.posted, flight.updated and collaboration.event.appended.
 * Scope:  none.
 * Opens:  a request or an active ask: its conversation, else its work
 *         item's chat, else its agent. Back returns here.
 */
import { useState } from "react";
import { usePanelContent, type PanelContent } from "../../../components/hud-grid/HudGrid.tsx";
import { OpsFleetQueue } from "../../ops/left-default.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import "./tail-panels.css";

function OpsQueue({ route, navigate }: ModuleProps) {
  // nothing waiting and nothing out: the grid folds the panel to its head row until something arrives
  const [content, setContent] = useState<PanelContent | null>(null);
  usePanelContent(content);
  return (
    <div className="ctx-panel ctx-panel--ops vw-ops-queue">
      <OpsFleetQueue navigate={navigate} route={route} requestLimit={Infinity} activeLimit={Infinity} onContent={setContent} />
    </div>
  );
}

export const opsQueueModule = defineModule({
  type: "ops-queue",
  title: "Inbox · Active",
  blurb: "Asks waiting on you and asks still out, as the Ops rail lists them",
  docs: {
    shows: "Inbox items waiting on the operator, then active asks with their agent's state, each with a count.",
    data: "loadFleet() (GET /api/fleet), on open and on message, flight and collaboration events.",
    opens: "An Inbox item or active ask: its conversation, else its work item's chat, else its agent.",
  },
  size: { w: 4, h: 10 },
  minSize: { w: 3, h: 5 },
  Component: OpsQueue,
});
