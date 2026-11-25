/**
 * Participants — everyone on one work item, and what part each played.
 *
 * Shows:  one row per person, by role: who owns it, whose move it is, who
 *         asked, who ran it, and who wrote on its timeline; how many events
 *         and flights each has, and when each last moved. The operator is
 *         listed as You (or their name). The count in the head.
 *         Head: Open full, and Unpin when pinned to one.
 * Data:   the work item's detail, GET /api/work/:id, shared with every Work
 *         panel on the page (warm under 30s, once per burst of broker events).
 * Scope:  Work item, by id. "This page's work item" follows /work/:id.
 * Opens:  an agent: their profile; the operator: nothing; Open full: /work/:id.
 */
import { useMemo } from "react";
import { filterWorkDetailByMachineScope } from "../../../lib/machine-scope.ts";
import { timeAgo } from "../../../lib/time.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { openContent } from "../../../scout/slots/openContent.ts";
import { useWorkDetail } from "../../work/use-work-detail.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import { usePanelWork, WorkPanelEmpty, WorkPanelHead, workScope } from "./work-shared.tsx";
import { workParticipants, type WorkParticipant } from "./work-view-model.ts";

function tally(person: WorkParticipant): string {
  const parts = [
    person.events > 0 ? `${person.events} ${person.events === 1 ? "event" : "events"}` : null,
    person.flights > 0 ? `${person.flights} ${person.flights === 1 ? "flight" : "flights"}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

function PersonRow({ person }: { person: WorkParticipant }) {
  return (
    <>
      <span className="vw-strong vw-ell">{person.label}</span>
      <span className="vw-dim vw-ell">{person.roles.join(" · ")}</span>
      <span className="vw-dim vw-num">{person.lastAt ? timeAgo(person.lastAt) : ""}</span>
      {tally(person) && <span className="vw-work-person-note vw-dim">{tally(person)}</span>}
    </>
  );
}

function WorkPeople({ route, navigate, config, setConfig }: ModuleProps) {
  const work = usePanelWork(route, config);
  const { operatorName } = useScout();
  const { detail, error, loaded } = useWorkDetail(work.workId);
  const scoped = useMemo(() => (detail ? filterWorkDetailByMachineScope(detail, work.agentIds) : null), [detail, work.agentIds]);
  const people = useMemo(() => (scoped ? workParticipants(scoped, operatorName) : []), [operatorName, scoped]);

  if (!work.workId) return <WorkPanelEmpty work={work} />;
  const head = <WorkPanelHead route={route} navigate={navigate} setConfig={setConfig} work={work} />;
  if (!loaded) return <>{head}<Quiet>Reading participants…</Quiet></>;
  if (!detail) return <>{head}<Quiet>{error ? "Work item not found." : "Reading participants…"}</Quiet></>;
  if (!scoped) return <>{head}<Quiet>This work item is outside this machine scope.</Quiet></>;
  if (people.length === 0) return <>{head}<Quiet>No one on this work item yet.</Quiet></>;

  return (
    <>
      {head}
      <ModuleHead>
        <span className="hud-grid-count" title={`${people.length} participants`}>{people.length}</span>
      </ModuleHead>
      <ul className="vw-rows" aria-label="Participants">
        {people.map((person) => (
          <li key={person.id}>
            {person.operator ? (
              <div className="vw-row vw-row--person">
                <PersonRow person={person} />
              </div>
            ) : (
              <button
                type="button"
                className="vw-row vw-row--person"
                onClick={() => openContent(navigate, { view: "agents-v2", agentId: person.id }, { returnTo: route })}
                title={`Open ${person.label}'s profile`}
              >
                <PersonRow person={person} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export const workPeopleModule = defineModule({
  type: "work-people",
  title: "Participants",
  blurb: "Everyone on one work item: owner, next move, asker, runners, writers",
  docs: {
    shows: "One row per person by role (owner, next move, asked, ran, wrote), their events and flights, and when they last moved.",
    data: "/api/work/:id, shared by every Work panel.",
    opens: "An agent: their profile; the operator: nothing; Open full: /work/:id.",
  },
  size: { w: 3, h: 12 },
  minSize: { w: 3, h: 5 },
  scopes: [workScope],
  Component: WorkPeople,
});
