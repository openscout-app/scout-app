import { describe, expect, test } from "bun:test";
import type { Agent, FleetAsk, FleetState, WorkDetail, WorkItem } from "../../lib/types.ts";
import { buildStations, carryItems, headline, opening, proseText, stationSurface, stationWorkIds } from "./agents-stations-model.ts";

function ask(over: Partial<FleetAsk>): FleetAsk {
  return {
    invocationId: "inv-1",
    flightId: null,
    agentId: "codex-1",
    agentName: "codex-1",
    conversationId: null,
    collaborationRecordId: null,
    task: "Do the thing.",
    status: "working",
    statusLabel: "Working",
    acknowledgedAt: null,
    attention: "silent",
    agentState: "working",
    harness: "codex",
    transport: null,
    summary: null,
    startedAt: 1_000,
    completedAt: null,
    updatedAt: 1_000,
    ...over,
  } as FleetAsk;
}

function fleet(asks: FleetAsk[]): FleetState {
  return { activeAsks: asks } as unknown as FleetState;
}

function item(over: Partial<WorkItem>): WorkItem {
  return { id: "w-1", title: "Work", parentId: null, parentTitle: null, ...over } as WorkItem;
}

const agents = [
  { id: "codex-1", name: "codex-1", harness: "codex", project: "scout", projectRoot: "/x/scout" },
] as unknown as Agent[];

describe("buildStations", () => {
  test("asks on one work item and on its children share the parent's station", () => {
    const stations = buildStations({
      fleet: fleet([
        ask({ invocationId: "a", collaborationRecordId: "w-build", startedAt: 1_000 }),
        ask({ invocationId: "b", agentId: "rev", agentName: "reviewer", harness: "claude", collaborationRecordId: "w-review", startedAt: 2_000 }),
      ]),
      agents,
      workItems: [
        item({ id: "w-build", title: "Build the update record" }),
        item({ id: "w-review", title: "Review it", parentId: "w-build", parentTitle: "Build the update record" }),
      ],
    });
    expect(stations).toHaveLength(1);
    expect(stations[0]!.title).toBe("Build the update record");
    expect(stations[0]!.players.map((p) => p.agent)).toEqual(["codex-1", "reviewer"]);
    // the latest ask's work fills the card
    expect(stations[0]!.surfaceWorkId).toBe("w-review");
    expect(stations[0]!.project).toBe("scout");
  });

  test("an ask with no work item is a station of one, named by its brief", () => {
    const [station] = buildStations({
      fleet: fleet([ask({ task: "# Fix the sweep\n\nContext: the sweep restarts twice." })]),
      agents,
    });
    expect(station!.id).toBe("ask:inv-1");
    expect(station!.workId).toBeNull();
    expect(station!.title).toBe("Fix the sweep");
  });

  test("stations keep the order they started in; finished asks leave", () => {
    const stations = buildStations({
      fleet: fleet([
        ask({ invocationId: "late", startedAt: 5_000 }),
        ask({ invocationId: "early", startedAt: 1_000 }),
        ask({ invocationId: "done", status: "completed", startedAt: 500 }),
      ]),
      agents,
    });
    expect(stations.map((s) => s.id)).toEqual(["ask:early", "ask:late"]);
  });

  test("an agent's view keeps only the stations it works at", () => {
    const stations = buildStations({
      fleet: fleet([ask({ invocationId: "a" }), ask({ invocationId: "b", agentId: "other", agentName: "other" })]),
      agents,
      agentId: "other",
    });
    expect(stations.map((s) => s.id)).toEqual(["ask:b"]);
  });

  test("stationWorkIds names each work item once", () => {
    expect(stationWorkIds(fleet([
      ask({ invocationId: "a", collaborationRecordId: "w-2" }),
      ask({ invocationId: "b", collaborationRecordId: "w-1" }),
      ask({ invocationId: "c", collaborationRecordId: "w-2" }),
      ask({ invocationId: "d" }),
    ]))).toEqual(["w-1", "w-2"]);
  });
});

function detail(materials: Array<Record<string, unknown>>, timeline: Array<Record<string, unknown>> = []): WorkDetail {
  return {
    timeline,
    inventory: {
      materials: materials.map((m, i) => ({ id: `m${i}`, status: "modified", agentId: null, diffStat: null, ...m })),
    },
  } as unknown as WorkDetail;
}

describe("held asks", () => {
  test("a working ask stopped on a permission prompt waits, not works", () => {
    const state = {
      activeAsks: [ask({ summary: "Waiting on permission" })],
      needsAttention: [{ kind: "question", recordId: "p-1", title: "Permission request", summary: null,
        agentId: "codex-1", agentName: "codex-1", conversationId: null, state: "open", acceptanceState: "none", updatedAt: 2 }],
    } as unknown as FleetState;
    const [player] = buildStations({ fleet: state, agents })[0]!.players;
    expect(player!.live).toBe(false);
    expect(player!.waiting).toBe("Waiting on permission");
  });
  test("a needs-attention ask keeps its station", () => {
    const stations = buildStations({ fleet: fleet([ask({ status: "needs_attention" })]), agents });
    expect(stations).toHaveLength(1);
    expect(stations[0]!.players[0]!.waiting).toBe("Waiting on an answer");
  });
  test("a question in one conversation holds only that station", () => {
    const state = {
      activeAsks: [
        ask({ invocationId: "a", collaborationRecordId: "w-a", conversationId: "c-a" }),
        ask({ invocationId: "b", collaborationRecordId: "w-b", conversationId: "c-b" }),
      ],
      needsAttention: [{ kind: "question", recordId: "p-1", title: "Permission request", summary: null,
        agentId: "codex-1", agentName: "codex-1", conversationId: "c-a", state: "open", acceptanceState: "none", updatedAt: 2 }],
    } as unknown as FleetState;
    const byId = new Map(buildStations({ fleet: state, agents }).map((s) => [s.id, s.players[0]!]));
    expect(byId.get("w-a")!.waiting).toBe("Waiting on permission");
    expect(byId.get("w-b")!.waiting).toBeNull();
    expect(byId.get("w-b")!.live).toBe(true);
  });
  test("another agent's question does not hold this one", () => {
    const state = {
      activeAsks: [ask({})],
      needsAttention: [{ kind: "question", recordId: "p-2", title: "Permission request", summary: null,
        agentId: "other", agentName: "other", conversationId: null, state: "open", acceptanceState: "none", updatedAt: 2 }],
    } as unknown as FleetState;
    const [player] = buildStations({ fleet: state, agents })[0]!.players;
    expect(player!.live).toBe(true);
    expect(player!.waiting).toBeNull();
  });
});

describe("stationSurface", () => {
  test("images make it visual, with frames from the raw endpoint", () => {
    const surface = stationSurface(detail([{ kind: "asset", path: "/d/shot.png" }, { kind: "code", path: "/a.ts" }]), "w 1");
    expect(surface.kind).toBe("visual");
    expect(surface.frames).toEqual([{ id: "m0", name: "shot.png", src: "/api/work/w%201/material/raw?materialId=m0" }]);
  });

  test("code beats docs on a tie; files sort by size of change", () => {
    const surface = stationSurface(detail([
      { kind: "doc", path: "/docs/a.md" },
      { kind: "code", path: "/src/small.ts", diffStat: { branch: { additions: 2, deletions: 0 }, inflight: null } },
      { kind: "test", path: "/src/big.test.ts", diffStat: { branch: { additions: 30, deletions: 1 }, inflight: { additions: 4, deletions: 0 } } },
    ]), "w");
    expect(surface.kind).toBe("code");
    expect(surface.files.map((f) => [f.name, f.additions, f.deletions])).toEqual([["big.test.ts", 34, 1], ["small.ts", 2, 0]]);
  });

  test("docs alone make it writing", () => {
    expect(stationSurface(detail([{ kind: "spec", path: "/docs/spec.md" }]), "w").kind).toBe("writing");
  });

  test("nothing touched is talk: the latest messages, oldest first", () => {
    const surface = stationSurface(detail([], [
      { id: "1", kind: "message", at: 1, actorName: "point", actorId: "p", summary: "One", title: null },
      { id: "2", kind: "flight_started", at: 2, actorName: null, actorId: null, summary: "x", title: null },
      { id: "4", kind: "message", at: 4, actorName: "codex", actorId: "c", summary: "Three", title: null },
      { id: "3", kind: "message", at: 3, actorName: "point", actorId: "p", summary: "Two", title: null },
      { id: "5", kind: "message", at: 5, actorName: "point", actorId: "p", summary: "Four", title: null },
    ]), "w");
    expect(surface.kind).toBe("talk");
    expect(surface.lines.map((l) => l.text)).toEqual(["Two", "Three", "Four"]);
  });

  test("no detail yet is an empty talk surface", () => {
    expect(stationSurface(null, null)).toEqual({ kind: "talk", files: [], frames: [], lines: [] });
  });
});

describe("headline", () => {
  test("a heading, or the first sentence", () => {
    expect(headline("## Build two verbs\nbody")).toBe("Build two verbs");
    expect(headline("[ask:f-1] Check the sweep. Then report back.")).toBe("Check the sweep.");
  });
});

describe("proseText", () => {
  test("drops a heading that repeats the title and strips marks", () => {
    const brief = "# Review the stations change\n\nReview commit 49922db8 on branch `agents-stations`.";
    expect(proseText(brief, "Review the stations change")).toBe("Review commit 49922db8 on branch agents-stations.");
  });
  test("keeps a heading that differs from the title", () => {
    expect(proseText("## Scope\nRead only.", "Review")).toBe("Scope Read only.");
  });
  test("a brief that is only the title stays readable", () => {
    expect(proseText("# Review", "Review")).toBe("Review");
  });
});

describe("review fixes", () => {
  const question = (conversationId: string | null) => ({
    kind: "question", recordId: "p", title: "Permission request", summary: null,
    agentId: "codex-1", agentName: "codex-1", conversationId, state: "open", acceptanceState: "none", updatedAt: 2,
  });

  test("a question that names its conversation does not hold an ask without one", () => {
    const state = {
      activeAsks: [
        ask({ invocationId: "a", collaborationRecordId: "w-a", conversationId: "c-a" }),
        ask({ invocationId: "b", collaborationRecordId: "w-b", conversationId: null }),
      ],
      needsAttention: [question("c-a")],
    } as unknown as FleetState;
    const byId = new Map(buildStations({ fleet: state, agents }).map((s) => [s.id, s.players[0]!]));
    expect(byId.get("w-a")!.waiting).toBe("Waiting on permission");
    expect(byId.get("w-b")!.waiting).toBeNull();
  });

  test("asks on a child and a grandchild share the root's station", () => {
    const stations = buildStations({
      fleet: fleet([
        ask({ invocationId: "p", collaborationRecordId: "P" }),
        ask({ invocationId: "c", collaborationRecordId: "C", startedAt: 2_000 }),
      ]),
      agents,
      workItems: [
        item({ id: "P", title: "Part", parentId: "G", parentTitle: "Goal" }),
        item({ id: "C", title: "Piece", parentId: "P", parentTitle: "Part" }),
      ],
    });
    expect(stations).toHaveLength(1);
    expect(stations[0]!.id).toBe("G");
    expect(stations[0]!.title).toBe("Goal");
    expect(stations[0]!.players.map((p) => p.id)).toEqual(["p", "c"]);
  });

  test("a card keeps its place when its earliest ask ends", () => {
    const seen = new Map<string, number>();
    const first = [
      ask({ invocationId: "a1", collaborationRecordId: "A", startedAt: 1_000 }),
      ask({ invocationId: "b1", collaborationRecordId: "B", startedAt: 2_000 }),
      ask({ invocationId: "a2", collaborationRecordId: "A", startedAt: 3_000 }),
    ];
    const order = (asks: FleetAsk[]) => buildStations({ fleet: fleet(asks), agents, seen }).map((s) => s.id);
    expect(order(first)).toEqual(["A", "B"]);
    expect(order(first.filter((a) => a.invocationId !== "a1"))).toEqual(["A", "B"]);
  });

  test("a queued ask does not move as it updates", () => {
    const seen = new Map<string, number>();
    const queued = (updatedAt: number) =>
      ask({ invocationId: "q", collaborationRecordId: "Q", status: "queued", startedAt: null, updatedAt });
    const other = ask({ invocationId: "o", collaborationRecordId: "O", startedAt: 1_500 });
    const order = (at: number) => buildStations({ fleet: fleet([queued(at), other]), agents, seen }).map((s) => s.id);
    expect(order(1_000)).toEqual(["Q", "O"]);
    expect(order(9_000)).toEqual(["Q", "O"]);
  });

  test("a grouped station stays whole while a new ids= read is out", () => {
    const known = new Map<string, WorkItem>();
    const build = item({ id: "w-build", title: "Build" });
    const review = item({ id: "w-review", title: "Review", parentId: "w-build", parentTitle: "Build" });
    const asks = [
      ask({ invocationId: "a", collaborationRecordId: "w-build", startedAt: 1_000 }),
      ask({ invocationId: "b", collaborationRecordId: "w-review", startedAt: 2_000 }),
    ];
    carryItems(known, [build, review], ["w-build", "w-review"]);
    const ids = ["w-build", "w-other", "w-review"];
    const during = carryItems(known, null, ids);
    const other = ask({ invocationId: "c", collaborationRecordId: "w-other", startedAt: 3_000 });
    const stations = buildStations({ fleet: fleet([...asks, other]), agents, workItems: during });
    expect(stations.map((s) => s.id)).toEqual(["w-build", "w-other"]);
    expect(carryItems(known, null, ["w-other"])).toEqual([]);
  });

  test("front matter goes, whatever the line endings", () => {
    expect(opening("---\r\ntitle: Plan\r\n---\r\n\r\nBody.")).toBe("Body.");
    expect(opening("\uFEFF---\ntitle: Plan\n---\nBody.")).toBe("Body.");
  });
});
