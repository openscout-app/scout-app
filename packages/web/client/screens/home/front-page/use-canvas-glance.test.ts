import { describe, expect, test } from "bun:test";
import type { HomeRunning } from "./front-page-running.ts";
import { glanceAgents } from "./use-canvas-glance.ts";

const row = (id: string, project: string, state: HomeRunning["state"], sessionId: string | null = id): HomeRunning => ({
  id, project, title: id, agent: { name: id, harness: "codex" }, since: null, at: 0, state, stateSince: null, progress: null, trace: [],
  refs: { pr: null, branch: null, worktree: null, projectPath: null, host: null, harness: null, model: null, terminal: null },
  open: sessionId ? { view: "sessions", sessionId } : null,
});

describe("the glance's agents", () => {
  test("those at work or waiting, in a steady order, by their session", () => {
    const agents = glanceAgents([row("b", "scout", "working"), row("z", "arc", "waiting"), row("a", "scout", "idle"), row("c", "arc", "working", null)]);
    expect(agents.map((a) => a.id)).toEqual(["c", "z", "b"]);
    expect(agents.map((a) => a.sessionId)).toEqual([null, "z", "b"]);
    expect(agents.find((a) => a.id === "z")?.asks).toBe(true);
  });

  test("Running reordering itself does not move an area", () => {
    const one = glanceAgents([row("a", "p", "working"), row("b", "p", "working")]);
    const two = glanceAgents([row("b", "p", "working"), row("a", "p", "working")]);
    expect(two).toEqual(one);
  });
});
