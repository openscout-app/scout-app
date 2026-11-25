import { describe, expect, test } from "bun:test";
import type { RepoWatchProject, RepoWatchSnapshot, RepoWatchWorktree } from "../../../scout/repo-watch/types.ts";
import { parseLayout, parseListOpen, thinGroups, thinReading } from "../../repos/changes-layout.ts";
import { composedViewFor } from "../composed-routes.ts";
import { SHIPPED_VIEWS } from "../views-model.ts";

/*
 * Projects › Changes (/repos and /repo-diff) is one fixed page, not a grid
 * composition: two layouts, a thin worktree list that expands into the Repos
 * table, the diff, and one details pane (screens/repos/ChangesPage.tsx).
 */

function worktree(id: string, patch: Partial<RepoWatchWorktree> = {}): RepoWatchWorktree {
  return {
    id,
    path: `/dev/scout-${id}`,
    name: id,
    isBare: false,
    branch: { name: id, upstream: null, head: null, detached: false, ahead: 0, behind: 0, isMain: false, diverged: false },
    status: { clean: true, staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0, files: [] },
    diff: { branchShortstat: null, unstagedShortstat: null, stagedShortstat: null },
    attention: "quiet",
    attentionReasons: [],
    agents: [],
    sessions: [],
    hints: [],
    lastCommitAt: null,
    scannedAt: 0,
    error: null,
    ...patch,
  };
}

function project(name: string, worktrees: RepoWatchWorktree[], attention: RepoWatchProject["attention"] = "quiet"): RepoWatchProject {
  return { id: name, name, root: `/dev/${name}`, commonGitDir: `/dev/${name}/.git`, attention, attentionReasons: [], worktrees } as unknown as RepoWatchProject;
}

describe("the Changes page", () => {
  test("draws itself on /repos and /repo-diff, with or without a selection", () => {
    expect(composedViewFor({ view: "repos" })).toBeNull();
    expect(composedViewFor({ view: "repos", root: "/example/me/dev/scout", machineId: "m1" })).toBeNull();
    expect(composedViewFor({ view: "repo-diff", path: "/example/me/dev/scout" })).toBeNull();
    expect(SHIPPED_VIEWS.some((view) => view.id === "repos")).toBe(false);
  });

  test("ships Classic with the list thin; only a stored choice changes either", () => {
    expect(parseLayout(null)).toBe("classic");
    expect(parseLayout("grid")).toBe("classic");
    expect(parseLayout("wide")).toBe("wide");
    expect(parseListOpen(null)).toBe(false);
    expect(parseListOpen("thin")).toBe(false);
    expect(parseListOpen("open")).toBe(true);
  });

  test("the thin list keeps every worktree, unfinished work first", () => {
    const snapshot = {
      projects: [
        project("quiet-repo", [worktree("q")]),
        project("scout", [
          worktree("clean"),
          worktree("dirty", { attention: "active", status: { clean: false, staged: 0, unstaged: 3, untracked: 0, conflicts: 0, changedFiles: 3, files: [] } }),
        ], "active"),
      ],
    } as unknown as RepoWatchSnapshot;
    const groups = thinGroups(snapshot);
    expect(groups.map((g) => g.name)).toEqual(["scout", "quiet-repo"]);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["dirty", "clean"]);
    expect(groups.flatMap((g) => g.rows)).toHaveLength(3);
    expect(groups[0]!.rows[0]!.state).toBe("dirty");
  });

  test("a row reads its files changed, then drift; nothing when clean and level", () => {
    const base = { id: "a", path: "/a", name: "a", branch: null, state: "clean" as const, agents: 0 };
    expect(thinReading({ ...base, changed: 0, ahead: 0, behind: 0 })).toBe("");
    expect(thinReading({ ...base, changed: 4, ahead: 2, behind: 1 })).toBe("4 ↑2 ↓1");
  });
});
