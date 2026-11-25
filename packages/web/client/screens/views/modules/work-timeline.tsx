/**
 * Timeline — one work item's history: the request, progress and replies.
 *
 * Shows:  every event newest first (18, then Show all): when (date, clock,
 *         age), what (request created, agent output, reply, thread update),
 *         who, its ask handle to copy, and the update itself (long ones fold
 *         under Full update); echoes of the same update fold into the row.
 *         Head: Open full, and Unpin when pinned to one.
 * Data:   the work item's detail, GET /api/work/:id, shared with every Work
 *         panel on the page (warm under 30s, once per burst of broker events).
 * Scope:  Work item, by id. "This page's work item" follows /work/:id.
 * Opens:  nothing; Open full: /work/:id.
 */
import { WorkDetailScreen, type WorkPanelOptions } from "../../work/WorkDetailScreen.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { usePanelWork, WorkPanelEmpty, WorkPanelHead, workScope } from "./work-shared.tsx";

const TIMELINE: WorkPanelOptions["parts"] = ["timeline"];

function WorkTimeline({ route, navigate, config, setConfig }: ModuleProps) {
  const work = usePanelWork(route, config);
  if (!work.workId) return <WorkPanelEmpty work={work} />;
  return (
    <div className="vw-work vw-work-timeline">
      <WorkPanelHead route={route} navigate={navigate} setConfig={setConfig} work={work} />
      <WorkDetailScreen key={work.workId} workId={work.workId} navigate={navigate} panel={{ parts: TIMELINE, own: work.own }} />
    </div>
  );
}

export const workTimelineModule = defineModule({
  type: "work-timeline",
  title: "Timeline",
  blurb: "One work item's request, progress and replies, newest first",
  docs: {
    shows: "Every event newest first: when, what, who, its ask handle, and the update; echoes fold into the row.",
    data: "/api/work/:id, shared by every Work panel: warm under 30s, once per burst of broker events.",
    opens: "Nothing; Open full: /work/:id.",
  },
  size: { w: 6, h: 16 },
  minSize: { w: 4, h: 6 },
  scopes: [workScope],
  Component: WorkTimeline,
});
