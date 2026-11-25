import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import type { RepoWatchSnapshot } from "../../scout/repo-watch/types.ts";
import {
  codeLinkKey,
  codeTargetKey,
  firstSnapshotRoot,
  resolveCodeTarget,
  resolveProjectLink,
  type CodeTarget,
  type CodeTargetState,
} from "./code-browser-model.ts";
import { useCodeSnapshot } from "./code-snapshot.ts";
import { readLastRoot, readStoredTree } from "./code-tree-store.ts";

/*
 * Where a Code target lands, for the page and every Code panel. A slug link
 * resolves once per window: the snapshot answers first when it can (it knows
 * worktrees), otherwise the server's project inventory is the authority
 * (repo-watch only registers checkouts with live agent activity, so a
 * quiet-but-known checkout must still resolve). The first answer stays, so a
 * later snapshot never moves a root out from under a reader, and every panel
 * on a page lands on the same root.
 */

const LINK_ROOTS_LIMIT = 64;
const linkRoots = new Map<string, string>();

function rememberLink(key: string, root: string): void {
  if (linkRoots.has(key)) return;
  linkRoots.set(key, root);
  if (linkRoots.size > LINK_ROOTS_LIMIT) {
    const oldest = linkRoots.keys().next().value;
    if (oldest) linkRoots.delete(oldest);
  }
}

export type UseCodeTargetOptions = {
  /** No root asked for: land on the last root read, else the first repo (the page's greeting). */
  fallback?: boolean;
  /** A root with no file reopens the file last open there. */
  restore?: boolean;
  /** The file a panel last opened itself, kept while it sits under the root. */
  ownFile?: string | null;
};

export function useCodeTarget(
  target: CodeTarget | null,
  { fallback = false, restore = false, ownFile = null }: UseCodeTargetOptions = {},
): CodeTargetState & { snapshot: RepoWatchSnapshot | null } {
  const snapshot = useCodeSnapshot();
  const key = codeLinkKey(target);
  const project = target?.project ?? null;
  const wt = target?.wt ?? null;
  const [answered, setAnswered] = useState(0);
  // a slug the inventory already missed stays failed instead of re-asking on
  // every snapshot arrival; a late snapshot that knows it can still resolve
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);

  const fromSnapshot = key && project && snapshot ? resolveProjectLink(snapshot, project, wt)?.root ?? null : null;
  const linkRoot = key ? linkRoots.get(key) ?? fromSnapshot : null;

  useEffect(() => {
    if (!key || !project) return;
    if (linkRoots.has(key)) return;
    if (fromSnapshot) {
      rememberLink(key, fromSnapshot);
      return;
    }
    if (failed?.key === key) return;
    let live = true;
    // api() dedupes concurrent identical GETs, so panels resolving one link share a request
    api<{ ok: true; projectName: string; root: string }>(`/api/code/resolve-project?slug=${encodeURIComponent(project)}`)
      .then((resolved) => {
        rememberLink(key, resolved.root);
        if (live) setAnswered((n) => n + 1);
      })
      .catch((error: unknown) => {
        if (live) setFailed({ key, message: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      live = false;
    };
  }, [failed, fromSnapshot, key, project]);

  const linkError = failed && failed.key === key ? failed.message : null;
  const targetKey = codeTargetKey(target);
  // with no root asked, reopen where the operator last was: read once per
  // target, so a bare /code after browsing lands on the repo just read
  const lastRoot = useMemo(() => (fallback ? readLastRoot() : null), [fallback, targetKey]);
  // else the first repo, kept for the target: a snapshot refresh that reorders
  // projects never moves the root under the reader
  const landed = useRef<{ key: string; root: string } | null>(null);
  if (landed.current && landed.current.key !== targetKey) landed.current = null;
  const fallbackRoot = fallback ? lastRoot ?? landed.current?.root ?? firstSnapshotRoot(snapshot) : null;
  if (fallbackRoot && !landed.current) landed.current = { key: targetKey, root: fallbackRoot };
  // the file last open in a root, read once per root for each target: a tree
  // elsewhere saving its own pick never moves this reader
  const stored = useMemo(() => new Map<string, string | null>(), [targetKey]);
  const storedFile = (root: string) => {
    if (!stored.has(root)) stored.set(root, readStoredTree(root)?.selectedFile ?? null);
    return stored.get(root) ?? null;
  };
  const state = useMemo(
    () => resolveCodeTarget(target, {
      snapshot,
      linkRoot,
      linkError,
      fallbackRoot,
      ownFile,
      storedFile: restore ? storedFile : undefined,
    }),
    // the target's fields (its key), not its identity: a fresh object per render is the same target
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [targetKey, stored, snapshot, linkRoot, linkError, fallbackRoot, ownFile, restore, answered],
  );
  return { ...state, snapshot };
}
