/**
 * Agents (world-readouts) — the World HUD's left column, beside the world: Ops › World's left column as a panel.
 *
 * Shows:  the HUD's left column as the page draws it: FLEET REPLAY, QUOTA ·
 *         CACHE, ASKS · OUTCOMES, TIME TO DONE, ROSTER and LANES ·
 *         WORKSPACES, each with its keys, fold and focus, all at the
 *         World's playhead. Without a World panel on the view it says so;
 *         while the World panel is in full view the column draws there.
 * Data:   none of its own: the World panel's engine paints it (world-dock.ts
 *         hands the column over).
 * Scope:  none; one per view. Follows the World panel's source and dataset.
 *         Keys are the HUD's while focus is in this panel.
 * Opens:  what the HUD opens: a roster or lane row focuses it in the world;
 *         an ask opens in the Inspector (or the HUD's own inspector).
 */
import { defineModule, type ModuleProps } from "./contract.ts";
import { WorldColumn } from "./world-column.tsx";

function WorldReadouts(_props: ModuleProps) {
  return <WorldColumn side="left" />;
}

export const worldReadoutsModule = defineModule({
  type: "world-readouts",
  title: "Agents",
  blurb: "Overview's left column, the agents at the playhead: replay, quota and cache, outcomes, time to done, roster, lanes",
  docs: {
    shows: "The Overview HUD's left column: Fleet replay, Quota · cache, Asks · outcomes, Time to done, Roster, Lanes · workspaces, at the playhead.",
    data: "None of its own: the Overview panel's engine paints it.",
    opens: "What the HUD opens: rows focus the scene; asks open in the Inspector.",
  },
  size: { w: 3, h: 24 },
  minSize: { w: 3, h: 16 },
  maxPerView: 1,
  Component: WorldReadouts,
});
