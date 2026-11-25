import { describe, expect, test } from "bun:test";

import { canvasMachineBuckets, machineCensusLine, machineChildren, machineContentsNote, machineOpenRows, machineRosterLimitNote, machineRowMeta, machineRuns } from "./machine-children.ts";
import type { MachineBucket } from "../../lib/mesh-buckets.ts";
import type { MeshNodeStateView } from "../../lib/mesh-node-state.ts";

function bucket(overrides: Partial<MachineBucket> = {}): MachineBucket {
  return {
    machineId: "arc-server-openscout",
    machineLabel: "arc-server",
    kind: "peer",
    reachability: "peer",
    agents: [],
    node: null,
    ...overrides,
  } as unknown as MachineBucket;
}

function agent(id: string, state = "callable") {
  return { id, name: id, state, updatedAt: 1 } as never;
}

function view(overrides: Partial<MeshNodeStateView> = {}): MeshNodeStateView {
  return {
    machineId: "arc-server-openscout",
    kind: "peer",
    label: "arc-server",
    network: "reachable",
    broker: "answered",
    detail: "full",
    source: "node-state",
    checkedAt: 1_000,
    observedAt: 1_000,
    stale: false,
    checking: false,
    error: null,
    node: null,
    workload: null,
    roster: [],
    sessions: null,
    work: null,
    failures: 0,
    nextAttemptAt: null,
    ...overrides,
  } as MeshNodeStateView;
}

describe("machineChildren", () => {
  test("lists this host's agents from the shared roster", () => {
    const children = machineChildren(
      bucket({ kind: "this", reachability: "this", agents: [agent("a"), agent("b")] as never }),
      null,
    );
    expect(children.map((child) => child.key)).toEqual(["a", "b"]);
    expect(children[0]?.agent).not.toBeNull();
  });

  test("never hangs local agents under a remote machine", () => {
    // The bucket still carries whatever the shared /api/agents response placed
    // here. That response is capped and filtered and shared with other screens:
    // it is what made a remote card appear and then vanish (#906).
    const children = machineChildren(
      bucket({ agents: [agent("leftover-from-a-full-response")] as never }),
      null,
    );
    expect(children).toEqual([]);
  });

  test("lists a remote machine's own roster once it reports", () => {
    const now = 1_800_000_000_000;
    const children = machineChildren(
      bucket({ agents: [agent("leftover")] as never }),
      view({
        roster: [
          {
            id: "exedev.arc-server",
            title: "Exedev",
            role: null,
            projectRoot: "/home/exedev",
            state: "working",
            statusLabel: "in a turn",
            lastSeenAt: now - 1000,
          },
        ],
      }),
      now,
    );
    expect(children.map((child) => child.key)).toEqual(["exedev.arc-server"]);
    expect(children[0]?.tone).toBe("in_turn");
    // A remote row is a reading, not a handle to open.
    expect(children[0]?.agent).toBeNull();
  });

  test("does not present a fifty-day-old agent as available", () => {
    const now = 1_800_000_000_000;
    const children = machineChildren(
      bucket(),
      view({
        roster: [
          {
            id: "old",
            title: "Old agent",
            role: null,
            projectRoot: null,
            state: "available",
            statusLabel: "Available",
            lastSeenAt: now - 50 * 24 * 60 * 60 * 1000,
          },
        ],
      }),
      now,
    );
    expect(children[0]?.tone).toBe("neutral");
    expect(children[0]?.meta).toBe("50d ago");
  });

  test("a remote agent the peer calls available is not presented as unseen", () => {
    const now = 1_800_000_000_000;
    const children = machineChildren(
      bucket(),
      view({
        roster: [
          {
            id: "ready",
            title: "Ready agent",
            role: null,
            projectRoot: null,
            state: "available",
            statusLabel: "Available",
            lastSeenAt: null,
          },
        ],
      }),
      now,
    );
    expect(children[0]?.meta).toBe("Available");
    expect(children[0]?.tone).toBe("neutral");
  });
});

describe("machineRosterLimitNote", () => {
  test("names the slice when the census is larger than the list", () => {
    const note = machineRosterLimitNote(view({
      roster: [
        {
          id: "a",
          title: "A",
          role: null,
          projectRoot: null,
          state: "available",
          statusLabel: "Available",
          lastSeenAt: null,
        },
      ],
      workload: { total: 53, working: 0, available: 23, offline: 30, truncated: true, unattributed: 0 },
    }));
    expect(note).toBe("Showing the first 1 of 53.");
  });

  test("says nothing when the report is complete", () => {
    expect(machineRosterLimitNote(view({
      workload: { total: 1, working: 0, available: 1, offline: 0, truncated: false, unattributed: 0 },
    }))).toBeNull();
  });
});

describe("machineCensusLine", () => {
  test("says the attested split", () => {
    expect(machineCensusLine(view({
      workload: { total: 53, working: 0, available: 23, offline: 30, truncated: true, unattributed: 0 },
    }))).toBe("0 working · 23 ready · 30 offline");
  });

  test("says nothing when the source could not attest liveness", () => {
    expect(machineCensusLine(view({
      workload: { total: 9, working: null, available: null, offline: null, truncated: false, unattributed: 0 },
    }))).toBeNull();
  });
});

describe("machineContentsNote", () => {
  test("this host with an empty roster says so, and a remote machine waits to be read", () => {
    expect(machineContentsNote("this", false, false, false)).toBe("No agents on this machine");
    expect(machineContentsNote("node", false, true, false)).toBe("Checking what is running…");
    expect(machineContentsNote("node", true, false, false)).toBe("Nothing running here");
    expect(machineContentsNote("node", false, false, true)).toBe("Couldn't read what is running");
  });
});

describe("machineRowMeta", () => {
  test("says it has not been checked rather than showing a dash", () => {
    expect(machineRowMeta(bucket(), null, false)).toBe("not checked yet");
  });

  test("shows counts only once the machine has reported them", () => {
    const meta = machineRowMeta(
      bucket(),
      view({ workload: { total: 9, working: 2, available: 7, offline: 0, truncated: false, unattributed: 0 } }),
      false,
    );
    expect(meta).toBe("2/9");
  });

  test("does not invent a working count a source could not attest", () => {
    const meta = machineRowMeta(
      bucket(),
      view({
        source: "snapshot",
        detail: "roster",
        workload: { total: 9, working: null, available: null, offline: null, truncated: false, unattributed: 3 },
      }),
      false,
    );
    expect(meta).toBe("9");
  });

  test("marks a stale reading as last known", () => {
    const meta = machineRowMeta(
      bucket(),
      view({ stale: true, workload: { total: 4, working: 1, available: 3, offline: 0, truncated: false, unattributed: 0 } }),
      false,
    );
    expect(meta).toBe("1/4 · last known");
  });
});


describe("machineRuns", () => {
  test("lists the work summary, not the agent name", () => {
    const runs = machineRuns(view({
      work: {
        total: 4,
        truncated: true,
        items: [
          { id: "w1", targetAgentId: "agent.one", state: "running", summary: "Finish the install on mini", startedAt: null, completedAt: null },
          { id: "w2", targetAgentId: "agent.two", state: "completed", summary: "   ", startedAt: null, completedAt: null },
        ],
      },
    }));
    expect(runs).toEqual([
      {
        key: "w1",
        name: "Finish the install on mini",
        meta: "running",
        tone: "in_turn",
        title: "Finish the install on mini",
        agent: null,
        selectId: null,
      },
    ]);
  });

  test("an opened remote machine lists runs ahead of its agent roster", () => {
    const opened = machineOpenRows(
      bucket(),
      view({
        roster: [{ id: "a", title: "Exedev", role: null, projectRoot: null, state: "available", statusLabel: "Available", lastSeenAt: null }],
        workload: { total: 1, working: 0, available: 1, offline: 0, truncated: false, unattributed: 0 },
        work: {
          total: 3,
          truncated: true,
          items: [{ id: "w1", targetAgentId: "a", state: "queued", summary: "Check the pairing cutover", startedAt: null, completedAt: null }],
        },
      }),
    );
    expect(opened.kind).toBe("runs");
    expect(opened.rows.map((row) => row.name)).toEqual(["Check the pairing cutover"]);
    expect(opened.limitNote).toBe("Showing the first 1 of 3.");
  });

  test("this host keeps its agents when work is also reported", () => {
    const opened = machineOpenRows(
      bucket({ kind: "this", reachability: "this", agents: [agent("local")] as never }),
      view({
        work: {
          total: 1,
          truncated: false,
          items: [{ id: "w1", targetAgentId: "local", state: "running", summary: "A local run", startedAt: null, completedAt: null }],
        },
      }),
    );
    expect(opened.kind).toBe("agents");
    expect(opened.rows.map((row) => row.key)).toEqual(["local"]);
  });
});

test("map inventory survives full-to-summary roster replacement without remote chips", () => {
  const mesh = { localNode: { id: "local", name: "local" }, nodes: {
    local: { id: "local", name: "local" }, remote: { id: "remote", name: "remote" },
  }, tailscale: { peers: [], running: true } } as unknown as import("../../lib/types.ts").MeshStatus;
  const local = { id: "local-agent", definitionId: "local-agent", name: "local-agent", state: "available", homeNodeId: "local", agentClass: "general" } as import("../../lib/types.ts").Agent;
  const remote = { ...local, id: "remote-agent", definitionId: "remote-agent", homeNodeId: "remote" };
  const full = canvasMachineBuckets([local, remote], mesh);
  const summary = canvasMachineBuckets([local], mesh);
  expect(full).toEqual(summary);
  expect(full.find((b) => b.machineId === "remote")?.agents).toEqual([]);
  expect(full.find((b) => b.machineId === "local")?.agents.map((a) => a.id)).toEqual(["local-agent"]);
});
