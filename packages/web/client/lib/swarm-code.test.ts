import { describe, expect, test } from "bun:test";

import {
  askDeeds,
  askPulls,
  codeLinks,
  deedSentence,
  isReviewAsk,
  laneVocabularies,
  linkedIssues,
  openedByAsk,
  pullRefs,
  reviewedByAsk,
  reviewSubject,
  reviewVerdict,
  swarmPulls,
  verdictWords,
} from "./swarm-code.ts";
import type { SwarmAsk } from "./swarm-model.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 21, 8, 0, 0);

function ask(overrides: Partial<SwarmAsk> & { id: string }): SwarmAsk {
  return {
    from: null,
    agentId: `agent-${overrides.id}`,
    memberId: "a",
    fromMemberId: null,
    title: overrides.task?.split("\n")[0] ?? "An ask",
    task: "",
    reply: null,
    replyHeadline: null,
    failure: null,
    state: "done",
    open: false,
    askedAt: T0,
    startedAt: T0,
    endedAt: T0 + 5 * MIN,
    conversationId: null,
    workId: null,
    flightId: null,
    ...overrides,
  };
}

describe("pullRefs", () => {
  test("reads qualified references and pull URLs in order, once each", () => {
    const text = [
      "[PR #1434](https://github.com/arach/openscout/pull/1434)",
      "Stacked on arach/scout#49, then arach/scout#50 and https://github.com/arach/scout/pull/49/files.",
    ].join("\n");
    expect(pullRefs(text).map((pr) => pr.key)).toEqual(["arach/openscout#1434", "arach/scout#49", "arach/scout#50"]);
    expect(pullRefs(text)[0]).toEqual({
      key: "arach/openscout#1434",
      repo: "arach/openscout",
      number: 1434,
      url: "https://github.com/arach/openscout/pull/1434",
    });
  });

  test("leaves bare numbers, paths and anchors alone", () => {
    const text = "See #50, docs/eng/core-split-cutover-checklist.md#gate-18 and packages/runtime/src#3, then issue https://github.com/arach/scout/issues/7.";
    expect(pullRefs(text)).toEqual([]);
  });

  test("lowercases the repository so one pull request has one key", () => {
    expect(pullRefs("Arach/Scout#5 and arach/scout#5").map((pr) => pr.key)).toEqual(["arach/scout#5"]);
  });

  test("with a lane's vocabulary, a bare number names the one pull request the lane knows by it", () => {
    const vocabulary = laneVocabularies([ask({ id: "a1", task: "Lane A", reply: "Opened arach/scout#51 and arach/scout#7." })]).get("a");
    expect(pullRefs("Pushed head 323d0d1d to #51; #52 is not ours.", vocabulary).map((pr) => pr.key)).toEqual(["arach/scout#51"]);
    expect(pullRefs("Anchors: checklist.md#7, src#7, &#7;, ## 7 and #7ab.", vocabulary)).toEqual([]);
  });
});

describe("laneVocabularies", () => {
  test("a number two repositories share stays unread, and each lane reads only its own numbers", () => {
    const vocabularies = laneVocabularies([
      ask({ id: "a1", task: "Lane A", reply: "Opened arach/scout#52." }),
      ask({ id: "a2", task: "Lane A: compare arach/openscout#52" }),
      ask({ id: "c1", memberId: "c", task: "Lane C", reply: "Opened arach/openscout#1436." }),
    ]);
    expect(vocabularies.get("a")?.get(52)).toBeNull();
    expect(pullRefs("Updated #52.", vocabularies.get("a"))).toEqual([]);
    expect(pullRefs("Fable's #1436 review", vocabularies.get("a"))).toEqual([]);
    expect(pullRefs("#1436 updated to 2250daae.", vocabularies.get("c")).map((pr) => pr.key)).toEqual(["arach/openscout#1436"]);
  });
});

describe("askPulls", () => {
  test("a pull request at the top of the reply that the task did not name was opened there", () => {
    const pulls = askPulls(ask({
      id: "t1",
      task: "Lane T: the R0 adapter contract after role-effect exclusion",
      reply: "[PR #1434](https://github.com/arach/openscout/pull/1434)\nHead: `cfe98b5a`",
    }));
    expect(pulls).toEqual([{ pr: expect.objectContaining({ key: "arach/openscout#1434" }), role: "opened" }]);
  });

  test("one the task named too was worked on; one named only in the task or deep in the reply is named", () => {
    const deep = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}.`).join("\n");
    const pulls = askPulls(ask({
      id: "a1",
      task: "Lane A: rebase arach/scout#41 after arach/scout#46 lands",
      reply: `Updated arach/scout#41 to 6a80bf28.\n${deep}\nThe milestone is openscout-app/scout#131.`,
    }));
    expect(pulls.map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#41", "worked"],
      ["arach/scout#46", "named"],
      ["openscout-app/scout#131", "named"],
    ]);
  });

  test("a line announces what it opened in its first sentence, after any list marker", () => {
    const pulls = askPulls(ask({
      id: "t3",
      memberId: "t",
      task: "Lane T: guest access, split into reviewable pieces",
      reply: [
        "Four drafts, each independently mergeable:",
        "1. [#94 — scoutd formatting](https://github.com/openscout-app/scout/pull/94)",
        "- [#102](https://github.com/openscout-app/scout/pull/102): the strict empty-HOME fix passes on macOS.",
        "| [#104 HTTP proxy refusal](https://github.com/openscout-app/scout/pull/104) | 83 pass, 1 skip |",
        "First PR: [openscout-app/scout#101](https://github.com/openscout-app/scout/pull/101), branch `core-split-t/guests`. Unmerged.",
      ].join("\n"),
    }));
    expect(pulls.map(({ pr, role }) => [pr.key, role])).toEqual([
      ["openscout-app/scout#94", "opened"],
      ["openscout-app/scout#102", "opened"],
      ["openscout-app/scout#104", "opened"],
      ["openscout-app/scout#101", "opened"],
    ]);
  });

  test("later in a line, a cited fix or another pull request's status is context, not code the ask opened", () => {
    const pulls = askPulls(ask({
      id: "e1",
      memberId: "e1",
      task: "Lane E1: the full CLI test run stalls after the extension permission tests",
      reply: [
        "**Bun defect; no Scout PR.** The sync-spawn loop spins after its child exits. This matches [Bun #34069](https://github.com/oven-sh/bun/issues/34069); [upstream #44581](https://github.com/oven-sh/bun/pull/44581) identifies the cause.",
        "No runtime API gap found. Forbidden files and arach/scout#55 remain untouched.",
      ].join("\n"),
    }));
    expect(pulls.map(({ pr, role }) => [pr.key, role])).toEqual([
      ["oven-sh/bun#44581", "named"],
      ["arach/scout#55", "named"],
    ]);
  });

  test("a line that cites a pull request as already there did not open it, even in its first sentence", () => {
    const pulls = askPulls(ask({
      id: "a3",
      task: "CLI env hang (#1478): name the native function",
      reply: [
        "Named the macOS native spin: `spawnMaybeSync` → `kevent64`.",
        "This matches existing [Bun #34069 and its merged fix #44581](https://github.com/oven-sh/bun/pull/44581): finalizers release main-loop polls.",
        "The existing PR arach/scout#126 is unchanged; draft [#127](https://github.com/arach/scout/pull/127) adds the witness.",
      ].join("\n"),
    }));
    expect(pulls.map(({ pr, role }) => [pr.key, role])).toEqual([
      ["oven-sh/bun#44581", "named"],
      ["arach/scout#126", "named"],
      ["arach/scout#127", "opened"],
    ]);
  });

  test("a thread the lane only commented on was not opened, even in its first sentence", () => {
    const pulls = askPulls(ask({
      id: "t9",
      task: "The split's one failing guard, then A2 onto the split",
      reply: [
        "- **[#129](https://github.com/arach/scout/pull/129): `900961b1`**, all hosted jobs green.",
        "Backlog clarification: arach/openscout#912, comment `6382140081`.",
        "Recorded on arach/openscout#1478 (comment 6378232766).",
      ].join("\n"),
    }));
    expect(pulls.map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#129", "opened"],
      ["arach/openscout#912", "named"],
      ["arach/openscout#1478", "named"],
    ]);
    // A bare reference the lane's vocabulary knows reads the same way.
    const vocabulary = laneVocabularies([ask({ id: "v", task: "arach/openscout#1478" })]).get("a");
    const bare = askPulls(ask({ id: "t11", task: "Record the rerun", reply: "Recorded on #1478 (comment 6378232766)." }), vocabulary);
    expect(bare.map(({ pr, role }) => [pr.key, role])).toEqual([["arach/openscout#1478", "named"]]);
    // A pull request a line delivers is still opened when a comment sits elsewhere in the line.
    const draft = askPulls(ask({ id: "t10", task: "Draft the fix", reply: "Draft arach/scout#130 is up; review comments welcome." }));
    expect(draft.map(({ pr, role }) => [pr.key, role])).toEqual([["arach/scout#130", "opened"]]);
  });

  test("work on a pull request the task named still counts anywhere at the top of the reply", () => {
    const pulls = askPulls(ask({
      id: "a2",
      task: "Lane A: #67, one sentence before merge on arach/scout#67",
      reply: "`609a3a22` — exact sentence added, docs only, pushed with lease. arach/scout#67 remains draft.",
    }));
    expect(pulls.map(({ pr, role }) => [pr.key, role])).toEqual([["arach/scout#67", "worked"]]);
  });

  test("a review reviews what its reply opens with, not the context it names", () => {
    const pulls = askPulls(ask({
      id: "f1",
      memberId: "review",
      task: "Review: arach/scout#40, the milestone-5 integration branch after openscout-app/scout#130",
      reply: "Review of arach/scout#40 (head f23ce173). Verdict: land as is.\nIt follows openscout-app/scout#130.",
    }));
    expect(pulls.map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#40", "reviewed"],
      ["openscout-app/scout#130", "named"],
    ]);
  });

  test("a review whose reply names nothing up top reviews what its first line names", () => {
    const pulls = askPulls(ask({
      id: "f2",
      memberId: "review",
      task: "Review: arach/scout#43 and arach/scout#44 (two drafts held for M0)",
      reply: "Two verdicts, both from scratch clones.",
    }));
    expect(pulls.map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#43", "reviewed"],
      ["arach/scout#44", "reviewed"],
    ]);
  });

  test("an ask titled as a review counts outside the review lane when its reply gives a verdict", () => {
    const reply = "Security review of arach/scout#3 round 2 (head 530efe4). Verdict: all five commits land as is.";
    expect(isReviewAsk({ memberId: "a", title: "Review request: arach/scout#3", reply })).toBe(true);
    expect(isReviewAsk({ memberId: "review", title: "Thanks for #3", reply: "Noted." })).toBe(true);
    expect(isReviewAsk({ memberId: "a", title: "Lane A: preview the fence", reply })).toBe(false);
  });

  test("a lane handed review findings works on the pull request; it does not review it", () => {
    const findings = ask({
      id: "t2",
      memberId: "t",
      task: "Review of arach/scout#4 at ca244858. The design is right: per-listener caps, two fixes before merge.",
      reply: "Updated [PR #4](https://github.com/arach/scout/pull/4) to `d36efc83`.",
    });
    expect(isReviewAsk(findings)).toBe(false);
    expect(askPulls(findings).map(({ pr, role }) => [pr.key, role])).toEqual([["arach/scout#4", "worked"]]);
  });
});

// Lanes' replies from the core split, 10-21 and 10-22: each names its base beside its work.
describe("askPulls and a base beside the work", () => {
  const known = (memberId: string, refs: string) => laneVocabularies([ask({ id: `v-${memberId}`, memberId, task: refs })]).get(memberId);

  test("a draft stacked on another opens only the draft", () => {
    const tail = ask({
      id: "t4",
      memberId: "t",
      task: "Tail slice two: the negotiated wire contract, stacked on #84",
      reply: "Draft [#89](https://github.com/arach/scout/pull/89), stacked on #84. Head: `4b49bb6e`. Not merged.",
    });
    expect(askPulls(tail, known("t", "arach/scout#84 arach/scout#89")).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#84", "named"],
      ["arach/scout#89", "opened"],
    ]);
    const herdr = ask({
      id: "a3",
      task: "Herdr slice 2: the inactive answer factory",
      reply: "Draft [#85](https://github.com/arach/scout/pull/85), stacked on #81.\nHead: `94c52598`",
    });
    expect(askPulls(herdr, known("a", "arach/scout#81 arach/scout#85")).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#85", "opened"],
      ["arach/scout#81", "named"],
    ]);
  });

  test("a base the reply also reports on is still only named", () => {
    const restack = ask({
      id: "e2",
      memberId: "e1",
      task: "#78's two doc sentences, then #78 on #75's new head",
      reply: [
        "- **#75:** `99de032e` (unchanged).",
        "- **[#78](https://github.com/arach/scout/pull/78):** `0029c961`, pushed with lease; still draft, based on #75.",
      ].join("\n"),
    });
    expect(askPulls(restack, known("e1", "arach/scout#75 arach/scout#78")).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#78", "worked"],
      ["arach/scout#75", "named"],
    ]);
  });

  test("a base the lane also worked on keeps its work, and work on a pull request is no base", () => {
    const vocabulary = known("a", "arach/scout#51 arach/scout#53");
    const followups = ask({
      id: "a4",
      task: "Lane A: Fable cleared #53; one sentence on #51 and the held map on #53",
      reply: [
        "- [#51](https://github.com/arach/scout/pull/51): `2fe34077` — audit paragraph replaced verbatim.",
        "- [#53](https://github.com/arach/scout/pull/53): `0c344c46` — rebased onto #51; both remain draft/inactive.",
      ].join("\n"),
    });
    expect(askPulls(followups, vocabulary).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#53", "worked"],
      ["arach/scout#51", "worked"],
    ]);
    const conditions = ask({ id: "a5", task: "Lane A: Fable's two conditions on #51", reply: "Pushed both conditions on #51 at `a85c8f98`." });
    expect(askPulls(conditions, vocabulary).map(({ pr, role }) => [pr.key, role])).toEqual([["arach/scout#51", "worked"]]);
  });

  test("a review does not review the base its opening cites", () => {
    const review = ask({
      id: "f3",
      memberId: "review",
      task: "Review: arach/scout#89, tail slice two, stacked on arach/scout#84",
      reply: "Review of arach/scout#89 (head 4b49bb6e), on top of arach/scout#84. Verdict: clear.",
    });
    expect(askPulls(review).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#89", "reviewed"],
      ["arach/scout#84", "named"],
    ]);
  });

  test("a pull request the lane measures against is a reference, not work", () => {
    // On 10-24 the arach/scout panel read "Lane T worked on #131 and #132": the reply published #132 and gave "the verbatim diff against #131".
    const publish = ask({
      id: "t12",
      memberId: "t",
      task: "Stage 5: the ACP line stays out, by reach; commit your unsupported-route check as a scope witness, then publish",
      reply: [
        "Published draft [#132](https://github.com/arach/scout/pull/132), head `ff30a945`, base `ci/fence-suite-matrix`.",
        "The four limit lines remain exactly as at `1773249c`; the verbatim diff against #131 is in the report and PR body.",
      ].join("\n"),
    });
    expect(askPulls(publish, known("t", "arach/scout#131 arach/scout#132")).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#132", "opened"],
      ["arach/scout#131", "named"],
    ]);
    // A review measured against another pull request reviews only its own.
    const review = ask({
      id: "f13",
      memberId: "review",
      task: "Review arach/scout#101, the stream repair",
      reply: "arach/scout#101 is cleared, reviewed against arach/scout#100's real stream.",
    });
    expect(askPulls(review).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#101", "reviewed"],
      ["arach/scout#100", "named"],
    ]);
  });

  test("a pull request the lane says the work left out is not work", () => {
    // On 10-24 #95's history listed lane C's "#100: keep the update fix out of #100", whose reply says "no #95 work performed".
    const kept = ask({
      id: "c7",
      memberId: "c",
      task: "#100: keep the update fix out of #100 (Fable's ruling)",
      reply: [
        "- **#100 head:** `66b52451` — readiness only, restored with the requested lease.",
        "- **`lane/c-100-update-fixture`:** `a2c13506` — pushed unchanged. No PR opened.",
        "No CI dispatched; no #95 work performed.",
      ].join("\n"),
    });
    expect(askPulls(kept, known("c", "arach/scout#95 arach/scout#100")).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#100", "worked"],
      ["arach/scout#95", "named"],
    ]);
    // So it goes for one the work did without, or one a line sets aside.
    const without = ask({ id: "c8", memberId: "c", task: "Find the hang", reply: "Reproduced on core-split without #100, on both Buns.\nFollow-on, not #116." });
    expect(askPulls(without, known("c", "arach/scout#100 arach/scout#116")).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#100", "named"],
      ["arach/scout#116", "named"],
    ]);
  });

  test("a pull request the task gives as done or waiting is context", () => {
    // On 10-24 #95's history listed lane C's "#95 is in CI; now #100: …", whose reply only says "#95 remains unmerged".
    // The reply never names #100, so neither counts as work here.
    const rebase = ask({
      id: "c9",
      memberId: "c",
      task: "#95 is in CI; now #100: rebase onto core-split and test E1's update finding",
      reply: "Pushed **`a2c13506`**, rebased onto `b90c69fd`, with the requested lease. #95 remains unmerged. The updater fix is a separate tip commit.",
    });
    expect(askPulls(rebase, known("c", "arach/scout#95 arach/scout#100")).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#95", "named"],
      ["arach/scout#100", "named"],
    ]);
    // A pull request the task asks work on keeps it, whatever state the reply gives.
    const draft = ask({ id: "a9", memberId: "a", task: "#70, two changes at the completion layer before merge", reply: "Both changes pushed with lease; #70 remains draft." });
    expect(askPulls(draft, known("a", "arach/scout#70")).map(({ pr, role }) => [pr.key, role])).toEqual([["arach/scout#70", "worked"]]);
  });

  test("a base named before its number is a base too", () => {
    // On 10-24 a sequencing ruling read as Fable's review of A1, and "Yes" as its verdict.
    const sequencing = ask({
      id: "f4",
      memberId: "review",
      task: "Sequencing: may T build PR B now, stacked on A1 (arach/scout#126)?",
      reply: "YES — T may start PR B now as a draft stacked on 44038da1 under the four conditions as proposed.",
    });
    expect(askPulls(sequencing).map(({ pr, role }) => [pr.key, role])).toEqual([["arach/scout#126", "named"]]);
    const stage = ask({
      id: "t5",
      memberId: "t",
      task: "Stage 5: fence local-agent and Codex commands, as a draft stacked on stage 4 (arach/scout#131)",
      reply: "Draft [#132](https://github.com/arach/scout/pull/132), head `1773249c`, stacked on stage 4 (#131).",
    });
    expect(askPulls(stage, known("t", "arach/scout#131 arach/scout#132")).map(({ pr, role }) => [pr.key, role])).toEqual([
      ["arach/scout#131", "named"],
      ["arach/scout#132", "opened"],
    ]);
  });
});

describe("reviewVerdict", () => {
  test("reads the verdict sentence as the reviewer wrote it", () => {
    expect(reviewVerdict("Review of arach/scout#50 (head 6cdae626).\n\n**Verdict: land as is, inactive.** One sentence for the doc."))
      .toBe("land as is, inactive");
    expect(reviewVerdict("Security review of arach/scout#2. Verdicts: all four land as is. No blocking findings."))
      .toBe("all four land as is");
    expect(reviewVerdict("Review of #51's descriptor-slot commit. Verdict on the slot commit: CLEAR. Scratch-clone ledger follows."))
      .toBe("Clear");
    expect(reviewVerdict("**Verdict for #49:** land as is.")).toBe("land as is");
  });

  test("calms a shouted verdict and falls back when there is none", () => {
    expect(reviewVerdict("**Verdict: LAND.** The model is correct.")).toBe("Land");
    expect(reviewVerdict("Clear to merge.", "Clear to merge.")).toBe("Clear to merge.");
    expect(reviewVerdict(null)).toBeNull();
  });

  test("reads a ruling line in capitals as the verdict, and the first verdict or ruling counts", () => {
    const land = reviewVerdict([
      "Ruling on private arach/openscout#1476 at 62b91efd (one commit on d5e6da58, one file, +14 lines): the #1473 fence inventory fix.",
      "",
      "RULING — LAND AS IS; #1476 merges on this clear. The diff is exactly the two named records.",
    ].join("\n"));
    expect(land).toBe("LAND AS IS; #1476 merges on this clear");
    expect(verdictWords(land)).toBe("Land as is");
    const cleared = reviewVerdict([
      "Ruling on #117 at b4c9d254 (three commits on cf81b65a, 18 files): the window is bound to its request.",
      "",
      "RULING 1 — CLEARED TO MERGE once hosted CI at b4c9d254 is green (run 39936902343 in progress at ruling). All three conditions hold.",
      "",
      "RULING 2 — BOTH NOTES ARE FOLLOW-UPS, NOT CHANGES TO THIS PR.",
    ].join("\n"));
    expect(cleared).toBe("CLEARED TO MERGE once hosted CI at b4c9d254 is green (run 39936902343 in progress at ruling)");
    expect(verdictWords(cleared)).toBe("Cleared to merge");
    expect(reviewVerdict("RULING 1 — THE DELTA IS APPROVED AS WRITTEN. It is a faithful re-grounding.")).toBe("The delta is approved as written");
    expect(reviewVerdict("**Verdict: land as is.**\n\nRULING 2 — HOLD the follow-up.")).toBe("land as is");
    expect(reviewVerdict("RULING 1 — LAND AS IS; one note.\n\nThe verdict: the report is right.")).toBe("LAND AS IS; one note");
  });

  test("a reply that opens with its subject has no ruling", () => {
    expect(reviewVerdict("Ruling on #117 at b4c9d254 (three commits on cf81b65a, 18 files): the window is bound to its request.")).toBeNull();
    expect(reviewVerdict("Ruling on the P2-B census, S1, the order of work, and the plan.\n\nThe census is complete.")).toBeNull();
  });

  test("a line that opens with a verdict's word in capitals and a dash or colon is the verdict", () => {
    const confirmed = reviewVerdict([
      "Confirmation of #121's respin at 98502431 (two commits on reviewed 608cd018): the test-budget commit and the parent-predicate fix.",
      "",
      "CONFIRMED — #121 IS CLEARED TO MERGE AT 98502431 ON HOSTED GREEN (run 40009305845 was still in progress at my check). Both commits are exactly what my rulings ordered.",
    ].join("\n"));
    expect(confirmed).toBe("CONFIRMED — #121 IS CLEARED TO MERGE AT 98502431 ON HOSTED GREEN (run 40009305845 was still in…");
    expect(verdictWords(confirmed)).toBe("Confirmed");
    expect(reviewVerdict("Notes first.\n\n**HOLD:** the cold placement audit failed. Rerun when quiet.")).toBe("HOLD: the cold placement audit failed");
    // The word opens its line and meets a dash or a colon; capitals elsewhere are not a verdict line.
    expect(reviewVerdict("The rows are CLEAR now — nothing else changed.")).toBeNull();
    expect(reviewVerdict("CLEARED TO MERGE once CI is green.")).toBeNull();
  });

  test("a reply that opens by naming its pull request and saying in capitals what it is gives the verdict", () => {
    const reply = "A1 (#126) IS CLEARED AT fdb262ad for the staged boundary — code and text as they stand, nothing must change. Full ruling: the review folder. Three gates remain, none mine.";
    expect(reviewVerdict(reply)).toBe("A1 (#126) IS CLEARED AT fdb262ad for the staged boundary — code and text as they stand, nothing…");
    expect(verdictWords(reviewVerdict(reply), reply)).toBe("Cleared at fdb262ad");
    expect(verdictWords(reviewVerdict("arach/scout#120 IS CLEARED TO MERGE at 36b22edf. Hosted CI is green."))).toBe("Cleared to merge");
    expect(verdictWords(reviewVerdict("PR A (arach/scout#126) IS NOT CLEAR as it stands. One change."))).toBe("Not clear");
    // A ruling says what it settled.
    const settled = "#1478 IS SETTLED FOR A1 UNDER ROUTE (a). Full ruling: the review folder. I verified the control myself.";
    expect(reviewVerdict(settled)).toBe("#1478 IS SETTLED FOR A1 UNDER ROUTE (a)");
    expect(verdictWords(reviewVerdict(settled), settled)).toBe("Settled for A1 under route (a)");
    expect(verdictWords(reviewVerdict("Notes first.\n\nSETTLED — the hang belongs to the base."))).toBe("Settled");
    // A part of the pull request can be named in capitals instead.
    const gate = "GATE BUNDLE APPROVED AT 5ba40c23 with ONE required addition before the window. Full ruling: the review folder.";
    expect(reviewVerdict(gate)).toBe("GATE BUNDLE APPROVED AT 5ba40c23 with ONE required addition before the window");
    expect(verdictWords(reviewVerdict(gate), gate)).toBe("Gate bundle approved at 5ba40c23");
    expect(verdictWords(reviewVerdict("THE DELTA IS APPROVED AS WRITTEN. It is faithful."))).toBe("The delta is approved as written");
    // Prose after the name, capitals with no verdict word, or a verdict word after words in their own case are not this verdict.
    expect(reviewVerdict("#118 lands as is. Details follow.")).toBeNull();
    expect(reviewVerdict("A1 (#126) is cleared at fdb262ad.")).toBeNull();
    expect(reviewVerdict("GATE BUNDLE READY AT 5ba40c23. Details follow.")).toBeNull();
    expect(reviewVerdict("The gate bundle is APPROVED at 5ba40c23.")).toBeNull();
  });

  test("a verdict in capitals after a short label and a dash or a colon, in the opening sentence or the next, gives the verdict", () => {
    const delta = "Delta ACK, README only — CONFIRMED and still clear. I re-read the whole README and compared it line by line.";
    expect(reviewVerdict(delta)).toBe("CONFIRMED and still clear");
    expect(verdictWords(reviewVerdict(delta), delta)).toBe("Confirmed and still clear");
    const ruling = "Ruling on #116 at dd1c8689. R1 — CLEARED TO MERGE once hosted CI at this head is green. The revision implements both rulings.";
    expect(reviewVerdict(ruling)).toBe("CLEARED TO MERGE once hosted CI at this head is green");
    expect(verdictWords(reviewVerdict(ruling), ruling)).toBe("Cleared to merge");
    expect(verdictWords(reviewVerdict("**Delta ACK** — **CONFIRMED** and still clear."))).toBe("Confirmed and still clear");
    // A colon ends the label too, and a few words in capitals can name what the verdict word rules on.
    expect(verdictWords(reviewVerdict("#110: LAND AS IS, gated on hosted green."))).toBe("Land as is");
    const correction = "Correction accepted: CLEAR WITH THE CORRECTION — W2 is dead, and your reasoning is right. I verified the plan myself.";
    expect(verdictWords(reviewVerdict(correction), correction)).toBe("Clear with the correction");
    const adopted = "A2 scope ruling: A′ ADOPTED — fence the direct paths and NARROW the process line; do not remove it.";
    expect(verdictWords(reviewVerdict(adopted), adopted)).toBe("A′ adopted");
    const option = "CI margin ruling: OPTION 1 ADOPTED — split the pairing tests into their own job; T builds it. Option 2 refused.";
    expect(reviewVerdict(option)).toBe("OPTION 1 ADOPTED — split the pairing tests into their own job; T builds it");
    expect(verdictWords(reviewVerdict(option), option)).toBe("Option 1 adopted");
    const findings = "Ruling on #116 and the two-room proposal. R1 — ALL THREE FINDINGS CONFIRMED (I spot-checked independently). R2 — the fix is right.";
    expect(verdictWords(reviewVerdict(findings), findings)).toBe("All three findings confirmed");
    // A sentence that says what it rules on can run long before the label.
    const design = "Ruling on the sentinel-first design delta and the probe decisions. DESIGN: APPROVED FOR THE IMPLEMENTATION PR AS WRITTEN, with two binding amendments.";
    expect(verdictWords(reviewVerdict(design), design)).toBe("Approved for the implementation PR as written");
    // The opening sentence's verdict counts before the next one's.
    expect(reviewVerdict("Delta ACK — CONFIRMED. R2 — HOLD the follow-up.")).toBe("Confirmed");
    // Not after a long opening sentence of another kind, not further in, and not when the words after the label are prose or name no verdict.
    expect(reviewVerdict("Notes on #116 at dd1c8689, with three commits on the reviewed base and two new files. R1 — CLEARED TO MERGE.")).toBeNull();
    expect(reviewVerdict("Ruling on #116. Notes first. R1 — CLEARED TO MERGE.")).toBeNull();
    expect(reviewVerdict("Delta ACK, README only — confirmed and still clear.")).toBeNull();
    expect(reviewVerdict("Ruling on #113's cold refusal at a16c930a. Q1: this is a COLLECTION refusal — NOT a design failure.")).toBeNull();
    expect(reviewVerdict("Ruling on the P2-B census. (1) THE CENSUS MEETS AMENDMENT 5 — pinned trees and reproducible searches.")).toBeNull();
  });

  test("a reply that counts its rulings gives the first ruling's verdict, after its label and a colon or a dash", () => {
    const landed = "Two rulings. #110: LAND AS IS, gated on hosted run 39878860492 green. Pure sensitivity EXTENSION verified line by line — the catch rethrows the SAME error. — Herdr P2 design: ALL FIVE DECISIONS APPROVED with amendments.";
    expect(reviewVerdict(landed)).toBe("LAND AS IS, gated on hosted run 39878860492 green");
    expect(verdictWords(reviewVerdict(landed), landed)).toBe("Land as is");
    const delta = "Two rulings. #107 REBASE DELTA: APPROVED — #107 completes and merges on hosted green at d942b582 (a failure on the known flake is a re-dispatch). Verified in a scratch clone.";
    expect(verdictWords(reviewVerdict(delta), delta)).toBe("Approved");
    const mechanism = "Two rulings. #107 (mechanism + witness HOLD): the INVENTORY MECHANISM IS APPROVED at 01885907 — LAND WITH THE ONE ALREADY-REQUESTED CHANGE (rebase onto 48a6bb29). The mechanism satisfies every instrument rule.";
    expect(verdictWords(reviewVerdict(mechanism), mechanism)).toBe("The inventory mechanism is approved at 01885907");
    const numbered = "Four rulings on the #116 follow-up (fact 1's reproduction noted with approval — the failing baselines now exist for everything the revision must fix). R1 — MATCHING PRIVATE'S RELAY SEMANTICS IS RIGHT: private's three-room model is production precedent. R2 — CLEAR.";
    expect(verdictWords(reviewVerdict(numbered), numbered)).toBe("Matching private's relay semantics is right");
    expect(reviewVerdict("**Two rulings.**\n\n1. **#110:** LAND AS IS.\n2. #111: HOLD.")).toBe("Land as is");
    // Not when the first ruling is prose, and not a label after other words.
    expect(reviewVerdict("Two rulings. #110: the fix is right as written.")).toBeNull();
    expect(reviewVerdict("Two rulings. First the notes. #110: LAND AS IS.")).toBeNull();
  });

  test("a ruling that answers its question first gives the answer, alone or after a short label", () => {
    const sequencing = "YES — T may start PR B now as a draft stacked on 44038da1 under the four conditions as proposed; 'after A merges' governs merge and review order, not build order. Two sharpenings follow.";
    expect(verdictWords(reviewVerdict(sequencing), sequencing)).toBe("Yes");
    const boundary = "Stage-4 boundary ruling: YES — the external-work acceptance boundary is the FINAL GUARDED CLIENT SUBMISSION, adopted explicitly. Full ruling: the review folder.";
    expect(verdictWords(reviewVerdict(boundary), boundary)).toBe("Yes");
    expect(verdictWords(reviewVerdict("NO, with one exception: the census stays as written."))).toBe("No, with one exception: the census stays as written");
    // Only the opening answers, in capitals, with punctuation after it.
    expect(reviewVerdict("Notes first.\n\nYES — the probe passed.")).toBeNull();
    expect(reviewVerdict("Yes — the probe passed.")).toBeNull();
    expect(reviewVerdict("YESTERDAY's run passed — twice.")).toBeNull();
  });

  test("a ruling's label, then its answer in capitals, gives the answer", () => {
    const margin = "Owners-margin ruling: PARTITION NOW, OPTION 2 (the matrix), placed as (a). (1) Partition on the projection — it is grounded in observed ratios from hosted logs.";
    expect(reviewVerdict(margin)).toBe("PARTITION NOW, OPTION 2 (the matrix), placed as (a)");
    expect(verdictWords(reviewVerdict(margin), margin)).toBe("Partition now");
    const census = "**Census ruling:** THE CENSUS MEETS AMENDMENT 5 — pinned trees and reproducible searches.";
    expect(verdictWords(reviewVerdict(census), census)).toBe("The census meets amendment 5");
    // A ruling in prose, a label that names no ruling, one word in capitals, and a label further in are not one.
    expect(reviewVerdict("Scope ruling: the census stays as written.")).toBeNull();
    expect(reviewVerdict("Status: CI GREEN on all eight jobs.")).toBeNull();
    expect(reviewVerdict("Owners-margin ruling: PARTITION now, before stage 5.")).toBeNull();
    expect(reviewVerdict("Notes first. Owners-margin ruling: PARTITION NOW.")).toBeNull();
  });

  test("a short label, then a clause that ends on a verdict's word in capitals, gives the clause", () => {
    const ack = "DELTA ACK: the recorder at 44038da1 is ACCEPTED. Full ruling: the review folder. Verified myself: one commit on 5ba40c23.";
    expect(reviewVerdict(ack)).toBe("the recorder at 44038da1 is ACCEPTED");
    expect(verdictWords(reviewVerdict(ack), ack)).toBe("The recorder at 44038da1 is accepted");
    expect(verdictWords(reviewVerdict("Delta ACK — ACCEPTED. One note follows."))).toBe("Accepted");
    // Words after the verdict's word make it emphasis in prose, and a word in its own case is no verdict.
    expect(reviewVerdict("DELTA ACK: the recorder is ACCEPTED at 44038da1.")).toBeNull();
    expect(reviewVerdict("DELTA ACK: the recorder at 44038da1 is accepted.")).toBeNull();
    expect(reviewVerdict("The gate bundle is APPROVED at 5ba40c23.")).toBeNull();
  });

  test("a reply that opens in bold with a reviewer's verdict word in its own case gives the verdict", () => {
    const names = "**Clear at `eb5a68f5`; no name or doc changes required.**";
    expect(reviewVerdict(names)).toBe("Clear at eb5a68f5; no name or doc changes required");
    expect(verdictWords(reviewVerdict(names), names)).toBe("Clear at eb5a68f5");
    expect(reviewVerdict("**Approved.** Two notes follow.")).toBe("Approved");
    // A lane that stops opens in bold too, and the same words without bold are prose.
    expect(reviewVerdict("**Blocked at the file boundary:** open #66 owns the file.")).toBeNull();
    expect(reviewVerdict("**No production edits were made.**")).toBeNull();
    expect(reviewVerdict("Clear at eb5a68f5; no changes.")).toBeNull();
  });
});

describe("verdictWords", () => {
  test("keeps a verdict's lead phrase for a block, calm and capitalized", () => {
    expect(verdictWords("CLEAR WITH CONDITIONS — one condition, which is exactly the hole your question 1 hypothesized…"))
      .toBe("Clear with conditions");
    expect(verdictWords("land as is, inactive — with one protocol sentence to add to the doc")).toBe("Land as is, inactive");
    expect(verdictWords("land as is, inactive, after one named ONE-LINE doc fix; one non-blocking follow-up"))
      .toBe("Land as is, inactive, after one named one-line doc fix");
    expect(verdictWords("all four land as is")).toBe("All four land as is");
    expect(verdictWords(null)).toBeNull();
  });

  test("a phrase in capitals is the verdict; one word in capitals keeps the clause that conditions it", () => {
    expect(verdictWords("CLEAR WITH TWO NAMED CHANGES, both small and both at the completion layer; the report layer publishes as is"))
      .toBe("Clear with two named changes");
    expect(verdictWords("ADOPT AS GATE 18'S DIRECTION, with four named additions below")).toBe("Adopt as gate 18's direction");
    expect(verdictWords("CLEAR, with one sentence to fold into HOST-ATTENTION.md before merge (answer 3)"))
      .toBe("Clear, with one sentence to fold into HOST-ATTENTION.md before merge (answer 3)");
    expect(verdictWords("CLI JSON refusal is right, land it")).toBe("CLI JSON refusal is right, land it");
    expect(verdictWords("Land as is, inactive, with ONE NAMED FIX that must land first"))
      .toBe("Land as is, inactive, with one named fix that must land first");
  });

  test("a verdict's own word in capitals later in the kept clause reads calmly too", () => {
    expect(verdictWords("CLEAR, and the floor ruling is CONFIRMED")).toBe("Clear, and the floor ruling is confirmed");
    expect(verdictWords("CLEAR, and API 2 is NOT for release until CI runs")).toBe("Clear, and API 2 is not for release until CI runs");
    expect(verdictWords("CLEAR, no named changes")).toBe("Clear, no named changes");
    expect(verdictWords("CLEAR, and #1478 is SETTLED for A1")).toBe("Clear, and #1478 is settled for A1");
  });

  test("capitals that start with a verdict's word are the verdict even when lowercase words follow", () => {
    expect(verdictWords("CLEAR WITH ONE NAMED CHANGE and one queued broker follow-up bundle")).toBe("Clear with one named change");
    expect(verdictWords("NOT CLEAR as it stands")).toBe("Not clear");
    expect(verdictWords("CLEAR with one sentence to fold in")).toBe("Clear with one sentence to fold in");
  });

  test("capitals that end on a verdict's word, after what it rules on, are the verdict too", () => {
    expect(verdictWords("EVIDENCE CLEARED for transport (b), on BOTH platforms")).toBe("Evidence cleared");
    expect(verdictWords("ALL THREE FINDINGS CONFIRMED (I spot-checked independently)")).toBe("All three findings confirmed");
    // One word in capitals before lowercase words is a name, not a verdict.
    expect(verdictWords("CONFIRMED by both runs")).toBe("Confirmed by both runs");
  });

  test("a verdict that opens by naming its pull request reads from the verdict", () => {
    const cleared = reviewVerdict([
      "Ruling on arach/scout#120 at 36b22edf (two commits on reviewed 125304d9, 27 files): R2 of the remedy.",
      "",
      "RULING 1 — #120 IS CLEARED TO MERGE at 36b22edf, and hosted CI is ALREADY GREEN at this exact head (run 39988240291). After it merges, R1 and R2 go together.",
    ].join("\n"));
    expect(verdictWords(cleared)).toBe("Cleared to merge");
    expect(verdictWords("arach/scout#57 is clear, with one doc sentence")).toBe("Clear, with one doc sentence");
    expect(verdictWords("#118 lands as is")).toBe("#118 lands as is");
  });

  test("capitals carry tokens with no case of their own, and read as a sentence when they hold its small words", () => {
    expect(verdictWords("GATE (g) PASSES, and with it #122 IS CLEARED TO MERGE (hosted CI was already green at this head")).toBe("Gate (g) passes");
    expect(verdictWords("BUILD PR 1 NOW as proposed, with amendments (none a redesign)")).toBe("Build PR 1 now");
    expect(verdictWords("THE AIR QUALIFIES as the equivalent macOS arm64 host my tail ruling named")).toBe("The air qualifies");
    // A commit is caseless too, so the verdict does not stop on the word before it.
    expect(verdictWords(reviewVerdict("RULING — #124 IS CLEARED AT f1b3e4e9. It merges after #123 merges."))).toBe("Cleared at f1b3e4e9");
    expect(verdictWords("CLEAR AT 5988f61e, with one test to restore")).toBe("Clear at 5988f61e");
    // Capitals of acronyms alone stay a name.
    expect(verdictWords("CLI JSON refusal is right, land it")).toBe("CLI JSON refusal is right, land it");
  });

  test("a name the reply writes in its own case after a lowercase word keeps that case", () => {
    expect(verdictWords("THE AIR QUALIFIES as the equivalent host", "Ruling on the gate host, run on the Air.")).toBe("The Air qualifies");
    // A capital that opens a sentence is not a name.
    expect(verdictWords("CLEARED TO MERGE", "The tree check stands. Merge per the listed steps.")).toBe("Cleared to merge");
  });

  test("a letter after an acronym is a name, and a lettered condition is not", () => {
    expect(verdictWords("OPTION 1 IS ACCEPTED FOR PR A: one fresh authority read per awaited frame is the contract…"))
      .toBe("Option 1 is accepted for PR A");
    expect(verdictWords("LAND PR B AFTER PR A, as ruled")).toBe("Land PR B after PR A");
    expect(verdictWords("CLEAR UNDER (a) AND (b), both small")).toBe("Clear under (a) and (b)");
  });

  test("a verdict given as a value reads as words", () => {
    const value = reviewVerdict("Review (2 of 3) complete — verdict: needs_revision. Full report in the review folder.");
    expect(value).toBe("needs_revision");
    expect(verdictWords(value)).toBe("Needs revision");
    expect(verdictWords("READY_FOR_NEXT_REVIEW")).toBe("Ready for next review");
  });

  test("words in capitals inside a kept clause read calmly; acronyms side by side stay names", () => {
    expect(verdictWords("the kernel stays injected and the NAMED PRIVATE HOST owns the composition — the rest follows"))
      .toBe("The kernel stays injected and the named private host owns the composition");
    expect(verdictWords("both required changes are CORRECTLY IMPLEMENTED, and the advisory shape is APPROVED"))
      .toBe("Both required changes are correctly implemented, and the advisory shape is approved");
    expect(verdictWords("the PTY XPC path is right as built")).toBe("The PTY XPC path is right as built");
  });

  test("a clause that runs into the cut ends on a whole word, and keeps the ellipsis", () => {
    expect(verdictWords("A credible founder-led bet, but the narrower insight needs one outside leader’s consequential d…"))
      .toBe("A credible founder-led bet, but the narrower insight needs one outside leader’s consequential…");
    expect(verdictWords("second meeting yes, but as a pre-seed/seed bet on the founder and the category, not an enterpri…"))
      .toBe("Second meeting yes, but as a pre-seed/seed bet on the founder and the category…");
    expect(verdictWords("the diversity half is published mechanism but unmeasured on real PRs (self-preference bias, Neu…"))
      .toBe("The diversity half is published mechanism but unmeasured on real PRs…");
    expect(verdictWords("both required changes are CORRECTLY IMPLEMENTED, the advisory lastSeen shape is APPROVED, and #…"))
      .toBe("Both required changes are correctly implemented, the advisory lastSeen shape is approved…");
    expect(verdictWords("HOLD: full qualification fails cold collection because wrapper 0 remains alive after sixty-four rou…"))
      .toBe("Hold: full qualification fails cold collection because wrapper 0 remains alive after sixty-four…");
    // A short clause ends on its own ellipsis.
    expect(verdictWords("Clear…")).toBe("Clear");
  });
});

describe("swarmPulls", () => {
  test("ties each pull request to the ask that opened it, later work and replied reviews", () => {
    const opened = ask({ id: "a1", task: "Lane A: the fence", reply: "Draft https://github.com/arach/scout/pull/50, head 6cdae626.", endedAt: T0 + 10 * MIN });
    const review = ask({
      id: "f1",
      memberId: "review",
      task: "Review: arach/scout#50 (head 6cdae626)",
      reply: "Review of arach/scout#50. Verdict: land as is, inactive. One sentence to add.",
      replyHeadline: "Review of arach/scout#50.",
      askedAt: T0 + 12 * MIN,
      endedAt: T0 + 18 * MIN,
    });
    const fix = ask({ id: "a2", task: "Lane A: one protocol sentence on #50", reply: "Pushed arach/scout#50 at e4de492e.", askedAt: T0 + 20 * MIN, endedAt: T0 + 22 * MIN });
    const pending = ask({ id: "f2", memberId: "review", task: "Review: arach/scout#51", open: true, state: "working", endedAt: null, askedAt: T0 + 30 * MIN });
    const [pull, ...rest] = swarmPulls({ asks: [opened, review, fix, pending] });
    expect(rest).toEqual([]);
    expect(pull).toEqual({
      pr: expect.objectContaining({ key: "arach/scout#50" }),
      openedBy: "a1",
      workedBy: ["a2"],
      reviews: [{ askId: "f1", at: T0 + 18 * MIN, memberId: "review", verdict: "land as is, inactive" }],
      last: T0 + 22 * MIN,
    });
  });
});

describe("linkedIssues", () => {
  test("reads the numbers linked as issues, keyed as pull requests are, and nothing else", () => {
    const texts = [
      "Timing watch preserved in [#1480](https://github.com/arach/openscout/issues/1480).",
      "Backlog: https://github.com/Arach/OpenScout/issues/1478#issuecomment-1 and https://github.com/arach/scout/pull/131",
      null,
      "Rule on arach/openscout#1477",
    ];
    expect([...linkedIssues(texts)].sort()).toEqual(["arach/openscout#1478", "arach/openscout#1480"]);
  });
});

describe("swarmPulls and issues", () => {
  const filed = ask({
    id: "t1",
    memberId: "t",
    task: "Stage 4: fence broker sends",
    reply: "Draft arach/scout#131 at 1b298602.\nBacklog: [#1478](https://github.com/arach/openscout/issues/1478).",
    endedAt: T0 + 10 * MIN,
  });
  const ruling = ask({
    id: "f1",
    memberId: "review",
    task: "Rule on arach/openscout#1478 under your ruling 3: the CLI hang repro",
    reply: "#1478 IS SETTLED FOR A1 UNDER ROUTE (a).",
    askedAt: T0 + 20 * MIN,
    endedAt: T0 + 25 * MIN,
  });

  test("a ruling on a number another ask links as an issue moved no code", () => {
    expect(swarmPulls({ asks: [ruling] }).map((pull) => pull.pr.key)).toEqual(["arach/openscout#1478"]);
    expect(swarmPulls({ asks: [filed, ruling] }).map((pull) => pull.pr.key)).toEqual(["arach/scout#131"]);
  });

  test("an issue linked by a run outside the swarm is left out too", () => {
    expect(swarmPulls({ asks: [ruling] }, new Set(["arach/openscout#1478"]))).toEqual([]);
  });
});

describe("swarmPulls with bare references", () => {
  test("a lane's bare reference to its own pull request is work on it", () => {
    const opened = ask({ id: "a1", task: "Lane A: the slot", reply: "Opened arach/scout#51 at 008109a5.", endedAt: T0 + 10 * MIN });
    const fix = ask({
      id: "a2",
      task: "Lane A: #51's carrier slot collides with the parent channel",
      reply: "Pushed head 323d0d1d to #51.",
      askedAt: T0 + 20 * MIN,
      endedAt: T0 + 30 * MIN,
    });
    expect(askPulls(fix)).toEqual([]);
    expect(swarmPulls({ asks: [opened, fix] })).toEqual([expect.objectContaining({ openedBy: "a1", workedBy: ["a2"] })]);
  });

  test("a review counts only the pull requests it qualifies; its bare numbers are precedent", () => {
    const known = ask({ id: "f0", memberId: "review", task: "Review: arach/openscout#1418", reply: "Review of arach/openscout#1418. Verdict: land." });
    const review = ask({
      id: "f1",
      memberId: "review",
      task: "Review: arach/openscout#1420",
      reply: "Review of arach/openscout#1420. Verdict: land as is, exactly as #1418 landed.",
      askedAt: T0 + 20 * MIN,
      endedAt: T0 + 25 * MIN,
    });
    const [vocabulary] = [...laneVocabularies([known, review]).values()];
    expect(askPulls(review, vocabulary).filter((entry) => entry.role === "reviewed").map((entry) => entry.pr.key)).toEqual(["arach/openscout#1420"]);
  });
});

describe("openedByAsk", () => {
  test("marks only the ask that opened each pull request, in number order", () => {
    const both = ask({ id: "c1", task: "Lane C: gate 17", reply: "Opened arach/openscout#1436 and arach/openscout#1435.\nAlso arach/scout#46." });
    const later = ask({ id: "c2", task: "Lane C: fix arach/openscout#1435", reply: "Pushed arach/openscout#1435 at 0f00ba44.", askedAt: T0 + 20 * MIN, endedAt: T0 + 25 * MIN });
    const review = ask({ id: "f1", memberId: "review", task: "Review: arach/scout#46", reply: "Review of arach/scout#46. Verdict: land." });
    const opened = openedByAsk(swarmPulls({ asks: [both, later, review] }));
    expect([...opened.keys()]).toEqual(["c1"]);
    expect(opened.get("c1")?.map((pr) => pr.key)).toEqual(["arach/openscout#1435", "arach/openscout#1436", "arach/scout#46"]);
  });
});

describe("reviewedByAsk and codeLinks", () => {
  const opener = ask({ id: "a1", task: "Lane A: the fence", reply: "Drafts arach/scout#50 and arach/scout#49.", endedAt: T0 + 10 * MIN });
  const review = ask({
    id: "f1",
    memberId: "review",
    task: "Review: arach/scout#49 and arach/scout#50",
    reply: "Review of arach/scout#49 and arach/scout#50. Verdict: land as is, inactive.",
    askedAt: T0 + 12 * MIN,
    endedAt: T0 + 18 * MIN,
  });
  const fix = ask({ id: "a2", task: "Lane A: one sentence on arach/scout#50", reply: "Pushed arach/scout#50 at e4de492e.", askedAt: T0 + 20 * MIN, endedAt: T0 + 22 * MIN });
  const pending = ask({ id: "f2", memberId: "review", task: "Review: arach/scout#51", open: true, state: "working", endedAt: null, askedAt: T0 + 30 * MIN });
  const pulls = swarmPulls({ asks: [opener, review, fix, pending] });

  test("names what each replied review reviewed, in number order", () => {
    const reviewed = reviewedByAsk(pulls);
    expect([...reviewed.keys()]).toEqual(["f1"]);
    expect(reviewed.get("f1")?.map((pr) => pr.key)).toEqual(["arach/scout#49", "arach/scout#50"]);
  });

  test("links the asks that moved the same pull requests, once per pair", () => {
    const links = codeLinks(pulls);
    const of = (askId: string) => (links.get(askId) ?? []).map((link) => [link.askId, link.role, link.prs.map((pr) => pr.key).sort()]);
    expect(of("a1")).toEqual(expect.arrayContaining([
      ["f1", "reviewed", ["arach/scout#49", "arach/scout#50"]],
      ["a2", "worked", ["arach/scout#50"]],
    ]));
    expect(of("a1")).toHaveLength(2);
    expect(of("f1")).toEqual(expect.arrayContaining([
      ["a1", "opened", ["arach/scout#49", "arach/scout#50"]],
      ["a2", "worked", ["arach/scout#50"]],
    ]));
    expect(of("a2")).toEqual(expect.arrayContaining([["a1", "opened", ["arach/scout#50"]], ["f1", "reviewed", ["arach/scout#50"]]]));
    // A review still open is a request, not yet a link.
    expect(links.has("f2")).toBe(false);
  });
});

describe("askDeeds and deedSentence", () => {
  const opener = ask({ id: "a1", task: "Lane A: the fence", reply: "Drafts arach/scout#50 and arach/scout#49.", endedAt: T0 + 10 * MIN });
  const fix = ask({ id: "a2", task: "Lane A: one sentence on arach/scout#50", reply: "Pushed arach/scout#50 at e4de492e.", askedAt: T0 + 20 * MIN, endedAt: T0 + 22 * MIN });
  const cleared = ask({
    id: "f1",
    memberId: "review",
    task: "Review: arach/scout#50 (head e4de492e)",
    reply: "Review of arach/scout#50. Verdict: CLEAR WITH CONDITIONS — one condition, the retention design.",
    askedAt: T0 + 24 * MIN,
    endedAt: T0 + 30 * MIN,
  });
  const plain = ask({ id: "f2", memberId: "review", task: "Review: arach/scout#49", reply: "Review of arach/scout#49. The model is right.", askedAt: T0 + 31 * MIN, endedAt: T0 + 33 * MIN });
  const asks = [opener, fix, cleared, plain];
  const deeds = askDeeds(asks, swarmPulls({ asks }));

  test("an ask that opened pull requests did that, in number order", () => {
    expect(deeds.get("a1")).toEqual({ verb: "opened", refs: [expect.objectContaining({ key: "arach/scout#49" }), expect.objectContaining({ key: "arach/scout#50" })], verdict: null });
    expect(deedSentence(deeds.get("a1")!, { who: "Lane A" })).toBe("Lane A opened arach/scout#49 and arach/scout#50");
    expect(deedSentence(deeds.get("a1")!)).toBe("Opened arach/scout#49 and arach/scout#50");
  });

  test("a review carries its verdict's lead phrase, or none when it gave no verdict line", () => {
    expect(deedSentence(deeds.get("f1")!, { who: "Fable" })).toBe("Fable reviewed arach/scout#50: Clear with conditions");
    expect(deeds.get("f2")?.verdict).toBeNull();
    expect(deedSentence(deeds.get("f2")!, { who: "Fable" })).toBe("Fable reviewed arach/scout#49");
  });

  test("a lane's label says when, after the verdict, so a narrow label cuts the time first", () => {
    expect(deedSentence(deeds.get("f1")!, { ago: "8 min ago" })).toBe("Reviewed arach/scout#50: Clear with conditions, 8 min ago");
    expect(deedSentence(deeds.get("f2")!, { ago: "6 min ago" })).toBe("Reviewed arach/scout#49 6 min ago");
    expect(deedSentence(deeds.get("a1")!, { ago: "1 min ago" })).toBe("Opened arach/scout#49 and arach/scout#50 1 min ago");
  });

  test("work on a pull request someone else opened is not a deed; its reply speaks for itself", () => {
    expect(deeds.has("a2")).toBe(false);
  });

  test("lists three or more pull requests with commas", () => {
    const refs = ["arach/scout#1", "arach/scout#2", "arach/scout#3"].map((key) => ({ key, repo: "arach/scout", number: Number(key.split("#")[1]), url: "" }));
    expect(deedSentence({ verb: "opened", refs, verdict: null }, { who: "Lane C" })).toBe("Lane C opened arach/scout#1, arach/scout#2 and arach/scout#3");
  });

  test("a review of a design note quotes what it reviewed and says its verdict", () => {
    const note = ask({
      id: "f3",
      memberId: "review",
      task: "Design review: Herdr permission answers beside tmux (A's note)\n\nFrom Claude, running point.",
      reply: "Design review: Herdr permission answers beside tmux (A's note). Verdict: CLEAR — all four decisions approved as A proposes.\n\nIt keeps arach/scout#76's result shape.",
      askedAt: T0 + 40 * MIN,
      endedAt: T0 + 44 * MIN,
    });
    const rollout = ask({
      id: "f4",
      memberId: "review",
      task: "Design review: `scout web` leaves the core (C's rollout note)",
      reply: "Verdict: CLEAR WITH ONE NAMED CHANGE — a sequencing clarification.",
    });
    const unsaid = ask({ id: "f5", memberId: "review", task: "Review: the runtime tail contract", reply: "The contract reads well." });
    const running = ask({ id: "f6", memberId: "review", task: "Review: the barrier", reply: null, open: true, state: "working" });
    const all = [note, rollout, unsaid, running];
    const found = askDeeds(all, swarmPulls({ asks: all }));
    expect(found.get("f3")).toEqual({ verb: "reviewed", refs: [], verdict: "Clear", subject: "Herdr permission answers beside tmux" });
    expect(deedSentence(found.get("f3")!, { who: "Fable" })).toBe("Fable reviewed “Herdr permission answers beside tmux”: Clear");
    // A lane's label leads with the verdict, so the long subject is what a narrow label cuts.
    expect(deedSentence(found.get("f3")!, { ago: "3 min ago" })).toBe("Clear on “Herdr permission answers beside tmux”, 3 min ago");
    expect(deedSentence(found.get("f3")!)).toBe("Reviewed “Herdr permission answers beside tmux”: Clear");
    expect(deedSentence(found.get("f4")!, { who: "Fable" })).toBe("Fable reviewed “scout web leaves the core”: Clear with one named change");
    // With no verdict line, or no reply yet, the reply speaks for itself.
    expect(found.has("f5")).toBe(false);
    expect(found.has("f6")).toBe(false);
  });

  test("a review's subject is its title after the word review, without code marks or a closing aside", () => {
    expect(reviewSubject("Design review: `scout web` leaves the core (C's rollout note)")).toBe("scout web leaves the core");
    expect(reviewSubject("Review: the runtime tail contract")).toBe("the runtime tail contract");
    expect(reviewSubject("Review")).toBeNull();
    expect(reviewSubject("Two reviews: #110, then T's Herdr P2 design")).toBe("#110, then T's Herdr P2 design");
    expect(reviewSubject("Design review: one registry for inherited descriptor slots across every spawn path")).toBe("one registry for inherited descriptor slots…");
    // A closing aside ends at its period too, and an aside the title's clipping cut goes as well.
    expect(reviewSubject("Confirm #121's respin at 98502431 (your budgets ruling and your parent-predicate ruling).")).toBe("Confirm #121's respin at 98502431");
    expect(reviewSubject("Confirm #121's respin at 98502431 (your budgets ruling and your…")).toBe("Confirm #121's respin at 98502431");
    // A title that runs on into a second sentence names its subject first when it asks for a review; otherwise it is a message.
    expect(reviewSubject("Review a launch headline (the line under the name). Reply in chat only; don't write any files.")).toBe("a launch headline");
    expect(reviewSubject("Review: the README delta. Re-read the alignment row only.")).toBe("the README delta");
    expect(reviewSubject("Thanks. All six numbered docs and overview hashes match your ACK.")).toBeNull();
  });

  test("an ask for a ruling is ruled on, and its subject is what comes before the questions", () => {
    expect(reviewSubject("Rule on PR A's admission tail (the arach/scout registry WIP at cd1a0979): the cause, the remedy and the gate method"))
      .toBe("PR A's admission tail");
    expect(reviewSubject("Ruling on the stranded slot")).toBe("the stranded slot");
    expect(reviewSubject("Ruling: the unit job's 25-minute limit (split, raise or leave)")).toBe("the unit job's 25-minute limit");
    // A clause the cut would split goes whole, and the title's period goes too.
    expect(reviewSubject("Ruling: the owners job's margin at stage 4, before stage 5 joins it.")).toBe("the owners job's margin at stage 4");
    expect(reviewSubject("Ruling: the unit job's 25-minute limit.")).toBe("the unit job's 25-minute limit");
    expect(reviewSubject("Ruling: is the final guarded client submission the external-work acceptance boundary? (stage 4)")).toBe("is the final guarded client submission…");
    const margin = ask({
      id: "f12",
      memberId: "review",
      task: "Ruling: the owners job's margin at stage 4, before stage 5 joins it.\n\nFrom Claude, running point.",
      reply: "Owners-margin ruling: PARTITION NOW, OPTION 2 (the matrix), placed as (a). (1) Partition on the projection.",
    });
    const ruled = askDeeds([margin], swarmPulls({ asks: [margin] }));
    expect(deedSentence(ruled.get("f12")!, { ago: "3 hr ago" })).toBe("Ruled on “the owners job's margin at stage 4”: Partition now, 3 hr ago");
    const tail = ask({
      id: "f7",
      memberId: "review",
      task: "Rule on PR A's admission tail (the arach/scout registry WIP at cd1a0979): the cause, the remedy and the gate method\n\nFrom Claude, running point.",
      reply: "Ruling on PR A's admission tail.\n\nRULING 1 — THE CAUSE IS ACCEPTED AS STATED, as a two-factor mechanism. Nothing further must be measured.",
    });
    const found = askDeeds([tail], swarmPulls({ asks: [tail] }));
    expect(found.get("f7")).toEqual({ verb: "ruled on", refs: [], verdict: "The cause is accepted as stated", subject: "PR A's admission tail" });
    expect(deedSentence(found.get("f7")!, { who: "Fable" })).toBe("Fable ruled on “PR A's admission tail”: The cause is accepted as stated");
    // A ruling's verdict is a sentence, so the ruling leads a lane's label too.
    expect(deedSentence(found.get("f7")!, { ago: "4 min ago" })).toBe("Ruled on “PR A's admission tail”: The cause is accepted as stated, 4 min ago");
  });

  test("a ruling on what a reference names rules on it, and says what it settled", () => {
    const hang = ask({
      id: "f10",
      memberId: "review",
      task: "Rule on arach/openscout#1478 under your ruling 3: the CLI hang reproduced on core-split without PR A\n\nFrom Claude, running point.",
      reply: "#1478 IS SETTLED FOR A1 UNDER ROUTE (a). Full ruling: the review folder. I verified the control myself, not from the report.",
    });
    const found = askDeeds([hang], swarmPulls({ asks: [hang] }));
    expect(found.get("f10")).toEqual({ verb: "ruled on", refs: [expect.objectContaining({ key: "arach/openscout#1478" })], verdict: "Settled for A1 under route (a)" });
    expect(deedSentence(found.get("f10")!, { who: "Fable" })).toBe("Fable ruled on arach/openscout#1478: Settled for A1 under route (a)");
    expect(deedSentence(found.get("f10")!, { ago: "4 min ago" })).toBe("Ruled on arach/openscout#1478: Settled for A1 under route (a), 4 min ago");
    // A review of the same reference stays a review.
    expect(deedSentence(deeds.get("f1")!, { who: "Fable" })).toBe("Fable reviewed arach/scout#50: Clear with conditions");
  });

  test("a confirmation reads as a review, and a shouted ruling reads calmly with the reply's names", () => {
    const confirm = ask({
      id: "f8",
      memberId: "review",
      task: "Confirm #121's respin at 98502431 (your budgets ruling and your parent-predicate ruling).\n\nFrom Claude, running point.",
      reply: "Confirmation of #121's respin at 98502431.\n\nCONFIRMED — #121 IS CLEARED TO MERGE AT 98502431 ON HOSTED GREEN. Both commits are what the rulings ordered.",
    });
    const host = ask({
      id: "f9",
      memberId: "review",
      task: "Gate host: may the Air run the next gates?\n\nFrom Claude, running point.",
      reply: "Ruling on the gate host: whether the operator's MacBook Air may run the next timing gates.\n\nRULING 1 — THE AIR QUALIFIES as the equivalent macOS arm64 host, under these binding conditions. Eligibility: same platform class.",
    });
    const found = askDeeds([confirm, host], swarmPulls({ asks: [confirm, host] }));
    expect(deedSentence(found.get("f8")!, { who: "Fable" })).toBe("Fable reviewed “Confirm #121's respin at 98502431”: Confirmed");
    expect(deedSentence(found.get("f9")!, { who: "Fable" })).toBe("Fable reviewed “Gate host: may the Air run the next gates?”: The Air qualifies");
  });
});
