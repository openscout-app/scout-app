/**
 * Flights — every flight one work item ran, and where each delivery stands.
 *
 * Shows:  each flight, active first: the agent (Run marks the work item's
 *         own ask), its state and when it started or ended; then its
 *         delivery (queued until online, not delivered yet, delivery unknown,
 *         or delivered to its session), a note when the asker stopped
 *         waiting, and its summary. Then the work item's child work, open
 *         first. The count in the head.
 *         Head: Open full, and Unpin when pinned to one.
 * Data:   the work item's detail, GET /api/work/:id, shared with every Work
 *         panel on the page (warm under 30s, once per burst of broker
 *         events). On the page's ?machineId=, only that machine's flights.
 * Scope:  Work item, by id. "This page's work item" follows /work/:id.
 * Opens:  a flight: its session, observed (/flights/:id/observe); Chat: its
 *         conversation; a child: that work item; Open full: /work/:id.
 */
import { useMemo } from "react";
import { filterWorkDetailByMachineScope } from "../../../lib/machine-scope.ts";
import { timeAgo } from "../../../lib/time.ts";
import { openContent } from "../../../scout/slots/openContent.ts";
import { useWorkDetail } from "../../work/use-work-detail.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import { usePanelWork, WorkPanelEmpty, WorkPanelHead, workScope } from "./work-shared.tsx";
import { workChildRows, workFlightRows, workRoute, workRowMark } from "./work-view-model.ts";

function stateText(state: string): string {
  const text = state.replace(/_/g, " ");
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function WorkFlights({ route, navigate, config, setConfig }: ModuleProps) {
  const work = usePanelWork(route, config);
  const { detail, error, loaded } = useWorkDetail(work.workId);
  const scoped = useMemo(() => (detail ? filterWorkDetailByMachineScope(detail, work.agentIds) : null), [detail, work.agentIds]);
  const flights = useMemo(() => (detail && scoped ? workFlightRows(detail, work.agentIds) : []), [detail, scoped, work.agentIds]);
  const children = useMemo(() => (scoped ? workChildRows(scoped) : []), [scoped]);

  if (!work.workId) return <WorkPanelEmpty work={work} />;
  const head = <WorkPanelHead route={route} navigate={navigate} setConfig={setConfig} work={work} />;
  if (!loaded) return <>{head}<Quiet>Reading flights…</Quiet></>;
  if (!detail) return <>{head}<Quiet>{error ? "Work item not found." : "Reading flights…"}</Quiet></>;
  if (!scoped) return <>{head}<Quiet>This work item is outside this machine scope.</Quiet></>;

  return (
    <div className="vw-work vw-work-flights">
      {head}
      <ModuleHead>
        <span className="hud-grid-count" title={`${flights.length} flights`}>{flights.length}</span>
      </ModuleHead>
      {flights.length === 0 ? (
        <Quiet>No flights yet.</Quiet>
      ) : (
        <ul className="vw-rows vw-work-list" aria-label="Flights">
          {flights.map((flight) => (
            <li key={flight.id} className="vw-work-flight" data-active={flight.active || undefined}>
              <button
                type="button"
                className="vw-row vw-row--flight"
                onClick={() => openContent(navigate, flight.open, { returnTo: route })}
                title={`Observe ${flight.agentLabel}'s session for this flight`}
              >
                <span className="vw-strong vw-ell">
                  {flight.primary && <span className="vw-kind">Run</span>} {flight.agentLabel}
                </span>
                <span className="vw-dim vw-ell">{stateText(flight.state)}</span>
                <span className="vw-dim vw-num" title={flight.completedAt ? "Ended" : "Started"}>
                  {flight.completedAt ? timeAgo(flight.completedAt) : flight.startedAt ? timeAgo(flight.startedAt) : ""}
                </span>
                {(flight.delivery || flight.waitNote || flight.summary) && (
                  <span className="vw-work-flight-note">
                    {flight.delivery && <span className="vw-muted">{flight.delivery}</span>}
                    {flight.waitNote && <span className="vw-muted">{flight.waitNote}</span>}
                    {flight.summary && <span className="vw-dim vw-ell">{flight.summary}</span>}
                  </span>
                )}
              </button>
              {flight.conversationId && (
                <button
                  type="button"
                  className="vw-chip vw-work-chat"
                  onClick={() => openContent(navigate, { view: "conversation", conversationId: flight.conversationId! }, { returnTo: route })}
                  title="Open this flight's chat"
                >
                  Chat
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {children.length > 0 && (
        <>
          <div className="vw-work-sub">Child work</div>
          <ul className="vw-rows vw-work-list" aria-label="Child work">
            {children.map((child) => {
              const mark = workRowMark(child);
              return (
                <li key={child.id}>
                  <button
                    type="button"
                    className="vw-row vw-row--work"
                    onClick={() => openContent(navigate, workRoute(child.id), { returnTo: route })}
                    title="Open this work item"
                  >
                    <span className="vw-strong vw-ell">{child.title}</span>
                    <span className={mark ? "vw-kind vw-ell" : "vw-dim vw-ell"}>{mark ?? child.currentPhase}</span>
                    <span className="vw-dim vw-ell">{child.ownerName ?? child.ownerId ?? "Unassigned"}</span>
                    <span className="vw-dim vw-num">{timeAgo(child.lastMeaningfulAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export const workFlightsModule = defineModule({
  type: "work-flights",
  title: "Flights",
  blurb: "Every flight one work item ran, its delivery, and its child work",
  docs: {
    shows: "Each flight, active first: agent, state, when, delivery, a wait note and summary; then child work.",
    data: "/api/work/:id, shared by every Work panel; the page's ?machineId= narrows flights.",
    opens: "A flight: its observed session; Chat: its conversation; a child: that work item; Open full: /work/:id.",
  },
  size: { w: 3, h: 12 },
  minSize: { w: 3, h: 5 },
  scopes: [workScope],
  Component: WorkFlights,
});
