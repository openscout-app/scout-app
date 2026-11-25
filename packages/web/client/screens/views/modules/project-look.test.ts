import { describe, expect, test } from "bun:test";
import type { RepoWatchWorktree } from "../../../scout/repo-watch/types.ts";
import { branchFiles, homeForm, worktreeOfSession } from "./project-look.tsx";
import { MAC_HOME_ROOT } from "../../../../test-support/path-fixtures.ts";

const wt = (path: string, branch: string, sessions: string[] = []) =>
  ({ path, name: path.split("/").pop(), isBare: false, branch: { name: branch, isMain: branch === "main", detached: false }, sessions: sessions.map((id) => ({ id })) }) as unknown as RepoWatchWorktree;

const checkouts = [wt(`${MAC_HOME_ROOT}/me/dev/app`, "main"), wt(`${MAC_HOME_ROOT}/me/dev/app-panes`, "panes", ["s-attached"])];

describe("a session's worktree", () => {
  test("matches a workspace root written from home, as sessions report it", () => {
    expect(worktreeOfSession({ workspaceRoot: "~/dev/app-panes", sessionId: "x", branch: "other" }, checkouts)?.path).toBe(`${MAC_HOME_ROOT}/me/dev/app-panes`);
  });

  test("matches the checkout holding a subfolder, the deepest one first", () => {
    expect(worktreeOfSession({ workspaceRoot: `${MAC_HOME_ROOT}/me/dev/app-panes/packages/web/`, sessionId: "x", branch: "" }, checkouts)?.path).toBe(`${MAC_HOME_ROOT}/me/dev/app-panes`);
  });

  test("falls back to the session Repo Watch attaches, then the branch", () => {
    expect(worktreeOfSession({ workspaceRoot: "/elsewhere", sessionId: "s-attached", branch: "" }, checkouts)?.path).toBe(`${MAC_HOME_ROOT}/me/dev/app-panes`);
    expect(worktreeOfSession({ workspaceRoot: "", sessionId: "x", branch: "main" }, checkouts)?.path).toBe(`${MAC_HOME_ROOT}/me/dev/app`);
    expect(worktreeOfSession({ workspaceRoot: "/elsewhere", sessionId: "x", branch: "gone" }, checkouts)).toBeNull();
  });

  test("home form folds macOS and Linux homes and drops a trailing slash", () => {
    expect(homeForm(`${MAC_HOME_ROOT}/me/dev/x/`)).toBe("~/dev/x");
    expect(homeForm("/home/me/dev/x")).toBe("~/dev/x");
    expect(homeForm(`${MAC_HOME_ROOT}/me`)).toBe("~");
    expect(homeForm("~/dev/x")).toBe("~/dev/x");
  });
});

describe("a branch's files", () => {
  test("one row per file across the layers, lines summed, the newest layer's status", () => {
    const f = (path: string, status: string, additions: number, deletions: number) => ({ oldPath: path, newPath: path, status, additions, deletions });
    const layers = [
      { files: [f("b.ts", "added", 10, 0), f("a.ts", "modified", 2, 1)] },
      { files: [f("b.ts", "modified", 3, 2)] },
    ] as unknown as Parameters<typeof branchFiles>[0];
    expect(branchFiles(layers)).toEqual([
      { path: "a.ts", status: "modified", add: 2, del: 1 },
      { path: "b.ts", status: "modified", add: 13, del: 2 },
    ]);
  });
});
