import { describe, expect, test } from "bun:test";
import { isRuntimeRoute, RUNTIME_STATUS_OPTIONS, runtimeScope } from "./runtime-model.ts";

describe("Runtime panels", () => {
  test("their own route is Ops › Runtime", () => {
    expect(isRuntimeRoute({ view: "ops", mode: "atop" })).toBe(true);
    expect(isRuntimeRoute({ view: "ops", mode: "mission" })).toBe(false);
    expect(isRuntimeRoute({ view: "ops" })).toBe(false);
  });

  test("status choices name the row states without colour words", () => {
    expect(RUNTIME_STATUS_OPTIONS.map((o) => o.label)).toEqual(["Working", "Active", "Idle"]);
  });

  test("a scope from the panel's config", () => {
    expect(runtimeScope({}, null)).toEqual({ harness: undefined, status: undefined, roots: null });
    expect(runtimeScope({ harness: "codex", status: "tool" }, null)).toEqual({ harness: "codex", status: "tool", roots: null });
    expect(runtimeScope({ project: "/w/a" }, ["/w/b"]).roots).toEqual(["/w/a"]);
    // following the page: the page project's checkouts, or every row off a project page
    expect(runtimeScope({ project: "@route" }, ["/w/b", "/w/b-wt"]).roots).toEqual(["/w/b", "/w/b-wt"]);
    expect(runtimeScope({ project: "@route" }, null).roots).toBeNull();
  });
});
