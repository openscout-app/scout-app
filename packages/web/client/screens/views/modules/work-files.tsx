/**
 * Files — what one work item touched and read, with a preview.
 *
 * Shows:  Touched · Read · All, a filter ("/" focuses it), the files grouped
 *         by repo with their diff stats, and the picked file's preview (text,
 *         or the image); ↑↓ step through the list. A Made link in the Work
 *         item panel picks its file here.
 *         Head: Open full, and Unpin when pinned to one.
 * Data:   the work item's detail and inventory, GET /api/work/:id, shared
 *         with every Work panel; the picked file from
 *         /api/work/:id/material?materialId=, once per pick.
 * Scope:  Work item, by id. "This page's work item" follows /work/:id. On
 *         the Work page "/" is the page's key; anywhere else it binds only
 *         while focus is inside this panel.
 * Opens:  Open: the file in a viewer; Open full: /work/:id.
 */
import { WorkDetailScreen, type WorkPanelOptions } from "../../work/WorkDetailScreen.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { usePanelKeyScope } from "./panel-scope.ts";
import { usePanelWork, WorkPanelEmpty, WorkPanelHead, workScope } from "./work-shared.tsx";

const FILES: WorkPanelOptions["parts"] = ["files"];

function WorkFiles({ route, navigate, config, setConfig }: ModuleProps) {
  const work = usePanelWork(route, config);
  const { root, keyScope } = usePanelKeyScope();
  if (!work.workId) return <WorkPanelEmpty work={work} />;
  return (
    <div ref={root} className="vw-work vw-work-files">
      <WorkPanelHead route={route} navigate={navigate} setConfig={setConfig} work={work} />
      <WorkDetailScreen key={work.workId} workId={work.workId} navigate={navigate} panel={{ parts: FILES, own: work.own, keyScope }} />
    </div>
  );
}

export const workFilesModule = defineModule({
  type: "work-files",
  title: "Files",
  blurb: "What one work item touched and read, with a preview",
  docs: {
    shows: "Touched, Read and All files by repo with diff stats, a filter, and the picked file's preview.",
    data: "/api/work/:id (shared) and its inventory; /api/work/:id/material once per pick.",
    opens: "Open: the file in a viewer; Open full: /work/:id.",
  },
  size: { w: 12, h: 16 },
  minSize: { w: 5, h: 10 },
  scopes: [workScope],
  Component: WorkFiles,
});
