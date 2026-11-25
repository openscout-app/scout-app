import { expect, test } from "bun:test";

import type { OperatorAttentionItem } from "../../lib/types.ts";
import { clearAllOf, clearNote, clearPlan, clearQuestion, clearRequests, clearResult, type ClearStep } from "./clear-requests.ts";

const item = (id: string, overrides: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem => ({
  id, kind: "question", title: id, summary: null, detail: null, agentId: null, agentName: null,
  conversationId: null, updatedAt: 60_000, severity: "info", sourceLabel: "question", actions: [], ...overrides,
});
const dismiss = (recordId: string) => ({ kind: "dismiss", label: "Dismiss", recordKind: "question", recordId }) as const;
const permission = { requestId: "p", version: "v", sessionId: "s", projectRoot: "/p" };

const question = item("need:q", { actions: [dismiss("q")] });
const allow = item("permission:p", { permission, actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "deny", label: "Deny" }, dismiss("p")] });
const denyOnly = item("permission:d", { permission, actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "deny", label: "Deny" }] });
const answerOnly = item("ask:a", { answer: { conversationId: "c", replyToMessageId: "m", options: ["yes"] } });

test("a request clears by its dismissal, a permission without one by its deny, and a bare question is left", () => {
  const plan = clearPlan([question, allow, denyOnly, answerOnly]);
  expect(plan.steps.map((s) => [s.item.id, s.dismiss, s.deny])).toEqual([
    ["need:q", "q", false],
    ["permission:p", "p", true],
    ["permission:d", null, true],
  ]);
  expect(plan.left.map((i) => i.id)).toEqual(["ask:a"]);
});

test("the confirm names the count and says what clearing does", () => {
  const plan = clearPlan([question, allow, denyOnly, answerOnly]);
  expect(clearQuestion(plan)).toBe("Clear 3 requests?");
  expect(clearNote(plan)).toBe("Each one is dismissed; a permission still in use is denied. 1 more needs an answer.");
  expect(clearQuestion(clearPlan([question]))).toBe("Clear 1 request?");
  expect(clearNote(clearPlan([question]))).toBe("Each one is dismissed.");
  expect(clearNote(clearPlan([denyOnly]))).toBe("Each one is denied.");
});

test("every request is tried in turn; a refusal keeps its reason and the rest go on", async () => {
  const seen: string[] = [];
  const run = async (step: ClearStep) => {
    seen.push(step.item.id);
    if (step.item.id === "permission:p") throw new Error("A session still waits on it.");
  };
  const outcome = await clearRequests(clearPlan([question, allow, denyOnly]).steps, run);
  expect(seen).toEqual(["need:q", "permission:p", "permission:d"]);
  expect(outcome.cleared).toBe(2);
  expect(outcome.failed.map((f) => [f.item.id, f.reason])).toEqual([["permission:p", "A session still waits on it."]]);
  expect(clearResult(outcome)).toBe("Cleared 2 of 3. permission:p: A session still waits on it.");
  expect(clearResult({ cleared: 3, failed: [] })).toBe("Cleared 3 requests.");
});

test("Clear all is offered only when something can be cleared, and says how it went", async () => {
  expect(clearAllOf([answerOnly])).toBeNull();
  const ran: string[] = [];
  const all = clearAllOf([question, allow, answerOnly], async (step) => { ran.push(step.item.id); })!;
  expect(all.count).toBe(2);
  expect(all.question).toBe("Clear 2 requests?");
  expect(await all.run()).toEqual({ line: "Cleared 2 requests.", ok: true });
  expect(ran).toEqual(["need:q", "permission:p"]);
});
