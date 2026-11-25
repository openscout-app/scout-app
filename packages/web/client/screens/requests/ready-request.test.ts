import { describe, expect, test } from "bun:test";

import type { OperatorAttentionItem } from "../../lib/types.ts";
import { clearPlan } from "./clear-requests.ts";
import { isDeclaredRequest, isReadyRequest, requestActions, requestKind, requestKindTag } from "./requests-model.ts";

/** A Ready item as the server projects it (readyAttentionItem). */
function readyItem(patch: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem {
  return {
    id: "ready:flt-1", kind: "ready", title: "Ranger is ready", summary: "Fixed the route resolution.", detail: "Fix the session route",
    agentId: "ranger", agentName: "Ranger", conversationId: "dm.ranger", updatedAt: 1_000, severity: "info", sourceLabel: "Ready",
    ready: { invocationId: "inv-1", flightId: "flt-1", workId: "work-1", summary: "Fixed the route resolution.", at: 1_000 },
    actions: [
      { kind: "continue", label: "Continue", flightId: "flt-1" },
      { kind: "hold", label: "Hold", flightId: "flt-1" },
      { kind: "open", label: "Open conversation", route: { view: "conversation", conversationId: "dm.ranger" } },
    ],
    ...patch,
  };
}

describe("Ready in the requests model", () => {
  test("is declared, so the store and the companion keep it", () => {
    expect(isDeclaredRequest(readyItem())).toBe(true);
    expect(isReadyRequest(readyItem())).toBe(true);
    // A Ready kind without its record is not Ready.
    expect(isDeclaredRequest(readyItem({ ready: undefined }))).toBe(false);
  });

  test("reads as Ready, never as an ask or a question", () => {
    expect(requestKind(readyItem())).toBe("Ready");
    expect(requestKindTag(readyItem())).toBe("Ready");
  });

  test("offers Continue and Hold, and its source link", () => {
    expect(requestActions(readyItem()).map((a) => a.kind)).toEqual(["continue", "hold", "open"]);
    // Continue and Hold belong to Ready alone.
    const question: OperatorAttentionItem = { ...readyItem(), id: "q1", kind: "question", ready: undefined };
    expect(requestActions(question).map((a) => a.kind)).toEqual(["open"]);
  });

  test("Clear all leaves it: neither move clears it", () => {
    const plan = clearPlan([readyItem()]);
    expect(plan.steps).toEqual([]);
    expect(plan.left.map((i) => i.id)).toEqual(["ready:flt-1"]);
  });
});
