import { describe, expect, test } from "bun:test";
import { openProjectSection, projectSectionRoute } from "./project-navigation.ts";
import type { Route } from "../../lib/types.ts";

const project = { slug: "demo-app", root: "/work/demo-app-feature" };
const local = { view: "agents-v2" as const, projectSlug: project.slug };

describe("project tool navigation", () => {
  test("opens the chosen repository root without adding another destination", () => {
    expect(projectSectionRoute(project, "repos", local)).toEqual({ view: "repos", root: project.root });
  });
  test("keeps a remote host through project sections and Repos", () => {
    const remote = { ...local, machineId: "mini", sessionId: "old-session", showEphemeral: true };
    for (const section of ["overview", "sessions", "agents"] as const) {
      expect(projectSectionRoute(project, section, remote)).toEqual({
        view: "agents-v2", projectSlug: project.slug, machineId: "mini", showEphemeral: true,
        ...(section === "overview" ? {} : { indexView: section }),
      });
    }
    expect(projectSectionRoute(project, "repos", remote)).toEqual({ view: "repos", root: project.root, machineId: "mini" });
  });
  test("does not open an unrelated repository when the project root is unknown", () => {
    const navigations: Route[] = [];
    openProjectSection((route) => navigations.push(route), { ...project, root: null }, "repos", local);
    expect(navigations).toEqual([]);
  });
});
