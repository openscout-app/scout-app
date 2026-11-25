/**
 * Lanes roster — the lanes on the deck, in the deck's order: Ops › Lanes' left rail as a panel.
 *
 * Shows:  Lanes with a count, then one row per column the deck drew (pinned
 *         left, live, pinned right): the lane's name, its harness or
 *         status, its state and when it last wrote. No active lanes when the
 *         deck has none. Without a Lanes deck on the view: a line saying the
 *         deck fills it.
 * Data:   the roster the deck publishes as it draws (lane-roster-store.ts),
 *         so the count and the order always match the deck; until its first
 *         draw, the fleet's live agents (useScout().agents).
 * Scope:  none; one per view, since it mirrors the one deck.
 * Opens:  a row: that lane on the deck, scrolled into view and focused (a
 *         lane off the deck's edge included); a registered agent with no
 *         column: its profile.
 */
import { OpsLanesLeft } from "../../ops/left-lanes.tsx";
import "../../../scout/slots/ctx-panel.css";
import { defineModule, type ModuleProps } from "./contract.ts";
import { useDeckOnView } from "./lanes-shared.ts";
import { Quiet } from "./shared.tsx";
import "./lanes-panels.css";

function LanesRoster(_props: ModuleProps) {
  const decked = useDeckOnView();
  return (
    <div className="vw-lanes-roster">
      {decked ? (
        <OpsLanesLeft />
      ) : (
        <Quiet>Lists the lanes on the Lanes deck. Add the deck to this view to fill it.</Quiet>
      )}
    </div>
  );
}

export const lanesRosterModule = defineModule({
  type: "lanes-roster",
  title: "Lanes roster",
  blurb: "The lanes on the deck in its order, each a jump to its column",
  docs: {
    shows: "Lanes with a count, then one row per column the deck drew: name, harness or status, state and when it last wrote.",
    data: "The roster the Lanes deck publishes as it draws; the fleet's live agents until its first draw.",
    opens: "A row: that lane on the deck, scrolled into view and focused; else the agent's profile.",
  },
  size: { w: 2, h: 28 },
  minSize: { w: 2, h: 8 },
  maxPerView: 1,
  Component: LanesRoster,
});
