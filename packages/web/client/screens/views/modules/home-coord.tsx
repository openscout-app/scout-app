/**
 * Scout coordination — the fleet's messages and dispatches in the window, newest first.
 *
 * Shows:  each message or dispatch with when, who (a generated id as it is,
 *         in mono), what kind and the text; under the last row, the window's
 *         shape said once: how many events (or the cap when it is hit), the
 *         longest gap, and "widen to" the next window. The
 *         window widens 30m → 6h → 24h on its own while empty; the Lookback
 *         segments in the head hold one for the visit. An empty 24h says so
 *         quietly; a failed read offers Retry.
 * Data:   the Home feed (screens/home/use-home-feed.ts), one for every Home
 *         panel: /api/fleet with the window's activity limit, on open and on
 *         fleet and roster events (15s net while the event stream is down,
 *         30s while up). The window is the feed's, so every coordination
 *         panel shows the same one and none reads on its own.
 * Scope:  machine: "This page's machine" (the page's ?machineId=) or one
 *         machine; "" = every machine.
 * Opens:  a row: its conversation, else its work item, else its agent. Off
 *         Home, Open full: Home on this machine.
 */
import { useState } from "react";
import { readHomeLayoutHint } from "../../home/home-layout-hint.ts";
import { useHomeCoordination, useHomeScope, useLayoutHintWrite } from "../../home/home-panels.tsx";
import { homePanelMachine } from "../../home/home-view.ts";
import { useHomeFeed } from "../../home/use-home-feed.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { HomeOpenFull, homeMachineScope } from "./home-shared.tsx";
import { ModuleHead } from "./ModuleHead.tsx";

function HomeCoordPanel({ route, navigate, config }: ModuleProps) {
  const feed = useHomeFeed();
  const machineId = homePanelMachine(route, config);
  const { scopedFleet } = useHomeScope(feed.fleet, machineId);
  const [layoutHint] = useState(readHomeLayoutHint);
  const part = useHomeCoordination({ feed, scopedFleet, navigate, layoutHint });
  useLayoutHintWrite(!feed.loading && feed.gaugesSettled && feed.tailSettled, {
    activity: part.rows,
    lookback: part.settledLookback ?? undefined,
  });
  return (
    <div className="vw-home vw-home--coord">
      <ModuleHead>
        {part.count !== undefined && <span className="hud-grid-count">{part.count}</span>}
        {part.right}
        <HomeOpenFull route={route} navigate={navigate} machineId={machineId} />
      </ModuleHead>
      {part.body}
    </div>
  );
}

export const homeCoordModule = defineModule({
  type: "home-coord",
  title: "Scout coordination",
  blurb: "The fleet's messages and dispatches in the window, newest first",
  docs: {
    shows: "Each message and dispatch with when, who, kind and text, then the window's shape once (count or cap, longest gap, widen to); the window widens 30m, 6h, 24h while empty, or holds a pick.",
    data: "The Home feed: /api/fleet with the window's activity, on fleet and roster events (15s / 30s net); one window for every coordination panel.",
    opens: "A row's conversation, else its work item, else its agent; off Home, Open full: Home.",
  },
  size: { w: 8, h: 10 },
  // the lookback segments in the head, two rows and the shape line
  minSize: { w: 4, h: 6 },
  scopes: [homeMachineScope],
  // as tall as what it holds, up to its cell
  fit: true,
  Component: HomeCoordPanel,
});
