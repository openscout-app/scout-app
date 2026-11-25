/**
 * File — one file, read: its source with the focused lines marked, or its
 * working-tree changes.
 *
 * Shows:  the path (relative to its checkout), Source / Changes (Changes when
 *         the file sits under a checkout), size · truncated · the focused
 *         lines, Copy and Raw; then the highlighted source scrolled to the
 *         focused lines, or the file's diff. Quiet lines: Loading, why a read
 *         failed, a file too big or binary to show (with open raw), Opening
 *         "<project>"… while a link resolves, why it missed, and with nothing
 *         open: Pick a file to read (on Code), or Pick a file in Files and it
 *         opens here.
 * Data:   /api/file/preview once per file, shared with every Code panel for
 *         30s (hovering a file in Files reads it ahead); the path-filtered
 *         Git diff on Changes. No polling.
 * Scope:  file = "@route" follows the page (on Code the URL's file and lines,
 *         ⌘[ back to the thread; anywhere else the latest file opened in a
 *         Files or Changes panel on this view), "" for that latest file
 *         everywhere, or a pinned absolute file (with root, line, endLine).
 * Opens:  Copy scout:// (the clipboard). Pin keeps this file here; Unpin
 *         follows again. Raw: the file in a new tab. Open full: Code on this
 *         file and lines.
 */
import { useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Route } from "../../../lib/types.ts";
import {
  codeDeepLinkFor,
  codeRouteFor,
  findWorktree,
  snapshotRoots,
  type CodeFocus,
  type CodeTargetState,
} from "../../code/code-browser-model.ts";
import { CodeFile } from "../../code/CodeFile.tsx";
import { useCopyLink, useReturnToThread } from "../../code/CodeHeadParts.tsx";
import { useCodeSnapshot } from "../../code/code-snapshot.ts";
import { useCodeTarget } from "../../code/use-code-target.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { CODE_END_LINE_KEY, CODE_LINE_KEY, CODE_ROOT_KEY, filePlan, pinPatch, unpinPatch, type CodeFilePlan } from "./code-panel-model.ts";
import { codePicks } from "./code-pick.ts";
import { CODE_FILE_SCOPE } from "./code-scopes.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import "../../code/code-screen.css";
import "./code-panels.css";

const IDLE: Pick<CodeTargetState, "phase" | "project" | "path" | "message"> = {
  phase: "idle",
  project: null,
  path: null,
  message: null,
};

type Face = {
  root: string | null;
  file: string | null;
  focus: CodeFocus | null;
  link: Pick<CodeTargetState, "phase" | "project" | "path" | "message">;
  empty: ReactNode;
};

type FaceActions = {
  navigate: ModuleProps["navigate"];
  setConfig: ModuleProps["setConfig"];
  pinned: boolean;
  /** Open full goes to Code; the Code page's own File is already there. */
  openFull: boolean;
};

/** The head's actions and the reader, the same for every source. */
function FileFace({ root, file, focus, link, empty, navigate, setConfig, pinned, openFull }: Face & FaceActions) {
  const snapshot = useCodeSnapshot();
  const active = useMemo(() => findWorktree(snapshot, root), [snapshot, root]);
  const deepLink = useMemo(() => codeDeepLinkFor(root, file, active, focus), [root, file, active, focus]);
  const copy = useCopyLink(deepLink);
  return (
    <div className="vw-code-file">
      <ModuleHead>
        {deepLink ? (
          <button type="button" className="vw-chip" title={deepLink} onClick={copy.copy}>
            {copy.copied ? "Copied scout://" : "Copy scout://"}
          </button>
        ) : null}
        {pinned ? (
          <button type="button" className="vw-chip" aria-pressed="true" onClick={() => setConfig(unpinPatch())} title="Follow the page, or the file opened beside it, again">
            Unpin
          </button>
        ) : file ? (
          <button type="button" className="vw-chip" onClick={() => setConfig(pinPatch(root, file, focus))} title="Keep this file in this panel">
            Pin
          </button>
        ) : null}
        {openFull && root ? (
          <button
            type="button"
            className="vw-chip"
            onClick={() => navigate(codeRouteFor(snapshot, root, file, { focus }))}
            title="Open this file on the Code page"
          >
            Open full
          </button>
        ) : null}
      </ModuleHead>
      <CodeFile root={root} file={file} focus={focus} link={link} empty={empty} />
    </div>
  );
}

/** On Code, following the page: the URL's file and lines, as the Code page reads them. */
function RouteFile({ route, plan, ...actions }: { route: Route; plan: Extract<CodeFilePlan, { source: "route" }> } & Omit<FaceActions, "pinned" | "openFull">) {
  const state = useCodeTarget(plan.target, { fallback: true, restore: true });
  // Files shows the button; ⌘[ works with File alone too (the first binding takes it)
  useReturnToThread(route.view === "code" ? route.returnConversationId ?? null : null, actions.navigate);
  return <FileFace {...state} link={state} empty="Pick a file to read." pinned={false} openFull={false} {...actions} />;
}

/** A pinned file, with its root and lines. */
function PinnedFile({ plan, ...actions }: { plan: Extract<CodeFilePlan, { source: "pinned" }> } & Omit<FaceActions, "pinned" | "openFull">) {
  const state = useCodeTarget(plan.target);
  return <FileFace {...state} link={state} empty="Pick a file to read." pinned openFull {...actions} />;
}

/** The latest file opened in a Files or Changes panel on this view. */
function PickedFile(actions: Omit<FaceActions, "pinned" | "openFull">) {
  const pick = useSyncExternalStore(codePicks.subscribe, codePicks.latest, codePicks.latest);
  return (
    <FileFace
      root={pick?.root ?? null}
      file={pick?.file ?? null}
      focus={pick?.focus ?? null}
      link={IDLE}
      empty="Pick a file in Files and it opens here."
      pinned={false}
      openFull
      {...actions}
    />
  );
}

function CodeFilePanel({ route, navigate, config, setConfig }: ModuleProps) {
  const snapshot = useCodeSnapshot();
  const roots = useMemo(() => snapshotRoots(snapshot), [snapshot]);
  const plan = filePlan(config, route, roots);
  const actions = { navigate, setConfig };
  if (plan.source === "route") return <RouteFile route={route} plan={plan} {...actions} />;
  if (plan.source === "pinned") return <PinnedFile plan={plan} {...actions} />;
  return <PickedFile {...actions} />;
}

export const codeFileModule = defineModule({
  type: "code-file",
  title: "File",
  blurb: "One file, read: highlighted source at the focused lines, or its working-tree changes",
  docs: {
    shows: "Path, Source / Changes, size and lines, Copy, Raw; the highlighted source or the file's diff.",
    data: "/api/file/preview once per file (shared for 30s); the path-filtered Git diff on Changes.",
    opens: "Copy scout://, Pin / Unpin, Raw in a new tab. Open full: Code on this file and lines.",
  },
  size: { w: 9, h: 24 },
  minSize: { w: 4, h: 8 },
  scopes: [CODE_FILE_SCOPE],
  state: [CODE_ROOT_KEY, CODE_LINE_KEY, CODE_END_LINE_KEY],
  Component: CodeFilePanel,
});
