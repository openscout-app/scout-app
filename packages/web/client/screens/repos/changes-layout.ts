import type { RepoWatchProject, RepoWatchSnapshot, RepoWatchWorktree } from "../../scout/repo-watch/types.ts";
import { attentionRank, pathLeaf, worktreeDisplayLeaf, wtState, type WtState } from "../../scout/repo-watch/ui.ts";

/*
 * The Changes page's rules (Projects › Changes, /repos and /repo-diff), pure
 * so they test without a DOM. The page has two fixed layouts and nothing
 * else to arrange:
 *
 *   classic  the worktree rail on the left, the diff in the middle, the
 *            selected worktree's details in one pane on the right.
 *   wide     the details move to a band under the diff, in three columns,
 *            so the diff takes the full width and split view fits.
 *
 * The list is a narrow rail of state dots until it is expanded into the full
 * Repos table. Both choices are per-viewer conveniences in this browser.
 */

export type ChangesLayout = "classic" | "wide";
export const CHANGES_LAYOUTS: readonly { id: ChangesLayout; label: string; title: string }[] = [
  { id: "classic", label: "Classic", title: "List on the left, the diff in the middle, details on the right" },
  { id: "wide", label: "Wide diff", title: "Details in a band under the diff; the diff takes the full width" },
];

export const LAYOUT_KEY = "openscout.changes.layout.v1";
export const LIST_KEY = "openscout.changes.list.v1";

export function parseLayout(value: string | null | undefined): ChangesLayout {
  return value === "wide" ? "wide" : "classic";
}

/** Expanded only when the viewer opened it; the list ships thin. */
export function parseListOpen(value: string | null | undefined): boolean {
  return value === "open";
}

export type ThinRow = {
  id: string;
  path: string;
  /** The checkout's distinguishing name within its repo. */
  name: string;
  branch: string | null;
  state: WtState;
  changed: number;
  ahead: number;
  behind: number;
  agents: number;
};

export type ThinGroup = { id: string; name: string; rows: ThinRow[] };

function thinRow(wt: RepoWatchWorktree, project: RepoWatchProject): ThinRow {
  const branch = wt.branch.name ?? (wt.branch.detached ? "detached" : null);
  return {
    id: wt.id,
    path: wt.path,
    name: worktreeDisplayLeaf(wt, project),
    branch: branch && branch !== pathLeaf(wt.path) ? branch : null,
    state: wtState(wt),
    changed: wt.status.changedFiles,
    ahead: wt.branch.ahead,
    behind: wt.branch.behind,
    agents: wt.agents.length,
  };
}

const byAttention = (a: { attention: RepoWatchWorktree["attention"] }, b: { attention: RepoWatchWorktree["attention"] }) =>
  attentionRank(a.attention) - attentionRank(b.attention);

/**
 * The thin list: every repo and every worktree the scan holds, unfinished
 * work first (the table's attention order), clean and idle ones after.
 */
export function thinGroups(snapshot: RepoWatchSnapshot | null): ThinGroup[] {
  if (!snapshot) return [];
  return [...snapshot.projects]
    .sort((a, b) => byAttention(a, b) || a.name.localeCompare(b.name))
    .map((project) => ({
      id: project.id,
      name: project.name,
      rows: [...project.worktrees]
        .sort((a, b) => byAttention(a, b) || b.status.changedFiles - a.status.changedFiles || a.path.localeCompare(b.path))
        .map((wt) => thinRow(wt, project)),
    }));
}

/** A row's short reading: files changed, then drift. Empty when clean and level. */
export function thinReading(row: ThinRow): string {
  const parts: string[] = [];
  if (row.changed > 0) parts.push(String(row.changed));
  if (row.ahead > 0) parts.push(`↑${row.ahead}`);
  if (row.behind > 0) parts.push(`↓${row.behind}`);
  return parts.join(" ");
}
