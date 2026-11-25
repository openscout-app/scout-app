/**
 * Mission wall — every live session's raw log, tiled: Ops › Control's wall as a panel.
 *
 * Shows:  the status line (logs shown of matching, grid, lines, withheld and
 *         quiet counts, the Within chips, the keys, unpin), then one pane per
 *         log, most recently active first, tiled to what stays legible in
 *         the panel (16 at most). With a Session context panel on the view the
 *         cursor's reading goes there; without one Enter opens it over the
 *         wall's right edge as before. o opens the session (profile, activity,
 *         message) over the wall. Empty: No logs on the wire, or No matching
 *         logs.
 * Data:   the tail firehose (live socket, repainted every 250ms, 4000 lines),
 *         one recent-tail backfill on mount, /api/tail/discover every 30s,
 *         observe polling for registered agents. Filters, search, order,
 *         selection and the visible list live in the mission-control store
 *         the Mission roster shares; the cursor's reading goes to the Session
 *         context panel through mission-dock.ts.
 * Scope:  none; one per view. On Ops › Control the cursor is the page's
 *         (?sessionId=, once the router keeps it); anywhere else the wall's
 *         own. Keys (hjkl and arrows, Enter or i, o, x or Space, Esc, ⌘A) read
 *         from anywhere on Ops › Control and only with focus in the panel
 *         elsewhere.
 * Opens:  a pane's file: Ops › Tail on the session. From the session overlay:
 *         its conversation (or /sessions/<id> for a native session), Tail,
 *         the agent's profile.
 */
import { useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { useGridFullView } from "../../../components/hud-grid/HudGrid.tsx";
import { routePath } from "../../../lib/router.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { MissionControlView } from "../../ops/MissionControlView.tsx";
import "../../ops/ops-screen.css";
import { defineModule, type ModuleProps } from "./contract.ts";
import { missionDock } from "./mission-dock.ts";
import { cursorRoute, isMissionRoute, routeCursor, urlHoldsCursor } from "./mission-panels-model.ts";
import { usePanelKeyScope } from "./panel-scope.ts";
import "./mission-panels.css";

const contextDocked = () => missionDock.get().docks > 0;
const URL_HOLDS_CURSOR = urlHoldsCursor(routePath);

function MissionWall({ route, navigate }: ModuleProps) {
  const { agents } = useScout();
  const { root, keyScope } = usePanelKeyScope();
  const own = isMissionRoute(route);

  useLayoutEffect(() => missionDock.mountWall(), []);
  // in full view the Session context panel is out of sight, so the wall draws its own detail again
  const fullView = useGridFullView();
  const docked = useSyncExternalStore(missionDock.subscribe, contextDocked, () => false) && fullView !== "self";

  // On its own page the cursor is the URL's, so a link to /ops/control?sessionId=…
  // lands on that pane and Back walks out of the page, not through the moves.
  const urlCursor = own && URL_HOLDS_CURSOR;
  const cursorId = urlCursor ? routeCursor(route) : null;
  const setCursor = useCallback(
    (id: string | null) => navigate(cursorRoute(id), { replace: true }),
    [navigate],
  );
  const cursor = useMemo(
    () => (urlCursor ? { id: cursorId, set: setCursor } : undefined),
    [cursorId, setCursor, urlCursor],
  );

  return (
    <div ref={root} className="vw-mission-wall">
      <MissionControlView
        navigate={navigate}
        agents={agents}
        keyScope={keyScope}
        idleKeys={own}
        cursor={cursor}
        contextDocked={docked}
        onCursorContext={missionDock.publish}
      />
    </div>
  );
}

export const missionWallModule = defineModule({
  type: "mission-wall",
  title: "Mission wall",
  blurb: "Every live session's raw log on one wall, tiled to stay readable",
  docs: {
    shows: "The status line and Within chips, then one raw log pane per session, most recent first, with a cursor, selection and pin.",
    data: "The tail firehose every 250ms, one backfill, /api/tail/discover every 30s, observe for registered agents; the mission-control store.",
    opens: "Ops › Tail on a session; from the session overlay its conversation, Tail or the agent's profile.",
  },
  size: { w: 6, h: 24 },
  minSize: { w: 4, h: 10 },
  maxPerView: 1,
  Component: MissionWall,
});
