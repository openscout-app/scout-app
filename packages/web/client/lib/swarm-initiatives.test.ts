import { describe, expect, test } from "bun:test";

import { CORE_SPLIT } from "./swarm-goal.ts";
import { findInitiatives, humanize, initiativeSentence, sessionMark } from "./swarm-initiatives.ts";
import type { SwarmAsk, SwarmMember } from "./swarm-model.ts";
import type { AgentRun } from "./types.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

/** An ask from the operator's Scout MCP session, as the runtime records it, from a Claude session in openscout. */
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
    agentName: `openscout-${agentId}-4`,
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

function asks(count: number, base: Omit<Parameters<typeof run>[0], "id" | "createdAt"> & { at: number }, flight?: Record<string, unknown>): AgentRun[] {
  const { at, ...rest } = base;
  return Array.from({ length: count }, (_, index) => run({ ...rest, id: `${rest.agentId}-${index}`, createdAt: at + index * MIN }, flight));
}

describe("finding initiatives", () => {
  test("one point's asks split by what they serve, not by who sent them", () => {
    const runs = [
      // A lane of the goal, by the place it works in.
      ...asks(3, { agentId: "lane-a", agentName: "core-split-a-lavoisier-3", at: NOW - 3 * HOUR }),
      // The reviewer works from the main checkout, and its labels name the review lane.
      ...asks(2, { agentId: "fable", agentName: "openscout-hudson-6", at: NOW - 2 * HOUR }, { labels: ["goal:core-split", "lane:a", "review"] }),
      // Another project: every session there is one initiative.
      ...asks(4, { agentId: "dirac", agentName: "lattices-dirac-8", at: NOW - 30 * HOUR }),
      ...asks(2, { agentId: "kepler", agentName: "lattices-kepler-2", at: NOW - 29 * HOUR }),
      // Sessions in the asker's own checkout are each their own piece of work.
      ...asks(6, { agentId: "zeno", agentName: "openscout-zeno-5", at: NOW - 50 * HOUR }),
      ...asks(1, { agentId: "pike", agentName: "openscout-pike-4", at: NOW - 40 * HOUR }),
    ];
    const found = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
    expect(found.map((initiative) => initiative.id).sort()).toEqual(["goal:core-split", "place:lattices", "session:pike", "session:zeno"]);

    const split = found.find((initiative) => initiative.id === "goal:core-split")!;
    expect(split.title).toBe("Core split");
    expect(split.kind).toBe("goal");
    expect(split.lanes.map((lane) => lane.mark)).toEqual(["A", "F"]);
    expect(split.asks).toBe(5);

    const lattices = found.find((initiative) => initiative.id === "place:lattices")!;
    expect(lattices.title).toBe("Lattices");
    expect(lattices.summary).toBe("Every session working in lattices.");
    expect(lattices.sessions).toBe(2);
    expect(lattices.lanes.map((lane) => lane.name)).toEqual(["dirac-8", "kepler-2"]);

    const zeno = found.find((initiative) => initiative.id === "session:zeno")!;
    expect(zeno.title).toBe("Task for zeno");
    expect(zeno.summary).toBe("The asks to zeno-5, working in openscout.");
  });

  test("a session that only one lane asked does that lane's work, drawn in its lane", () => {
    const runs = [
      ...asks(2, { agentId: "lane-a", agentName: "core-split-a-lavoisier-3", at: NOW - 2 * HOUR }),
      // Lane A's own reviewer: the runtime records its asks as the operator's, returning to lane A's session.
      run({ id: "sub-1", agentId: "helper", agentName: "openscout-ravel-2", createdAt: NOW - HOUR },
        { returnAddress: { actorId: "operator", sessionId: "lane-a" } }),
    ];
    const [split, ...rest] = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
    expect(rest).toEqual([]);
    expect(split!.id).toBe("goal:core-split");
    expect(split!.asks).toBe(3);
    const sub = split!.swarms[0]!.asks.find((ask) => ask.id === "sub-1")!;
    expect(sub.memberId).toBe("a");
    expect(sub.from).toBe("lane-a");
  });

  test("an ask one lane sent another through the point's Scout MCP session is drawn from the sending lane", () => {
    const runs = [
      run({ id: "to-a", agentId: "lane-a", agentName: "core-split-a-beethoven-3", createdAt: NOW - 2 * HOUR, completedAt: NOW - HOUR }),
      run({ id: "to-e1", agentId: "lane-e1", agentName: "core-split-e1-voltaire-10", createdAt: NOW - 2 * HOUR + 5 * MIN }),
      // A asked E1 while it worked on the point's ask; the runtime records it as the operator's, sent from A's place.
      run({ id: "a-to-e1", agentId: "lane-e1", agentName: "core-split-e1-voltaire-10", createdAt: NOW - 90 * MIN },
        { senderContext: { agentId: "operator", project: "core-split-a" } }),
    ];
    const [split] = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
    const asks = split!.swarms.flatMap((swarm) => swarm.asks);
    expect(asks.find((ask) => ask.id === "a-to-e1")).toMatchObject({ from: "lane-a", fromMemberId: "a", memberId: "e1" });
    expect(asks.find((ask) => ask.id === "to-e1")).toMatchObject({ from: null, fromMemberId: null });
  });

  test("a goal label with no registry entry still makes an initiative, with lanes from its lane labels", () => {
    const runs = [
      ...asks(2, { agentId: "x1", agentName: "openscout-euler-4", at: NOW - HOUR }, { labels: ["goal:muse-launch", "lane:docs"] }),
      ...asks(1, { agentId: "x2", agentName: "openscout-gauss-4", at: NOW - HOUR }, { labels: ["goal:muse-launch"] }),
    ];
    const [initiative] = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
    expect(initiative!.id).toBe("goal:muse-launch");
    expect(initiative!.title).toBe("Muse launch");
    expect(initiative!.summary).toBe("The asks labeled goal:muse-launch.");
    expect(initiative!.lanes.map((lane) => [lane.name, lane.mark])).toEqual([["Lane DOCS", "DOCS"], ["gauss-4", "G4"]]);
  });

  test("roots are the initiatives with enough asks or enough sessions", () => {
    const runs = [
      ...asks(5, { agentId: "busy", at: NOW - 5 * HOUR }),
      ...asks(2, { agentId: "brief", at: NOW - 4 * HOUR }),
      ...["orwell", "pasteur", "haydn"].map((name, index) => run({ id: name, agentId: name, agentName: `scout-media-${name}-3`, createdAt: NOW - 3 * HOUR + index * MIN })),
    ];
    const major = new Map(findInitiatives(runs, { now: NOW }).map((initiative) => [initiative.id, initiative.major]));
    expect(major.get("session:busy")).toBe(true);
    expect(major.get("session:brief")).toBe(false);
    expect(major.get("place:scout-media")).toBe(true);
  });

  test("initiatives with work in progress come first, then the most recently active", () => {
    const runs = [
      ...asks(1, { agentId: "old", at: NOW - 30 * HOUR }),
      ...asks(1, { agentId: "recent", at: NOW - HOUR }),
      run({ id: "open-1", agentId: "working", createdAt: NOW - 20 * HOUR, state: "running", completedAt: undefined, updatedAt: NOW - 20 * HOUR }),
    ];
    const found = findInitiatives(runs, { now: NOW });
    expect(found.map((initiative) => initiative.id)).toEqual(["session:working", "session:recent", "session:old"]);
    expect(found[0]!.open).toBe(1);
    expect(found[0]!.tone).toBe("work");
    // The old ask replied a minute after it was sent.
    expect(found[2]!.sentence).toBe("Quiet for 29 h 59 min.");
  });

  test("no runs, no initiatives", () => {
    expect(findInitiatives([], { now: NOW })).toEqual([]);
  });
});

describe("words", () => {
  const member = (name: string, status: SwarmMember["status"], asks: SwarmAsk[] = []) => ({ name, status, asks }) as SwarmMember;
  /** A lane whose session went silent on an open ask; `finished` when its last turn ended after the ask began. */
  const silentLane = (name: string, finished: boolean) =>
    member(name, "silent", [{ open: true, state: "working", silence: { since: NOW - 2 * HOUR, finished } } as SwarmAsk]);

  test("the sentence puts a requested review first, then work, then how long it has been quiet", () => {
    expect(initiativeSentence([member("Lane A", "working"), member("Fable", "review")], NOW, NOW)).toEqual({ sentence: "Review requested on Fable's reply.", tone: "review" });
    expect(initiativeSentence([member("Lane A", "working"), member("Lane C", "working")], NOW, NOW)).toEqual({ sentence: "Lane A and Lane C are working.", tone: "work" });
    expect(initiativeSentence(["A", "B", "C", "D"].map((name) => member(`Lane ${name}`, "working")), NOW, NOW).sentence).toBe("Lane A, Lane B and 2 others are working.");
    expect(initiativeSentence([member("dirac-8", "queued")], NOW, NOW).sentence).toBe("dirac-8 has an ask not started yet.");
    expect(initiativeSentence([member("Lane A", "done")], NOW - 3 * HOUR, NOW)).toEqual({ sentence: "Quiet for 3 h.", tone: "quiet" });
  });

  test("silent sessions are named after the lead, or alone", () => {
    expect(initiativeSentence([member("Lane A", "working"), member("Lane C", "silent")], NOW, NOW).sentence).toBe("Lane A is working. Lane C has gone silent.");
    expect(initiativeSentence([member("Lane A", "silent"), member("Lane C", "silent")], NOW, NOW)).toEqual({ sentence: "Lane A and Lane C have gone silent.", tone: "work" });
  });

  test("a silent lane whose turn ended reads as finished, its reply not reached, as its row says", () => {
    expect(initiativeSentence([member("Lane T", "working"), silentLane("Lane C", true), silentLane("Lane E1", true)], NOW, NOW).sentence)
      .toBe("Lane T is working. Lane C and Lane E1 finished; their replies have not reached the runtime.");
    expect(initiativeSentence([silentLane("Lane A", false), silentLane("Lane C", true)], NOW, NOW)).toEqual({
      sentence: "Lane A has gone silent. Lane C finished; its reply has not reached the runtime.",
      tone: "work",
    });
  });

  test("place names read as titles, and sessions get tile letters", () => {
    expect(humanize("modules-anywhere")).toBe("Modules anywhere");
    expect(humanize("scout_media")).toBe("Scout media");
    expect(sessionMark("lattices-dirac-8")).toBe("D8");
    expect(sessionMark("Grok Cursor")).toBe("GC");
  });
});
