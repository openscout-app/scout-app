import { describe, expect, test } from "bun:test";
import type { OperatorAttentionItem } from "../../lib/types.ts";
import { createRequestReceipts, heldFeedback, isSettled, requestRevision, requestRows } from "./request-receipts.ts";

const item = (id: string, over: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem => ({
  id, kind: "question", title: id, summary: null, detail: null, agentId: "a", agentName: "fab", conversationId: "c",
  updatedAt: 60_000, severity: "warning", sourceLabel: "Question", actions: [], ...over,
});

describe("request receipts", () => {
  test("a recorded decision holds its card after the source drops it, in the place it was drawn", () => {
    const receipts = createRequestReceipts();
    const [a, b, c] = [item("a"), item("b"), item("c")];
    expect(receipts.rows([a, b, c]).map((r) => r.id)).toEqual(["a", "b", "c"]);
    receipts.record(b, { phase: "sending", label: "Yes" });
    receipts.record(b, { phase: "recorded", label: "Reply recorded: Yes" });
    // the source's next snapshot no longer lists b: it stays where it was
    expect(receipts.rows([a, c]).map((r) => r.id)).toEqual(["a", "b", "c"]);
    // a new request goes last
    expect(receipts.rows([a, c, item("d")]).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    receipts.dismiss("b");
    expect(receipts.rows([a, c, item("d")]).map((r) => r.id)).toEqual(["a", "c", "d"]);
  });

  test("a failed decision lets the card go back to the source's state", () => {
    const receipts = createRequestReceipts();
    const a = item("a");
    receipts.record(a, { phase: "sending", label: "Allow once" });
    expect(receipts.held().has("a")).toBe(true);
    receipts.record(a, { phase: "failed" });
    expect(receipts.held().has("a")).toBe(false);
    expect(receipts.rows([]).map((r) => r.id)).toEqual([]);
  });

  test("every surface reads one order: the same rows while neither the source nor the receipts changed", () => {
    const receipts = createRequestReceipts();
    const live = [item("a"), item("b")];
    const first = receipts.rows(live);
    expect(receipts.rows(live)).toBe(first);
    receipts.record(live[0]!, { phase: "sending", label: "Yes" });
    expect(receipts.rows(live)).not.toBe(first);
  });

  test("subscribers hear each change; dismissing nothing is quiet", () => {
    const receipts = createRequestReceipts();
    let heard = 0;
    const stop = receipts.subscribe(() => void heard++);
    receipts.record(item("a"), { phase: "sending", label: "Yes" });
    receipts.dismiss("a");
    receipts.dismiss("a");
    stop();
    receipts.record(item("b"), { phase: "sending", label: "Yes" });
    expect(heard).toBe(2);
  });

  test("feedback holds only for the revision it was given on", () => {
    const answer = { conversationId: "c", replyToMessageId: "m1", options: ["Yes"] };
    const a = item("a", { answer });
    const held = new Map([["a", { item: a, feedback: { phase: "recorded" as const, label: "Reply recorded: Yes" } }]]);
    expect(heldFeedback(held, a)).toEqual({ phase: "recorded", label: "Reply recorded: Yes" });
    // the same request asking a new question is a new card
    const asked = item("a", { answer: { ...answer, replyToMessageId: "m2" } });
    expect(requestRevision(asked)).not.toBe(requestRevision(a));
    expect(heldFeedback(held, asked)).toBeUndefined();
  });

  test("a permission's new version is a new card, with its decision open again", () => {
    const permission = { requestId: "p", version: "v1", sessionId: "s", projectRoot: "/r" };
    const v1 = item("a", { permission });
    const held = new Map([["a", { item: v1, feedback: { phase: "recorded" as const, label: "Approval recorded" } }]]);
    const v2 = item("a", { permission: { ...permission, version: "v2" } });
    expect(requestRevision(v2)).not.toBe(requestRevision(v1));
    expect(heldFeedback(held, v2)).toBeUndefined();
  });

  test("settled: the source no longer lists it", () => {
    expect(isSettled([item("a")], "a")).toBe(false);
    expect(isSettled([item("a")], "b")).toBe(true);
    expect(requestRows([], [item("a")], new Map()).map((r) => r.id)).toEqual(["a"]);
  });
});
