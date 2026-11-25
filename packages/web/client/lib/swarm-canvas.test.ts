import { describe, expect, test } from "bun:test";

import { CANVAS_METRICS, canvasGraph, layoutCanvas, type CanvasLayout, type PlacedEdge, type PlacedNode } from "./swarm-canvas.ts";
import { askDeeds, swarmPulls } from "./swarm-code.ts";
import { CORE_SPLIT } from "./swarm-goal.ts";
import { findInitiatives } from "./swarm-initiatives.ts";
import type { SwarmPullState } from "./swarm-pull-state.ts";
import type { AgentRun } from "./types.ts";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

function run(
  overrides: Partial<AgentRun> & { id: string; agentId: string; createdAt: number },
  flight: Record<string, unknown> = {},
): AgentRun {
  const { id, agentId, createdAt } = overrides;
  return {
    source: "ask",
    requesterId: "operator",
    state: "completed",
    input: { task: `Task for ${agentId}` },
    output: {},
    updatedAt: overrides.completedAt ?? createdAt + MIN,
    completedAt: createdAt + MIN,
    agentName: `core-split-${agentId}-popper-4`,
    metadata: {
      flightMetadata: {
        source: "scout-mcp",
        requesterDisplayName: "Arach",
        returnAddress: { actorId: "operator", sessionId: "mcp:point-1" },
        senderContext: { agentId: "operator", project: "openscout" },
        ...flight,
      },
    },
    ...overrides,
    id,
    agentId,
    createdAt,
  } as AgentRun;
}

/** Lane A opens a pull request and fails once, asks lane C directly, C is still working, and Fable reviews A's pull request. */
function coreSplit() {
  const runs = [
    run({ id: "a-1", agentId: "a", createdAt: NOW - 60 * MIN, state: "failed", terminalReason: "Selected model is at capacity" }),
    run({ id: "a-2", agentId: "a", createdAt: NOW - 50 * MIN, output: { text: "Opened arach/scout#50 with the contract." } }),
    run({ id: "c-1", agentId: "c", createdAt: NOW - 40 * MIN }),
    run({ id: "a-to-c", agentId: "c", createdAt: NOW - 30 * MIN }, { returnAddress: { actorId: "operator", sessionId: "a" } }),
    run({ id: "review-1", agentId: "fable", agentName: "openscout-hudson-6", createdAt: NOW - 20 * MIN,
      output: { text: "arach/scout#50 at 1234abcd. Verdict: clear." } }, { labels: ["goal:core-split", "lane:a", "review"] }),
    run({ id: "c-2", agentId: "c", createdAt: NOW - 10 * MIN, state: "running", completedAt: undefined, updatedAt: NOW - 10 * MIN }),
  ];
  const [initiative] = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
  const asks = initiative!.swarms.flatMap((swarm) => swarm.asks);
  const pulls = swarmPulls({ asks });
  return canvasGraph(initiative!.swarms, { now: NOW, pulls, deeds: askDeeds(asks, pulls) });
}

describe("the canvas graph", () => {
  test("who asked, the lanes they asked, and the repositories the lanes' code went to", () => {
    const graph = coreSplit();
    expect(graph.nodes.map((node) => [node.id, node.rank])).toEqual([
      ["point:operator|mcp:point-1", 0],
      ["lane:a", 1],
      ["lane:c", 1],
      ["lane:review", 1],
      ["repo:arach/scout", 2],
    ]);
    const point = graph.nodes[0]!;
    expect([point.title, point.detail]).toEqual(["Arach", "Asks through Scout MCP"]);
    const review = graph.nodes.find((node) => node.id === "lane:review")!;
    expect([review.title, review.mark, review.reviews]).toEqual(["Fable", "F", true]);
    expect(graph.nodes.find((node) => node.id === "repo:arach/scout")!.detail).toBe("Fable moved #50 last");
  });

  test("edges count asks, with what is open and what failed, and the pull requests each lane opened or reviewed", () => {
    const labels = new Map(coreSplit().edges.map((edge) => [`${edge.from} > ${edge.to}`, edge.label]));
    expect(Object.fromEntries(labels)).toEqual({
      "point:operator|mcp:point-1 > lane:a": "2 asks, 1 failed",
      "point:operator|mcp:point-1 > lane:c": "2 asks, 1 open",
      "lane:a > lane:c": "1 ask",
      "point:operator|mcp:point-1 > lane:review": "1 ask",
      "lane:a > repo:arach/scout": "1 opened",
      "lane:review > repo:arach/scout": "1 reviewed",
    });
  });

  test("a repository names the highest pull request one reply moved, as its panel lists them", () => {
    const runs = [run({ id: "a-1", agentId: "a", createdAt: NOW - 30 * MIN, output: { text: "Opened arach/scout#50 and arach/scout#49." } })];
    const [initiative] = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
    const asks = initiative!.swarms.flatMap((swarm) => swarm.asks);
    const graph = canvasGraph(initiative!.swarms, { now: NOW, pulls: swarmPulls({ asks }) });
    expect(graph.nodes.find((node) => node.id === "repo:arach/scout")!.detail).toBe("Lane A moved #50 last");
  });

  test("a lane says what its last reply did to code", () => {
    const review = coreSplit().nodes.find((node) => node.id === "lane:review")!;
    expect(review.say).toBe("Reviewed arach/scout#50: Clear, 19 min ago");
    expect(coreSplit().nodes.find((node) => node.id === "lane:c")!.status).toBe("working");
  });

  test("with GitHub's states, a repository names its latest merge and each code edge counts what has not merged", () => {
    const runs = [
      run({ id: "a-1", agentId: "a", createdAt: NOW - 50 * MIN, output: { text: "Opened arach/scout#50 and arach/scout#49." } }),
      run({ id: "c-1", agentId: "c", createdAt: NOW - 40 * MIN, output: { text: "Opened arach/scout#55." } }),
    ];
    const [initiative] = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
    const asks = initiative!.swarms.flatMap((swarm) => swarm.asks);
    const state = (number: number, value: SwarmPullState["state"], mergedAt: string | null = null): [string, SwarmPullState] => [
      `arach/scout#${number}`,
      { key: `arach/scout#${number}`, repo: "arach/scout", number, state: value, title: "", url: "", mergedAt, closedAt: mergedAt, updatedAt: null },
    ];
    const states = new Map([
      state(49, "merged", new Date(NOW - 30 * MIN).toISOString()),
      state(50, "merged", new Date(NOW - 20 * MIN).toISOString()),
      state(55, "draft"),
    ]);
    const graph = canvasGraph(initiative!.swarms, { now: NOW, pulls: swarmPulls({ asks }), states });
    expect(graph.nodes.find((node) => node.id === "repo:arach/scout")!.detail).toBe("#50 merged 20 min ago");
    const waiting = Object.fromEntries(graph.edges.filter((edge) => edge.kind === "code").map((edge) => [edge.from, [edge.waiting, edge.label]]));
    expect(waiting).toEqual({ "lane:a": [0, "2 opened"], "lane:c": [1, "1 opened"] });
  });

  test("without states nothing waits, and a repository with no merge names what moved last", () => {
    const graph = coreSplit();
    expect(graph.edges.every((edge) => edge.waiting === 0)).toBe(true);
    const runs = [run({ id: "c-1", agentId: "c", createdAt: NOW - 40 * MIN, output: { text: "Opened arach/scout#55." } })];
    const [initiative] = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
    const asks = initiative!.swarms.flatMap((swarm) => swarm.asks);
    const open: SwarmPullState = { key: "arach/scout#55", repo: "arach/scout", number: 55, state: "open", title: "", url: "", mergedAt: null, closedAt: null, updatedAt: null };
    const withOpen = canvasGraph(initiative!.swarms, { now: NOW, pulls: swarmPulls({ asks }), states: new Map([[open.key, open]]) });
    expect(withOpen.nodes.find((node) => node.id === "repo:arach/scout")!.detail).toBe("Lane C moved #55 last");
    expect(withOpen.edges.find((edge) => edge.kind === "code")!.waiting).toBe(1);
  });
});

function byRank(layout: CanvasLayout, rank: number): PlacedNode[] {
  return layout.nodes.filter((node) => node.rank === rank);
}

/** Where an edge's path starts and ends: "M x,y C … … x,y". */
function start(edge: PlacedEdge): { x: number; y: number } {
  const [x, y] = edge.path.slice(1, edge.path.indexOf(" ")).split(",").map(Number);
  return { x: x!, y: y! };
}

function end(edge: PlacedEdge): { x: number; y: number } {
  const [x, y] = edge.path.slice(edge.path.lastIndexOf(" ") + 1).split(",").map(Number);
  return { x: x!, y: y! };
}

describe("the canvas layout", () => {
  test("horizontal: ranks are columns, lanes stack without touching, and edges leave the right side", () => {
    const layout = layoutCanvas(coreSplit(), "horizontal");
    const [points, lanes, repos] = [0, 1, 2].map((rank) => byRank(layout, rank));
    expect(Math.max(...points!.map((n) => n.x + n.w))).toBeLessThan(Math.min(...lanes!.map((n) => n.x)));
    expect(Math.max(...lanes!.map((n) => n.x + n.w))).toBeLessThan(Math.min(...repos!.map((n) => n.x)));
    expect(new Set(lanes!.map((n) => n.x)).size).toBe(1);
    lanes!.slice(1).forEach((lane, index) => expect(lane.y).toBeGreaterThanOrEqual(lanes![index]!.y + lanes![index]!.h + CANVAS_METRICS.horizontal.gap));
    // The point's three asks leave its right side a quarter of the way apart, in the order of their lanes.
    const point = points![0]!;
    const starts = ["lane:a", "lane:c", "lane:review"].map((to) => start(layout.edges.find((edge) => edge.id === `ask:${point.id}>${to}`)!));
    expect(starts).toEqual([1, 2, 3].map((quarter) => ({ x: point.x + point.w, y: point.y + (point.h * quarter) / 4 })));
    expect(layout.width).toBeGreaterThanOrEqual(Math.max(...repos!.map((n) => n.x + n.w)));
    expect(layout.height).toBeGreaterThanOrEqual(Math.max(...lanes!.map((n) => n.y + n.h)));
  });

  test("vertical: ranks are rows, lanes sit side by side, and edges leave the bottom", () => {
    const layout = layoutCanvas(coreSplit(), "vertical");
    const [points, lanes, repos] = [0, 1, 2].map((rank) => byRank(layout, rank));
    expect(Math.max(...points!.map((n) => n.y + n.h))).toBeLessThan(Math.min(...lanes!.map((n) => n.y)));
    expect(Math.max(...lanes!.map((n) => n.y + n.h))).toBeLessThan(Math.min(...repos!.map((n) => n.y)));
    expect(new Set(lanes!.map((n) => n.y)).size).toBe(1);
    lanes!.slice(1).forEach((lane, index) => expect(lane.x).toBeGreaterThanOrEqual(lanes![index]!.x + lanes![index]!.w + CANVAS_METRICS.vertical.gap));
    const point = points![0]!;
    const toC = layout.edges.find((edge) => edge.id === `ask:${point.id}>lane:c`)!;
    expect(start(toC)).toEqual({ x: point.x + point.w / 2, y: point.y + point.h });
    expect(layout.width).toBeGreaterThanOrEqual(Math.max(...lanes!.map((n) => n.x + n.w)));
  });

  test("edges into one repository arrive apart, in the order of their lanes", () => {
    const layout = layoutCanvas(coreSplit(), "horizontal");
    const repo = layout.nodes.find((n) => n.id === "repo:arach/scout")!;
    const ends = ["lane:a", "lane:review"].map((from) => end(layout.edges.find((edge) => edge.id === `code:${from}>${repo.id}`)!));
    expect(ends).toEqual([1, 2].map((third) => ({ x: repo.x, y: repo.y + (repo.h * third) / 3 })));
  });

  test("labels sit beside the lane: an ask's count ends before its arrow, a lane's code starts after the lane", () => {
    const { tag, labelH } = CANVAS_METRICS.vertical;
    const across = layoutCanvas(coreSplit(), "horizontal");
    const [laneA, review] = ["lane:a", "lane:review"].map((id) => across.nodes.find((n) => n.id === id)!);
    const toReview = across.edges.find((edge) => edge.id === "ask:point:operator|mcp:point-1>lane:review")!;
    expect([toReview.labelX, toReview.labelY, toReview.labelAnchor]).toEqual([review!.x - tag, review!.y + review!.h / 2, "end"]);
    const codeA = across.edges.find((edge) => edge.id === "code:lane:a>repo:arach/scout")!;
    expect([codeA.labelX, codeA.labelY, codeA.labelAnchor]).toEqual([laneA!.x + laneA!.w + tag, laneA!.y + laneA!.h / 2, "start"]);

    const down = layoutCanvas(coreSplit(), "vertical");
    const laneC = down.nodes.find((n) => n.id === "lane:c")!;
    const toC = down.edges.find((edge) => edge.id === "ask:point:operator|mcp:point-1>lane:c")!;
    // Lane A also asked lane C, so the point's ask arrives left of the middle of C's top.
    expect(toC.labelY).toBe(laneC.y - tag - labelH / 2);
    expect(toC.labelAnchor).toBe("middle");
    expect(toC.labelX).toBe(end(toC).x);
  });

  test("both directions draw the same nodes and edges", () => {
    const graph = coreSplit();
    const ids = (layout: CanvasLayout) => [layout.nodes.map((n) => n.id).sort(), layout.edges.map((e) => e.id).sort()];
    expect(ids(layoutCanvas(graph, "vertical"))).toEqual(ids(layoutCanvas(graph, "horizontal")));
  });

  test("an ask between two lanes loops out past the side asks come in on", () => {
    const layout = layoutCanvas(coreSplit(), "horizontal");
    const [laneA, laneC] = ["lane:a", "lane:c"].map((id) => layout.nodes.find((n) => n.id === id)!);
    const loop = layout.edges.find((edge) => edge.id === "ask:lane:a>lane:c")!;
    expect(start(loop).x).toBe(laneA!.x);
    expect(end(loop).x).toBe(laneC!.x);
    expect(loop.path).toContain(`C${laneA!.x - CANVAS_METRICS.horizontal.loop},`);
    expect(loop.labelX).toBeLessThan(laneA!.x);
  });

  test("an empty graph is just its padding", () => {
    const layout = layoutCanvas({ nodes: [], edges: [] }, "horizontal");
    expect([layout.nodes.length, layout.edges.length]).toEqual([0, 0]);
    expect(layout.width).toBe(CANVAS_METRICS.horizontal.pad * 2);
  });
});
