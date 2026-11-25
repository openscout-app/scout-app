import { describe, expect, test } from "bun:test";

import { swarmPulls } from "./swarm-code.ts";
import { CORE_SPLIT } from "./swarm-goal.ts";
import { findInitiatives, initiativeMembers } from "./swarm-initiatives.ts";
import { pullSentence, repoLead, repoPulls, stepWords, type PullStep } from "./swarm-repo.ts";
import type { AgentRun } from "./types.ts";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

function run(overrides: Partial<AgentRun> & { id: string; agentId: string; createdAt: number }, labels?: string[]): AgentRun {
  const { id, agentId, createdAt } = overrides;
  return {
    source: "ask",
    requesterId: "operator",
    state: "completed",
    input: { task: `Task for ${agentId}` },
    output: {},
    updatedAt: createdAt + MIN,
    completedAt: createdAt + MIN,
    agentName: `core-split-${agentId}-popper-4`,
    metadata: {
      flightMetadata: {
        source: "scout-mcp",
        requesterDisplayName: "Arach",
        returnAddress: { actorId: "operator", sessionId: "mcp:point-1" },
        senderContext: { agentId: "operator", project: "openscout" },
        ...(labels ? { labels } : {}),
      },
    },
    ...overrides,
    id,
    agentId,
    createdAt,
  } as AgentRun;
}

const REVIEW = ["goal:core-split", "lane:a", "review"];

/** Lane A opens arach/scout#50, Fable clears it with a condition, E1 and A work on it, Fable clears it; Lane C opens two private pull requests in one reply. */
function coreSplit() {
  const runs = [
    run({ id: "a-open", agentId: "a", createdAt: NOW - 50 * MIN, output: { text: "Opened arach/scout#50 with the contract." } }),
    run({ id: "c-open", agentId: "c", createdAt: NOW - 45 * MIN, output: { text: "Opened arach/openscout#1440 and arach/openscout#1438 with the docs." } }),
    run({ id: "review-1", agentId: "fable", agentName: "openscout-hudson-6", createdAt: NOW - 40 * MIN,
      output: { text: "arach/scout#50 at 1234abcd. Verdict: CLEAR WITH CONDITIONS — one sentence in the doc." } }, REVIEW),
    run({ id: "e1-work", agentId: "e1", createdAt: NOW - 35 * MIN, input: { task: "Fix the bridge test in arach/scout#50." },
      output: { text: "Pushed 77bb to arach/scout#50; 171 pass." } }),
    run({ id: "a-work", agentId: "a", createdAt: NOW - 30 * MIN, input: { task: "Add Fable's sentence to arach/scout#50." },
      output: { text: "Pushed 99aa to arach/scout#50 with the sentence." } }),
    run({ id: "review-2", agentId: "fable", agentName: "openscout-hudson-6", createdAt: NOW - 10 * MIN,
      output: { text: "arach/scout#50 at 5678abcd. Verdict: clear." } }, REVIEW),
  ];
  const [initiative] = findInitiatives(runs, { now: NOW, goals: [CORE_SPLIT] });
  const asks = initiative!.swarms.flatMap((swarm) => swarm.asks);
  return { pulls: swarmPulls({ asks }), lanes: initiativeMembers(initiative!.swarms, NOW) };
}

describe("a repository's pull requests", () => {
  test("each pull request lists the asks that moved it in the order they replied", () => {
    const { pulls, lanes } = coreSplit();
    const [pull, ...rest] = repoPulls("arach/scout", pulls, lanes);
    expect(rest).toEqual([]);
    expect(pull!.pr.key).toBe("arach/scout#50");
    expect(pull!.steps.map((step) => [step.askId, step.role, step.lane, step.verdict])).toEqual([
      ["a-open", "opened", "Lane A", null],
      ["review-1", "reviewed", "Fable", "Clear with conditions"],
      ["e1-work", "worked", "Lane E1", null],
      ["a-work", "worked", "Lane A", null],
      ["review-2", "reviewed", "Fable", "Clear"],
    ]);
    expect(pull!.last).toBe(NOW - 9 * MIN);
  });

  test("one sentence says who opened it, who else worked on it, and each reviewer's latest verdict", () => {
    const { pulls, lanes } = coreSplit();
    expect(repoPulls("arach/scout", pulls, lanes)[0]!.sentence).toBe("Lane A opened it; Lane E1 worked on it; Fable reviewed it: Clear.");
    // One reply moved both, so they share a time and the higher number comes first.
    expect(repoPulls("arach/openscout", pulls, lanes).map((pull) => [pull.pr.key, pull.sentence])).toEqual([
      ["arach/openscout#1440", "Lane C opened it."],
      ["arach/openscout#1438", "Lane C opened it."],
    ]);
  });

  test("a repository the initiative's asks never moved has none", () => {
    const { pulls, lanes } = coreSplit();
    expect(repoPulls("openscout-app/scout", pulls, lanes)).toEqual([]);
  });

  test("an ask outside the lanes is left out, as the canvas leaves it out", () => {
    const { pulls, lanes } = coreSplit();
    const withoutFable = lanes.filter((lane) => lane.id !== "review");
    expect(repoPulls("arach/scout", pulls, withoutFable)[0]!.sentence).toBe("Lane A opened it; Lane E1 worked on it.");
  });

  test("the lead says what moved last and when, with everything the same reply did there", () => {
    const { pulls, lanes } = coreSplit();
    expect(repoLead(repoPulls("arach/scout", pulls, lanes), NOW)).toBe("Fable reviewed #50: Clear, 9 min ago");
    expect(repoLead(repoPulls("arach/openscout", pulls, lanes), NOW)).toBe("Lane C opened #1438 and #1440 44 min ago");
    expect(repoLead([], NOW)).toBeNull();
  });

  test("a lead past six pull requests names five and how many more", () => {
    const opened = (n: number) => ({
      pr: { key: `openscout-app/scout#${n}`, repo: "openscout-app/scout", number: n, url: "" }, last: NOW, sentence: "",
      steps: [{ askId: "k-1", role: "opened" as const, at: NOW - 2 * MIN, laneId: "k", lane: "kafka-6", title: "", verdict: null }],
    });
    expect(repoLead([77, 78, 80, 82, 83, 85].map(opened), NOW)).toBe("kafka-6 opened #77, #78, #80, #82, #83 and #85 2 min ago");
    expect(repoLead([77, 78, 80, 82, 83, 85, 86].map(opened), NOW)).toBe("kafka-6 opened #77, #78, #80, #82, #83 and 2 more 2 min ago");
  });
});

describe("the words", () => {
  const step = (lane: string, role: PullStep["role"], verdict: string | null = null): PullStep =>
    ({ askId: `${lane}-${role}`, role, at: 0, laneId: lane, lane, title: "", verdict });

  test("several lanes and reviewers, and a review with no verdict line", () => {
    expect(pullSentence([
      step("Lane A", "opened"),
      step("Lane E1", "worked"),
      step("Fable", "reviewed", "Clear with conditions"),
      step("Lane C", "worked"),
      step("Lane B", "reviewed"),
      step("Fable", "reviewed", "CLEAR, with one named one-line hardening for A's next pass"),
    ])).toBe("Lane A opened it; Lane E1 and Lane C worked on it; Fable reviewed it: Clear; Lane B reviewed it.");
  });

  test("the lead cuts a verdict to its first clause, and a step keeps it whole", () => {
    const review = { ...step("Fable", "reviewed", "Land as is, inactive, with one named fix"), at: NOW - 3 * MIN };
    const pull = { pr: { key: "arach/scout#47", repo: "arach/scout", number: 47, url: "" }, last: review.at, steps: [review], sentence: "" };
    expect(repoLead([pull], NOW)).toBe("Fable reviewed #47: Land as is, 3 min ago");
    expect(stepWords(review)).toBe("Fable reviewed it: Land as is, inactive, with one named fix");
  });

  test("a pull request opened outside the initiative starts with the work on it", () => {
    expect(pullSentence([step("Lane T", "worked")])).toBe("Lane T worked on it.");
    expect(pullSentence([])).toBe("");
  });

  test("a step names the pull request when asked to", () => {
    expect(stepWords(step("Lane A", "worked"), "#51")).toBe("Lane A worked on #51");
    expect(stepWords(step("Fable", "reviewed", "Land as is"))).toBe("Fable reviewed it: Land as is");
  });
});
