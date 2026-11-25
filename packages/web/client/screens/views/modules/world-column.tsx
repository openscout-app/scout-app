import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { Quiet } from "./shared.tsx";
import { worldDock } from "./world-dock.ts";
import { columnNote, type WorldSide } from "./world-panels-model.ts";
import "./world-panels.css";

/*
 * One of the World HUD's side columns, drawn in a panel. The column is the
 * engine's own markup, moved here by world-dock.ts; its host holds no React
 * children, so the move never fights React. world-readouts.tsx and
 * world-details.tsx are the two sides.
 */
export function WorldColumn({ side }: { side: WorldSide }) {
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => worldDock.mountColumn(side, host.current!), [side]);
  const dock = useSyncExternalStore(worldDock.subscribe, worldDock.get, worldDock.get);
  const note = columnNote({ stage: dock.stages > 0, ready: dock.ready[side], place: dock.placement[side], side });
  return (
    <div className="vw-world-column">
      {note && <Quiet>{note}</Quiet>}
      <div ref={host} className="vw-world-column-host" />
    </div>
  );
}
