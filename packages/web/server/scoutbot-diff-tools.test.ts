import { describe, expect, test } from "bun:test";

import { changedWorktrees, createScoutbotDiffTools, renderChangedWorktrees, renderDiff } from "./scoutbot-diff-tools.ts";

const worktree = (path: string, overrides: Record<string, unknown> = {}) => ({
  path,
  branch: { name: "feat/x", upstream: "origin/feat/x", ahead: 0, behind: 0, isMain: false },
  status: { staged: 0, unstaged: 0, untracked: 0, conflicts: 0, changedFiles: 0 },
  diff: { branchShortstat: null, unstagedShortstat: null, stagedShortstat: null },
  agents: [],
  ...overrides,
});

const WATCH = {
  generatedAt: 1,
  projects: [{
    name: "demo-app",
    root: "/work/demo-app",
    worktrees: [
      worktree("/work/demo-app", { lastTouchedAt: 10 }),
      worktree("/work/demo-app-a", {
        status: { staged: 1, unstaged: 2, untracked: 1, conflicts: 0, changedFiles: 4 },
        diff: { branchShortstat: null, unstagedShortstat: "3 files changed, 20 insertions(+)", stagedShortstat: null },
        agents: [
          { id: "s1", name: "idle-one", state: "idle", harness: "claude" },
          { id: "s2", name: "idle-one", state: "idle", harness: "claude" },
          { id: "s3", name: "lovelace", state: "working", harness: "codex" },
        ],
        lastTouchedAt: 20,
      }),
      worktree("/work/demo-app-b", {
        branch: { name: "feat/b", upstream: null, ahead: 3, behind: 1, isMain: false },
        diff: { branchShortstat: "5 files changed, 80 insertions(+), 4 deletions(-)", unstagedShortstat: null, stagedShortstat: null },
        lastTouchedAt: 30,
      }),
    ],
  }],
  warnings: [],
};

const DIFF = {
  worktreePath: "/work/demo-app-a",
  layers: [
    { kind: "branch", baseLabel: "origin/main", compareLabel: "HEAD", rawPatch: null, truncated: false, files: [], shortstat: null },
    {
      kind: "unstaged", baseLabel: "index", compareLabel: "worktree", truncated: false, shortstat: "2 files changed, 12 insertions(+), 1 deletion(-)",
      rawPatch: `diff --git a/src/a.ts b/src/a.ts\n${"+line\n".repeat(400)}`,
      files: [
        { oldPath: "src/a.ts", newPath: "src/a.ts", status: "modified", binary: false, additions: 10, deletions: 1, truncated: false },
        { oldPath: "src/old.ts", newPath: "src/new.ts", status: "renamed", binary: false, additions: 2, deletions: 0, truncated: false },
      ],
    },
  ],
  diagnostics: [],
};

describe("Scoutbot panel diff tools", () => {
  test("list worktrees with work in progress, most recently touched first, with distinct agents working first", () => {
    const rows = changedWorktrees(WATCH);
    expect(rows.map((row) => row.path)).toEqual(["/work/demo-app-b", "/work/demo-app-a"]);
    expect(rows[1]).toMatchObject({ agents: ["lovelace", "idle-one"], agentCount: 2 });
    expect(renderChangedWorktrees([], { limit: 5, loading: true, warnings: [] })).toContain("not evidence that nothing is changing");
  });

  test("a patch read is cut at the budget and says so; a summary carries no patch text", () => {
    const summary = renderDiff(DIFF as never, { detail: "summary", maxChars: 40_000 });
    expect(summary.text).toContain("renamed src/old.ts -> src/new.ts +2 -0");
    expect(summary.text).not.toContain("+line");
    const patch = renderDiff(DIFF as never, { detail: "patch", maxChars: 2_000 });
    expect(patch.cut).toBe(true);
    expect(patch.text).toContain("[Patch cut at 2000 characters.");
  });

  test("the tools read the runtime's Repo Watch and worktree diff routes", async () => {
    const paths: string[] = [];
    const [list, read] = createScoutbotDiffTools(async (path) => {
      paths.push(path);
      return path.startsWith("/v1/repo-watch/") ? WATCH : DIFF;
    });
    expect([list.name, read.name]).toEqual(["worktrees_changes", "diff_read"]);
    const listed = await (list as any).execute({ project: "demo-app-a" });
    expect(listed.content[0].text).toContain("/work/demo-app-a (demo-app, feat/x): 1 staged, 2 unstaged, 1 untracked");
    const diff = await (read as any).execute({ path: " /work/demo-app-a ", files: ["src/a.ts", "src/a.ts"], layers: ["unstaged"], detail: "patch", maxChars: 999_999 });
    expect(diff.content[0].text).toContain("--- Not staged patch ---");
    expect(paths).toEqual([
      "/v1/repo-watch/snapshot?includeDiff=1&maxWorktrees=64",
      "/v1/repo-diff/worktree?path=%2Fwork%2Fdemo-app-a&tier=patch&file=src%2Fa.ts&layers=unstaged",
    ]);
  });
});
