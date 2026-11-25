import { describe, expect, test } from "bun:test";

import { sessionModelLabel } from "../../lib/agent-labels.ts";
import type { Agent, FleetActivity, FleetAsk, FleetState } from "../../lib/types.ts";
import { buildRecentSessionRows } from "./home-recent-sessions.ts";

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "session-mvqtz29p-heaenb.main.dev-host",
    definitionId: "session-mvqtz29p-heaenb",
    name: "Session Mvqtz29p Heaenb",
    handle: "session-mvqtz29p-heaenb",
    authorityNodeId: null,
    authorityNodeName: null,
    agentClass: "general",
    state: "available",
    harness: "claude",
    project: "demo-app",
    projectRoot: "~/dev/openscout/demo-app",
    cwd: "~/dev/openscout/demo-app",
    updatedAt: 1_000,
    createdAt: null,
    transport: "tmux",
    selector: null,
    defaultSelector: null,
    nodeQualifier: null,
    workspaceQualifier: null,
    wakePolicy: null,
    capabilities: [],
    branch: "main",
    role: null,
    model: "claude-fable-5",
    harnessSessionId: null,
    terminalSurface: null,
    harnessLogPath: null,
    conversationId: null,
    homeNodeId: null,
    homeNodeName: null,
    ownerId: null,
    ownerName: null,
    ownerHandle: null,
    staleLocalRegistration: false,
    retiredFromFleet: false,
    replacedByAgentId: null,
    ...overrides,
  };
}

function ask(overrides: Partial<FleetAsk> = {}): FleetAsk {
  return {
    invocationId: "inv-1",
    flightId: null,
    agentId: "session-mvqtz29p-heaenb",
    agentName: "demo-app-epicurus-12",
    conversationId: null,
    collaborationRecordId: null,
    task: "Review the architecture direction and say what to cut.",
    status: "completed",
    statusLabel: "Done",
    acknowledgedAt: null,
    attention: "silent",
    agentState: "idle",
    harness: "claude",
    transport: "tmux",
    summary: "session-mvqtz29p-heaenb replied.",
    startedAt: 900,
    completedAt: 950,
    updatedAt: 950,
    ...overrides,
  } as FleetAsk;
}

function activity(overrides: Partial<FleetActivity> & Pick<FleetActivity, "id" | "kind">): FleetActivity {
  return {
    ts: 900,
    actorName: null,
    title: null,
    summary: null,
    conversationId: null,
    workspaceRoot: null,
    actorId: null,
    agentId: null,
    agentName: null,
    flightId: null,
    invocationId: null,
    messageId: null,
    recordId: null,
    sessionId: null,
    ...overrides,
  };
}

function fleet(overrides: Partial<FleetState> = {}): FleetState {
  return {
    generatedAt: 1_000,
    totals: { active: 0, recentCompleted: 0, needsAttention: 0, activity: 0 },
    activeAsks: [],
    recentCompleted: [],
    needsAttention: [],
    activity: [],
    ...overrides,
  };
}

describe("buildRecentSessionRows", () => {
  test("a session goes by its session name, with its id kept for the tooltip", () => {
    const [row] = buildRecentSessionRows([agent({ sessionName: "demo-app-epicurus-12" })], null);
    expect(row).toMatchObject({
      name: "demo-app-epicurus-12",
      sessionId: "session-mvqtz29p-heaenb",
      harness: "claude",
      model: "fable-5",
      project: "demo-app",
      branch: "main",
      topic: null,
      topicLive: false,
    });
  });

  test("without a session name, the fleet's name for the session stands in, else the id as it is", () => {
    const named = buildRecentSessionRows([agent()], fleet({ recentCompleted: [ask()] }))[0]!;
    expect(named.name).toBe("demo-app-epicurus-12");

    const bare = buildRecentSessionRows([agent()], null)[0]!;
    expect(bare.name).toBe("session-mvqtz29p-heaenb");
    expect(bare.sessionId).toBeNull();
  });

  test("a real name is kept over the fleet's", () => {
    const [row] = buildRecentSessionRows(
      [agent({ id: "scout.main.dev-host", definitionId: "scout", handle: "scout", name: "Scout" })],
      fleet({ recentCompleted: [ask({ agentId: "scout", agentName: "scout-epicurus-1" })] }),
    );
    expect(row?.name).toBe("Scout");
  });

  test("the line is the session's latest ask, matched on the card's definition id", () => {
    const rows = buildRecentSessionRows(
      [agent()],
      fleet({
        activeAsks: [ask({ invocationId: "inv-2", task: "Cut the spec down to **one page**.", status: "working", updatedAt: 990 })],
        recentCompleted: [ask()],
      }),
    );
    expect(rows[0]?.topic).toBe("Cut the spec down to one page.");
    expect(rows[0]?.topicLive).toBe(true);
  });

  test("past the asks, the latest ask to it in the firehose, then its own latest message", () => {
    const asked = buildRecentSessionRows([agent()], fleet({
      activity: [
        activity({ id: "a1", kind: "invocation_recorded", agentId: "session-mvqtz29p-heaenb", title: "Critique the direction", ts: 800 }),
        activity({ id: "a2", kind: "message_posted", actorId: "session-mvqtz29p-heaenb", title: "Critique posted", ts: 900 }),
      ],
    }))[0]!;
    expect(asked.topic).toBe("Critique the direction");
    expect(asked.topicLive).toBe(false);

    const said = buildRecentSessionRows([agent()], fleet({
      activity: [activity({ id: "a2", kind: "message_posted", actorId: "session-mvqtz29p-heaenb", title: "Critique posted", ts: 900 })],
    }))[0]!;
    expect(said.topic).toBe("Critique posted");
  });

  test("bookkeeping in the firehose is not a line", () => {
    const [row] = buildRecentSessionRows([agent()], fleet({
      activity: [
        activity({
          id: "a3",
          kind: "ask_working",
          agentId: "session-mvqtz29p-heaenb",
          title: "session-mvqtz29p-heaenb did not finish cleanly. Stale running flight reconciled.",
        }),
      ],
    }));
    expect(row?.topic).toBeNull();
  });

  test("another session's ask is not this one's", () => {
    const [row] = buildRecentSessionRows([agent()], fleet({ recentCompleted: [ask({ agentId: "session-other-1" })] }));
    expect(row?.topic).toBeNull();
  });

  test("the project is the checkout's folder, falling back to the recorded project", () => {
    expect(buildRecentSessionRows([agent({ projectRoot: null, cwd: null, project: "Openscout" })], null)[0]?.project).toBe("Openscout");
    expect(buildRecentSessionRows([agent({ projectRoot: "~/dev/openscout/", project: "Openscout" })], null)[0]?.project).toBe("openscout");
  });
});

describe("sessionModelLabel", () => {
  test("drops the harness prefix only", () => {
    expect(sessionModelLabel("claude-opus-5-5", "claude")).toBe("opus-5-5");
    expect(sessionModelLabel("gpt-5.5-codex", "codex")).toBe("gpt-5.5-codex");
    expect(sessionModelLabel("  ", "claude")).toBeNull();
    expect(sessionModelLabel("fable-5", null)).toBe("fable-5");
  });
});
