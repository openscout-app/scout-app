/**
 * Task tail — the live output of the session running one work item.
 *
 * Shows:  "Live from" (or "Session output from") the agent on the run, and
 *         the tail of that session's events, filtered to this work item, as
 *         the Work page drew it; always open in a panel.
 *         Head: Open full, and Unpin when pinned to one.
 * Data:   the work item's detail, GET /api/work/:id, shared with every Work
 *         panel; the tail's filter from useFollowTailQuery (the harness's own
 *         session id when known); the broker tail stream.
 * Scope:  Work item, by id. "This page's work item" follows /work/:id.
 * Opens:  Open in Tail: Ops Tail on the same filter; a tail row's own links;
 *         Open full: /work/:id.
 */
import { WorkDetailScreen, type WorkPanelOptions } from "../../work/WorkDetailScreen.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { usePanelWork, WorkPanelEmpty, WorkPanelHead, workScope } from "./work-shared.tsx";

const TAIL: WorkPanelOptions["parts"] = ["tail"];

function WorkTail({ route, navigate, config, setConfig }: ModuleProps) {
  const work = usePanelWork(route, config);
  if (!work.workId) return <WorkPanelEmpty work={work} />;
  return (
    <div className="vw-work vw-work-tail">
      <WorkPanelHead route={route} navigate={navigate} setConfig={setConfig} work={work} />
      <WorkDetailScreen key={work.workId} workId={work.workId} navigate={navigate} panel={{ parts: TAIL, own: work.own }} />
    </div>
  );
}

export const workTailModule = defineModule({
  type: "work-tail",
  title: "Task tail",
  blurb: "The live output of the session running one work item",
  docs: {
    shows: "The run's session events, filtered to this work item, live while it runs.",
    data: "/api/work/:id (shared); the tail filter from useFollowTailQuery; the broker tail stream.",
    opens: "Open in Tail: Ops Tail on the same filter; Open full: /work/:id.",
  },
  size: { w: 6, h: 16 },
  minSize: { w: 4, h: 7 },
  scopes: [workScope],
  Component: WorkTail,
});
