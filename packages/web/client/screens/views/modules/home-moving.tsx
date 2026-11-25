/**
 * What's moving — who is working right now: agents, native sessions and the asks still out.
 *
 * Shows:  working agents, native harness sessions and observed actors active
 *         in the moving window, each with what it is on and when, sorted by
 *         the panel's Sort (kept in this browser, as Home kept it); then asks
 *         still out with no working agent. The count says how many of the
 *         total are on screen. The window widens 30m → 4h → 24h on its own
 *         while nothing shows; a pick in the head holds it for the visit.
 *         Skeleton rows while the first answers are out; a failed first read
 *         says so.
 * Data:   the Home feed (screens/home/use-home-feed.ts), one for every Home
 *         panel: /api/fleet and /api/heartrate on open and on fleet and roster
 *         events (15s net while the event stream is down, 30s while up),
 *         /api/tail/recent and /api/tail/discover every 30s while Scout is in
 *         front. Observe reads for the agents that may be working
 *         (useObservePolling), which is why one fits per view.
 * Scope:  machine: "This page's machine" (the page's ?machineId=, as Home
 *         honoured it) or one machine; "" = every machine.
 * Opens:  a row expands in place; its links open the session (Enter too,
 *         with focus in the list), the agent's page or its terminal. An ask:
 *         its conversation, work item or agent. Off Home, Open full: Home
 *         on this machine.
 */
import { useState } from "react";
import { operatorNameFrom } from "../../home/home-derive.ts";
import { readHomeLayoutHint } from "../../home/home-layout-hint.ts";
import { useHomeMoving, useHomeScope, useLayoutHintWrite } from "../../home/home-panels.tsx";
import { homePanelMachine } from "../../home/home-view.ts";
import { useHomeFeed } from "../../home/use-home-feed.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { HomeOpenFull, homeMachineScope } from "./home-shared.tsx";
import { ModuleHead } from "./ModuleHead.tsx";

function HomeMovingPanel({ route, navigate, config }: ModuleProps) {
  const feed = useHomeFeed();
  const { onboarding } = useScout();
  const machineId = homePanelMachine(route, config);
  const { agents, scopedFleet } = useHomeScope(feed.fleet, machineId);
  const [layoutHint] = useState(readHomeLayoutHint);
  const part = useHomeMoving({ feed, agents, scopedFleet, operatorName: operatorNameFrom(onboarding), navigate, layoutHint });
  useLayoutHintWrite(!feed.loading && feed.gaugesSettled && feed.tailSettled, { moving: part.rows });
  return (
    <div className="vw-home vw-home--moving">
      <ModuleHead>
        {part.count !== undefined && <span className="hud-grid-count">{part.count}</span>}
        {part.right}
        <HomeOpenFull route={route} navigate={navigate} machineId={machineId} />
      </ModuleHead>
      {part.body}
    </div>
  );
}

export const homeMovingModule = defineModule({
  type: "home-moving",
  title: "What's moving",
  blurb: "Who is working right now, and the asks still out",
  docs: {
    shows: "Working agents, native sessions and observed actors in the moving window, sorted as picked, then asks still out with no working agent; the window widens 30m, 4h, 24h while empty.",
    data: "The Home feed: /api/fleet on fleet and roster events (15s / 30s net), /api/tail/recent and /api/tail/discover every 30s while Scout is in front; observe reads for likely-working agents.",
    opens: "A row's session, agent page or terminal; an ask's conversation, work item or agent; off Home, Open full: Home.",
  },
  size: { w: 8, h: 10 },
  // the sort and window segments in the head, and two rows
  minSize: { w: 5, h: 6 },
  scopes: [homeMachineScope],
  // its observe reads are its own, so a second panel would poll twice
  maxPerView: 1,
  // as tall as what it holds, up to its cell
  fit: true,
  Component: HomeMovingPanel,
});
