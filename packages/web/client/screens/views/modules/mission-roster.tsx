/**
 * Mission roster — who is on the Mission wall, and the wall's filters: Ops › Control's left rail as a panel.
 *
 * Shows:  Source (All · Scout · Native), the search, Within, Order by
 *         (Activity · Project · Harness · Status · Source), then the selection bar (Tail ↗,
 *         Clear) or the visible count, then one row per session on the wall:
 *         expand for its details, ⌘-click to select, Reveal on wall, Open ↗.
 *         Without a Mission wall on the view: a line saying the wall fills it.
 * Data:   the mission-control store the wall publishes its visible sessions
 *         to; every filter here narrows the wall beside it.
 * Scope:  none; one per view, since the filters are the wall's. "/" finds the
 *         search from anywhere on Ops › Control, and only with focus in the
 *         panel elsewhere; j/k and arrows walk the rows.
 * Opens:  Tail ↗: Ops › Tail on the selected sessions. Open ↗: the agent's
 *         profile. Reveal on wall: pins and flashes that pane on the wall.
 */
import { useSyncExternalStore } from "react";
import { OpsMissionLeft } from "../../ops/left-mission.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { missionDock } from "./mission-dock.ts";
import { isMissionRoute } from "./mission-panels-model.ts";
import { usePanelKeyScope } from "./panel-scope.ts";
import { Quiet } from "./shared.tsx";
import "./mission-panels.css";

const wallOnView = () => missionDock.get().walls > 0;

function MissionRoster({ route }: ModuleProps) {
  const { root, keyScope } = usePanelKeyScope();
  const own = isMissionRoute(route);
  const walled = useSyncExternalStore(missionDock.subscribe, wallOnView, () => false);

  return (
    <div ref={root} className="vw-mission-roster">
      {walled ? (
        <OpsMissionLeft keyScope={own ? undefined : keyScope} />
      ) : (
        <Quiet>Lists the sessions on the Mission wall. Add the wall to this view to fill it.</Quiet>
      )}
    </div>
  );
}

export const missionRosterModule = defineModule({
  type: "mission-roster",
  title: "Mission roster",
  blurb: "The sessions on the Mission wall, with the wall's source, search, window and order",
  docs: {
    shows: "Source, search, Within and Order by chips, the selection bar or visible count, then one row per session on the wall.",
    data: "The mission-control store the Mission wall publishes to; its filters narrow the wall.",
    opens: "Tail ↗ on the selection, Open ↗ to the agent's profile, Reveal on wall to pin that pane.",
  },
  size: { w: 3, h: 24 },
  minSize: { w: 2, h: 10 },
  maxPerView: 1,
  Component: MissionRoster,
});
