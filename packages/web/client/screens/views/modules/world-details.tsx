/**
 * Inspector (world-details) — the World HUD's right column, where what you open lands: Ops › World's right column as a panel.
 *
 * Shows:  the HUD's right column as the page draws it: CODE · WORKTREES ·
 *         PRS · DIFFS, FILES or RUNTIME LOG, and MESH, and over them whatever the world
 *         opens: INSPECT (the trail of what you unpacked), the STASH and the
 *         file or site preview. Without a World panel on the view it says
 *         so; while the World panel is in full view the column draws there.
 * Data:   none of its own: the World panel's engine paints it (world-dock.ts
 *         hands the column over); previews read /api/ops/world-file, the
 *         stash /api/ops/world-stash, through the engine.
 * Scope:  none; one per view. Follows the World panel's source and dataset.
 *         Keys are the HUD's while focus is in this panel.
 * Opens:  what the HUD opens: files and sites in the preview here (P lifts it
 *         over the world), reveal and open through /api/ops/world-file.
 */
import { defineModule, type ModuleProps } from "./contract.ts";
import { WorldColumn } from "./world-column.tsx";

function WorldDetails(_props: ModuleProps) {
  return <WorldColumn side="right" />;
}

export const worldDetailsModule = defineModule({
  type: "world-details",
  title: "Details",
  blurb: "Overview's right column: code, recent files or the runtime log, and mesh; inspect, stash and previews open here",
  docs: {
    shows: "The Overview HUD's right column: Code · worktrees · PRs · diffs, Files (most recent at the playhead) or the Runtime log, Mesh, and over them Inspect, the Stash and file or site previews.",
    data: "None of its own: the Overview panel's engine paints it; previews and the stash read /api/ops/world-file and /api/ops/world-stash.",
    opens: "Files and sites in its preview; reveal and open through /api/ops/world-file.",
  },
  size: { w: 3, h: 24 },
  minSize: { w: 3, h: 16 },
  maxPerView: 1,
  Component: WorldDetails,
});
