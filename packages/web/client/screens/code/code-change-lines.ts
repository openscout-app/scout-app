import type { RepoDiffLayer } from "../../scout/repo-diff/types.ts";
import { diffFileIndex } from "./code-diff-model.ts";

/**
 * Which lines of a file on disk differ from Git, for the bars in the Code
 * reader's gutter. Line numbers are on the new side of the patch, so they
 * match the file the reader shows.
 *
 * - added: a line with no removed line beside it
 * - modified: a line that replaced removed lines
 * - deletedAfter: lines were removed after this line (0 means before line 1)
 */
export type FileLineChanges = {
  added: Set<number>;
  modified: Set<number>;
  deletedAfter: Set<number>;
  additions: number;
  deletions: number;
};

export function emptyLineChanges(): FileLineChanges {
  return { added: new Set(), modified: new Set(), deletedAfter: new Set(), additions: 0, deletions: 0 };
}

export function hasLineChanges(changes: FileLineChanges | null): boolean {
  return Boolean(changes && (changes.additions > 0 || changes.deletions > 0));
}

/** The part of a unified patch that belongs to one file, or null. */
export function filePatch(rawPatch: string, relativePath: string): string | null {
  const sections = rawPatch.split(/^(?=diff --git )/m);
  for (const section of sections) {
    if (!section.startsWith("diff --git ")) continue;
    const header = section.slice(0, section.indexOf("\n") >>> 0);
    if (header.endsWith(` b/${relativePath}`) || header.includes(` a/${relativePath} `)) return section;
    const plus = /^\+\+\+ b\/(.+)$/m.exec(section);
    if (plus?.[1] === relativePath) return section;
  }
  return null;
}

/** Walk one file's hunks and classify each new-side line. */
export function lineChangesFromPatch(patch: string): FileLineChanges {
  const changes = emptyLineChanges();
  let newLine = 0;
  let inHunk = false;
  // removed lines waiting for added lines to pair with
  let pendingRemoved = 0;

  const flushRemoved = () => {
    if (pendingRemoved > 0) changes.deletedAfter.add(newLine);
    pendingRemoved = 0;
  };

  for (const line of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flushRemoved();
      newLine = Number(hunk[1]) - 1;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("-")) {
      pendingRemoved += 1;
      changes.deletions += 1;
    } else if (line.startsWith("+")) {
      newLine += 1;
      changes.additions += 1;
      if (pendingRemoved > 0) {
        changes.modified.add(newLine);
        pendingRemoved -= 1;
      } else {
        changes.added.add(newLine);
      }
    } else if (line.startsWith(" ")) {
      flushRemoved();
      newLine += 1;
    } else if (line.startsWith("diff --git ")) {
      flushRemoved();
      inHunk = false;
    }
  }
  flushRemoved();
  return changes;
}

/**
 * The file's changes against Git as it sits on disk: the unstaged layer when
 * it has the file (index to disk), else the staged one (HEAD to index, which
 * is then the disk). The branch layer compares commits, not the disk, so it
 * never marks lines.
 */
export function lineChangesForFile(
  layers: readonly RepoDiffLayer[],
  relativePath: string,
): { changes: FileLineChanges; layer: RepoDiffLayer["kind"] } | null {
  for (const kind of ["unstaged", "staged"] as const) {
    const layer = layers.find((candidate) => candidate.kind === kind);
    if (!layer?.rawPatch || diffFileIndex(layer, relativePath) < 0) continue;
    const patch = filePatch(layer.rawPatch, relativePath);
    if (!patch) continue;
    return { changes: lineChangesFromPatch(patch), layer: kind };
  }
  return null;
}
