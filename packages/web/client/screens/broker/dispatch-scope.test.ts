import { describe, expect, test } from "bun:test";
import {
  dispatchScopeTitle,
  EMPTY_DISPATCH_SCOPE,
  mergeScope,
  scopeConfig,
  scopeFromConfig,
  scopeFromRoute,
  scopeIsActive,
  scopeRoute,
  toDispatchScope,
  type DispatchRouteScope,
} from "./dispatch-scope.ts";

const scoped: DispatchRouteScope = { filter: "failed", focus: ["agent:opus", "agent:codex"], between: true, window: "24h" };

describe("the Dispatch scope in the URL", () => {
  test("reads the four from a /dispatch route, and nothing from any other", () => {
    expect(scopeFromRoute({ view: "broker", filter: "failed", focus: ["agent:opus", "agent:codex"], between: true, window: "24h" })).toEqual(scoped);
    expect(scopeFromRoute({ view: "broker" })).toEqual(EMPTY_DISPATCH_SCOPE);
    expect(scopeFromRoute({ view: "inbox" })).toEqual(EMPTY_DISPATCH_SCOPE);
  });

  test("writes the canonical route: defaults left out, the open dispatch kept", () => {
    expect(scopeRoute(EMPTY_DISPATCH_SCOPE)).toEqual({ view: "broker" });
    expect(scopeRoute(scoped, "message:m1")).toEqual({
      view: "broker",
      attemptId: "message:m1",
      filter: "failed",
      focus: ["agent:opus", "agent:codex"],
      between: true,
      window: "24h",
    });
  });

  test("Between needs two: dropping a node to one drops it", () => {
    const one = mergeScope(scoped, { focus: ["agent:opus"] });
    expect(one.between).toBe(false);
    expect(scopeRoute(one)).toEqual({ view: "broker", filter: "failed", focus: ["agent:opus"], window: "24h" });
  });

  test("a node is focused once", () => {
    expect(mergeScope(EMPTY_DISPATCH_SCOPE, { focus: ["agent:opus", " agent:opus ", ""] }).focus).toEqual(["agent:opus"]);
  });

  test("a route round-trips through the scope unchanged", () => {
    const route = { view: "broker" as const, attemptId: "a1", filter: "delivered" as const, focus: ["x", "y"], between: true, window: "7d" as const };
    expect(scopeRoute(scopeFromRoute(route), route.attemptId)).toEqual(route);
  });
});

describe("the Dispatch scope in a panel's settings", () => {
  test("round-trips through settings", () => {
    expect(scopeFromConfig(scopeConfig(scoped))).toEqual(scoped);
  });

  test("writes every key, so going back to a default clears it", () => {
    expect(scopeConfig(EMPTY_DISPATCH_SCOPE)).toEqual({ filter: "", focus: "", between: "", window: "" });
  });

  test("a bad setting reads as no scope, never a broken panel", () => {
    expect(scopeFromConfig({ filter: "nope", focus: "{not json", between: "1", window: "forever" })).toEqual(EMPTY_DISPATCH_SCOPE);
    expect(scopeFromConfig({ focus: JSON.stringify(["a", 3, "b"]) }).focus).toEqual(["a", "b"]);
    expect(scopeFromConfig({})).toEqual(EMPTY_DISPATCH_SCOPE);
  });
});

describe("reading the scope", () => {
  test("hands the ledger's filter what it reads", () => {
    expect(toDispatchScope(scoped, "fork")).toEqual({
      nodes: ["agent:opus", "agent:codex"],
      between: true,
      window: "24h",
      query: "fork",
      outcome: "failed",
    });
  });

  test("anything narrowing counts as active, search included", () => {
    expect(scopeIsActive(EMPTY_DISPATCH_SCOPE)).toBe(false);
    expect(scopeIsActive(EMPTY_DISPATCH_SCOPE, "  ")).toBe(false);
    expect(scopeIsActive(EMPTY_DISPATCH_SCOPE, "fork")).toBe(true);
    expect(scopeIsActive({ ...EMPTY_DISPATCH_SCOPE, window: "1h" })).toBe(true);
  });

  test("titles the scope the way the graph always has", () => {
    const label = (key: string) => key.replace("agent:", "").toUpperCase();
    expect(dispatchScopeTitle(EMPTY_DISPATCH_SCOPE, label)).toBe("All routes");
    expect(dispatchScopeTitle(scoped, label)).toBe("Between OPUS and CODEX");
    expect(dispatchScopeTitle({ ...scoped, between: false }, label)).toBe("Involving OPUS, CODEX");
  });
});
