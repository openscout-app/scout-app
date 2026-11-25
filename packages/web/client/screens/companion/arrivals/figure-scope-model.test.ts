import { describe, expect, test } from "bun:test";
import { keepScopedAgents, parseScopeValues, projectKey, scopedValue, scopeNote, withScoped } from "./figure-scope-model.ts";

const isWord = (v: unknown): v is string => typeof v === "string" && v.length > 0;

describe("three levels: this agent, its project, every figure", () => {
  test("the most specific level that holds a value wins", () => {
    const values = { agents: { a: "own" }, projects: { openscout: "shared" } };
    expect(scopedValue(values, { id: "a", project: "openscout" })).toEqual({ value: "own", from: "agent" });
    expect(scopedValue(values, { id: "b", project: "openscout" })).toEqual({ value: "shared", from: "project" });
    expect(scopedValue(values, { id: "b", project: "hudson" })).toBeUndefined();
    expect(scopedValue(values, { id: "b", project: null })).toBeUndefined();
  });

  test("set, clear, and the same object when nothing changes", () => {
    const set = withScoped({ agents: {}, projects: {} }, "project", "openscout", "x");
    expect(set).toEqual({ agents: {}, projects: { openscout: "x" } });
    expect(withScoped(set, "project", "openscout", "x")).toBe(set);
    expect(withScoped(set, "project", "openscout", null)).toEqual({ agents: {}, projects: {} });
    expect(withScoped(set, "agent", "gone", null)).toBe(set);
  });

  test("agents the host let go of are forgotten; projects stay", () => {
    const values = { agents: { a: "x", b: "y" }, projects: { openscout: "z" } };
    expect(keepScopedAgents(values, ["a"])).toEqual({ agents: { a: "x" }, projects: { openscout: "z" } });
    expect(keepScopedAgents(values, ["a", "b"])).toBe(values);
  });

  test("stored values drop anything unreadable", () => {
    expect(parseScopeValues(JSON.stringify({ agents: { a: "x", b: 3 }, projects: { "": "y", p: "z" } }), isWord)).toEqual({ agents: { a: "x" }, projects: { p: "z" } });
    expect(parseScopeValues("nope", isWord)).toEqual({ agents: {}, projects: {} });
    expect(projectKey("  openscout ")).toBe("openscout");
    expect(projectKey("  ")).toBeNull();
  });
});

describe("the note beside a value in Details", () => {
  test("editing this agent: where an inherited value comes from", () => {
    expect(scopeNote("agent", "project", "openscout")).toEqual({ text: "from openscout", reset: false });
    expect(scopeNote("agent", "default", "openscout")).toEqual({ text: "from every figure", reset: false });
    expect(scopeNote("agent", "landed", null)).toEqual({ text: "as it landed", reset: false });
    expect(scopeNote("agent", "agent", "openscout")).toEqual({ text: "", reset: true });
  });

  test("editing a wider level: what wins over it for this agent", () => {
    expect(scopeNote("project", "agent", "openscout")).toEqual({ text: "this agent's own wins here", reset: false });
    expect(scopeNote("default", "project", "openscout")).toEqual({ text: "openscout's wins here", reset: false });
    expect(scopeNote("default", "app", null)).toEqual({ text: "its character in Agents wins here", reset: false });
    expect(scopeNote("default", "default", null)).toBeNull();
  });

  test("a wider level that holds its own value can still be reset under the one that wins", () => {
    expect(scopeNote("project", "agent", "openscout", true)).toEqual({ text: "this agent's own wins here", reset: true });
    expect(scopeNote("project", "agent", "openscout", false)).toEqual({ text: "this agent's own wins here", reset: false });
    expect(scopeNote("default", "project", "openscout", true)).toEqual({ text: "openscout's wins here", reset: false });
  });
});
