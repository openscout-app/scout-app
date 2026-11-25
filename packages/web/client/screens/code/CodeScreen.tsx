import { getDestination } from "../../scout/nav-destinations.ts";
import { useCallback, useMemo, useState } from "react";
import type { Route } from "../../lib/types.ts";
import { defineSurface } from "../../surfaces/types.ts";
import { useEmbedHeadline } from "../../surfaces/useEmbedHeadline.ts";
import {
  codeDeepLinkFor,
  codeRouteFor,
  codeTargetKey,
  findWorktree,
  focusFrom,
  type CodeFocus,
  type CodeTarget,
} from "./code-browser-model.ts";
import { CodeFile } from "./CodeFile.tsx";
import { ReturnToThreadButton, useCopyLink, useReturnToThread } from "./CodeHeadParts.tsx";
import { CodeProjectPicker, type CodePickerSelection } from "./CodeProjectPicker.tsx";
import { shortRootPath } from "./code-project-picker-model.ts";
import { CodeTree } from "./CodeTree.tsx";
import { useCodeTarget } from "./use-code-target.ts";
import "./code-screen.css";

/*
 * The Code reader on one page: the project picker and the scout:// link over
 * the file tree and the reading plane. /embed/code (the macOS app) draws it;
 * /code draws the Code view, whose Files, File and Changes panels are these
 * same parts (screens/views/modules/code-*.tsx).
 */

/** Only the fields a caller set: the target a /code route or the embed's props ask for. */
function askedTarget(fields: CodeTarget): CodeTarget {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== "")) as CodeTarget;
}

export function CodeContent({
  route,
  navigate,
  root: rootProp,
  file: fileProp,
  project: projectProp,
  path: pathProp,
  wt: wtProp,
  line: lineProp,
  endLine: endLineProp,
  returnConversationId: returnConversationIdProp,
  embedded = false,
}: {
  route?: Extract<Route, { view: "code" }>;
  navigate?: (route: Route) => void;
  root?: string;
  file?: string;
  project?: string;
  path?: string;
  wt?: string;
  line?: number;
  endLine?: number;
  returnConversationId?: string;
  embedded?: boolean;
}) {
  useEmbedHeadline("Code", embedded);
  const asked = askedTarget({
    root: rootProp ?? route?.root,
    file: fileProp ?? route?.file,
    project: projectProp ?? route?.project,
    path: pathProp ?? route?.path,
    wt: wtProp ?? route?.wt,
    line: lineProp ?? route?.line,
    endLine: endLineProp ?? route?.endLine,
  });
  const askedKey = codeTargetKey(asked);
  const returnConversationId = returnConversationIdProp ?? route?.returnConversationId ?? null;

  // What is on screen: the asked target until the operator picks something
  // here; a new ask (a link, Back, Forward) wins again.
  const [held, setHeld] = useState<{ key: string; target: CodeTarget } | null>(null);
  const target = held && held.key === askedKey ? held.target : asked;
  // With no explicit target, reopen where the operator last was — the surface
  // should greet you with your repo, not a picker.
  const state = useCodeTarget(target, { fallback: true, restore: true });
  const { root, file, focus, snapshot } = state;

  // Keep the address bar in sync with what's on screen so any moment in the
  // surface is a copyable link (code-browser-model › codeRouteFor).
  const select = useCallback((rootPath: string, filePath: string | null, lines: CodeFocus | null = null) => {
    setHeld({
      key: askedKey,
      target: {
        root: rootPath,
        ...(filePath ? { file: filePath } : {}),
        ...(lines ? { line: lines.line, ...(lines.endLine ? { endLine: lines.endLine } : {}) } : {}),
      },
    });
    if (!embedded && navigate) navigate(codeRouteFor(snapshot, rootPath, filePath, { focus: lines, returnConversationId }));
  }, [askedKey, embedded, navigate, returnConversationId, snapshot]);

  // A manual pick supersedes any still-unresolved deep link.
  const selectFromPicker = useCallback((selection: CodePickerSelection) => {
    select(selection.root, selection.file ?? null, focusFrom(selection.line, selection.endLine));
  }, [select]);

  const back = useReturnToThread(returnConversationId, navigate);
  const activeWorktree = useMemo(() => findWorktree(snapshot, root), [snapshot, root]);
  const scoutDeepLink = useMemo(() => codeDeepLinkFor(root, file, activeWorktree, focus), [root, file, activeWorktree, focus]);
  const deepLinkCopy = useCopyLink(scoutDeepLink);

  return (
    <div className="s-code-screen" data-embedded={embedded || undefined}>
      <div className="s-code-head">
        {back ? <ReturnToThreadButton onClick={back} /> : null}
        <CodeProjectPicker
          snapshot={snapshot}
          root={root}
          onSelect={selectFromPicker}
        />
        {activeWorktree?.worktree.diff.branchShortstat ? (
          <span className="s-code-headStat">{activeWorktree.worktree.diff.branchShortstat}</span>
        ) : null}
        {root ? <span className="s-code-headPath" title={root}>{shortRootPath(root)}</span> : null}
        {scoutDeepLink ? (
          <button
            type="button"
            className="s-code-copyLink"
            title={scoutDeepLink}
            onClick={deepLinkCopy.copy}
          >
            {deepLinkCopy.copied ? "Copied scout://" : "Copy scout://"}
          </button>
        ) : null}
      </div>
      <div className="s-code-body">
        <CodeTree
          root={root}
          selectedFile={file}
          snapshot={snapshot}
          link={state}
          onSelectFile={(path) => root && select(root, path)}
        />
        <CodeFile root={root} file={file} focus={focus} link={state} />
      </div>
    </div>
  );
}

export const scoutSurface = defineSurface({
  id: "code",
  label: "Files",
  route: { view: "code" },
  webPath: "/code",
  screen: "CodeContent",
  embed: {
    path: "/embed/code",
    profile: "macos.code",
    rootClassName: "s-code-embed",
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    hosts: { macos: true },
    resolveEmbedProps: (params) => ({
      root: params.get("root")?.trim() || undefined,
      file: params.get("file")?.trim() || undefined,
      project: params.get("project")?.trim() || undefined,
      path: params.get("path")?.trim() || undefined,
      wt: params.get("wt")?.trim() || undefined,
      line: positiveEmbedLine(params.get("line")),
      endLine: positiveEmbedLine(params.get("endLine")),
      returnConversationId: params.get("fromConversation")?.trim() || undefined,
    }),
  },
});

function positiveEmbedLine(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
