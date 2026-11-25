import { describe, expect, test } from "bun:test";

import { askDeeds, askPulls, laneVocabularies, replySentence, swarmPulls } from "./swarm-code.ts";
import { initiativeSentence } from "./swarm-initiatives.ts";
import { buildSwarms, memberStatus, replyHeadline, type SwarmAsk, type SwarmMember } from "./swarm-model.ts";
import { askStops, calmStop, headlineStops, statusStopLine } from "./swarm-stop.ts";
import type { AgentRun } from "./types.ts";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 22, 4, 0, 0);

/** An ask as the model builds it, with its headline read from its reply. */
function ask(overrides: Partial<SwarmAsk> & { id: string }): SwarmAsk {
  const reply = overrides.reply ?? null;
  return {
    from: null,
    agentId: `agent-${overrides.id}`,
    memberId: "c",
    fromMemberId: null,
    title: "An ask",
    task: "",
    reply,
    replyHeadline: replyHeadline(reply),
    failure: null,
    state: "done",
    open: false,
    askedAt: NOW - 20 * MIN,
    startedAt: NOW - 20 * MIN,
    endedAt: NOW - 5 * MIN,
    conversationId: null,
    workId: null,
    flightId: null,
    ...overrides,
  };
}

// Lanes' replies from the core split's runs, 10-21 and 10-22.
const C_EXPORT = "Blocked before implementation: at `053e3ff7`, private `packages/web` remains export-covered. W3’s required acquisition import fails the boundary guard.";
const E1_BOUNDARY = [
  "Blocked by the file boundary: open #66 owns `runtime/src/scout-extensions.ts`, `cli/main.ts`, and `cli/main-dispatch.ts`, which contain the required manifest/bootstrap/dispatch seams.",
  "",
  "Please authorize those three files or provide a coordinated #66 floor.",
  "",
  "Prepared #78 + one #80 merge locally at `80f17539de1f65849e68d6023706cc9635438e56`. No implementation edits, push or PR.",
].join("\n");

describe("a reply that stops", () => {
  test("reads the lanes' own openings as stops", () => {
    for (const reply of [
      C_EXPORT,
      E1_BOUNDARY,
      "Stopped at the brief’s boundary: making the watch asynchronous requires editing `base-daemon.ts`, which overlaps #42. No source changes or PR.",
      "Stopped as instructed. **No PR or documentation changes.**",
      "**Blocked on quiet point:** new draft #43 touches `apps/desktop/src/cli/commands/mesh-trust.test.ts`.",
      "Stopped under Fable’s cost gate. **No production edits or draft PR.**",
      "Blocked per the brief: the private checkout is read-only.",
    ]) {
      expect(headlineStops(replyHeadline(reply))).toBe(true);
    }
  });

  test("work that only mentions stopping is not a stop", () => {
    for (const reply of [
      "Stopped the leaked watcher (pid 4120); the suite is green.",
      "Stopped underlying watchers (pid 4120); the suite is green.",
      "Unblocked: #66 merged, so the slice is in.",
      "The brief's fix is blocked upstream, so I shipped the rest as #90.",
      "Draft [#66](https://github.com/arach/scout/pull/66), head `e05fa294`.",
    ]) {
      expect(headlineStops(replyHeadline(reply))).toBe(false);
    }
    expect(headlineStops(null)).toBe(false);
  });

  test("only a reply stops: a failed or open ask keeps its state", () => {
    expect(askStops(ask({ id: "1", reply: C_EXPORT }))).toBe(true);
    expect(askStops(ask({ id: "2", reply: C_EXPORT, state: "failed" }))).toBe(false);
    expect(askStops(ask({ id: "3", state: "working", open: true, endedAt: null }))).toBe(false);
  });
});

describe("a lane that stopped", () => {
  test("says so until it is asked again", () => {
    const stopped = ask({ id: "1", reply: C_EXPORT });
    expect(memberStatus([stopped], NOW)).toEqual({
      status: "stopped",
      since: NOW - 5 * MIN,
      sentence: "Stopped 5 min ago: “Blocked before implementation: at 053e3ff7, private…”",
    });
    const ruling = ask({ id: "2", state: "working", open: true, askedAt: NOW - 2 * MIN, startedAt: NOW - 2 * MIN, endedAt: null });
    expect(memberStatus([stopped, ruling], NOW).status).toBe("working");
  });

  test("the story says the lane stopped, in its own words", () => {
    const run = {
      id: "run-c1",
      agentId: "agent-c",
      agentName: "core-split-c-cli-descartes-4",
      source: "ask",
      requesterId: "operator",
      state: "completed",
      createdAt: NOW - 20 * MIN,
      startedAt: NOW - 19 * MIN,
      completedAt: NOW - 5 * MIN,
      updatedAt: NOW - 5 * MIN,
      input: { task: "W3: private web setup calls the acquisition service directly" },
      output: { text: C_EXPORT },
      metadata: { flightMetadata: { source: "scout-mcp", requesterDisplayName: "Arach", returnAddress: { actorId: "operator", sessionId: "mcp:point-1" } } },
    } as AgentRun;
    const [swarm] = buildSwarms([run], { now: NOW, windowMs: 24 * 60 * MIN });
    expect(swarm?.events.find((event) => event.kind === "replied")?.text).toBe(
      "descartes-4 stopped: “Blocked before implementation: at 053e3ff7, private packages/web…”",
    );
  });

  test("opened nothing it names", () => {
    const opened = ask({ id: "e1-a", memberId: "e1", reply: "Draft https://github.com/arach/scout/pull/66, head e05fa294.", askedAt: NOW - 90 * MIN, endedAt: NOW - 80 * MIN });
    const named = ask({ id: "e1-b", memberId: "e1", task: "Rebase arach/scout#78 and arach/scout#80", reply: "Rebased.", askedAt: NOW - 70 * MIN, endedAt: NOW - 60 * MIN });
    const stopped = ask({ id: "e1-c", memberId: "e1", reply: E1_BOUNDARY });
    const vocabulary = laneVocabularies([opened, named, stopped]).get("e1");
    expect(askPulls(stopped, vocabulary).map(({ pr, role }) => `${role} ${pr.key}`)).toEqual([
      "named arach/scout#66",
      "named arach/scout#78",
      "named arach/scout#80",
    ]);
    // Without its stop, the same reply's "Prepared #78 …" line would announce #78.
    const prepared = ask({ id: "e1-d", memberId: "e1", reply: E1_BOUNDARY.split("\n").slice(4).join("\n") });
    expect(askPulls(prepared, vocabulary).find(({ pr }) => pr.key === "arach/scout#78")?.role).toBe("opened");
    const pull66 = swarmPulls({ asks: [opened, named, stopped] }).find((pull) => pull.pr.key === "arach/scout#66");
    expect(pull66?.openedBy).toBe("e1-a");
    expect(pull66?.workedBy).toEqual([]);
  });

  test("names the initiative's state when nothing else moves", () => {
    const member = (name: string, status: SwarmMember["status"]) => ({ name, status }) as SwarmMember;
    expect(initiativeSentence([member("Lane C", "stopped"), member("Lane T", "done")], NOW - 5 * MIN, NOW))
      .toEqual({ sentence: "Lane C stopped.", tone: "work" });
    expect(initiativeSentence([member("Lane C", "stopped"), member("Lane A", "working")], NOW - 5 * MIN, NOW))
      .toEqual({ sentence: "Lane A is working.", tone: "work" });
  });
});

// E1's reply on the credential channel, 04:18Z on 10-22: a draft first, then the stop in bold.
const E1_HELD = [
  "Draft [#87](https://github.com/arach/scout/pull/87), stacked on #86.  ",
  "**Head:** `857f5e026d775b1c81088cc66a0e73046e05c742`",
  "",
  "**Blocked at transport qualification. No credential delivery is enabled.**",
  "- Linux 1.3.14: five duplex/EOF/GC exchanges pass in hosted CI.",
  "- macOS 1.3.14: isolated exchanges pass, but full-run GC closes an unrelated descriptor (`EBADF`).",
].join("\n");

describe("a lane that stops after what it delivered", () => {
  test("says so in a bold status line under its first lines", () => {
    expect(headlineStops(replyHeadline(E1_HELD))).toBe(false);
    expect(statusStopLine(E1_HELD)).toBe("Blocked at transport qualification. No credential delivery is enabled.");
    const held = ask({ id: "e1-87", memberId: "e1", reply: E1_HELD });
    expect(askStops(held)).toBe(true);
    expect(memberStatus([held], NOW).sentence).toBe("Stopped 5 min ago: “Blocked at transport qualification.”");
  });

  test("a bold line that is no stop, only partly bold, or too far down is not a status line", () => {
    for (const reply of [
      "Stopped the watcher; draft #91 is up.\n\n**No PR or documentation changes.**",
      "Draft #92, head `abcd1234`.\n**Blocked paths:** `/tmp/scout-x` refuses with EACCES, as the test expects.",
      "Draft #93.\nHead `abcd1234`.\nChecks pass.\nFence 151.\n**Blocked on nothing.**",
    ]) {
      expect(statusStopLine(reply)).toBeNull();
      expect(askStops(ask({ id: "x", reply }))).toBe(false);
    }
  });

  test("keeps what it opened, and the story says both", () => {
    const held = ask({ id: "e1-87", memberId: "e1", reply: E1_HELD });
    expect(askPulls(held).map(({ pr, role }) => `${role} ${pr.key}`)).toEqual(["opened arach/scout#87"]);
    const run = {
      id: "run-e1",
      agentId: "agent-e1",
      agentName: "core-split-e1-voltaire-10",
      source: "ask",
      requesterId: "operator",
      state: "completed",
      createdAt: NOW - 60 * MIN,
      startedAt: NOW - 59 * MIN,
      completedAt: NOW - 5 * MIN,
      updatedAt: NOW - 5 * MIN,
      input: { task: "The credential channel for API 2 (descriptor 6) and its grants" },
      output: { text: E1_HELD },
      metadata: { flightMetadata: { source: "scout-mcp", requesterDisplayName: "Arach", returnAddress: { actorId: "operator", sessionId: "mcp:point-1" } } },
    } as AgentRun;
    const [swarm] = buildSwarms([run], { now: NOW, windowMs: 24 * 60 * MIN });
    const replied = swarm!.events.find((event) => event.kind === "replied")!;
    expect(replied.text).toBe("voltaire-10 stopped: “Blocked at transport qualification.”");
    const deed = askDeeds(swarm!.asks, swarmPulls(swarm!)).get(replied.askId);
    expect(replySentence(replied, deed)).toBe("voltaire-10 opened arach/scout#87, then stopped: “Blocked at transport qualification.”");
  });
});

// A's reply on the reuse apparatus, 02:35Z on 10-23: a hold in capitals, then its evidence.
const A_HOLD = [
  "**HOLD: the cold placement audit failed.** Released slots `[125,126,127,128]` produced parent/source `[129,128]`, not `[128,127]`.",
  "",
  "Fable ruled: stop, leave the apparatus uncommitted, and submit a compile-isolation boundary design. **No PR opened or new commit pushed.**",
].join("\n");

describe("a lane that holds", () => {
  test("reads a hold as a stop, and quotes it calmly", () => {
    expect(headlineStops(replyHeadline(A_HOLD))).toBe(true);
    const held = ask({ id: "a-reuse", memberId: "a", reply: A_HOLD });
    expect(askStops(held)).toBe(true);
    expect(memberStatus([held], NOW).sentence).toBe("Stopped 5 min ago: “Hold: the cold placement audit failed.”");
    expect(headlineStops(replyHeadline("On hold until Fable rules on the seam."))).toBe(true);
    expect(statusStopLine("Draft #94.\n**Hold at the cold audit.**")).toBe("Hold at the cold audit.");
    expect(calmStop("ON HOLD until Fable rules.")).toBe("On hold until Fable rules.");
    expect(calmStop("Blocked by the CI queue.")).toBe("Blocked by the CI queue.");
  });

  test("a hold that is a measurement or a verdict's later word is not a stop", () => {
    for (const reply of [
      "Hold times fell to 2 ms after #90.",
      "HOLD stands on the witness; #107 lands as is.",
      "Holding the lock for 5 s keeps the suite green.",
      "Holds at 175 pairs.",
    ]) {
      expect(headlineStops(replyHeadline(reply))).toBe(false);
    }
  });

  test("the story says the lane stopped, without the capitals", () => {
    const run = {
      id: "run-a1",
      agentId: "agent-a",
      agentName: "core-split-a-aristotle-24",
      source: "ask",
      requesterId: "operator",
      state: "completed",
      createdAt: NOW - 30 * MIN,
      startedAt: NOW - 29 * MIN,
      completedAt: NOW - 5 * MIN,
      updatedAt: NOW - 5 * MIN,
      input: { task: "Build the reuse-witness apparatus" },
      output: { text: A_HOLD },
      metadata: { flightMetadata: { source: "scout-mcp", requesterDisplayName: "Arach", returnAddress: { actorId: "operator", sessionId: "mcp:point-1" } } },
    } as AgentRun;
    const [swarm] = buildSwarms([run], { now: NOW, windowMs: 24 * 60 * MIN });
    expect(swarm?.events.find((event) => event.kind === "replied")?.text).toBe(
      "aristotle-24 stopped: “Hold: the cold placement audit failed.”",
    );
  });
});

// A's reply on the new tuple, 03:14Z on 10-23: the draft first, then a line that opens with its hold in bold.
const A_HELD_DRAFT = [
  "Draft [#113](https://github.com/arach/scout/pull/113), head `a16c930ac9867a32955fc7b10b85e60c7f915a7e`.",
  "",
  "**HOLD:** full Darwin qualification fails cold collection: wrapper 0 remains alive after 64 rounds. Exact-head heap walking remains **unclassified**. Placement passes all nine exchanges.",
  "",
  "Other exact-head results:",
  "- Warm matrix **45 pass / 881 assertions**.",
].join("\n");

describe("a stop that opens in bold", () => {
  test("reads the line whole, without its bold marks", () => {
    expect(statusStopLine(A_HELD_DRAFT)).toBe(
      "HOLD: full Darwin qualification fails cold collection: wrapper 0 remains alive after 64 rounds. Exact-head heap walking remains unclassified. Placement passes all nine exchanges.",
    );
    expect(statusStopLine("Draft #120.\n- **Blocked on quiet point:** #43 touches mesh-trust.")).toBe(
      "Blocked on quiet point: #43 touches mesh-trust.",
    );
    const held = ask({ id: "a-tuple", memberId: "a", reply: A_HELD_DRAFT });
    expect(askStops(held)).toBe(true);
    expect(memberStatus([held], NOW).sentence).toBe("Stopped 5 min ago: “Hold: full Darwin qualification fails cold collection: wrapper…”");
  });

  test("a bold opening that is a measurement, a verdict or work done is not a stop", () => {
    for (const reply of [
      "Draft #120.\n**Hold times:** fell to 2 ms after #90.",
      "Draft #120.\n**HOLD** stands on the witness; #107 lands as is.",
      "Draft #120.\n**Stopped the watcher** before the merge.",
      "Draft #120.\n**Blocked paths:** `/tmp/scout-x` refuses with EACCES, as the test expects.",
    ]) {
      expect(statusStopLine(reply)).toBeNull();
    }
    expect(statusStopLine("Draft #120.\n**Blocked** — the guard refused writes.")).toBe("Blocked — the guard refused writes.");
  });

  test("the story keeps the draft the lane opened, then says it stopped", () => {
    const run = {
      id: "run-a2",
      agentId: "agent-a",
      agentName: "core-split-a-aristotle-24",
      source: "ask",
      requesterId: "operator",
      state: "completed",
      createdAt: NOW - 60 * MIN,
      startedAt: NOW - 59 * MIN,
      completedAt: NOW - 5 * MIN,
      updatedAt: NOW - 5 * MIN,
      input: { task: "The compile-only seam: build it as one PR with one new qualified tuple" },
      output: { text: A_HELD_DRAFT },
      metadata: { flightMetadata: { source: "scout-mcp", requesterDisplayName: "Arach", returnAddress: { actorId: "operator", sessionId: "mcp:point-1" } } },
    } as AgentRun;
    const [swarm] = buildSwarms([run], { now: NOW, windowMs: 24 * 60 * MIN });
    const replied = swarm!.events.find((event) => event.kind === "replied")!;
    const deed = askDeeds(swarm!.asks, swarmPulls(swarm!)).get(replied.askId);
    expect(replySentence(replied, deed)).toBe(
      "aristotle-24 opened arach/scout#113, then stopped: “Hold: full Darwin qualification fails cold collection: wrapper 0…”",
    );
  });
});
