import { describe, expect, test } from "bun:test";

import type { WebTaskReady } from "../../../shared/api/web.ts";
import { readyAttentionItem } from "./operator-attention-state.ts";

const READY: WebTaskReady = {
  invocationId: "inv-1",
  flightId: "flt-1",
  agentId: "ranger.main",
  agentName: "Ranger",
  conversationId: "dm.ranger",
  workId: "work-1",
  task: "Fix the session route resolution",
  summary: "Fixed the route resolution and added a test.",
  readyAt: 1_000,
  heldAt: null,
};

describe("readyAttentionItem", () => {
  test("is its own kind: the agent is ready, its summary, Continue and Hold on the flight", () => {
    const item = readyAttentionItem(READY);
    expect(item).toMatchObject({
      id: "ready:flt-1:1000",
      kind: "ready",
      title: "Ranger is ready",
      summary: "Fixed the route resolution and added a test.",
      detail: "Fix the session route resolution",
      agentId: "ranger.main",
      agentName: "Ranger",
      conversationId: "dm.ranger",
      updatedAt: 1_000,
      severity: "info",
      sourceLabel: "Ready",
      ready: { invocationId: "inv-1", flightId: "flt-1", workId: "work-1", summary: "Fixed the route resolution and added a test.", at: 1_000 },
    });
    expect(item.actions.map((a) => [a.kind, a.label, a.flightId ?? null])).toEqual([
      ["continue", "Continue", "flt-1"],
      ["hold", "Hold", "flt-1"],
      ["open", "Open conversation", null],
    ]);
    expect(item.actions[2]!.route).toEqual({ view: "conversation", conversationId: "dm.ranger" });
  });

  test("is never a question, and names the agent by id when it has no name", () => {
    const item = readyAttentionItem({ ...READY, agentName: null, conversationId: null });
    expect(item.kind).not.toBe("question");
    expect(item.title).toBe("ranger.main is ready");
    expect(item.actions.find((a) => a.kind === "open")?.route).toEqual({ view: "follow", workId: "work-1", preferredView: "chat", targetAgentId: "ranger.main" });
  });

  test("a new round on the same flight is a new item", () => {
    const first = readyAttentionItem(READY);
    const second = readyAttentionItem({ ...READY, readyAt: 9_000, summary: "Second pass done." });
    expect(second.id).toBe("ready:flt-1:9000");
    expect(second.id).not.toBe(first.id);
    expect(second.ready?.flightId).toBe("flt-1");
  });
});
