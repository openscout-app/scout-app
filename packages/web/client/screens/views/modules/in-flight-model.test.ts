import { describe, expect, test } from "bun:test";
import type { RepoPullRequestItem } from "../../../scout/repo-watch/api.ts";
import { project, snapshot, worktree } from "../../repos/repos-fixtures.ts";
import { driftLabel, FAR_BEHIND, inFlightRows, inFlightSummary, LEFT_AFTER_MS, whoLabel } from "./in-flight-model.ts";

const HOUR = 3_600_000;

const pr = (number: number, headRefName: string, path: string, isDraft = false): RepoPullRequestItem => ({
  id: `pr-${number}`,
  repo: "me/scout",
  path,
  number,
  title: `PR ${number}`,
  url: `https://github.com/me/scout/pull/${number}`,
  state: "OPEN",
  isDraft,
  headRefName,
  baseRefName: "main",
  author: null,
  updatedAt: null,
});

const agent = (id: string, name: string, state: string | null) => ({ id, name, state, harness: "claude" });

describe("which worktrees are in flight", () => {
  const snap = {
    ...snapshot([
      project("scout", "/dev/scout", [
        // a clean main checkout with a registered agent and no endpoint: not in flight
        worktree("main", "/dev/scout", { branchName: "main", agents: [agent("a0", "scout", null)] }),
        // uncommitted changes
        worktree("dirty", "/dev/wt/dirty", { branchName: "dirty", changedFiles: 3, lastCommitAt: 10 * HOUR }),
        // clean, but its branch has an open PR
        worktree("pr", "/dev/wt/pr", { branchName: "feat/pr", lastCommitAt: 5 * HOUR }),
        // clean, someone working on it
        worktree("agent", "/dev/wt/agent", { branchName: "agent", agents: [agent("a1", "hume-7", "working")], lastCommitAt: 2 * HOUR }),
        // clean, an idle agent only: nobody is on it now, so not in flight
        worktree("idle", "/dev/wt/idle", { branchName: "idle", agents: [agent("a3", "resting", "idle")] }),
        // clean, an offline agent only: not in flight
        worktree("offline", "/dev/wt/offline", { branchName: "offline", agents: [agent("a2", "old", "offline")] }),
        // a bare repo never counts
        worktree("bare", "/dev/wt/bare", { isBare: true, changedFiles: 1 }),
      ]),
      // uncommitted changes; a session file Tail once found there is not someone on it
      project("site", "/dev/site", [worktree("site", "/dev/site", { branchName: "main", changedFiles: 1, sessions: [{ id: "sess-1", source: "codex", harness: "codex" }], lastCommitAt: 1 * HOUR })]),
    ]),
    generatedAt: 20 * HOUR,
  };

  test("uncommitted changes, a PR on the branch, or someone on it; nothing else", () => {
    const rows = inFlightRows(snap, [pr(12, "feat/pr", "/dev/scout")]);
    expect(rows.map((r) => r.id).sort()).toEqual(["agent", "dirty", "pr", "site"]);
  });

  test("across every repo, the project named on each line", () => {
    const rows = inFlightRows(snap, []);
    expect(rows.find((r) => r.id === "site")).toMatchObject({ project: "site", branch: "main", on: [] });
    expect(rows.find((r) => r.id === "agent")).toMatchObject({ on: ["hume-7"], live: true });
    expect(rows.find((r) => r.id === "dirty")).toMatchObject({ project: "scout", branch: "dirty" });
  });

  test("a PR on the branch is matched to its worktree, draft as a word", () => {
    const rows = inFlightRows(snap, [pr(12, "feat/pr", "/dev/scout", true)]);
    expect(rows.find((r) => r.id === "pr")?.pr).toMatchObject({ number: 12, state: "draft" });
    expect(rows.find((r) => r.id === "dirty")?.pr).toBeNull();
  });

  test("newest activity first: someone live is now, then by last commit", () => {
    const live = {
      ...snap,
      projects: [
        ...snap.projects,
        project("talkie", "/dev/talkie", [worktree("talkie", "/dev/talkie", { branchName: "master", live: 1, lastCommitAt: 0 })]),
      ],
    };
    const rows = inFlightRows(live, [pr(12, "feat/pr", "/dev/scout")]);
    expect(rows.map((r) => r.id)).toEqual(["agent", "talkie", "dirty", "pr", "site"]);
    expect(rows[0]).toMatchObject({ live: true, activityAt: 20 * HOUR });
  });

  test("a worktree with no commit time sorts last", () => {
    const unknown = { ...snap, projects: [project("x", "/dev/x", [worktree("old", "/dev/x", { changedFiles: 1 }), worktree("new", "/dev/x2", { changedFiles: 1, lastCommitAt: HOUR })])] };
    expect(inFlightRows(unknown, []).map((r) => r.id)).toEqual(["new", "old"]);
  });

  test("a checkout that is only dirty and has not moved in two weeks was left, not in flight; a PR keeps it", () => {
    const now = 100 * 24 * HOUR;
    const old = now - LEFT_AFTER_MS - HOUR;
    const left = {
      ...snapshot([project("x", "/dev/x", [
        worktree("left", "/dev/x", { changedFiles: 4, lastCommitAt: old }),
        worktree("left-pr", "/dev/x2", { branchName: "feat/old", changedFiles: 1, lastCommitAt: old }),
        worktree("recent", "/dev/x3", { changedFiles: 1, lastCommitAt: now - HOUR }),
      ])]),
      generatedAt: now,
    };
    expect(inFlightRows(left, [pr(7, "feat/old", "/dev/x")]).map((r) => r.id).sort()).toEqual(["left-pr", "recent"]);
  });

  test("no snapshot, no rows", () => {
    expect(inFlightRows(null, [])).toEqual([]);
  });

  test("the line opens the diff when there is one, else Repos", () => {
    const rows = inFlightRows(snap, [pr(12, "feat/pr", "/dev/scout")]);
    expect(rows.find((r) => r.id === "dirty")?.opens).toEqual({ view: "repo-diff", path: "/dev/wt/dirty" });
    expect(rows.find((r) => r.id === "agent")?.opens).toEqual({ view: "repos", root: "/dev/wt/agent" });
  });
});

describe("how a line reads", () => {
  test("drift: even, ahead and behind, far past the threshold", () => {
    expect(driftLabel(0, 0)).toEqual({ text: "even", far: false });
    expect(driftLabel(6, 3)).toEqual({ text: "↑6 ↓3", far: false });
    expect(driftLabel(2, 0)).toEqual({ text: "↑2", far: false });
    expect(driftLabel(0, FAR_BEHIND)).toEqual({ text: `↓${FAR_BEHIND}`, far: false });
    expect(driftLabel(1, FAR_BEHIND + 1).far).toBe(true);
  });

  test("who: the first name and +N, else how long it has been quiet", () => {
    expect(whoLabel({ on: ["claude · board", "codex · vivaldi-6"], activityAt: 0 }, 0)).toBe("claude · board +1");
    expect(whoLabel({ on: ["hume-7"], activityAt: 0 }, 0)).toBe("hume-7");
    expect(whoLabel({ on: [], activityAt: 0 }, 26 * HOUR)).toBe("quiet 1d");
    expect(whoLabel({ on: [], activityAt: null }, 0)).toBe("quiet");
  });

  test("the summary counts worktrees, PRs and live ones", () => {
    const base = { churn: { add: 0, del: 0, files: 0 }, ahead: 0, behind: 0, dirty: true, on: [], activityAt: null, opens: { view: "repos" } as const };
    const row = (id: string, extra: object) => ({ id, path: id, project: "p", branch: id, pr: null, live: false, ...base, ...extra });
    expect(inFlightSummary([row("a", {}), row("b", { pr: { number: 1, state: "open", title: "", url: "" }, live: true })])).toBe("2 worktrees with work · 1 PR · 1 live");
    expect(inFlightSummary([row("a", {})])).toBe("1 worktree with work");
  });
});
