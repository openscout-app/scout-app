import { describe, expect, test } from "bun:test";
import type { Flight } from "../../lib/types.ts";
import { isOutcomePost, mentionHandles, messageMentionStates } from "./mention-state.ts";

function flight(overrides: Partial<Flight>): Flight {
  return {
    id: "f-1",
    invocationId: "inv-1",
    messageId: "m-1",
    agentId: "agent.franklin",
    agentName: "Franklin",
    conversationId: "chn-1",
    collaborationRecordId: null,
    state: "running",
    summary: null,
    startedAt: 1,
    completedAt: null,
    sessions: [],
    ...overrides,
  };
}

describe("mentionHandles", () => {
  test("reads each handle once and ignores emails", () => {
    expect(mentionHandles("next step @grok, then @grok and a@b.com (@sagan)")).toEqual(["grok", "sagan"]);
  });
});

describe("messageMentionStates", () => {
  test("a mention the runtime routed to nobody says so", () => {
    const lines = messageMentionStates(
      { id: "m-1", body: "next step @grok", metadata: { intent: "invoke", relayTargetIds: [] } },
      [],
    );
    expect(lines).toEqual([
      { key: "unresolved:grok", who: "@grok", label: "matched no agent; nobody was asked", tone: "problem" },
    ]);
  });

  test("flights opened for the post give each agent's state", () => {
    const lines = messageMentionStates(
      { id: "m-1", body: "@franklin look", metadata: { relayTargetIds: ["agent.franklin"] } },
      [flight({ state: "running" }), flight({ id: "f-2", messageId: "other" })],
    );
    expect(lines).toEqual([{ key: "f-1", who: "Franklin", label: "working", tone: "active" }]);
  });

  test("a completed flight reads as replied", () => {
    const [line] = messageMentionStates(
      { id: "m-1", body: "@franklin look", metadata: null },
      [flight({ state: "completed" })],
    );
    expect(line?.label).toBe("replied");
  });

  test("no routing record and no flight means no line", () => {
    expect(messageMentionStates({ id: "m-1", body: "@franklin look", metadata: { source: "scout-cli" } }, [])).toEqual([]);
  });

  test("routed with no flight yet reads as delivered", () => {
    const [line] = messageMentionStates(
      { id: "m-1", body: "@franklin look", metadata: { relayTargetIds: ["agent.franklin"] } },
      [],
    );
    expect(line).toEqual({ key: "routed", who: "agent.franklin", label: "delivered, no turn yet", tone: "pending" });
  });
});

describe("isOutcomePost", () => {
  test("matches a post that opens with its outcome label", () => {
    expect(isOutcomePost({ body: "council: keep the ref whole" })).toBe(true);
    expect(isOutcomePost({ body: "Decision: ship it" })).toBe(true);
    expect(isOutcomePost({ body: "The last post should start with council:" })).toBe(false);
  });
});
