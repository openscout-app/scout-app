import { describe, expect, test } from "bun:test";
import { ATTENTION_STALE_MS, attentionFromRecords, type RuntimeCollaborationRecord } from "./attention.ts";

const now = Date.UTC(2026, 10, 24, 12);
const record = (overrides: Partial<RuntimeCollaborationRecord>): RuntimeCollaborationRecord => ({
  id: "w-1", kind: "work_item", state: "waiting", title: "Pick a layout", conversationId: "chn-1",
  createdById: "agent-a", nextMoveOwnerId: "operator", updatedAt: now - 1000, ...overrides,
});

describe("attention from runtime collaboration records", () => {
  test("agent-declared work and questions waiting on the operator join by work item and by conversation", () => {
    expect(attentionFromRecords([
      record({}),
      record({ id: "q-1", kind: "question", state: "open", conversationId: "chn-2", updatedAt: now - 10 }),
      record({ id: "w-2", state: "review", updatedAt: now - 2000 }),
    ], [], now)).toEqual([
      { id: "question:q-1", workId: null, conversationId: "chn-2", label: "Question for you", detail: "Pick a layout" },
      { id: "work_item:w-1", workId: "w-1", conversationId: "chn-1", label: "Needs your decision", detail: "Pick a layout" },
      { id: "work_item:w-2", workId: "w-2", conversationId: "chn-1", label: "Review requested", detail: "Pick a layout" },
    ]);
  });

  test("the operator's own asks, settled, stale, someone else's and dismissed records never wait", () => {
    expect(attentionFromRecords([
      record({ id: "mine", requestedById: "operator" }),
      record({ id: "asked", metadata: { askedById: "operator" } }),
      record({ id: "done", state: "done" }),
      record({ id: "closed", kind: "question", state: "closed" }),
      record({ id: "old", updatedAt: now - ATTENTION_STALE_MS - 1 }),
      record({ id: "theirs", nextMoveOwnerId: "agent-b" }),
      record({ id: "dismissed" }),
    ], [{ kind: "dismissed", recordId: "dismissed", actorId: "operator", at: now }], now)).toEqual([]);
  });

  test("a record updated after its dismissal waits again", () => {
    const out = attentionFromRecords([record({ id: "back", updatedAt: now })], [{ kind: "dismissed", recordId: "back", actorId: "operator", at: now - 5 }], now);
    expect(out.map((a) => a.id)).toEqual(["work_item:back"]);
  });
});

test("a request's words are flattened and kept readable", async () => {
  const { requestWords } = await import("./attention.ts");
  expect(requestWords("  Ship\n\noption B?  ")).toBe("Ship option B?");
  expect(requestWords("")).toBeNull();
  expect(requestWords("a".repeat(400))!.length).toBe(280);
});
