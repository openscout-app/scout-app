import { useEffect, useMemo, useState } from "react";
import { fetchRepoDiffSnapshot } from "../../scout/repo-diff/cache.ts";
import { lineChangesForFile, type FileLineChanges } from "./code-change-lines.ts";
import { FILE_DIFF_LAYERS, relativeFilePath } from "./code-diff-model.ts";

/**
 * One file's changes against Git on disk, for the Code reader's gutter and
 * its Diff toggle. It makes the same path-filtered request the Diff pane
 * makes, so opening the diff after it reuses the cached snapshot.
 *
 * `version` re-reads when the file's text changes (an agent rewrote it).
 * Null while reading, outside a repo root, or when the read failed: the
 * reader then shows the source with no marks.
 */
export function useFileLineChanges(
  root: string | null,
  file: string | null,
  version: string | null,
): FileLineChanges | null {
  const relativePath = useMemo(
    () => (root && file ? relativeFilePath(root, file) : null),
    [file, root],
  );
  const [state, setState] = useState<{ key: string; changes: FileLineChanges | null } | null>(null);
  const key = root && relativePath ? `${root}\0${relativePath}\0${version ?? ""}` : null;

  useEffect(() => {
    if (!key || !root || !relativePath) return;
    let cancelled = false;
    void fetchRepoDiffSnapshot(root, FILE_DIFF_LAYERS, { files: [relativePath], tier: "patch" }).then(
      (record) => {
        if (cancelled) return;
        setState({ key, changes: lineChangesForFile(record.snapshot.layers, relativePath)?.changes ?? null });
      },
      () => {
        if (!cancelled) setState({ key, changes: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, relativePath, root]);

  return state && state.key === key ? state.changes : null;
}
