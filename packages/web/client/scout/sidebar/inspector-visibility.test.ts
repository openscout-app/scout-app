import { describe, expect, test } from "bun:test";
import type { Route } from "../../lib/types.ts";
import { routeHasMeaningfulInspector } from "./inspector-visibility.ts";

const noSelection = {
  hasBrokerAttempt: false,
  hasKnowledgeHit: false,
};

function visible(route: Route, selection = noSelection): boolean {
  return routeHasMeaningfulInspector(route, selection);
}

describe("context inspector visibility", () => {
  test("does not reserve a panel for routes without a right-pane surface", () => {
    const routes: Route[] = [
      { view: "activity" },
      { view: "briefings" },
      { view: "code" },
      { view: "follow" },
      { view: "harnesses" },
      { view: "inbox" },
      { view: "ops", mode: "lanes" },
      { view: "ops", mode: "world" },
      { view: "repo-diff", path: "/repo" },
      { view: "sessions", flightId: "flight-1" },
      { view: "sessions" },
      { view: "sessions", sessionId: "s" },
      { view: "settings", section: "appearance" },
      { view: "settings", section: "agents", agentId: "agent-1" },
      { view: "voice" },
    ];

    for (const route of routes) expect(visible(route)).toBe(false);
  });

  test("directory routes wait for a concrete selection", () => {
    // Agents and Agent are compositions: the feed's peek draws in its Agent
    // activity panel and an agent's session in its Agent session panel
    expect(visible({ view: "agents-v2" })).toBe(false);
    expect(visible({ view: "agents-v2", selectedAgentId: "agent-1" })).toBe(false);
    expect(visible({ view: "agents-v2", sessionId: "session-1" })).toBe(false);
    expect(visible({ view: "agents-v2", agentId: "agent-1" })).toBe(false);

    expect(visible({ view: "messages" })).toBe(false);
    expect(visible({ view: "messages", conversationId: "chat-1" })).toBe(true);

    // Search is a composition: its Result panel shows the hit, never the shell inspector
    expect(visible({ view: "search", hitId: "hit-1" })).toBe(false);
    expect(visible(
      { view: "search", hitId: "hit-1" },
      { ...noSelection, hasKnowledgeHit: true },
    )).toBe(false);

    // Dispatch is a composed view: its Ledger panel draws the open dispatch,
    // so the shell's inspector never opens there, selection or not.
    expect(visible({ view: "broker", attemptId: "attempt-1" })).toBe(false);
    expect(visible(
      { view: "broker", attemptId: "attempt-1" },
      { ...noSelection, hasBrokerAttempt: true },
    )).toBe(false);

    // The work page draws its own detail pane, on bare /work and on /work/:id.
    expect(visible({ view: "work", workId: "work-1" })).toBe(false);
    expect(visible({ view: "work", workId: "" })).toBe(false);

    // Network and Mesh Ops are compositions: their Machine and Item panels draw what the inspector did
    expect(visible({ view: "mesh" })).toBe(false);
    expect(visible({ view: "mesh", machineId: "mini" })).toBe(false);
    expect(visible({ view: "mesh-ops", itemId: "w-1" })).toBe(false);
  });

  test("keeps inspectors that carry route-level or directory summary context", () => {
    const routes: Route[] = [
      { view: "agent-info", conversationId: "chat-1" },
      { view: "conversation", conversationId: "chat-1" },
    ];

    for (const route of routes) expect(visible(route)).toBe(true);
  });

  test("Repos is a composition: its Worktree panel draws the selection the inspector did", () => {
    expect(visible({ view: "repos" })).toBe(false);
    expect(visible({ view: "repos", root: "/repo" })).toBe(false);
    expect(visible({ view: "repo-diff", path: "/repo" })).toBe(false);
  });

  test("Ops › Control is a composition: its Ops summary panel draws what the inspector did", () => {
    expect(visible({ view: "ops", mode: "mission" })).toBe(false);
    expect(visible({ view: "ops" })).toBe(false);
    expect(visible({ view: "ops", mode: "mission", sessionId: "s" })).toBe(false);
  });

  test("a terminal's page is the Terminal view: its Details panel is the inspector", () => {
    expect(visible({ view: "terminal", agentId: "agent-1" })).toBe(false);
    expect(visible({ view: "terminal", terminalSurfaceKey: "tmux:work", mode: "observe" })).toBe(false);
  });
});
