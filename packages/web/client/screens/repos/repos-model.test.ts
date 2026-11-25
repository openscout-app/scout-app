import { describe, expect, test } from "bun:test";

import type { RepoPullRequestItem } from "../../scout/repo-watch/api.ts";
import { project, snapshot, twoRepos, worktree } from "./repos-fixtures.ts";
import {
  canDiffWorktree,
  pageRepoTarget,
  pickToWrite,
  prefetchWorktreePaths,
  projectForRoot,
  pullRequestGroups,
  repoPrPaths,
  resolveRepoSelection,
  samePath,
  type RepoTarget,
} from "./repos-model.ts";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";

describe("samePath / projectForRoot", () => {
  test("a trailing slash or ~ names the same checkout", () => {
    expect(samePath(`${MAC_HOME_ROOT}/me/dev/scout/`, `${MAC_HOME_ROOT}/me/dev/scout`)).toBe(true);
    expect(samePath("~/dev/scout", `${MAC_HOME_ROOT}/me/dev/scout`)).toBe(true);
    expect(samePath(`${MAC_HOME_ROOT}/me/dev/scout`, `${MAC_HOME_ROOT}/me/dev/site`)).toBe(false);
    expect(samePath(null, "/x")).toBe(false);
  });

  test("a repo is found by its root or any of its worktrees", () => {
    const snap = twoRepos();
    expect(projectForRoot(snap, "/example/me/dev/scout")?.id).toBe("scout");
    expect(projectForRoot(snap, "/example/me/dev/scout-wt/feat/")?.id).toBe("scout");
    expect(projectForRoot(snap, "/example/me/dev/elsewhere")).toBeNull();
  });
});

describe("resolveRepoSelection, the page's way", () => {
  const snap = twoRepos();

  test("no snapshot: nothing, not missing", () => {
    expect(resolveRepoSelection(null, "/example/me/dev/scout", null, "page")).toEqual({ project: null, worktree: null, missing: false, seed: false });
  });

  test("a non-main worktree's own path selects that worktree, over any pick", () => {
    const sel = resolveRepoSelection(snap, "/example/me/dev/scout-wt/feat", "site-main", "page");
    expect(sel.worktree?.id).toBe("scout-feat");
    expect(sel.project?.id).toBe("scout");
    expect(sel.seed).toBe(false);
  });

  test("a repo root keeps the pick when it is in that repo", () => {
    const sel = resolveRepoSelection(snap, "/example/me/dev/scout", "scout-main", "page");
    expect(sel.worktree?.id).toBe("scout-main");
    expect(sel.seed).toBe(false);
  });

  test("a repo root with the pick elsewhere seeds the repo's busiest", () => {
    const sel = resolveRepoSelection(snap, "/example/me/dev/scout", "site-main", "page");
    expect(sel.worktree?.id).toBe("scout-feat");
    expect(sel.seed).toBe(true);
  });

  test("a root the scan holds no repo for is missing", () => {
    const sel = resolveRepoSelection(snap, "/example/me/dev/elsewhere", "scout-main", "page");
    expect(sel).toEqual({ project: null, worktree: null, missing: true, seed: false });
  });

  test("no root keeps the pick, else seeds the busiest anywhere", () => {
    expect(resolveRepoSelection(snap, null, "site-main", "page").worktree?.id).toBe("site-main");
    const seeded = resolveRepoSelection(snap, null, null, "page");
    expect(seeded.worktree?.id).toBe("scout-feat");
    expect(seeded.project?.id).toBe("scout");
    expect(seeded.seed).toBe(true);
    // a pick the scan lost seeds again
    expect(resolveRepoSelection(snap, null, "gone", "page").seed).toBe(true);
  });

  test("an empty scan selects nothing", () => {
    expect(resolveRepoSelection(snapshot([]), null, null, "page")).toEqual({ project: null, worktree: null, missing: false, seed: false });
  });
});

describe("resolveRepoSelection, exactly", () => {
  const snap = twoRepos();

  test("the main checkout's path selects the main checkout, not the busiest", () => {
    const sel = resolveRepoSelection(snap, "/example/me/dev/scout", null, "exact");
    expect(sel.worktree?.id).toBe("scout-main");
    expect(sel.seed).toBe(false);
  });

  test("ignores the page's pick", () => {
    expect(resolveRepoSelection(snap, "/example/me/dev/site", "scout-feat", "exact").worktree?.id).toBe("site-main");
  });

  test("a path inside no worktree but in a repo (its root) falls back to the busiest", () => {
    const bare = snapshot([
      project("lib", "/example/me/dev/lib", [
        worktree("lib-a", "/example/me/dev/lib-wt/a"),
        worktree("lib-b", "/example/me/dev/lib-wt/b", { changedFiles: 2 }),
      ]),
    ]);
    const sel = resolveRepoSelection(bare, "/example/me/dev/lib", null, "exact");
    expect(sel.worktree?.id).toBe("lib-b");
    expect(sel.seed).toBe(true);
  });
});

describe("pickToWrite", () => {
  const snap = twoRepos();
  const follows: RepoTarget = { root: null, mode: "page", leads: false, writes: true };
  const leads: RepoTarget = { root: "/example/me/dev/scout-wt/feat", mode: "page", leads: true, writes: true };
  const pinned: RepoTarget = { root: "/example/me/dev/site", mode: "exact", leads: false, writes: false };

  test("a seeded default is written so later scans don't move it", () => {
    const sel = resolveRepoSelection(snap, null, null, "page");
    expect(pickToWrite(follows, sel, null, false)).toBe("scout-feat");
  });

  test("a follower leaves a live pick alone", () => {
    const sel = resolveRepoSelection(snap, null, "site-main", "page");
    expect(pickToWrite(follows, sel, "site-main", true)).toBeNull();
  });

  test("what the URL shows on its own route becomes the pick", () => {
    const sel = resolveRepoSelection(snap, leads.root, "site-main", "page");
    expect(pickToWrite(leads, sel, "site-main", true)).toBe("scout-feat");
  });

  test("a follower replaces a pick the scan lost", () => {
    const sel = resolveRepoSelection(snap, "/example/me/dev/scout-wt/feat", "gone", "page");
    expect(pickToWrite(follows, sel, "gone", false)).toBe("scout-feat");
  });

  test("a pinned panel never writes", () => {
    const sel = resolveRepoSelection(snap, pinned.root, null, "exact");
    expect(pickToWrite(pinned, sel, null, false)).toBeNull();
  });

  test("nothing selected, or already the pick: nothing to write", () => {
    expect(pickToWrite(leads, { project: null, worktree: null, missing: true, seed: false }, null, false)).toBeNull();
    const sel = resolveRepoSelection(snap, leads.root, "scout-feat", "page");
    expect(pickToWrite(leads, sel, "scout-feat", true)).toBeNull();
  });
});

describe("pageRepoTarget", () => {
  test("/repos reads its root the page's way and leads", () => {
    expect(pageRepoTarget({ view: "repos", root: " /a/b ", machineId: "m1" })).toEqual({ root: "/a/b", mode: "page", leads: true, writes: true });
    expect(pageRepoTarget({ view: "repos" })).toEqual({ root: null, mode: "page", leads: true, writes: true });
  });

  test("/repo-diff reads its path exactly and leads", () => {
    expect(pageRepoTarget({ view: "repo-diff", path: "/a/b" })).toEqual({ root: "/a/b", mode: "exact", leads: true, writes: true });
  });

  test("elsewhere the page's pick, followed", () => {
    expect(pageRepoTarget({ view: "search" })).toEqual({ root: null, mode: "page", leads: false, writes: true });
  });
});

describe("canDiffWorktree", () => {
  test("clean and level: nothing to diff", () => {
    expect(canDiffWorktree(worktree("w", "/w"))).toBe(false);
  });

  test("changed files, a branch delta, or commits ahead each have a diff", () => {
    expect(canDiffWorktree(worktree("w", "/w", { changedFiles: 1 }))).toBe(true);
    expect(canDiffWorktree(worktree("w", "/w", { branchShortstat: " 2 files changed, 5 insertions(+)" }))).toBe(true);
    expect(canDiffWorktree(worktree("w", "/w", { ahead: 1 }))).toBe(true);
  });
});

describe("prefetchWorktreePaths", () => {
  test("skips clean, idle, level worktrees and puts the selection first", () => {
    const snap = twoRepos();
    expect(prefetchWorktreePaths(snap, null)).toEqual(["/example/me/dev/scout-wt/feat", "/example/me/dev/site"]);
    expect(prefetchWorktreePaths(snap, "site-main")).toEqual(["/example/me/dev/site", "/example/me/dev/scout-wt/feat"]);
  });
});

describe("repoPrPaths", () => {
  test("one checkout per repo", () => {
    expect(repoPrPaths(twoRepos())).toEqual(["/example/me/dev/scout", "/example/me/dev/site"]);
  });
});

describe("pullRequestGroups", () => {
  function pr(id: string, path: string, repo: string, head: string): RepoPullRequestItem {
    return { id, repo, path, number: Number(id.replace(/\D/gu, "")) || 1, title: id, url: "", state: "OPEN", isDraft: false, headRefName: head, baseRefName: "main", author: null, updatedAt: null };
  }
  const snap = twoRepos();
  const scout = snap.projects[0]!;
  const feat = scout.worktrees[1]!;
  const prs = [
    pr("p1", "/example/me/dev/scout", "me/scout", "feat"),
    pr("p2", "/example/me/dev/scout", "me/scout", "other"),
    pr("p3", "/example/me/dev/site", "me/site", "feat"),
  ];

  test("the selection's branch, then its repo, then the rest", () => {
    const groups = pullRequestGroups(prs, scout, feat);
    expect(groups.map((g) => [g.key, g.label, g.items.map((p) => p.id)])).toEqual([
      ["branch", "Selected branch · feat", ["p1"]],
      ["project", "scout PRs", ["p2"]],
      ["other", "Other open PRs", ["p3"]],
    ]);
  });

  test("no selection: one plain group", () => {
    const groups = pullRequestGroups(prs, null, null);
    expect(groups.map((g) => [g.key, g.label, g.items.length])).toEqual([["other", "Open PRs", 3]]);
  });

  test("no pull requests: no groups", () => {
    expect(pullRequestGroups([], scout, feat)).toEqual([]);
  });
});
