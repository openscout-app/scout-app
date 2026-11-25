import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collides, gridColumnsFor, reconcile, type GridLayout, type GridMins } from "../../../components/hud-grid/hud-grid-layout.ts";
import type { Route } from "../../../lib/types.ts";
import { composedViewFor } from "../composed-routes.ts";
import { defaultsFor, shippedView, sideOf } from "../views-model.ts";
import { isAgentPage, isAgentsFeed } from "./agent-model.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";

/*
 * The Agents and Agent views on every grid they can draw on. Agents is the
 * feed; Agent is the agent's page (the profile, the inspector), its panels
 * following the page's agent. Both live under Activity and carry no project
 * list: the list belongs to Projects.
 * Minimums are read from the module files as text, as registry.test.ts does.
 */

const FILES: Record<string, string> = {
  "agent-activity": "agent-activity.tsx",
  "agent": "agent.tsx",
  "agent-session": "agent-session.tsx",
  "projects": "projects.tsx",
};

const minOf = (file: string) => {
  const m = readFileSync(join(import.meta.dir, file), "utf8").match(/minSize: \{ w: (\d+), h: (\d+) \}/);
  if (!m) throw new Error(`no minSize in ${file}`);
  return { w: Number(m[1]), h: Number(m[2]) };
};

function grid(id: string) {
  const view = shippedView(id);
  // shippedView falls back to Watch: say which view is missing
  if (view.id !== id) throw new Error(`no shipped view "${id}" in views-model.ts`);
  const mins: GridMins = Object.fromEntries(view.instances.map((i) => [i.id, minOf(FILES[i.type]!)]));
  const defaults = defaultsFor(view, view.instances, () => ({ w: 6, h: 8 }));
  // a docked panel has no cell: only the grid's panels are laid out
  const ids = view.instances.filter((i) => !sideOf(view, i.id)).map((i) => i.id);
  const at = (width: number) => reconcile(null, defaults, ids, gridColumnsFor(width)!, mins);
  const cell = (l: GridLayout, type: string) => l.find((c) => c.id === view.instances.find((i) => i.type === type)!.id)!;
  const docked = (type: string) => sideOf(view, view.instances.find((i) => i.type === type)!.id);
  return { view, mins, at, cell, docked };
}

function holds(l: GridLayout, mins: GridMins) {
  for (const item of l) {
    expect(item.w, item.id).toBeGreaterThanOrEqual(mins[item.id]!.w);
    expect(item.h, item.id).toBeGreaterThanOrEqual(mins[item.id]!.h);
  }
  expect(l.some((a) => l.some((b) => collides(a, b)))).toBe(false);
}

describe("the Agents view", () => {
  const { view, mins, at, cell, docked } = grid("agents");

  test("is the activity feed alone, on the feed's own route", () => {
    expect(view.id).toBe("agents");
    expect(view.host).toEqual({ view: "agents-v2" });
    expect(composedViewFor(view.host!)).toBe("agents");
    expect(view.instances.map((i) => i.type)).toEqual(["agent-activity"]);
    // stacked, the feed leads
    expect(gridColumnsFor(719)).toBeNull();
  });

  test("draws on bare /agents and /projects, its peek and sub-views included", () => {
    const feed: Route[] = [
      { view: "agents-v2" },
      { view: "agents-v2", selectedAgentId: "a" },
      { view: "agents-v2", sessionId: "s1" },
      { view: "agents-v2", indexView: "sessions" },
      { view: "agents-v2", indexView: "agents", machineId: "peer" },
    ];
    for (const route of feed) {
      expect(composedViewFor(route)).toBe("agents");
      expect(isAgentsFeed(route)).toBe(true);
    }
  });

  test("docks nothing: the project list belongs to Projects", () => {
    expect(view.sides).toBeUndefined();
    expect(docked("agent-activity")).toBeNull();
  });

  for (const width of [760, 900, 1099, 1100, 1600]) {
    test(`at ${width}px the feed is the whole grid`, () => {
      const cols = gridColumnsFor(width)!;
      const l = at(width);
      expect(l.map((c) => c.id)).toEqual([cell(l, "agent-activity").id]);
      expect(cell(l, "agent-activity")).toMatchObject({ x: 0, y: 0, w: cols });
      holds(l, mins);
    });
  }
});

describe("the Agent view", () => {
  const { view, mins, at, cell, docked } = grid("agent");

  test("is the profile and its session, both following the page", () => {
    expect(view.id).toBe("agent");
    expect(view.instances.map((i) => i.type)).toEqual(["agent", "agent-session"]);
    for (const i of view.instances) expect(i.config).toEqual({ agent: FOLLOW_PAGE });
    // /views/agent goes to the feed, where an agent is picked
    expect(view.host).toEqual({ view: "agents-v2" });
  });

  test("draws on every agent's page: tab, session, chat, under a project or not", () => {
    const pages: Route[] = [
      { view: "agents-v2", agentId: "a" },
      { view: "agents-v2", agentId: "a", tab: "config" },
      { view: "agents-v2", agentId: "a", sessionId: "s1", tab: "observe", machineId: "peer" },
      { view: "agents-v2", agentId: "a", conversationId: "c1", tab: "message" },
      { view: "agents-v2", projectSlug: "pomo", agentId: "a" },
    ];
    for (const route of pages) {
      expect(composedViewFor(route)).toBe("agent");
      expect(isAgentPage(route)).toBe(true);
    }
  });

  test("leaves the project pages to Projects and /agent/:conversationId to its screen", () => {
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo" })).toBe("project-snapshot");
    expect(composedViewFor({ view: "agents-v2", projectSlug: "pomo", indexView: "agents", selectedAgentId: "a" })).toBe("project");
    expect(composedViewFor({ view: "agents-v2", indexView: "projects" })).toBe("projects");
    expect(composedViewFor({ view: "agent-info", conversationId: "c1" })).toBeNull();
  });

  test("docks nothing: the project list belongs to Projects", () => {
    expect(view.sides).toBeUndefined();
    expect(docked("agent")).toBeNull();
    expect(docked("agent-session")).toBeNull();
  });

  test("at 12 columns the profile and inspector split the grid two to one", () => {
    for (const width of [1100, 1600]) {
      const l = at(width);
      expect(cell(l, "agent")).toMatchObject({ x: 0, y: 0, w: 8 });
      expect(cell(l, "agent-session")).toMatchObject({ x: 8, y: 0, w: 4 });
      holds(l, mins);
    }
  });

  // both minimums (4 + 3) fit 8 columns: the session stays beside the profile
  for (const width of [760, 900, 1099]) {
    test(`at ${width}px the profile and session share the top`, () => {
      const l = at(width);
      const profile = cell(l, "agent");
      const session = cell(l, "agent-session");
      expect(profile).toMatchObject({ x: 0, y: 0 });
      expect(session).toMatchObject({ x: profile.w, y: 0, h: profile.h });
      expect(session.x + session.w).toBe(8);
      holds(l, mins);
    });
  }
});
