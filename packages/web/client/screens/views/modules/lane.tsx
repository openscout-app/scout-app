/**
 * Lane — one lane read whole, beside the Lanes deck: the lane sheet as a panel.
 *
 * Shows:  the lane's head (avatar, name, where it runs, when it last wrote,
 *         its harness; Open session, Agent profile, Traces, the terminal
 *         hop, Pin project), the section anchors (Vitals, Runtime, Files,
 *         Commands, Plans, Docs), then Vitals (what it is executing now or
 *         its last action, the context gauge, cadence, compaction), Runtime,
 *         the files it touched with their diffs, its recent commands, and the
 *         plans and docs that match its session. Head: Clear while it shows a
 *         pick; Unpin when pinned to one lane. With no deck on the view,
 *         nothing picked, or a lane not built in the deck's window: a line
 *         saying which.
 * Data:   the lanes the deck beside it built (lane-dock.ts), so the tail is
 *         read once per view; /api/plan-documents per lane for its plans and
 *         docs.
 * Scope:  Lane. "This page's lane" follows Ops › Lanes' ?sessionId= (once the
 *         router keeps it; until then, and off that page, the deck's pick);
 *         "The deck's pick"; or one lane, pinned (two pinned panels read two
 *         lanes side by side). o, t and p read only with focus in the panel.
 * Opens:  Open session (o): the session. Agent profile (p): the agent. Traces
 *         (t): its trace. The terminal hop, a touched file in the preview, a
 *         plan or doc in Host Advisor. Back returns here, the lane still
 *         picked.
 */
import { useLayoutEffect, useMemo } from "react";
import { usePanelContent } from "../../../components/hud-grid/HudGrid.tsx";
import { laneProjectPath } from "../../ops/agent-lane-detail.ts";
import { AgentLaneDetailSheet } from "../../ops/AgentLaneDetailSheet.tsx";
import { laneContextLabel, lanePrimaryLabel } from "../../ops/agent-lanes-model.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { laneDock } from "./lane-dock.ts";
import { isLanesRoute, lanePanelContent, lanePanelState, laneRoute, panelLane, showsPicks } from "./lanes-panel-model.ts";
import { URL_HOLDS_LANE, useDeckLanes, useLaneDock } from "./lanes-shared.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { usePanelKeyScope } from "./panel-scope.ts";
import { Quiet } from "./shared.tsx";
import "./lanes-panels.css";

// Navigating from the lane (its session, profile, traces) closes nothing in a
// panel: the route it opened is the new entry, and Back finds the lane still here.
const STAYS = () => {};

function short(id: string): string {
  const tail = id.split(":").pop() ?? id;
  return tail.length > 12 ? `${tail.slice(0, 12)}…` : tail;
}

function LanePanel({ route, navigate, config, setConfig }: ModuleProps) {
  const { root, keyScope } = usePanelKeyScope();
  const dock = useLaneDock();
  const shown = panelLane(route, config.lane, dock.pick, URL_HOLDS_LANE);
  const follows = showsPicks(shown.source);
  // count in while this panel shows picks, so the deck sends them here instead of its sheet
  useLayoutEffect(() => (follows ? laneDock.follow() : undefined), [follows]);
  const state = lanePanelState(dock, shown);
  const reading = dock.reading;
  const lane = state.kind === "ready" ? state.lane : null;
  const projectPath = useMemo(() => (lane ? laneProjectPath(lane) : null), [lane]);
  // no lane to read: the grid folds the panel to its head row until one is picked
  usePanelContent(lanePanelContent(state, (l) => lanePrimaryLabel(l.agent, l.source)));

  const clear = () => {
    laneDock.pick(null);
    if (shown.source === "page") navigate(laneRoute(null), { replace: true });
  };

  const latest = state.kind === "ready" && state.latest === true;

  const head = (
    <ModuleHead>
      {latest ? (
        <span className="hud-grid-count" title="Nothing is open on the deck, so this reads the lane that wrote last. Open a lane on the deck (click its card, or Enter or i on it) to read it here.">
          Wrote last
        </span>
      ) : null}
      {shown.source !== "pinned" && shown.id ? (
        <button type="button" className="vw-chip" onClick={clear} title="Let go of this lane">
          Clear
        </button>
      ) : null}
      {shown.source === "pinned" ? (
        <button type="button" className="vw-chip" onClick={() => setConfig({ lane: "" })} title="Show the lane the deck picks instead">
          Unpin
        </button>
      ) : null}
    </ModuleHead>
  );

  let body;
  if (state.kind === "no-deck") {
    body = <Quiet>Reads the lane picked on the Lanes deck. Add the deck to this view to fill it.</Quiet>;
  } else if (state.kind === "no-pick") {
    body = <Quiet>No lanes in the deck's window. The next lane to write shows here.</Quiet>;
  } else if (state.kind === "not-live") {
    body = (
      <Quiet>
        No lane for {short(state.id)} in the deck's last {state.horizonLabel}. It may have ended: widen the deck's window to look further back.
      </Quiet>
    );
  } else if (lane && reading) {
    body = (
      <AgentLaneDetailSheet
        key={lane.id}
        presentation="panel"
        lane={lane}
        navigate={navigate}
        returnRoute={route}
        navigationEnabled={reading.navigationEnabled}
        onClose={STAYS}
        onPinProject={reading.pinProject}
        projectPinned={projectPath ? reading.projectPinned(projectPath) : false}
        keyScope={keyScope}
        // the section anchors' #hash belongs to the Lanes page
        syncHash={isLanesRoute(route)}
      />
    );
  }

  return (
    <div ref={root} className="vw-lane">
      {head}
      {body}
    </div>
  );
}

/** Lane: the page's (Ops › Lanes ?sessionId=), the deck's pick, or one lane pinned. */
const laneScope: ModuleScope = {
  key: "lane",
  allLabel: "The deck's pick",
  followsPage: "This page's lane",
  useOptions: () => {
    const lanes = useDeckLanes();
    return useMemo(
      () => lanes.map((lane) => ({
        value: lane.id,
        label: `${lanePrimaryLabel(lane.agent, lane.source)} · ${laneContextLabel(lane.agent, lane.source)}`,
      })),
      [lanes],
    );
  },
};

export const laneModule = defineModule({
  type: "lane",
  title: "Lane",
  blurb: "One lane read whole beside the deck: vitals, runtime, files, commands, plans and docs",
  docs: {
    shows: "The lane's head and its actions, the section anchors, then Vitals, Runtime, touched files with diffs, recent commands, and the plans and docs that match its session.",
    data: "The lanes the deck beside it built (lane-dock.ts); /api/plan-documents per lane.",
    opens: "Its session (o), agent profile (p), traces (t), the terminal hop, a file preview, a plan or doc in Ops › In flight.",
  },
  size: { w: 4, h: 14 },
  // the head, the anchors and the start of Vitals still fit
  minSize: { w: 3, h: 8 },
  scopes: [laneScope],
  Component: LanePanel,
});
