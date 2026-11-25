/**
 * Recent — the Home rail as a panel: recent agents and recent Scout coordination.
 *
 * Shows:  Recent agents: the most recently active, one row per session with
 *         its state and when, harness, name (the session's own, else a
 *         generated id as it is, not title-cased into a name), what it was
 *         asked when the fleet still holds it, project and branch, and model;
 *         What's moving's columns when the panel is wide, stacked in the rail;
 *         and "all". Recent Scout coordination: the fleet's last four
 *         messages and dispatches, one row per event, each with when, and
 *         "all"; left out on Home, whose Coordination panel leads with the
 *         same rows. On the page's ?machineId=, only that machine's agents
 *         and their traffic, as the rail showed it on Activity and Briefings.
 * Data:   useScout().agents; loadFleet() (GET /api/fleet, the shared fleet
 *         store), warm from a read under 30s old, then on open and on fleet
 *         events (screens/home/left.tsx, uncut).
 * Scope:  none; the page's ?machineId= narrows it.
 * Opens:  an agent's page (Back returns here); a coordination item's
 *         conversation, else its agent, else Activity; "all": Agents or
 *         Activity.
 */
import { HomeLeft } from "../../home/left.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import "./briefings-panels.css";

function HomeRecent({ route, navigate }: ModuleProps) {
  // Home (drawn on the "inbox" route) has the Coordination panel, which
  // already leads with these rows; say them once. Agents are then the only
  // section, so the panel head names them and carries All, as Show all sits
  // on Subscriptions & quotas.
  const onHome = route.view === "inbox";
  return (
    <div className="vw-home-recent">
      {onHome && (
        <ModuleHead>
          <button type="button" className="hd-gauge-toggle" onClick={() => navigate({ view: "agents-v2" })}>
            All
          </button>
        </ModuleHead>
      )}
      <HomeLeft activity={!onHome} agentsLabel={!onHome} />
    </div>
  );
}

export const homeRecentModule = defineModule({
  type: "home-recent",
  title: "Recent",
  blurb: "Recent agents and Scout coordination, as the Home rail lists them",
  docs: {
    shows: "The most recently active agents, one row per session: state and when, harness, name, what it was asked, project and branch, and model; and (off Home, which has Coordination) the fleet's last four messages and dispatches, each with All.",
    data: "useScout().agents; loadFleet() (GET /api/fleet), on open and on fleet events; the page's ?machineId= narrows both.",
    opens: "An agent's page; a coordination item's conversation or agent; All: Agents or Activity.",
  },
  size: { w: 4, h: 10 },
  // both section labels and a row of each still fit
  minSize: { w: 3, h: 6 },
  // as tall as what it holds, up to its cell; filling, it takes its column's room and lists more agents
  fit: true,
  grow: true,
  Component: HomeRecent,
});
