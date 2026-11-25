import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { RepoWatchSnapshot } from "../../scout/repo-watch/types.ts";
import {
  afterFailedDir,
  ancestorDirs,
  changedDirsFor,
  changedFilesByPath,
  collectTreeRows,
  diffBadge,
  findWorktree,
  type CodeTargetState,
  type DirEntry,
  type TreeRow,
} from "./code-browser-model.ts";
import { prefetchFilePreview, readDirectory } from "./code-preview.ts";
import { refreshCodeSnapshot } from "./code-snapshot.ts";
import { readStoredTree, writeLastRoot, writeStoredTree } from "./code-tree-store.ts";

/**
 * The Code reader's file tree for one root: lazy directories, git-status
 * tints, hover prefetch. The page draws it beside the reader; the Files panel
 * draws it on its own. It owns what it has loaded and what is open; the
 * owner owns which root and file are selected.
 */
export function CodeTree({
  root,
  selectedFile,
  snapshot,
  link,
  onSelectFile,
  remember = true,
}: {
  root: string | null;
  selectedFile: string | null;
  snapshot: RepoWatchSnapshot | null;
  /** Where the target stands, for the quiet line while there is no root. */
  link: Pick<CodeTargetState, "phase" | "project" | "message">;
  onSelectFile: (path: string) => void;
  /** Count this root as the last one read: the page's greeting and the picker's recents. */
  remember?: boolean;
}) {
  // the root these entries belong to: nothing is saved for a root until it has its own
  const [treeRoot, setTreeRoot] = useState<string | null>(null);
  const [childrenByPath, setChildrenByPath] = useState<Map<string, DirEntry[]>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [treeError, setTreeError] = useState<string | null>(null);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const shownRoot = useRef<string | null>(null);
  // one count per visit to a root, so a return to the same root is a new visit
  const visit = useRef(0);

  const loadDir = useCallback(async (dir: string) => {
    // a read answers for the visit that asked: once the tree has moved to
    // another root (even a folder inside the old one, or back again), its
    // result is dropped
    const root = shownRoot.current;
    const asked = visit.current;
    const stillAsked = () => visit.current === asked;
    try {
      const entries = await readDirectory(dir);
      if (!entries || !root || !stillAsked()) return;
      setChildrenByPath((current) => new Map(current).set(dir, entries));
    } catch (error) {
      if (!root || !stillAsked()) return;
      if (afterFailedDir(root, dir, expandedRef.current).error) setTreeError(error instanceof Error ? error.message : String(error));
      else setExpanded((current) => afterFailedDir(root, dir, current).expanded);
    }
  }, []);

  useEffect(() => {
    if (!root) {
      if (shownRoot.current !== null) visit.current += 1;
      shownRoot.current = null;
      return;
    }
    const linkDirs = selectedFile ? ancestorDirs(root, selectedFile) : [];
    if (shownRoot.current !== root) {
      shownRoot.current = root;
      visit.current += 1;
      // Root switched: hydrate instantly from the last visit (stale), then
      // re-fetch every visible directory in the background — loadDir replaces
      // one directory at a time, which reconciles the stale render against
      // disk. The selected file's folders open too.
      setTreeError(null);
      const stored = readStoredTree(root);
      setTreeRoot(root);
      setChildrenByPath(stored ? new Map(Object.entries(stored.entries)) : new Map());
      setExpanded(new Set([...(stored?.expanded ?? []), ...linkDirs]));
      for (const dir of new Set([root, ...(stored?.expanded ?? []), ...linkDirs])) void loadDir(dir);
      // refresh git-status decorations alongside the tree
      void refreshCodeSnapshot();
      return;
    }
    // A selection from outside (a link, Back, the picker): reveal it — expand
    // and load every directory above it.
    if (linkDirs.every((dir) => expandedRef.current.has(dir))) return;
    setExpanded((current) => new Set([...current, ...linkDirs]));
    for (const dir of linkDirs) void loadDir(dir);
  }, [root, selectedFile, loadDir]);

  // Persist what's on screen so the next visit renders without a fetch.
  useEffect(() => {
    if (!root || treeRoot !== root || childrenByPath.size === 0) return;
    writeStoredTree(root, { entries: childrenByPath, expanded, selectedFile });
    if (remember) writeLastRoot(root);
  }, [root, treeRoot, childrenByPath, expanded, selectedFile, remember]);

  const toggleDir = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!childrenByPath.has(path)) void loadDir(path);
  }, [childrenByPath, loadDir]);

  const treeRows = useMemo(() => {
    if (!root) return [];
    const rows: TreeRow[] = [];
    collectTreeRows(root, 0, childrenByPath, expanded, rows);
    return rows;
  }, [root, childrenByPath, expanded]);

  // Git-status decoration: repo-watch already carries this worktree's changed
  // files — tint them in the tree and dot every folder on the way down.
  const active = useMemo(() => findWorktree(snapshot, root), [snapshot, root]);
  const changedByPath = useMemo(() => changedFilesByPath(root, active), [root, active]);
  const changedDirs = useMemo(() => changedDirsFor(root, changedByPath), [root, changedByPath]);

  return (
    <div className="s-code-tree" role="tree" aria-label="Files">
      {treeError ? (
        <div className="s-code-treeNote">{treeError}</div>
      ) : root ? (
        treeRows.map((row) =>
          row.loading ? (
            <div key={row.path} className="s-code-node s-code-node--loading" style={{ paddingLeft: 10 + row.depth * 14 }}>
              {row.name}
            </div>
          ) : (
            <button
              key={row.path}
              type="button"
              role="treeitem"
              className="s-code-node"
              data-selected={row.path === selectedFile || undefined}
              data-diff={row.kind === "file" ? changedByPath.get(row.path) : undefined}
              aria-expanded={row.kind === "directory" ? expanded.has(row.path) : undefined}
              style={{ paddingLeft: 10 + row.depth * 14 }}
              onClick={() => (row.kind === "directory" ? toggleDir(row.path) : onSelectFile(row.path))}
              onMouseEnter={row.kind === "file" ? () => prefetchFilePreview(row.path) : undefined}
            >
              {row.kind === "directory" ? (
                <ChevronRight
                  size={11}
                  strokeWidth={2}
                  className="s-code-nodeChevron"
                  data-open={expanded.has(row.path) || undefined}
                  aria-hidden
                />
              ) : (
                <span className="s-code-nodeSpacer" aria-hidden />
              )}
              <span className="s-code-nodeName">{row.name}</span>
              {row.kind === "file" && changedByPath.has(row.path) ? (
                <span className="s-code-nodeBadge" data-diff={changedByPath.get(row.path)}>
                  {diffBadge(changedByPath.get(row.path) ?? "")}
                </span>
              ) : null}
              {row.kind === "directory" && changedDirs.has(row.path) ? (
                <span className="s-code-nodeDot" aria-label="Contains changes" />
              ) : null}
            </button>
          ),
        )
      ) : link.phase === "resolving" ? (
        <div className="s-code-treeNote">Resolving “{link.project}”…</div>
      ) : link.phase === "failed" ? (
        <div className="s-code-treeNote">{link.message}</div>
      ) : (
        <div className="s-code-treeNote">No repo selected.</div>
      )}
    </div>
  );
}
