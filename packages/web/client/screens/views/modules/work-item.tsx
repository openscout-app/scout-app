/**
 * Work item — one work item's head: what was asked, who has it, where it stands.
 *
 * Shows:  the masthead (state, title, id, owner, branch, timing, verdict,
 *         what it made, the links and the companion pin), the request, the
 *         result (the owner's final reply, its links, what it checked and
 *         what is left to try), the request, then the run: its lifecycle,
 *         the Details plate (harness, model, effort, transport; project,
 *         branch, owner, work id; session, flight, invocation, conversation;
 *         and the case: acceptance, priority, signal, next move, children,
 *         flights, parent, created, updated) and its session, chat, terminal
 *         and tail actions.
 *         Head: Open full, and Unpin when pinned to one.
 * Data:   the work item's detail, GET /api/work/:id, shared with every Work
 *         panel on the page: warm from a read under 30s old, read again once
 *         per burst of broker events. The owner from the roster, or
 *         /api/agents/:id when their session has ended.
 * Scope:  Work item, by id. "This page's work item" follows /work/:id; pick
 *         one from recent work to pin it.
 * Opens:  the run's session, chat, terminal and tail; the original request
 *         and Work JSON in a viewer; a Made file in the Files panel (or in a
 *         viewer when no Files panel shows this work item); the parent work
 *         item; Open full: /work/:id.
 */
import { WorkDetailScreen, type WorkPanelOptions } from "../../work/WorkDetailScreen.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { usePanelWork, WorkPanelEmpty, WorkPanelHead, workScope } from "./work-shared.tsx";

const HEAD: WorkPanelOptions["parts"] = ["head"];

function WorkItem({ route, navigate, config, setConfig }: ModuleProps) {
  const work = usePanelWork(route, config);
  if (!work.workId) return <WorkPanelEmpty work={work} />;
  return (
    <div className="vw-work vw-work-item">
      <WorkPanelHead route={route} navigate={navigate} setConfig={setConfig} work={work} />
      <WorkDetailScreen
        key={work.workId}
        workId={work.workId}
        navigate={navigate}
        panel={{ parts: HEAD, own: work.own }}
      />
    </div>
  );
}

export const workItemModule = defineModule({
  type: "work-item",
  title: "Work item",
  blurb: "One work item: the ask, who has it, where it stands, and its case",
  docs: {
    shows: "The masthead, the result, the request, and the run with its Details plate: harness, model, effort, ids, and the case (acceptance, priority, routing, parent, created, updated).",
    data: "/api/work/:id, shared by every Work panel: warm under 30s, once per burst of broker events.",
    opens: "The run's session, chat, terminal and tail; the request and JSON viewers; a Made file; the parent; Open full: /work/:id.",
  },
  size: { w: 6, h: 24 },
  minSize: { w: 4, h: 10 },
  scopes: [workScope],
  Component: WorkItem,
});
