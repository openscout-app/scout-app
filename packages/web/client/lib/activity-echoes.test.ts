import { describe, expect, test } from "bun:test";
import { foldAskEchoes } from "./activity-echoes.ts";
import type { ActivityItem } from "./types.ts";

const row = (over: Partial<ActivityItem>): ActivityItem => ({
  id: over.id ?? `activity:${over.kind}`,
  kind: "collaboration_event",
  ts: 1_000,
  actorName: "Operator",
  title: null,
  summary: null,
  conversationId: null,
  workspaceRoot: null,
  agentId: null,
  agentName: null,
  flightId: null,
  invocationId: null,
  sessionId: null,
  messageId: null,
  recordId: null,
  ...over,
});

const work = row({ id: "work", kind: "collaboration_event", recordId: "work-1", title: "Study: name things by their task" });
const message = row({ id: "message", kind: "message_posted", messageId: "msg-1", conversationId: "chn-1", title: "Design study in design/studio" });
const invocation = row({
  id: "invocation",
  kind: "invocation_recorded",
  messageId: "msg-1",
  invocationId: "inv-1",
  conversationId: "chn-1",
  sessionId: "session-1",
  agentName: "drover-10",
  title: "Design study in design/studio",
  summary: "consult",
});

describe("foldAskEchoes", () => {
  test("an ask is one row: the invocation, headed by its work item's title, with its work link", () => {
    const folded = foldAskEchoes([work, message, invocation]);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({
      id: "invocation",
      title: "Study: name things by their task",
      summary: "Design study in design/studio",
      recordId: "work-1",
      sessionId: "session-1",
    });
  });

  test("a later reply on the work item and an unrelated message stay their own rows", () => {
    const reply = row({ id: "reply", kind: "collaboration_event", recordId: "work-1", ts: 9_000, title: "Done" });
    const other = row({ id: "other", kind: "message_posted", messageId: "msg-2", title: "Hello" });
    expect(foldAskEchoes([work, message, invocation, reply, other]).map((item) => item.id)).toEqual(["invocation", "reply", "other"]);
  });

  test("without an invocation nothing folds", () => {
    expect(foldAskEchoes([work, message]).map((item) => item.id)).toEqual(["work", "message"]);
  });

  test("another actor's work item at the same instant stays apart", () => {
    const theirs = row({ id: "theirs", kind: "collaboration_event", recordId: "work-9", actorName: "Someone else" });
    expect(foldAskEchoes([theirs, invocation]).map((item) => item.id)).toEqual(["theirs", "invocation"]);
  });
});
