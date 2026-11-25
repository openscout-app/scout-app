import { describe, expect, test } from "bun:test";
import type { FleetAsk, FollowTarget } from "../../../lib/types.ts";
import {
  askForFollow,
  EVERY_SESSION_ROUTE,
  followIdRows,
  followOpens,
  followSessionNote,
  followTarget,
  tailFollowState,
} from "./tail-follow-model.ts";

const none: FollowTarget = {
  flightId: null,
  invocationId: null,
  conversationId: null,
  workId: null,
  sessionId: null,
  targetAgentId: null,
};

const ask = (over: Partial<FleetAsk>) =>
  ({ invocationId: "inv-x", flightId: null, collaborationRecordId: null, agentId: "a", task: "t", ...over }) as FleetAsk;

describe("what the Following panel follows", () => {
  test("only Ops › Tail has anything to follow", () => {
    expect(tailFollowState({ view: "ops", mode: "issues", flightId: "flt-1" })).toEqual({ kind: "off" });
    expect(tailFollowState({ view: "ops" })).toEqual({ kind: "off" });
    expect(tailFollowState({ view: "follow", flightId: "flt-1" } as never)).toEqual({ kind: "off" });
  });

  test("bare Ops › Tail is every session; ?q= alone is a typed filter", () => {
    expect(tailFollowState({ view: "ops", mode: "tail" })).toEqual({ kind: "every" });
    expect(tailFollowState({ view: "ops", mode: "tail", tailQuery: "openscout" })).toEqual({ kind: "query", q: "openscout" });
  });

  test("follow ids win over ?q=, and their key is the /api/follow query useFollowTailQuery sends", () => {
    const state = tailFollowState({ view: "ops", mode: "tail", tailQuery: "flt-1", flightId: "flt-1", targetAgentId: "opus" });
    expect(state).toEqual({ kind: "follow", key: "flightId=flt-1&targetAgentId=opus", ids: { ...none, flightId: "flt-1", targetAgentId: "opus" } });
  });

  test("the broker's answer fills in what the URL did not name", () => {
    const ids = { ...none, flightId: "flt-1" };
    expect(followTarget(ids, null)).toBe(ids);
    const merged = followTarget(ids, { ...none, flightId: "flt-1", workId: "w-1", harnessSessionId: "uuid-1" });
    expect(merged).toMatchObject({ flightId: "flt-1", workId: "w-1", harnessSessionId: "uuid-1" });
  });
});

describe("the followed ask", () => {
  const fleet = {
    activeAsks: [ask({ invocationId: "inv-1", flightId: "flt-1", task: "active" })],
    recentCompleted: [ask({ invocationId: "inv-2", collaborationRecordId: "w-2", task: "done" })],
  };

  test("found by invocation, then flight, then work item, in active asks and then finished ones", () => {
    expect(askForFollow(fleet, { ...none, invocationId: "inv-1" })?.task).toBe("active");
    expect(askForFollow(fleet, { ...none, flightId: "flt-1" })?.task).toBe("active");
    expect(askForFollow(fleet, { ...none, workId: "w-2" })?.task).toBe("done");
    expect(askForFollow(fleet, { ...none, invocationId: "inv-404", workId: "w-2" })?.task).toBe("done");
  });

  test("none before the fleet answers, or when nothing matches", () => {
    expect(askForFollow(null, { ...none, flightId: "flt-1" })).toBeNull();
    expect(askForFollow(fleet, { ...none, conversationId: "c-1" })).toBeNull();
  });
});

describe("what the card says and opens", () => {
  test("names the harness session the tail shows, or that it is not known yet", () => {
    expect(followSessionNote({ ...none, harnessSessionId: "uuid-1" })).toBe("The tail shows session uuid-1.");
    expect(followSessionNote(none)).toContain("Waiting for its session");
  });

  test("lists only the ids there are", () => {
    expect(followIdRows({ ...none, flightId: "flt-1", targetAgentId: " opus ", harnessSessionId: "" })).toEqual([
      { label: "Flight", value: "flt-1" },
      { label: "Agent", value: "opus" },
    ]);
  });

  test("opens the work, the session, the chat and the agent; Every session drops the follow", () => {
    const opens = followOpens({ ...none, workId: "w-1", flightId: "flt-1", sessionId: "s-1", conversationId: "c-1", targetAgentId: "opus" });
    expect(opens.map((o) => o.label)).toEqual(["Open work", "Open session", "Open chat", "Agent"]);
    expect(opens.map((o) => o.route)).toEqual([
      { view: "work", workId: "w-1" },
      { view: "sessions", flightId: "flt-1", sessionId: "s-1" },
      { view: "conversation", conversationId: "c-1" },
      { view: "agents-v2", agentId: "opus" },
    ]);
    expect(followOpens(none)).toEqual([]);
    expect(EVERY_SESSION_ROUTE).toEqual({ view: "ops", mode: "tail" });
  });
});
