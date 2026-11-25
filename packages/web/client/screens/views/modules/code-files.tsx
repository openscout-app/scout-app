/**
 * Files — one checkout's file tree: pick a repo, open a file.
 *
 * Shows:  Back to thread (on Code, when a conversation handed the file in),
 *         the repo picker (recent repos, search with completion, a pasted
 *         scout:// link or absolute path), the branch's shortstat and the
 *         root, then the tree: lazy folders, changed files tinted with their
 *         status letter, folders holding changes dotted. Quiet lines:
 *         Resolving "<project>"…, why a project link missed, No repo selected.
 * Data:   /api/file/preview per folder opened (hovering a file reads it
 *         ahead for File); the repo-watch quick snapshot, shared by every Code
 *         panel (screens/code/code-snapshot.ts), read once and again on each
 *         root switch. Open folders persist per root in this browser.
 * Scope:  root = "@route" follows the page (on Code the URL; on a project,
 *         repo or diff page that checkout), an absolute root, or "" for the
 *         last repo read. Picking a repo here pins it. file = the file it last
 *         opened (state).
 * Opens:  a file: on Code the URL (/code/<project>/<path>, ⌘[ back to the
 *         thread), so File and Changes follow; anywhere else the File panel
 *         beside it (code-pick.ts). Open full: Code on this file.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { codeRouteFor, findWorktree, focusFrom, type CodeFocus } from "../../code/code-browser-model.ts";
import { ReturnToThreadButton, useReturnToThread } from "../../code/CodeHeadParts.tsx";
import { CodeProjectPicker, type CodePickerSelection } from "../../code/CodeProjectPicker.tsx";
import { shortRootPath } from "../../code/code-project-picker-model.ts";
import { writeLastRoot } from "../../code/code-tree-store.ts";
import { CodeTree } from "../../code/CodeTree.tsx";
import { useCodeTarget } from "../../code/use-code-target.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { CODE_FILE_KEY, CODE_ROOT_KEY, ownFile, rootPlan } from "./code-panel-model.ts";
import { codePicks } from "./code-pick.ts";
import { CODE_ROOT_SCOPE } from "./code-scopes.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import "../../code/code-screen.css";
import "./code-panels.css";

function CodeFiles({ instanceId, route, navigate, config, setConfig }: ModuleProps) {
  const plan = rootPlan(config, route);
  const onRoute = plan.source === "route";
  const kept = onRoute ? null : ownFile(config);
  const state = useCodeTarget(plan.target, { fallback: plan.fallback, restore: true, ownFile: kept });
  const { root, file, snapshot } = state;
  const returnConversationId = onRoute && route.view === "code" ? route.returnConversationId ?? null : null;
  const back = useReturnToThread(returnConversationId, navigate);

  // Lines a pasted scout:// link named, off the Code route: they ride with
  // the pick to File until another file opens.
  const [linked, setLinked] = useState<{ file: string; focus: CodeFocus } | null>(null);
  const focus = onRoute ? state.focus : linked && linked.file === file ? linked.focus : null;

  // What is open here is what File beside it shows; gone when nothing is.
  const line = focus?.line;
  const endLine = focus?.endLine;
  useEffect(() => {
    if (root && file) codePicks.publish(instanceId, { root, file, focus: line ? { line, ...(endLine ? { endLine } : {}) } : null });
    else codePicks.withdraw(instanceId);
  }, [instanceId, root, file, line, endLine]);
  useEffect(() => () => codePicks.withdraw(instanceId), [instanceId]);

  const open = useCallback((path: string) => {
    if (!root) return;
    if (onRoute) {
      navigate(codeRouteFor(snapshot, root, path, { returnConversationId }));
      return;
    }
    // the same file clicked again still brings it back to File
    codePicks.publish(instanceId, { root, file: path }, true);
    setLinked(null);
    setConfig({ [CODE_FILE_KEY]: path });
  }, [instanceId, navigate, onRoute, returnConversationId, root, setConfig, snapshot]);

  const pick = useCallback((selection: CodePickerSelection) => {
    const lines = focusFrom(selection.line, selection.endLine);
    if (onRoute) {
      navigate(codeRouteFor(snapshot, selection.root, selection.file ?? null, { focus: lines, returnConversationId }));
      return;
    }
    // a repo picked here pins this panel to it, and counts as read
    writeLastRoot(selection.root);
    setLinked(selection.file && lines ? { file: selection.file, focus: lines } : null);
    setConfig({ [CODE_ROOT_KEY]: selection.root, [CODE_FILE_KEY]: selection.file ?? "" });
  }, [navigate, onRoute, returnConversationId, setConfig, snapshot]);

  const active = useMemo(() => findWorktree(snapshot, root), [snapshot, root]);
  const stat = active?.worktree.diff.branchShortstat;

  return (
    <div className="vw-code-files">
      {!onRoute && root ? (
        <ModuleHead>
          <button
            type="button"
            className="vw-chip"
            onClick={() => navigate(codeRouteFor(snapshot, root, file, { focus }))}
            title="Open this file on the Code page"
          >
            Open full
          </button>
        </ModuleHead>
      ) : null}
      <div className="vw-code-strip">
        <div className="vw-code-stripRow">
          {back ? <ReturnToThreadButton onClick={back} /> : null}
          <CodeProjectPicker snapshot={snapshot} root={root} onSelect={pick} floating />
        </div>
        {root ? (
          <div className="vw-code-meta">
            {stat ? <span className="s-code-headStat">{stat}</span> : null}
            <span className="s-code-headPath" title={root}>{shortRootPath(root)}</span>
          </div>
        ) : null}
      </div>
      <CodeTree
        root={root}
        selectedFile={file}
        snapshot={snapshot}
        link={state}
        onSelectFile={open}
        // only the page's own tree, or one on the last repo read, moves the Code page's greeting
        remember={onRoute || plan.source === "last"}
      />
    </div>
  );
}

export const codeFilesModule = defineModule({
  type: "code-files",
  title: "Files",
  blurb: "One checkout's file tree, with its changes marked: pick a repo, open a file",
  docs: {
    shows: "Repo picker, branch shortstat and root, then the tree with changed files and folders marked.",
    data: "/api/file/preview per folder opened; the repo-watch quick snapshot, shared by every Code panel.",
    opens: "A file: on Code the URL, anywhere else the File panel beside it. Open full: Code on this file.",
  },
  size: { w: 3, h: 16 },
  minSize: { w: 2, h: 8 },
  scopes: [CODE_ROOT_SCOPE],
  state: [CODE_FILE_KEY],
  Component: CodeFiles,
});
