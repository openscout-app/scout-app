import { describe, expect, test } from "bun:test";
import type { CanvasData } from "../../../../shared/canvas.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import type { RepoWatchWorktree } from "../../../scout/repo-watch/types.ts";
import { canvasForProject, checkoutAlert, churn, gib, requestsForProject, reviewRows, workingRows, worktreeCounts } from "./project-snapshot-model.ts";
import type { SessionItem } from "./projects-model.ts";
import { MAC_HOME_ROOT } from "../../../../test-support/path-fixtures.ts";

const request = (id: string, over: Partial<OperatorAttentionItem>): OperatorAttentionItem =>
  ({ id, kind: "question", title: id, summary: null, detail: null, agentId: null, agentName: null, conversationId: null, updatedAt: 0, severity: "info", sourceLabel: "", actions: [], ...over }) as OperatorAttentionItem;

const session = (id: string, group: SessionItem["group"], lastActivityAt: number) => ({ id, group, lastActivityAt }) as SessionItem;

describe("requestsForProject", () => {
  test("keeps a permission inside a root, or a request from the project's agents or conversations, oldest first", () => {
    const items = [
      request("perm-in", { updatedAt: 3, permission: { requestId: "r", version: "1", sessionId: "s", projectRoot: `${MAC_HOME_ROOT}/me/dev/app/sub` } }),
      request("perm-out", { updatedAt: 1, permission: { requestId: "r", version: "1", sessionId: "s", projectRoot: `${MAC_HOME_ROOT}/me/dev/application` } }),
      request("agent", { updatedAt: 2, agentId: "a1" }),
      request("conv", { updatedAt: 1, conversationId: "c1" }),
      request("other", { updatedAt: 0, agentId: "zz" }),
    ];
    const kept = requestsForProject(items, ["~/dev/app"], [{ agentId: "a1", conversationId: null }, { agentId: null, conversationId: "c1" }]);
    expect(kept.map((item) => item.id)).toEqual(["conv", "agent", "perm-in"]);
  });
});

describe("workingRows", () => {
  test("live first, then the newest quiet ones up to the limit; every live row stays", () => {
    const items = [session("q1", "recent", 9), session("w1", "working", 5), session("q2", "recent", 8), session("n1", "needs", 7), session("q3", "recent", 1)];
    expect(workingRows(items, 4)).toEqual({ rows: [items[3], items[1], items[0], items[2]], live: 2 });
    expect(workingRows(items, 1).rows.map((row) => row.id)).toEqual(["n1", "w1"]);
  });
});

describe("reviewRows and churn", () => {
  test("ready pull requests newest first, drafts counted", () => {
    const pr = (number: number, isDraft: boolean, createdAt: number) => ({ number, isDraft, createdAt, additions: number, deletions: 1 }) as never;
    const { ready, drafts } = reviewRows([pr(1, false, 1), pr(2, true, 5), pr(3, false, 9)]);
    expect(ready.map((p) => p.number)).toEqual([3, 1]);
    expect(drafts).toBe(1);
    expect(churn([{ additions: 4, deletions: 1 }, { additions: 6, deletions: 2 }])).toEqual({ additions: 10, deletions: 3 });
  });
});

describe("canvasForProject", () => {
  test("the items whose agent works in the project, pictures newest first", () => {
    const data = {
      projects: [{ name: "app" }, { name: "other" }],
      agents: [{ project: "app" }, { project: "other" }],
      items: [
        { key: "a", kind: "image", agent: 0, at: 1, how: "captured" },
        { key: "b", kind: "doc", agent: 0, at: 5, how: "shown" },
        { key: "c", kind: "image", agent: 0, at: 9, how: "shown" },
        { key: "d", kind: "image", agent: 1, at: 9, how: "shown" },
      ],
    } as unknown as CanvasData;
    const read = canvasForProject(data, ["folder", "app"]);
    expect(read?.images.map((item) => item.key)).toEqual(["c", "a"]);
    expect(read?.total).toBe(3);
    expect(read?.shown).toBe(2);
    expect(read?.name).toBe("app");
    expect(canvasForProject(data, ["folder"])?.total).toBe(0);
    expect(canvasForProject(null, ["app"])).toBeNull();
  });
});

describe("checkoutAlert", () => {
  const main = { ref: "origin/main", sha: "abc", subject: "", at: 0 };
  test("says how main's own checkout drifted", () => {
    expect(checkoutAlert({ main, checkout: { branch: "main", ahead: 18, behind: 0, uncommitted: 4 } })).toBe(
      "Your checkout of main has 18 commits that are not on origin/main, and 4 uncommitted files",
    );
    expect(checkoutAlert({ main, checkout: { branch: "main", ahead: 1, behind: 0, uncommitted: 0 } })).toBe("Your checkout of main has 1 commit that is not on origin/main");
    expect(checkoutAlert({ main, checkout: { branch: "main", ahead: 0, behind: 3, uncommitted: 1 } })).toBe("Your checkout of main has 1 uncommitted file");
  });
  test("raises nothing for a clean main, a feature branch, or a missing read", () => {
    expect(checkoutAlert({ main, checkout: { branch: "main", ahead: 0, behind: 9, uncommitted: 0 } })).toBeNull();
    expect(checkoutAlert({ main, checkout: { branch: "feat/x", ahead: 4, behind: 0, uncommitted: 2 } })).toBeNull();
    expect(checkoutAlert({ main: null, checkout: { branch: "main", ahead: 4, behind: 0, uncommitted: 2 } })).toBeNull();
    expect(checkoutAlert(null)).toBeNull();
  });
});

describe("worktreeCounts and gib", () => {
  test("counts checkouts with uncommitted work and with a session", () => {
    const wt = (changedFiles: number, sessions: number) => ({ status: { changedFiles }, sessions: Array.from({ length: sessions }) }) as unknown as RepoWatchWorktree;
    expect(worktreeCounts([wt(0, 0), wt(3, 1), wt(1, 0)])).toEqual({ total: 3, uncommitted: 2, withSession: 1 });
  });
  test("one decimal under 100 GiB, whole above", () => {
    expect(gib(10.67 * 1024 ** 3)).toBe("10.7");
    expect(gib(245.2 * 1024 ** 3)).toBe("245");
  });
});
