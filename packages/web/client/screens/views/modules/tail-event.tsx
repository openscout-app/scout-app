/**
 * Event — the Tail or Alerts row picked beside it, as Ops' inspector showed it.
 *
 * Shows:  Tail detail (Alert detail for a pick from Alerts) with Clear, then
 *         the event: kind · harness, time · project · session, its metadata
 *         (Copy metadata), Open session, and the message (Copy message). With
 *         nothing picked: "No log selected".
 * Data:   the latest pick of a Tail or Alerts panel on the same view
 *         (tail-picks.ts); it reads nothing itself. While it is on the view,
 *         those panels hand it their picks instead of opening a sheet.
 * Scope:  none; one per view. It follows the Tail and Alerts panels beside it.
 * Opens:  Open session: the event's session.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import "../../../scout/slots/ctx-panel.css";
import { OpsTailInspectorPanel, parseOpsDetailSnapshot } from "../../ops/inspector-panel.tsx";
import { tailDetailSnapshot } from "../../shared/TailView.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { onTailPage } from "./tail-panel-model.ts";
import { tailPicks } from "./tail-picks.ts";
import "./tail-panels.css";

function TailEvent({ route, navigate }: ModuleProps) {
  // while this panel is here, Tail and Alerts panels send their picks to it
  useEffect(() => tailPicks.watch(), []);
  const pick = useSyncExternalStore(tailPicks.subscribe, tailPicks.latest, () => null);
  const detail = useMemo(() => (pick ? parseOpsDetailSnapshot(tailDetailSnapshot(pick.event)) : null), [pick]);
  const mode = pick?.kind ?? (onTailPage(route, "issues") ? "issues" : "tail");
  return (
    <div className="vw-tail-event">
      <OpsTailInspectorPanel
        detail={detail}
        mode={mode}
        navigate={navigate}
        onClear={() => pick && tailPicks.withdraw(pick.from)}
      />
    </div>
  );
}

export const tailEventModule = defineModule({
  type: "tail-event",
  title: "Event",
  blurb: "The Tail or Alerts row you picked, in full",
  docs: {
    shows: "The picked event: kind, harness, time, project, session, metadata, Open session, the message, with copy buttons.",
    data: "The latest pick of a Tail or Alerts panel on this view; no reads of its own.",
    opens: "Open session: the event's session.",
  },
  size: { w: 4, h: 12 },
  minSize: { w: 3, h: 6 },
  maxPerView: 1,
  Component: TailEvent,
});
