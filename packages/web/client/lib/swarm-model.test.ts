import { describe, expect, test } from "bun:test";

import {
  askLabels,
  askState,
  askTitle,
  axisTicks,
  buildSwarms,
  memberStatus,
  mergeRuns,
  packAsks,
  replyBody,
  replyHeadline,
  spanWords,
  splitAgentName,
  type SwarmAsk,
  type SwarmLane,
} from "./swarm-model.ts";
import type { AgentRun } from "./types.ts";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 21, 0, 0, 0);

function run(overrides: Partial<AgentRun> & { id: string; agentId: string; createdAt: number }, flight: Record<string, unknown> = {}): AgentRun {
  const { id, agentId, createdAt } = overrides;
  return {
    source: "ask",
    requesterId: "operator",
    state: "completed",
    input: { task: `Task for ${agentId}` },
    output: {},
    updatedAt: overrides.completedAt ?? createdAt,
    agentName: `core-split-${agentId}-popper-4`,
    metadata: {
      flightMetadata: {
        source: "scout-mcp",
        requesterDisplayName: "Arach",
        returnAddress: { actorId: "operator", sessionId: "mcp:point-1" },
        dispatchAck: {
          harness: "codex",
          executionResolution: { model: { observed: "gpt-6.1-sol" }, reasoningEffort: { observed: "high" } },
        },
        ...flight,
      },
    },
    ...overrides,
    id,
    agentId,
    createdAt,
  } as AgentRun;
}

describe("ask text", () => {
  test("titles drop heading marks, emphasis and the routing tag, and keep the first real line", () => {
    expect(askTitle("\n\n# Lane A: make the **3 MiB** test `deterministic`\nmore")).toBe("Lane A: make the 3 MiB test deterministic");
    expect(askTitle("[ask:msg-abc] Review request: arach/scout#13")).toBe("Review request: arach/scout#13");
    expect(askTitle("   ")).toBe("Untitled ask");
  });

  test("a title that opens with a pull request's number keeps its #, which is not a heading mark", () => {
    expect(askTitle("#83: plainer words for the receipt\n\nFrom Claude, running point.")).toBe("#83: plainer words for the receipt");
    expect(askTitle("#76's two liveness changes")).toBe("#76's two liveness changes");
    expect(askTitle("##\n## Lane T: the barrier")).toBe("Lane T: the barrier");
  });

  test("titles skip the sender's signature and read a long path as its file name", () => {
    expect(askTitle("From Claude, running point. Fable cleared #1422 to land as is.")).toBe("Fable cleared #1422 to land as is.");
    expect(askTitle("From Claude, running point.\n\n# Lane C: M0 goes now")).toBe("Lane C: M0 goes now");
    expect(askTitle("C, from Claude, running point. Your 4a contracts are all open.")).toBe("Your 4a contracts are all open.");
    expect(askTitle("FYI from Claude, running point (Scout may show the operator as sender). I merged #1418.")).toBe("I merged #1418.");
    expect(askTitle("From the start, the gate refuses.")).toBe("From the start, the gate refuses.");
    expect(askTitle("A design review for your idle time, from Claude, running point.")).toBe("A design review for your idle time, from Claude, running point.");
    expect(askTitle("From Claude, running point. Read and follow /private/tmp/claude-501/x/scratchpad/lane-a-brief.md.")).toBe("Read and follow lane-a-brief.md.");
    expect(askTitle("Evidence: ~/.scout/work/core-split-c-cli/tmp/REPORT.md")).toBe("Evidence: REPORT.md");
    expect(askTitle("Review https://github.com/arach/openscout/pull/1424 now")).toBe("Review https://github.com/arach/openscout/pull/1424 now");
  });

  test("long titles clip at a word", () => {
    const title = askTitle("word ".repeat(40), 30);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(title.endsWith("word…")).toBe(true);
  });

  test("a reply keeps the agent's words, not the runtime's placeholder", () => {
    expect(replyBody(run({ id: "r", agentId: "a", createdAt: NOW, output: { text: "[ask:msg-1] Verdict: land, as is. Details follow." } }))).toBe("Verdict: land, as is. Details follow.");
    expect(replyBody(run({ id: "r", agentId: "a", createdAt: NOW, output: { summary: "session-mvh1 replied." } }))).toBeNull();
    for (const summary of ["openscout-quill-8 failed to respond.", "openscout-chopin-5 could not be prepared.", "session-mvjn10bd did not finish cleanly.", "openscout-pauli-6 returned an empty reply."]) {
      expect(replyBody(run({ id: "r", agentId: "a", createdAt: NOW, output: { summary } }))).toBeNull();
    }
    expect(replyBody(run({ id: "r", agentId: "a", createdAt: NOW, output: { summary: "Merged #126 and opened the milestone." } }))).toBe("Merged #126 and opened the milestone.");
    expect(replyHeadline("## Done\nVerdict: land, as is. Details follow.")).toBe("Done");
    expect(replyHeadline("Verdict: land, as is. Details follow.")).toBe("Verdict: land, as is.");
    expect(replyHeadline("[#1415](https://github.com/arach/openscout/pull/1415) is ready.\n\nHead: x")).toBe("#1415 is ready.");
  });

  test("a reply that points at a note reads as the note's file name, not its folders", () => {
    expect(replyHeadline("Note: `/example/workstation-user/.scout/reports/core-split-c-web-port-20261021/web-port-rollout.md`\n\nSequence:"))
      .toBe("Note: web-port-rollout.md");
    expect(replyHeadline("Report: /example/workstation-user/.scout/reports/core-split-a-81/REPORT.md. Both Buns pass."))
      .toBe("Report: REPORT.md.");
    expect(replyHeadline("Merged https://github.com/arach/scout/pull/81 into core-split."))
      .toBe("Merged https://github.com/arach/scout/pull/81 into core-split.");
  });

  test("a pointer gives way to the words after it, and a line ending in a colon takes the sentence it introduces", () => {
    expect(replyHeadline("Design: `/example/workstation-user/.scout/reports/pairing-replay-remedy/DESIGN.md`\n\nRecommend **v2 authority capsules**: verified checkpoints. No prefix cache."))
      .toBe("Recommend v2 authority capsules: verified checkpoints.");
    expect(replyHeadline("DESIGN.md\n\nCovers all six areas and identifies five decisions."))
      .toBe("Covers all six areas and identifies five decisions.");
    expect(replyHeadline("Fix pushed to [R1 #119](https://github.com/arach/scout/pull/119):\n**`125304d933f428da5e4f13771f404f177c66d66f`**, appended to `74c75b25`, not rewritten.\n\nThe old head …"))
      .toBe("Fix pushed to R1 #119: 125304d9, appended to 74c75b25, not rewritten.");
    expect(replyHeadline("Two things:\n\n1. Authorize a qualification-only run. Then rerun.\n2. File it."))
      .toBe("Two things: Authorize a qualification-only run.");
    // "1.4.3" is a version, not a numbered item's mark.
    expect(replyHeadline("Report: report.md\n\n1.4.3 clears the defect, but is not a drop-in upgrade.")).toBe("1.4.3 clears the defect, but is not a drop-in upgrade.");
  });

  test("a pointer stays when a heading, a table or a bare introduction follows, and a colon before a table goes", () => {
    expect(replyHeadline("Saved: ideas.md\n\n## Combined top 10\n\n1. Creators")).toBe("Saved: ideas.md");
    expect(replyHeadline("Report: REPORT.md\n\n| Bun | p50 |\n|---|---|")).toBe("Report: REPORT.md");
    expect(replyHeadline("Worst read times, milliseconds:\n\n| Bun | p50 |\n|---|---|")).toBe("Worst read times, milliseconds");
    expect(replyHeadline("Report: REPORT.md")).toBe("Report: REPORT.md");
    expect(replyHeadline("Drafts pushed:")).toBe("Drafts pushed");
  });

  test("a reply that opens with a table reads from the words after it", () => {
    expect(replyHeadline("| Applicant | Aaron | Pete |\n|---|---|---|\n| A37 | Strong | Interview+ |\n\n**Mock outcome: Interview yes · Fund yes.** Details follow.\n\n[Full review](/tmp/review.md)"))
      .toBe("Mock outcome: Interview yes · Fund yes.");
    expect(replyHeadline("| Bun | p50 |\n|---|---|\n| 1.3.14 | 4 ms |")).toBeNull();
  });

  test("a full commit hash reads as its short form, and a list mark goes", () => {
    expect(replyHeadline("#85 lease-pushed at **`9876794ffd16cc55e4f308d67d4a43bcb4ad300d`**.\n\nBoth Buns:"))
      .toBe("#85 lease-pushed at 9876794f.");
    expect(replyHeadline("- #75: 99de032ebfd55f1f57694e3e39011966a289f5a5 (unchanged).\n- #78: 0029c961 (rebased)."))
      .toBe("#75: 99de032e (unchanged).");
    expect(replyHeadline(`Tree sha256:${"ab".repeat(32)} matches.`)).toBe("Tree sha256:abababab matches.");
    expect(askTitle("Merge #84 at f63057ceda3464d8d7ec097e431e78a440d1d5b7 on green")).toBe("Merge #84 at f63057ce on green");
    // A short hash, a longer hex run and a commit URL stay as written.
    expect(replyHeadline("Head 9876794f stays.")).toBe("Head 9876794f stays.");
    expect(replyHeadline(`Run ${"a".repeat(41)} stays.`)).toBe(`Run ${"a".repeat(41)} stays.`);
    expect(replyHeadline("See https://github.com/arach/scout/commit/9876794ffd16cc55e4f308d67d4a43bcb4ad300d now."))
      .toBe("See https://github.com/arach/scout/commit/9876794ffd16cc55e4f308d67d4a43bcb4ad300d now.");
    expect(askTitle("-1 is the exit code")).toBe("-1 is the exit code");
  });

  test("session names split into the agent and where it works", () => {
    expect(splitAgentName("core-split-a-lavoisier-3")).toEqual({ short: "lavoisier-3", place: "core-split-a" });
    expect(splitAgentName("Session Mvfuve7c Jjjkqw")).toEqual({ short: "Session Mvfuve7c Jjjkqw", place: null });
  });

  test("spans read as words", () => {
    expect(spanWords(20_000)).toBe("under a minute");
    expect(spanWords(42 * MIN)).toBe("42 min");
    expect(spanWords(72 * MIN)).toBe("1 h 12 min");
    expect(spanWords(120 * MIN)).toBe("2 h");
    expect(spanWords(72 * 60 * MIN)).toBe("3 d");
  });

  test("run states map onto ask states", () => {
    expect(askState({ state: "waking" })).toBe("queued");
    expect(askState({ state: "running" })).toBe("working");
    expect(askState({ state: "completed" })).toBe("done");
    expect(askState({ state: "unknown", completedAt: NOW })).toBe("done");
    expect(askState({ state: "unknown" })).toBe("unknown");
  });
});

describe("buildSwarms", () => {
  const runs = [
    run({ id: "1", agentId: "a", createdAt: NOW - 100 * MIN, completedAt: NOW - 80 * MIN, input: { task: "# Lane A: first" }, output: { text: "Done. Two commits." } }),
    run({ id: "2", agentId: "t", createdAt: NOW - 90 * MIN, state: "failed", completedAt: NOW - 85 * MIN, terminalReason: "model at capacity" }),
    run({ id: "3", agentId: "a", createdAt: NOW - 30 * MIN, state: "running", startedAt: NOW - 29 * MIN, input: { task: "Go: build lane D" } }),
    run({ id: "4", agentId: "a", createdAt: NOW - 5 * MIN, state: "queued", input: { task: "Next: the TUI" } }),
    run({ id: "old", agentId: "x", createdAt: NOW - 20 * 60 * MIN, completedAt: NOW - 19 * 60 * MIN }),
    run({ id: "other", agentId: "y", createdAt: NOW - 10 * MIN, completedAt: NOW - 2 * MIN }, {
      returnAddress: { actorId: "operator", sessionId: "mcp:point-2" },
      source: "scout-cli",
    }),
  ];

  test("one swarm per point session, most recent first, within the window", () => {
    const swarms = buildSwarms(runs, { now: NOW, windowMs: 3 * 60 * MIN });
    expect(swarms.map((s) => s.point.sessionId)).toEqual(["mcp:point-1", "mcp:point-2"]);
    expect(swarms[0]!.point).toMatchObject({ name: "Arach", via: "Scout MCP" });
    expect(swarms[1]!.point.via).toBe("the Scout CLI");
    expect(swarms[0]!.asks.map((a) => a.id)).toEqual(["1", "2", "3", "4"]);
  });

  test("members join in order and say what they are doing", () => {
    const [swarm] = buildSwarms(runs, { now: NOW, windowMs: 3 * 60 * MIN });
    expect(swarm!.members.map((m) => [m.id, m.name, m.place])).toEqual([
      ["a", "popper-4", "core-split-a"],
      ["t", "popper-4", "core-split-t"],
    ]);
    const [a, t] = swarm!.members;
    expect(a!.status).toBe("working");
    expect(a!.sentence).toBe("On “Go: build lane D” for 29 min, with another ask behind it");
    expect(a!.harness).toBe("codex");
    expect(a!.model).toBe("gpt-6.1-sol");
    expect(t!.status).toBe("failed");
    expect(t!.sentence).toBe("Failed 1 h 25 min ago: model at capacity");
  });

  test("events tell the story newest first", () => {
    const [swarm] = buildSwarms(runs, { now: NOW, windowMs: 3 * 60 * MIN });
    expect(swarm!.events[0]).toMatchObject({ kind: "asked", askId: "4", who: "popper-4", text: "Arach asked popper-4: “Next: the TUI”" });
    expect(swarm!.events.find((e) => e.askId === "1" && e.kind === "replied")?.text).toBe("popper-4 replied: “Done.”");
    expect(swarm!.events.find((e) => e.kind === "failed")?.text).toBe("popper-4 failed: model at capacity");
  });

  test("a failed ask reads its reason in plain words, and the runtime's status line is not a reply", () => {
    const refused = run({
      id: "r", agentId: "a", createdAt: NOW - 20 * MIN, state: "failed", completedAt: NOW - 10 * MIN,
      terminalReason: "This content was flagged for possible cybersecurity risk. If this seems wrong, try rephrasing your request. (cyberPolicy)",
      output: { summary: "core-split-a-popper-4 failed to respond.", error: "This content was flagged for possible cybersecurity risk. (cyberPolicy)" },
    });
    const [swarm] = buildSwarms([refused], { now: NOW, windowMs: 60 * MIN });
    const ask = swarm!.asks[0]!;
    expect(ask.failure).toBe("Refused by the provider's cybersecurity filter (cyberPolicy)");
    expect(ask.reply).toBeNull();
    expect(swarm!.members[0]!.sentence).toBe("Failed 10 min ago: Refused by the provider's cybersecurity filter (cyberPolicy)");
    // With no terminal reason, the error says why.
    const unprepared = run({
      id: "u", agentId: "a", createdAt: NOW - 20 * MIN, state: "failed", completedAt: NOW - 10 * MIN,
      output: { summary: "core-split-a-popper-4 could not be prepared.", error: "Endpoint resolution failed before execution: session session-a is not currently reachable" },
    });
    expect(buildSwarms([unprepared], { now: NOW, windowMs: 60 * MIN })[0]!.asks[0]!.failure).toBe("Its session was not reachable");
  });

  test("an open ask has no reply yet, whatever its output says", () => {
    const [swarm] = buildSwarms([run({ id: "o", agentId: "a", createdAt: NOW - MIN, state: "running", output: { text: "alias a → session-a acknowledged via steer." } })], { now: NOW, windowMs: 60 * MIN });
    expect(swarm!.asks[0]!.reply).toBeNull();
  });

  test("an open ask stays in view however old it is", () => {
    const stale = [run({ id: "s", agentId: "a", createdAt: NOW - 30 * 60 * MIN, state: "running", startedAt: NOW - 30 * 60 * MIN })];
    const [swarm] = buildSwarms(stale, { now: NOW, windowMs: 60 * MIN });
    expect(swarm!.asks.map((a) => a.id)).toEqual(["s"]);
    expect(swarm!.start).toBe(NOW - 60 * MIN);
  });

  test("an ask a member makes joins the swarm from that member's lane", () => {
    const nested = [
      run({ id: "p", agentId: "session-a", createdAt: NOW - 20 * MIN, state: "running" }),
      run({ id: "sub", agentId: "session-r", requesterId: "session-a", createdAt: NOW - 10 * MIN, completedAt: NOW - 4 * MIN }, {
        requesterDisplayName: "lane a",
        returnAddress: { actorId: "session-a", sessionId: "session-a" },
      }),
    ];
    const swarms = buildSwarms(nested, { now: NOW, windowMs: 60 * MIN });
    expect(swarms).toHaveLength(1);
    expect(swarms[0]!.members.map((m) => m.id)).toEqual(["session-a", "session-r"]);
    expect(swarms[0]!.asks.find((a) => a.id === "sub")?.from).toBe("session-a");
    expect(swarms[0]!.events.find((e) => e.askId === "sub" && e.kind === "asked")?.text.startsWith("popper-4 asked popper-4")).toBe(true);
  });

  test("an agent's own asks join from its lane when the runtime records them as the operator's", () => {
    // Scout MCP records the asks under the operator; the return session names the agent.
    const nested = [
      run({ id: "p", agentId: "session-a", createdAt: NOW - 20 * MIN, state: "running" }),
      run({ id: "sub", agentId: "session-r", createdAt: NOW - 10 * MIN, completedAt: NOW - 4 * MIN }, {
        returnAddress: { actorId: "operator", sessionId: "session-a" },
      }),
    ];
    const swarms = buildSwarms(nested, { now: NOW, windowMs: 60 * MIN });
    expect(swarms).toHaveLength(1);
    expect(swarms[0]!.asks.find((a) => a.id === "sub")).toMatchObject({ from: "session-a", fromMemberId: "session-a", memberId: "session-r" });
  });

  test("a lane holds every agent that worked in it, and other work stays out", () => {
    const lane = { id: "a", name: "Lane A", mark: "A", about: "public core" };
    const laneOf = (agentId: string) => (agentId === "x" ? null : lane);
    const asks = [
      run({ id: "1", agentId: "a1", createdAt: NOW - 50 * MIN, completedAt: NOW - 40 * MIN, output: { text: "Done." } }),
      run({ id: "2", agentId: "a2", createdAt: NOW - 30 * MIN, state: "running", startedAt: NOW - 30 * MIN, input: { task: "Rebase" } }),
      run({ id: "other", agentId: "x", createdAt: NOW - 20 * MIN }),
      run({ id: "inside", agentId: "a3", createdAt: NOW - 10 * MIN, completedAt: NOW - 5 * MIN }, {
        returnAddress: { actorId: "operator", sessionId: "a2" },
      }),
    ];
    const [swarm] = buildSwarms(asks, { now: NOW, windowMs: 60 * MIN, laneOf });
    expect(swarm!.asks.map((a) => a.id)).toEqual(["1", "2", "inside"]);
    expect(swarm!.members).toHaveLength(1);
    expect(swarm!.members[0]).toMatchObject({ id: "a", name: "Lane A", mark: "A", about: "public core", agentIds: ["a1", "a2", "a3"], status: "working" });
    expect(swarm!.agents.get("a2")).toMatchObject({ name: "popper-4", place: "core-split-a2", harness: "codex" });
    expect(swarm!.events.find((e) => e.askId === "2" && e.kind === "asked")?.text).toBe("Arach asked Lane A: “Rebase”");
    expect(swarm!.events.find((e) => e.askId === "1" && e.kind === "replied")).toMatchObject({ who: "Lane A", text: "Lane A replied: “Done.”" });
    // Within one lane the story names the agents, not "Lane A asked Lane A".
    expect(swarm!.asks.find((a) => a.id === "inside")).toMatchObject({ memberId: "a", fromMemberId: "a" });
    expect(swarm!.events.find((e) => e.askId === "inside" && e.kind === "asked")?.text.startsWith("popper-4 asked popper-4")).toBe(true);
  });

  test("lanes keep their places, whoever was asked first", () => {
    const lanes: Record<string, SwarmLane> = {
      a: { id: "a", name: "Lane A", mark: "A", about: "public core", order: 0 },
      b: { id: "b", name: "Lane B", mark: "B", about: "measure", order: 1 },
    };
    const asks = [
      run({ id: "1", agentId: "b", createdAt: NOW - 20 * MIN, completedAt: NOW - 10 * MIN }),
      run({ id: "2", agentId: "a", createdAt: NOW - 5 * MIN, completedAt: NOW - 2 * MIN }),
    ];
    const [swarm] = buildSwarms(asks, { now: NOW, windowMs: 60 * MIN, laneOf: (id) => lanes[id] ?? null });
    expect(swarm!.members.map((m) => m.id)).toEqual(["a", "b"]);
  });

  test("an agent's lane is read from the labels of its latest labeled ask", () => {
    const lanes: Record<string, SwarmLane> = {
      c: { id: "c", name: "Lane C", mark: "C", about: "wiring and cutover", order: 0 },
      view: { id: "view", name: "Swarm view", mark: "V", about: "visual study", order: 1 },
    };
    const seen: Record<string, readonly string[]> = {};
    const laneOf = (agentId: string, _name: string | null, labels: readonly string[]) => {
      seen[agentId] = labels;
      const label = labels.find((l) => l.startsWith("lane:"));
      return label ? lanes[label.slice("lane:".length)] ?? null : null;
    };
    const asks = [
      run({ id: "1", agentId: "s1", createdAt: NOW - 40 * MIN, completedAt: NOW - 35 * MIN, input: { task: "Old", metadata: { labels: ["goal:core-split", "lane:view"] } } }),
      run({ id: "2", agentId: "s1", createdAt: NOW - 30 * MIN, completedAt: NOW - 25 * MIN, input: { task: "New", metadata: { labels: ["goal:core-split", "lane:c"] } } }),
      run({ id: "3", agentId: "s1", createdAt: NOW - 20 * MIN, completedAt: NOW - 15 * MIN, input: { task: "Unlabeled" } }),
      run({ id: "4", agentId: "s2", createdAt: NOW - 10 * MIN, completedAt: NOW - 5 * MIN }, { labels: ["goal:core-split", "lane:view", " "] }),
    ];
    const [swarm] = buildSwarms(asks, { now: NOW, windowMs: 60 * MIN, laneOf });
    expect(seen).toEqual({ s1: ["goal:core-split", "lane:c"], s2: ["goal:core-split", "lane:view"] });
    expect(swarm!.members.map((m) => m.id)).toEqual(["c", "view"]);
    expect(askLabels(asks[3]!)).toEqual(["goal:core-split", "lane:view"]);
  });

  describe("asks one lane sends another through the point's own Scout MCP session", () => {
    const lanes: Record<string, SwarmLane> = {
      "core-split-a": { id: "a", name: "Lane A", mark: "A", about: "public core", order: 0 },
      "core-split-e1": { id: "e1", name: "Lane E1", mark: "E1", about: "mesh extension", order: 1 },
    };
    const placeLaneOf = (place: string) => lanes[place] ?? null;
    const laneOf = (_id: string, name: string | null) => placeLaneOf(splitAgentName(name ?? "").place ?? "");
    const from = (project: string) => ({ senderContext: { agentId: "operator", project } });

    test("an ask sent from a lane's place comes from the agent working there", () => {
      const runs = [
        run({ id: "to-a", agentId: "a", createdAt: NOW - 30 * MIN, state: "running", startedAt: NOW - 30 * MIN }, from("openscout")),
        run({ id: "to-e1", agentId: "e1", createdAt: NOW - 25 * MIN, completedAt: NOW - 20 * MIN }, from("openscout")),
        run({ id: "a-to-e1", agentId: "e1", createdAt: NOW - 15 * MIN, state: "running", startedAt: NOW - 15 * MIN, input: { task: "Design refinement" } }, from("core-split-a")),
      ];
      const [swarm] = buildSwarms(runs, { now: NOW, windowMs: 60 * MIN, laneOf, placeLaneOf });
      expect(swarm!.asks.find((a) => a.id === "a-to-e1")).toMatchObject({ from: "a", fromMemberId: "a", memberId: "e1" });
      expect(swarm!.asks.find((a) => a.id === "to-e1")).toMatchObject({ from: null, fromMemberId: null });
      expect(swarm!.events.find((e) => e.askId === "a-to-e1" && e.kind === "asked")?.text).toBe("Lane A asked Lane E1: “Design refinement”");
      // Without the places, the same ask stays the point's.
      const [plain] = buildSwarms(runs, { now: NOW, windowMs: 60 * MIN, laneOf });
      expect(plain!.asks.find((a) => a.id === "a-to-e1")).toMatchObject({ from: null, fromMemberId: null });
    });

    test("the sender is the agent with an ask open there at the time, else the last one asked there", () => {
      const runs = [
        // Two sessions in A's place: a long ask to lavoisier-3, a short one to beethoven-3 inside it.
        run({ id: "long", agentId: "a1", agentName: "core-split-a-lavoisier-3", createdAt: NOW - 60 * MIN, completedAt: NOW - 15 * MIN }, from("openscout")),
        run({ id: "short", agentId: "a2", agentName: "core-split-a-beethoven-3", createdAt: NOW - 30 * MIN, completedAt: NOW - 25 * MIN }, from("openscout")),
        run({ id: "both-open", agentId: "e1", createdAt: NOW - 28 * MIN, completedAt: NOW - 27 * MIN }, from("core-split-a")),
        run({ id: "one-open", agentId: "e1", createdAt: NOW - 20 * MIN, completedAt: NOW - 19 * MIN }, from("core-split-a")),
        run({ id: "none-open", agentId: "e1", createdAt: NOW - 10 * MIN, completedAt: NOW - 9 * MIN }, from("core-split-a")),
      ];
      const [swarm] = buildSwarms(runs, { now: NOW, windowMs: 2 * 60 * MIN, laneOf, placeLaneOf });
      const sender = (id: string) => swarm!.asks.find((a) => a.id === id)?.from;
      expect(sender("both-open")).toBe("a2");
      expect(sender("one-open")).toBe("a1");
      expect(sender("none-open")).toBe("a2");
    });

    test("when no agent is known there, the ask still comes from the lane", () => {
      const runs = [run({ id: "a-to-e1", agentId: "e1", createdAt: NOW - 15 * MIN, completedAt: NOW - 5 * MIN }, from("core-split-a"))];
      const [swarm] = buildSwarms(runs, { now: NOW, windowMs: 60 * MIN, laneOf, placeLaneOf });
      expect(swarm!.asks[0]).toMatchObject({ from: null, fromMemberId: "a", memberId: "e1" });
      expect(swarm!.events.find((e) => e.kind === "asked")?.text.startsWith("Lane A asked Lane E1")).toBe(true);
    });

    test("an agent's own identity still decides first", () => {
      const runs = [
        run({ id: "p", agentId: "a", createdAt: NOW - 20 * MIN, state: "running" }, from("openscout")),
        // Another session works in E1's place at the time; the identity, not the place, names the sender.
        run({ id: "q", agentId: "e1b", agentName: "core-split-e1-galileo-2", createdAt: NOW - 15 * MIN, state: "running" }, from("openscout")),
        run({ id: "sub", agentId: "e1", requesterId: "a", createdAt: NOW - 10 * MIN, completedAt: NOW - 4 * MIN }, {
          ...from("core-split-e1"),
          returnAddress: { actorId: "a", sessionId: "a" },
        }),
      ];
      const [swarm] = buildSwarms(runs, { now: NOW, windowMs: 60 * MIN, laneOf, placeLaneOf });
      expect(swarm!.asks.find((a) => a.id === "sub")).toMatchObject({ from: "a", fromMemberId: "a" });
    });
  });

  test("an ask that waited behind a busy lane starts when the session takes it", () => {
    const queued = [run({ id: "q", agentId: "a", createdAt: NOW - 30 * MIN, state: "running", startedAt: NOW - 30 * MIN, input: { task: "M0 goes now" } }, {
      dispatchAck: { harness: "codex", acknowledgedAt: NOW - 7 * MIN },
    })];
    const [swarm] = buildSwarms(queued, { now: NOW, windowMs: 60 * MIN });
    expect(swarm!.asks[0]!.startedAt).toBe(NOW - 7 * MIN);
    expect(swarm!.members[0]!.sentence).toBe("On “M0 goes now” for 7 min");
  });

  test("a review is the runtime's declared request, named as one", () => {
    const [swarm] = buildSwarms([run({ id: "r", agentId: "a", createdAt: NOW - 3 * MIN, state: "review", input: { task: "Ship it?" } })], { now: NOW, windowMs: 60 * MIN });
    expect(swarm!.members[0]!.status).toBe("review");
    expect(swarm!.members[0]!.sentence).toBe("Review requested on “Ship it?”");
  });
});

describe("packAsks", () => {
  test("an ask that overlaps another takes the next row; one that follows reuses the first", () => {
    const swarm = buildSwarms([
      run({ id: "w", agentId: "a", createdAt: NOW - 30 * MIN, state: "running" }),
      run({ id: "q", agentId: "a", createdAt: NOW - 5 * MIN, state: "queued" }),
      run({ id: "e", agentId: "b", createdAt: NOW - 40 * MIN, completedAt: NOW - 35 * MIN }),
      run({ id: "f", agentId: "b", createdAt: NOW - 34 * MIN, completedAt: NOW - 20 * MIN }),
    ], { now: NOW, windowMs: 60 * MIN })[0]!;
    // b asked first, so b's lane comes first.
    const [b, a] = swarm.members;
    expect(packAsks(a!.asks, NOW)).toEqual({ slots: new Map([["w", 0], ["q", 1]]), count: 2 });
    expect(packAsks(b!.asks, NOW).count).toBe(1);
    expect(packAsks(b!.asks, NOW, 2 * MIN).count).toBe(2);
  });
});

describe("mergeRuns", () => {
  test("newer records win, old closed ones drop, open ones stay", () => {
    const held = new Map<string, AgentRun>([
      ["1", run({ id: "1", agentId: "a", createdAt: NOW - 10 * MIN, state: "running", updatedAt: NOW - 10 * MIN })],
      ["old", run({ id: "old", agentId: "a", createdAt: NOW - 50 * 60 * MIN })],
      ["open", run({ id: "open", agentId: "a", createdAt: NOW - 50 * 60 * MIN, state: "running" })],
    ]);
    const next = mergeRuns(held, [
      run({ id: "1", agentId: "a", createdAt: NOW - 10 * MIN, completedAt: NOW - MIN }),
      run({ id: "1", agentId: "a", createdAt: NOW - 10 * MIN, state: "running", updatedAt: NOW - 9 * MIN }),
    ], NOW - 26 * 60 * MIN);
    expect(next.get("1")?.state).toBe("completed");
    expect(next.has("old")).toBe(false);
    expect(next.has("open")).toBe(true);
  });
});

describe("axisTicks", () => {
  test("round local times, never more than asked for", () => {
    const start = NOW - 3 * 60 * MIN + 7 * MIN;
    const ticks = axisTicks(start, NOW, 8);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThanOrEqual(8);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(start);
      expect(tick).toBeLessThan(NOW);
      expect(new Date(tick).getMinutes() % 30).toBe(0);
    }
    expect(axisTicks(NOW, NOW)).toEqual([]);
  });
});

describe("member status", () => {
  const ask = (id: string, state: SwarmAsk["state"], askedAt: number): SwarmAsk => ({
    id, from: null, agentId: "agent", memberId: "a", fromMemberId: null, title: `Ask ${id}`, task: "", reply: null,
    replyHeadline: null, failure: null, state, open: true, askedAt, startedAt: null, endedAt: null,
    conversationId: null, workId: null, flightId: null,
  });

  test("asks queued behind the current one are told apart from a single one", () => {
    const working = ask("1", "working", NOW - 20 * MIN);
    expect(memberStatus([working], NOW).sentence).toBe("On “Ask 1” for 20 min");
    expect(memberStatus([working, ask("2", "queued", NOW - 5 * MIN)], NOW).sentence)
      .toBe("On “Ask 1” for 20 min, with another ask behind it");
    expect(memberStatus([working, ask("2", "queued", NOW - 5 * MIN), ask("3", "queued", NOW - MIN)], NOW).sentence)
      .toBe("On “Ask 1” for 20 min, with more asks behind it");
  });

  test("a silent session leads only when nothing it holds up is heard from, and is not counted behind", () => {
    const silent = { ...ask("1", "working", NOW - 40 * MIN), silence: { since: NOW - 20 * MIN, finished: false } };
    expect(memberStatus([silent], NOW)).toEqual({ status: "silent", since: NOW - 20 * MIN, sentence: "Silent for 20 min on “Ask 1”" });
    expect(memberStatus([silent, ask("2", "queued", NOW - 5 * MIN)], NOW).sentence).toBe("Silent for 20 min on “Ask 1”, with another ask behind it");
    expect(memberStatus([{ ...silent, silence: { since: NOW - 20 * MIN, finished: true } }], NOW).sentence)
      .toBe("Finished “Ask 1” 20 min ago; the reply has not reached the runtime");
    expect(memberStatus([silent, ask("2", "working", NOW - 5 * MIN)], NOW).sentence).toBe("On “Ask 2” for 5 min");
  });
});
