import { describe, expect, test } from "bun:test";

import type { Agent } from "./types.ts";
import { scoutbotUiContext } from "../../shared/scoutbot-navigation.ts";
import {
  extractScoutbotOffers,
  extractScoutbotUiActions,
  forwardScoutbotUiActionToNativeHost,
  normalizeScoutbotUiAction,
  resolveScoutbotAgentId,
  stripScoutbotUiFences,
} from "./scoutbot.ts";

function agent(input: Partial<Agent> & { id: string }): Agent {
  return {
    id: input.id,
    definitionId: input.definitionId ?? input.id,
    name: input.name ?? input.id,
    handle: input.handle ?? null,
    authorityNodeId: null,
    authorityNodeName: null,
    agentClass: input.agentClass ?? "general",
    harness: input.harness ?? "codex",
    state: input.state ?? null,
    projectRoot: input.projectRoot ?? null,
    cwd: input.cwd ?? null,
    updatedAt: input.updatedAt ?? null,
    createdAt: input.createdAt ?? null,
    transport: input.transport ?? "codex_app_server",
    selector: input.selector ?? null,
    defaultSelector: input.defaultSelector ?? null,
    nodeQualifier: input.nodeQualifier ?? null,
    workspaceQualifier: input.workspaceQualifier ?? null,
    wakePolicy: input.wakePolicy ?? "on_demand",
    capabilities: input.capabilities ?? ["chat", "invoke", "deliver"],
    project: input.project ?? null,
    branch: input.branch ?? null,
    role: input.role ?? null,
    model: input.model ?? null,
    harnessSessionId: input.harnessSessionId ?? null,
    terminalSurface: input.terminalSurface ?? null,
    harnessLogPath: input.harnessLogPath ?? null,
    conversationId: input.conversationId ?? null,
    homeNodeId: input.homeNodeId ?? null,
    homeNodeName: input.homeNodeName ?? null,
    ownerId: input.ownerId ?? null,
    ownerName: input.ownerName ?? null,
    ownerHandle: input.ownerHandle ?? null,
    staleLocalRegistration: input.staleLocalRegistration ?? false,
    retiredFromFleet: input.retiredFromFleet ?? false,
    replacedByAgentId: input.replacedByAgentId ?? null,
  };
}

describe("extractScoutbotUiActions + stripScoutbotUiFences", () => {
  test("handles a scout-ui fence (strips + extracts)", () => {
    const body = [
      "Here you go.",
      "```scout-ui",
      '{"type":"navigate","route":{"view":"mesh"}}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([
      { type: "navigate", route: { view: "mesh" } },
    ]);
    expect(stripScoutbotUiFences(body)).toBe("Here you go.");
  });

  test("handles a json fence that carries a known action shape", () => {
    const body = [
      "Opening Scoutbot.",
      "```json",
      '{"action":"open-scoutbot"}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([{ type: "open-scoutbot" }]);
    expect(stripScoutbotUiFences(body)).toBe("Opening Scoutbot.");
  });

  test("leaves unrelated json fences in place", () => {
    const body = [
      "Sample payload:",
      "```json",
      '{"foo":"bar"}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([]);
    expect(stripScoutbotUiFences(body)).toBe(body.trim());
  });

  test("leaves non-json code fences alone", () => {
    const body = [
      "Quick example:",
      "```python",
      'print("hi")',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([]);
    expect(stripScoutbotUiFences(body)).toBe(body.trim());
  });

  test("strips bare fences when payload is a recognized action", () => {
    const body = [
      "Refreshing.",
      "```",
      '{"action":"refresh"}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([{ type: "refresh" }]);
    expect(stripScoutbotUiFences(body)).toBe("Refreshing.");
  });

  test("handles two leaking action fences in one body", () => {
    const body = [
      "```json",
      '{"action":"open-scoutbot"}',
      "```",
      "Reply text.",
      "```json",
      '{"action":"navigate","view":"mesh"}',
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([
      { type: "open-scoutbot" },
      { type: "navigate", route: { view: "mesh" } },
    ]);
    expect(stripScoutbotUiFences(body)).toBe("Reply text.");
  });

  test("normalizes the primary app destinations used by voice navigation", () => {
    const body = [
      "Opening those views.",
      "```scout-ui",
      JSON.stringify([
        { type: "navigate", route: { view: "projects", projectSlug: "openscout" } },
        { type: "navigate", route: { view: "messages", filter: "dm", sort: "unread" } },
        { type: "navigate", route: { view: "settings", section: "voice" } },
        { type: "navigate", route: { view: "repos", root: "/work/openscout" } },
        { type: "navigate", route: { view: "code", project: "openscout", path: "README.md", line: 12, endLine: 16 } },
        { type: "navigate", route: { view: "code", projectSlug: "blink", relativePath: "Sources/App.swift", worktree: "main" } },
      ]),
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([
      { type: "navigate", route: { view: "agents-v2", projectSlug: "openscout" } },
      // Route unification retired filter/sort — the normalizer drops them.
      { type: "navigate", route: { view: "messages" } },
      { type: "navigate", route: { view: "settings", section: "voice" } },
      { type: "navigate", route: { view: "repos", root: "/work/openscout" } },
      { type: "navigate", route: { view: "code", project: "openscout", path: "README.md", line: 12, endLine: 16 } },
      { type: "navigate", route: { view: "code", project: "blink", path: "Sources/App.swift", wt: "main" } },
    ]);
  });

  test("folds the legacy channels intent onto the unified conversation route", () => {
    const body = [
      "```scout-ui",
      JSON.stringify([
        { type: "navigate", route: { view: "channels", channelId: "chan-1" } },
        { type: "navigate", route: { view: "channels" } },
      ]),
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([
      { type: "navigate", route: { view: "messages", conversationId: "chan-1" } },
      { type: "navigate", route: { view: "messages" } },
    ]);
  });
});

describe("forwardScoutbotUiActionToNativeHost", () => {
  test("hands navigation to a native embed instead of its local router", () => {
    const messages: unknown[] = [];
    const action = { type: "navigate", route: { view: "settings", section: "voice" } } as const;

    expect(forwardScoutbotUiActionToNativeHost(action, {
      webkit: {
        messageHandlers: {
          scoutNativeUI: { postMessage: (message) => messages.push(message) },
        },
      },
    })).toBe(true);
    expect(messages).toEqual([{ kind: "ui-action", action }]);
  });

  test("hands composer focus to the native owner", () => {
    const messages: unknown[] = [];
    const action = { type: "focus-composer", reason: "Steer the active conversation" } as const;

    expect(forwardScoutbotUiActionToNativeHost(action, {
      webkit: {
        messageHandlers: {
          scoutNativeUI: { postMessage: (message) => messages.push(message) },
        },
      },
    })).toBe(true);
    expect(messages).toEqual([{ kind: "ui-action", action }]);
  });

  test("hands a matching failure dismissal to native conversation chrome", () => {
    const messages: unknown[] = [];
    const action = {
      type: "dismiss-conversation-failure",
      conversationId: "c-1",
      messageId: "msg-1",
    } as const;

    expect(forwardScoutbotUiActionToNativeHost(action, {
      webkit: {
        messageHandlers: {
          scoutNativeUI: { postMessage: (message) => messages.push(message) },
        },
      },
    })).toBe(true);
    expect(messages).toEqual([{ kind: "ui-action", action }]);
  });

  test("keeps the realtime-voice handler as a compatibility fallback", () => {
    const messages: unknown[] = [];
    const action = {
      type: "navigate",
      route: { view: "code", root: "/repo", file: "/repo/a.ts" },
    } as const;

    expect(forwardScoutbotUiActionToNativeHost(action, {
      webkit: {
        messageHandlers: {
          scoutRealtimeVoice: { postMessage: (message) => messages.push(message) },
        },
      },
    })).toBe(true);
    expect(messages).toEqual([{ kind: "ui-action", action }]);
  });

  test("falls back to web navigation outside a native embed", () => {
    expect(forwardScoutbotUiActionToNativeHost(
      { type: "navigate", route: { view: "inbox" } },
      {},
    )).toBe(false);
  });
});

describe("Scoutbot host navigation catalogs", () => {
  test("describes the web shell with product names instead of route aliases", () => {
    const context = scoutbotUiContext("web");
    expect(context.destinations.map(({ label }) => label)).toEqual([
      "Home",
      "Projects",
      "Sessions",
      "Messages",
      "Dispatch",
      "Search",
      "Operations",
      "World",
      "Repositories",
      "Code Browser",
      "Terminals",
      "Settings",
    ]);
  });

  test("advertises only first-class macOS destinations and Code deep actions", () => {
    const context = scoutbotUiContext("macos");
    expect(context.destinations.map(({ label }) => label)).toEqual([
      "Comms",
      "Projects",
      "Terminals",
      "Tail",
      "Dispatch",
      "Agent Lanes",
      "Repositories",
      "Code Browser",
      "Settings",
    ]);
    const code = context.destinations.find(({ id }) => id === "code-browser");
    expect(code?.deepActions).toContain("Focus a line with line and optional endLine.");
  });
});

describe("resolveScoutbotAgentId", () => {
  test("prefers an available Scoutbot over the stale default id", () => {
    const resolved = resolveScoutbotAgentId([
      agent({
        id: "scoutbot.main.mini",
        handle: "scoutbot",
        selector: "@scoutbot",
        state: "offline",
        updatedAt: 10,
      }),
      agent({
        id: "scoutbot.codex-vox-getting-started.mini",
        handle: "scoutbot",
        selector: "@scoutbot",
        state: "available",
        updatedAt: 20,
      }),
    ]);

    expect(resolved).toBe("scoutbot.codex-vox-getting-started.mini");
  });
});

describe("normalizeScoutbotUiAction", () => {
  test("reads a world.command with words or literal lines, and drops an empty one", () => {
    expect(normalizeScoutbotUiAction({ type: "world.command", text: " wednesday afternoon " })).toEqual({ type: "world.command", text: "wednesday afternoon" });
    expect(normalizeScoutbotUiAction({ type: "world_command", commands: ["goto wed 15:00", "", 3] })).toEqual({ type: "world.command", commands: ["goto wed 15:00"] });
    expect(normalizeScoutbotUiAction({ type: "world.command" })).toBeNull();
  });
  test("normalizes select-project actions", () => {
    expect(normalizeScoutbotUiAction({
      type: "select-project",
      root: "/example/test/dev/talkie",
    })).toEqual({
      type: "select-project",
      root: "/example/test/dev/talkie",
    });
    expect(normalizeScoutbotUiAction({
      type: "select_project",
      root: null,
    })).toEqual({
      type: "select-project",
      root: null,
    });
  });
});

describe("extractScoutbotUiActions", () => {
  test("normalizes ask-agent actions", () => {
    const actions = extractScoutbotUiActions([
      "I’ll ask Hudson.",
      "```scout-ui",
      JSON.stringify({
        type: "ask-agent",
        targetLabel: "hudson",
        body: "Can you inspect the broker handoff path?",
      }),
      "```",
    ].join("\n"));

    expect(actions).toEqual([
      {
        type: "ask-agent",
        targetLabel: "hudson",
        body: "Can you inspect the broker handoff path?",
      },
    ]);
  });
});

describe("extractScoutbotOffers", () => {
  const reply = [
    "The build on main is red. Hudson owns that lane.",
    "```scout-ui",
    JSON.stringify([
      { type: "navigate", route: { view: "mesh" } },
      { type: "ask-agent", offer: true, targetLabel: "hudson", body: "Main is red. Can you look?", reason: "Hudson owns the build" },
      { type: "view-file", offer: true, path: "/repo/docs/build.md" },
    ]),
    "```",
  ].join("\n");

  test("keeps an offered action out of the actions a reply runs", () => {
    expect(extractScoutbotUiActions(reply)).toEqual([{ type: "navigate", route: { view: "mesh" } }]);
  });

  test("returns the offers in the order Scoutbot wrote them", () => {
    expect(extractScoutbotOffers(reply)).toEqual([
      { type: "ask-agent", targetLabel: "hudson", body: "Main is red. Can you look?", reason: "Hudson owns the build" },
      { type: "view-file", path: "/repo/docs/build.md" },
    ]);
  });

  test("strips the block from the prose either way", () => {
    expect(stripScoutbotUiFences(reply)).toBe("The build on main is red. Hudson owns that lane.");
  });

  test("drops an offered action of a kind that has no row, and never runs it", () => {
    const body = [
      "```scout-ui",
      JSON.stringify([
        { type: "refresh", offer: true },
        { type: "world.command", offer: true, commands: [":focus hudson"] },
        { type: "reminder", offer: true, body: "Check the build" },
      ]),
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([]);
    expect(extractScoutbotOffers(body)).toEqual([]);
  });

  test("reads the offer flag on a nested action", () => {
    const body = [
      "```json",
      JSON.stringify({ scoutUi: { type: "navigate", offer: true, route: { view: "mesh" } } }),
      "```",
    ].join("\n");

    expect(extractScoutbotUiActions(body)).toEqual([]);
    expect(extractScoutbotOffers(body)).toEqual([{ type: "navigate", route: { view: "mesh" } }]);
    expect(stripScoutbotUiFences(body)).toBe("");
  });

  test("reads an offer flag written inside the route as an offer, and never runs it", () => {
    const reply = [
      "```json",
      JSON.stringify({ type: "navigate", route: { view: "mesh", offer: true } }),
      "```",
    ].join("\n");
    expect(extractScoutbotUiActions(reply)).toEqual([]);
    expect(extractScoutbotOffers(reply)).toHaveLength(1);
  });

  test("reads any set flag as an offer, and only a plainly false one as an action to run", () => {
    const flagged = (offer: unknown) => [
      "```scout-ui",
      JSON.stringify({ type: "navigate", offer, route: { view: "mesh" } }),
      "```",
    ].join("\n");

    for (const offer of [true, "true", "yes", 1]) {
      expect(extractScoutbotUiActions(flagged(offer))).toEqual([]);
      expect(extractScoutbotOffers(flagged(offer))).toHaveLength(1);
    }
    for (const offer of [false, "false", null, 0]) {
      expect(extractScoutbotUiActions(flagged(offer))).toHaveLength(1);
      expect(extractScoutbotOffers(flagged(offer))).toEqual([]);
    }
  });
});
