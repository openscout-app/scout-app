import { afterEach, describe, expect, test } from "bun:test";
import { projectAreaSubNav } from "./nav-destinations.ts";
import { projectScope, scopeProjectTabs, setProjectScope } from "./project-scope.ts";

describe("Work tabs carry the picked project", () => {
  afterEach(() => setProjectScope(null));

  test("with no project picked, the tabs keep their own routes", () => {
    const tabs = projectAreaSubNav("work", { canvasEnabled: true });
    expect(scopeProjectTabs(tabs, null)).toEqual(tabs);
  });

  test("Projects opens the picked project while Board stays global", () => {
    const unscoped = projectAreaSubNav("work", { canvasEnabled: true });
    const tabs = scopeProjectTabs(unscoped, {
      slug: "demo-app",
      root: "/work/demo-app",
    });
    expect(tabs.map((tab) => [tab.label, tab.route])).toEqual([
      ["Board", { view: "work", workId: "", board: true }],
      ["Projects", { view: "agents-v2", projectSlug: "demo-app" }],
    ]);
    // Scoping moves where a tab goes, not when it is lit.
    const byId = (id: string) => tabs.find((tab) => tab.id === id)!;
    expect(byId("project-list").active({ view: "agents-v2", projectSlug: "other" })).toBe(true);
    expect(byId("board").active({ view: "review" })).toBe(true);
    expect(byId("board")).toEqual(unscoped.find((tab) => tab.id === "board")!);
  });

  test("a project with no root still opens from the Projects tab", () => {
    const tabs = scopeProjectTabs(projectAreaSubNav("work"), { slug: "notes", root: null });
    expect(tabs.find((tab) => tab.id === "project-list")?.route).toEqual({ view: "agents-v2", projectSlug: "notes" });
  });

  test("recording the same project twice leaves the scope as it was", () => {
    setProjectScope({ slug: "a", root: "/a" });
    const first = projectScope();
    setProjectScope({ slug: "a", root: "/a" });
    expect(projectScope()).toBe(first);
  });
});
