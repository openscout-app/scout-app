/**
 * Lanes — every working session as a lane, side by side: Ops › Lanes' deck as a panel.
 *
 * Shows:  the bar (live and pinned counts, the trace window, the filter, the
 *         layout: Lanes · Grid · Floor; grid columns; + Lane: Needs
 *         attention, Codex, Claude, Grok and Kimi sessions, Clear pinned
 *         lanes; the window chips), roster issues, then one lane per working
 *         session (its card, summary and trace), pinned lanes at the edges.
 *         Before the first lane: the pre-flight deck and its loading sheet;
 *         the tail down: Retry; nothing live: Look back, Show attention, Pin
 *         Codex sessions. The fleet roll call while summaries are spoken.
 * Data:   the tail (live socket with transcript replay, /api/tail/discover
 *         every 60s), terminal sessions every 10s, observe polling for
 *         registered agents, a 10s clock; the deck's pins and widths in
 *         localStorage per profile; window, layout, grid columns and scroll
 *         in sessionStorage, as the page kept them. It publishes its lanes to
 *         a Lane panel through lane-dock.ts and its columns to the Lanes
 *         roster.
 * Scope:  Project and Harness narrow the deck, as the embed's ?project= and
 *         ?harness= do. One per view. Keys (1–4 window, j/k and arrows, g/G,
 *         Enter or i, p) read from anywhere on Ops › Lanes and only with
 *         focus in the panel elsewhere.
 * Opens:  a lane (its card, Enter or i): in the Lane panel beside the deck
 *         (on Ops › Lanes: ?sessionId=, once the router keeps it), else the
 *         lane sheet over the deck, with its session, profile, traces,
 *         terminal, plans and docs. A trace event: its trace sheet. Floor:
 *         Ops › Fleet.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useGridFullView } from "../../../components/hud-grid/HudGrid.tsx";
import { harnessLabel } from "../../../components/HarnessMark.tsx";
import { useScout } from "../../../scout/Provider.tsx";
import type { AgentLane } from "../../ops/agent-lanes-model.ts";
import { AgentLanesView } from "../../ops/AgentLanesView.tsx";
import { FleetRollCallHud } from "../../ops/FleetRollCallHud.tsx";
import "../../ops/ops-screen.css";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { laneDock } from "./lane-dock.ts";
import {
  isLanesRoute,
  laneForSelection,
  laneHarnessValues,
  laneProjectOptions,
  laneRoute,
  pickTarget,
  routeLane,
} from "./lanes-panel-model.ts";
import { URL_HOLDS_LANE, useDeckLanes } from "./lanes-shared.ts";
import { usePanelKeyScope } from "./panel-scope.ts";
import "./lanes-panels.css";

function selector(laneId: string): string {
  return `[data-lane-id="${laneId.replace(/["\\]/g, "\\$&")}"]`;
}

function LanesDeck({ route, navigate, config }: ModuleProps) {
  const { agents } = useScout();
  const { root, keyScope } = usePanelKeyScope();
  const own = isLanesRoute(route);
  const fullView = useGridFullView();

  useLayoutEffect(() => laneDock.mountDeck(), []);

  // A lane opened on the deck goes to a Lane panel beside it when one shows
  // picks; in full view, or with none, the sheet opens over the deck as before.
  const pickLane = useCallback((lane: AgentLane) => {
    const target = pickTarget(laneDock.get(), fullView === "self", own, URL_HOLDS_LANE);
    if (target === "sheet") return false;
    laneDock.pick(lane.id);
    if (target === "url") navigate(laneRoute(lane.id), { replace: true });
    return true;
  }, [fullView, navigate, own]);

  // A link to /ops/lanes?sessionId=… brings that lane into view once the deck has built it.
  const pageLane = own && URL_HOLDS_LANE ? routeLane(route) : null;
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!pageLane || revealed.current === pageLane) return;
    const reveal = () => {
      const lanes = laneDock.get().reading?.lanes;
      const lane = lanes ? laneForSelection(lanes, pageLane) : null;
      const node = lane ? root.current?.querySelector<HTMLElement>(selector(lane.id)) : null;
      if (!node) return false;
      revealed.current = pageLane;
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
      return true;
    };
    if (reveal()) return;
    const stop = laneDock.subscribe(() => {
      if (reveal()) stop();
    });
    return stop;
  }, [pageLane, root]);

  return (
    <div ref={root} className="vw-lanes">
      <FleetRollCallHud />
      <AgentLanesView
        navigate={navigate}
        agents={agents}
        harnessFilter={config.harness || null}
        projectFilter={config.project || null}
        keyScope={keyScope}
        idleKeys={own}
        returnRoute={route}
        onPickLane={pickLane}
        onReading={laneDock.publish}
      />
    </div>
  );
}

/** Project, by folder name, from the lanes the deck built. */
const projectScope: ModuleScope = {
  key: "project",
  allLabel: "All projects",
  useOptions: () => {
    const lanes = useDeckLanes();
    return useMemo(() => laneProjectOptions(lanes), [lanes]);
  },
};

/** Harness, from the lanes the deck built. */
const harnessScope: ModuleScope = {
  key: "harness",
  allLabel: "Any harness",
  useOptions: () => {
    const lanes = useDeckLanes();
    return useMemo(() => laneHarnessValues(lanes).map((value) => ({ value, label: harnessLabel(value) })), [lanes]);
  },
};

export const lanesModule = defineModule({
  type: "lanes",
  title: "Lanes",
  blurb: "Every working session as a lane, side by side, with pins, widths and a trace window",
  docs: {
    shows: "The deck's bar (counts, layout, + Lane, window chips), roster issues, then one lane per working session with its card, summary and trace; pinned lanes at the edges.",
    data: "The tail with transcript replay, /api/tail/discover every 60s, terminal sessions every 10s, observe for registered agents; the deck in localStorage, the window and layout in sessionStorage.",
    opens: "A lane in the Lane panel beside it (?sessionId= on Ops › Lanes), else the lane sheet; a trace event's sheet; Floor: Ops › Fleet.",
  },
  size: { w: 6, h: 28 },
  // one lane card and its trace still fit
  minSize: { w: 3, h: 12 },
  scopes: [projectScope, harnessScope],
  maxPerView: 1,
  Component: LanesDeck,
});
