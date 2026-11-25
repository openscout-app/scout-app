import { describe, expect, test } from "bun:test";
import type { api } from "../../lib/api.ts";
import type { BrokerRouteAttempt } from "../../lib/types.ts";
import { investigateDispatch } from "./dispatch-investigation.ts";

const attempt: BrokerRouteAttempt = {
  id: "dispatch:failed-route",
  kind: "failed_query",
  status: "failed",
  ts: 1_000,
  actorName: "Operator",
  target: "unavailable-agent",
  route: "dm",
  detail: "The recipient is unavailable",
  metadata: null,
  conversationId: null,
  messageId: null,
  deliveryId: null,
  invocationId: null,
};

describe("investigateDispatch", () => {
  test("sends a no-conversation routing failure to the assistant, not a harness ask", async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const request: typeof api = async <T>(path: string, init?: RequestInit) => {
      calls.push({ path, init });
      return { conversationId: "chn-investigation" } as T;
    };
    expect(await investigateDispatch(attempt, request)).toEqual({ conversationId: "chn-investigation" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe("/api/scoutbot/messages");
    expect(calls[0]!.init?.method).toBe("POST");
    const body = JSON.parse(calls[0]!.init!.body as string);
    expect(body.body).toContain("Investigate why this dispatch failed.");
    expect(body.body).toContain(attempt.id);
    expect(body.body).toContain(attempt.detail);
    expect(body.page).toEqual({ source: "scout-dispatch-investigate", originalDispatchId: attempt.id });
    expect(body.targetAgentId).toBeUndefined();
    expect(body.threadId).toBeUndefined();
  });

  test("summarizes a successful dispatch and preserves its source ids", async () => {
    let body: { body?: string; page?: Record<string, unknown> } = {};
    const request: typeof api = async <T>(_path: string, init?: RequestInit) => {
      body = JSON.parse(init!.body as string);
      return { conversationId: "chn-investigation" } as T;
    };
    await investigateDispatch({ ...attempt, kind: "success", status: "sent", messageId: "msg-source", conversationId: "chn-source" }, request);
    expect(body.body).toContain("Summarize this dispatch and what happened next.");
    expect(body.page).toMatchObject({ originalMessageId: "msg-source", originalConversationId: "chn-source" });
  });

  test("propagates a posting failure instead of claiming the investigation started", async () => {
    const request: typeof api = async () => { throw new Error("Scout is unavailable"); };
    await expect(investigateDispatch(attempt, request)).rejects.toThrow("Scout is unavailable");
  });

  test("requires an actual conversation to open", async () => {
    const request: typeof api = async <T>() => ({} as T);
    await expect(investigateDispatch(attempt, request)).rejects.toThrow("Scout did not return an investigation conversation.");
  });
});
