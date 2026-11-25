import { describe, expect, test } from "bun:test";
import type { BrokerRouteAttempt } from "../../../lib/types.ts";
import type { DispatchDeliveryState, DispatchNode, DispatchRowModel } from "../../broker/dispatch-focus.ts";
import { dispatchHealth, healthPercent } from "./dispatch-health-model.ts";

const node = (key: string): DispatchNode => ({ key, label: key, kind: "agent", address: null, agentId: key, machine: null, where: null });

function row(id: string, ts: number, delivery: DispatchDeliveryState, from = "arach", to = "opus", route = "dm"): DispatchRowModel {
  const attempt: BrokerRouteAttempt = {
    id,
    kind: delivery === "attention" ? "failed_delivery" : "success",
    status: delivery,
    ts,
    actorName: from,
    target: to,
    route,
    detail: id,
    conversationId: null,
    messageId: null,
    deliveryId: null,
    invocationId: null,
    metadata: null,
  };
  return { attempt, from: node(from), to: node(to), request: id, title: id, delivery };
}

describe("dispatch health", () => {
  test("counts every outcome, and the three add up to the total", () => {
    const health = dispatchHealth([
      row("a", 5, "delivered"),
      row("b", 4, "delivered"),
      row("c", 3, "attention"),
      row("d", 2, "pending"),
    ]);
    expect([health.total, health.delivered, health.attention, health.pending]).toEqual([4, 2, 1, 1]);
    expect(health.deliveredShare).toBe(0.5);
    expect(health.attentionShare).toBe(0.25);
    expect(health.latestAt).toBe(5);
  });

  test("nothing in scope reads as no share, not 0%", () => {
    const health = dispatchHealth([]);
    expect(health.deliveredShare).toBeNull();
    expect(healthPercent(health.deliveredShare)).toBe("—");
    expect(health.busiest).toBeNull();
    expect(health.latestAt).toBeNull();
  });

  test("lists the newest dispatches that need attention, up to the limit", () => {
    const health = dispatchHealth([
      row("old", 1, "attention"),
      row("new", 9, "attention"),
      row("mid", 5, "attention"),
      row("fine", 10, "delivered"),
    ], 2);
    expect(health.needsAttention.map((entry) => entry.attempt.id)).toEqual(["new", "mid"]);
  });

  test("names the busiest route, with its failures, only when there is more than one", () => {
    const health = dispatchHealth([
      row("a", 1, "delivered", "arach", "opus"),
      row("b", 2, "attention", "arach", "opus"),
      row("c", 3, "delivered", "opus", "codex"),
    ]);
    expect(health.busiest && [health.busiest.from.key, health.busiest.to.key, health.busiest.count, health.busiest.attention])
      .toEqual(["arach", "opus", 2, 1]);
    expect(dispatchHealth([row("a", 1, "delivered"), row("b", 2, "delivered")]).busiest).toBeNull();
  });

  test("the route mix shares the total", () => {
    const health = dispatchHealth([
      row("a", 1, "delivered", "arach", "opus", "dm"),
      row("b", 2, "delivered", "arach", "opus", "dm"),
      row("c", 3, "delivered", "arach", "ops", "channel"),
      row("d", 4, "delivered", "arach", "opus", "dm"),
    ]);
    expect(health.routeMix).toEqual([
      { label: "direct", count: 3, share: 0.75 },
      { label: "channel", count: 1, share: 0.25 },
    ]);
  });

  test("one failure in a thousand never rounds to none", () => {
    expect(healthPercent(0.001)).toBe("<1%");
    expect(healthPercent(0)).toBe("0%");
    expect(healthPercent(0.926)).toBe("93%");
  });
});
