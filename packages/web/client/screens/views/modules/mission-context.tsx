/**
 * Session context — the reading of the session under the Mission wall's cursor, beside the wall.
 *
 * Shows:  the session's name, where it runs and when it last wrote; what it is
 *         executing now (or its last action); its stats and context gauge;
 *         model, branch, cwd, session and log; the files it touched and its
 *         recent commands. Expand, Tail ↗, Session ↗. It follows the cursor
 *         as hjkl moves it. With no wall on the view, no cursor yet, or a
 *         session that has not written: a line saying which.
 * Data:   the wall's cursor reading through mission-dock.ts: the session's log
 *         and lane (the registered agent's observe, else rebuilt from the
 *         tail). While this panel is on the view the wall draws no rail of
 *         its own.
 * Scope:  none; one per view. It reads the wall's cursor, which on
 *         Ops › Control is the page's.
 * Opens:  Expand: the session overlay on the wall. Tail ↗: Ops › Tail on the
 *         session. Session ↗: /sessions/<id>. A touched file: the file preview.
 */
import { useLayoutEffect, useSyncExternalStore } from "react";
import { setMissionFocusedId } from "../../../lib/mission-control-store.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { MissionContextRail } from "../../ops/MissionContextRail.tsx";
import "../../ops/mission-control.css";
import "../../ops/ops-screen.css";
import { defineModule, type ModuleProps } from "./contract.ts";
import { missionDock } from "./mission-dock.ts";
import { missionContextState } from "./mission-panels-model.ts";
import { Quiet } from "./shared.tsx";
import "./mission-panels.css";

function MissionContext({ navigate }: ModuleProps) {
  const { openFilePreview } = useScout();
  useLayoutEffect(() => missionDock.dock(), []);
  const dock = useSyncExternalStore(missionDock.subscribe, missionDock.get, missionDock.get);
  const state = missionContextState(dock);

  if (state.kind === "no-wall") {
    return <Quiet>Reads the session under the Mission wall's cursor. Add the wall to this view to fill it.</Quiet>;
  }
  if (state.kind === "no-cursor") {
    return <Quiet>Move onto a pane on the wall (hjkl or arrows), or click one, to read it here.</Quiet>;
  }
  if (state.kind === "off-wall") {
    return <Quiet>Nothing on the wire for session {state.sessionId.slice(0, 8)} yet.</Quiet>;
  }

  const { log, lane } = state;
  return (
    <div className="vw-mission-context">
      <div className="s-wall">
        <MissionContextRail
          variant="panel"
          log={log}
          lane={lane}
          onExpand={() => setMissionFocusedId(log.id)}
          onTail={() => navigate({ view: "ops", mode: "tail", tailQuery: log.sessionId })}
          onOpenLog={() => navigate({ view: "sessions", sessionId: log.sessionId })}
          onOpenFile={openFilePreview}
        />
      </div>
    </div>
  );
}

export const missionContextModule = defineModule({
  type: "mission-context",
  title: "Session context",
  blurb: "The session under the Mission wall's cursor: what it is doing, its stats, files and commands",
  docs: {
    shows: "The cursor's session: executing now or last action, stats and context gauge, runtime facts, touched files, recent commands.",
    data: "The Mission wall's cursor reading (mission-dock.ts): the session's log and lane, from observe or the tail.",
    opens: "Expand: the session overlay. Tail ↗: Ops › Tail. Session ↗: /sessions/<id>. A file: the file preview.",
  },
  size: { w: 3, h: 14 },
  minSize: { w: 3, h: 10 },
  maxPerView: 1,
  Component: MissionContext,
});
