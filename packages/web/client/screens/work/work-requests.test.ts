import { describe, expect, test } from "bun:test";
import type { OperatorAttentionItem, WorkDetail } from "../../lib/types.ts";
import { selectWorkRequests } from "./work-requests.ts";

const detail = {
  conversationId: "chn-work",
  primaryInvocation: { flightId: "flt-main", resolvedSessionId: "session-main", targetSessionId: null, targetAgentId: "agent-main" },
  allFlights: [{ id: "flt-main", agentId: "agent-main", conversationId: "chn-work", sessions: [{ sessionId: "session-main" }] }],
  activeFlights: [],
  childWork: [{ conversationId: "chn-child", ownerId: "agent-sub" }],
} as unknown as WorkDetail;

function request(id: string, fields: Partial<OperatorAttentionItem>): OperatorAttentionItem {
  return {
    id, kind: "question", title: "Permission request", summary: null, detail: null, agentId: null, agentName: null,
    conversationId: null, updatedAt: 0, severity: "warning", sourceLabel: "Permission request", actions: [], ...fields,
  };
}

const permission = (sessionId: string, flightId?: string) => ({ requestId: "r", version: "1", sessionId, projectRoot: "/p", ...(flightId ? { flightId } : {}) });

describe("selectWorkRequests", () => {
  test("keeps the run's own permission request by flight", () => {
    const ids = selectWorkRequests([request("own", { agentId: "agent-main", permission: permission("x", "flt-main") })], detail).map((item) => item.id);
    expect(ids).toEqual(["own"]);
  });

  test("a request naming another flight stays out, even from the same agent", () => {
    expect(selectWorkRequests([request("other", { agentId: "agent-main", permission: permission("session-main", "flt-other") })], detail)).toEqual([]);
  });

  test("keeps a native session's request by session, and a subagent's by its conversation or owner", () => {
    const ids = selectWorkRequests([
      request("native", { permission: permission("session-main") }),
      request("child-chat", { conversationId: "chn-child" }),
      request("child-agent", { agentId: "agent-sub" }),
    ], detail).map((item) => item.id);
    expect(ids).toEqual(["native", "child-chat", "child-agent"]);
  });

  test("leaves out unrelated requests and work records", () => {
    expect(selectWorkRequests([
      request("stranger", { agentId: "agent-else", conversationId: "chn-else" }),
      request("record", { kind: "work_item", agentId: "agent-main" }),
    ], detail)).toEqual([]);
  });
});
