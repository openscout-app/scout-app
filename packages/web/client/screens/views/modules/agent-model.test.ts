import { describe, expect, mock, test } from "bun:test";
import type * as ReactModule from "react";

import type { Route } from "../../../lib/types.ts";
import {
  asAgentTab,
  feedPeek,
  followsAgentPage,
  isAgentPage,
  isAgentsFeed,
  pageAgentId,
  panelAgentId,
  panelMove,
  panelReturnTo,
  panelRoute,
} from "./agent-model.ts";
import { createAgentPicks } from "./agent-pick.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { isProjectsPage } from "./projects-model.ts";

// the router reads React; the relative .js path keeps bun on the real module (rebuild-ledger.test.ts)
// @ts-expect-error -- the relative .js path keeps bun's runtime resolution to the real react module
const React = (await import("../../../../node_modules/react/index.js")) as typeof ReactModule;
mock.module("react", () => React);
const { routeFromUrl } = await import("../../../lib/router.ts");

const at = (url: string): Route => routeFromUrl(`http://scout.local${url}`);

describe("the Agents and Agent pages", () => {
  test("an agent's page is every agent URL, under a project or not", () => {
    for (const url of [
      "/agents/fourier.main",
      "/agents/fourier.main/sessions/s1",
      "/agents/fourier.main/c/c1",
      "/agents/fourier.main?tab=config",
      "/projects/openscout/agents/fourier.main",
      "/projects/openscout/agents/fourier.main/sessions/s1",
    ]) {
      const route = at(url);
      expect({ url, page: isAgentPage(route), feed: isAgentsFeed(route), projects: isProjectsPage(route) }).toEqual({
        url,
        page: true,
        feed: false,
        projects: false,
      });
      expect(pageAgentId(route)).toBe("fourier.main");
    }
  });

  test("the feed is bare /agents, with or without a peek; never the list or a project", () => {
    for (const url of ["/agents", "/agents?select=fourier.main", "/projects?view=sessions", "/projects?select=fourier.main"]) {
      const route = at(url);
      expect({ url, feed: isAgentsFeed(route), page: isAgentPage(route), projects: isProjectsPage(route) }).toEqual({
        url,
        feed: true,
        page: false,
        projects: false,
      });
    }
    // Projects owns bare /projects
    for (const url of ["/projects", "/projects/", "/projects?view=projects", "/projects/openscout", "/projects/openscout/sessions/s1"]) {
      const route = at(url);
      expect({ url, feed: isAgentsFeed(route), projects: isProjectsPage(route) }).toEqual({ url, feed: false, projects: true });
    }
    expect(isAgentsFeed(at("/agent/c1"))).toBe(false);
    expect(pageAgentId(at("/agent/c1"))).toBeUndefined();
  });

  test("the feed draws the page's peek: ?select= or a selected session", () => {
    expect(feedPeek(at("/projects?select=fourier.main"))).toBe(true);
    expect(feedPeek({ view: "agents-v2", sessionId: "s1" })).toBe(true);
    expect(feedPeek(at("/projects"))).toBe(false);
    expect(feedPeek(at("/projects/openscout?select=fourier.main"))).toBe(false);
  });

  test("the page's ?machineId= and ?tab= stay on the page's route", () => {
    const route = at("/agents/fourier.main/sessions/s1?tab=observe&machineId=peer");
    expect(route).toMatchObject({ view: "agents-v2", agentId: "fourier.main", sessionId: "s1", tab: "observe", machineId: "peer" });
  });
});

describe("a panel's agent", () => {
  const page = at("/agents/fourier.main?tab=config");

  test("following the page, it is the page's agent and the panel is the page", () => {
    expect(panelAgentId({ agent: FOLLOW_PAGE }, page)).toBe("fourier.main");
    expect(followsAgentPage({ agent: FOLLOW_PAGE }, page)).toBe(true);
    // on another view, following the page names no agent
    expect(panelAgentId({ agent: FOLLOW_PAGE }, { view: "views", viewId: "watch" })).toBe("");
    expect(followsAgentPage({ agent: FOLLOW_PAGE }, { view: "views", viewId: "watch" })).toBe(false);
  });

  test("pinned, it is its own agent, even on another agent's page", () => {
    expect(panelAgentId({ agent: "dirac.main" }, page)).toBe("dirac.main");
    expect(followsAgentPage({ agent: "dirac.main" }, page)).toBe(false);
    expect(panelAgentId({}, page)).toBe("");
  });

  test("off the page it draws the agent's page as its settings hold it, for that agent only", () => {
    expect(panelRoute("fourier.main", {})).toEqual({ view: "agents-v2", agentId: "fourier.main" });
    const held = { of: "fourier.main", tab: "observe", session: "s2", conversation: "c1" };
    expect(panelRoute("fourier.main", held)).toEqual({
      view: "agents-v2",
      agentId: "fourier.main",
      tab: "observe",
      sessionId: "s2",
      conversationId: "c1",
    });
    // another agent chosen in Scope starts fresh: the held tab and session were the old one's
    expect(panelRoute("dirac.main", held)).toEqual({ view: "agents-v2", agentId: "dirac.main" });
    expect(asAgentTab("trace")).toBeUndefined();
    expect(panelRoute("fourier.main", { ...held, tab: "nonsense" }).tab).toBeUndefined();
  });

  test("the same agent's tab, session or chat stays in the panel; anything else is a real move", () => {
    const tab = { view: "agents-v2" as const, agentId: "fourier.main", tab: "config" as const, conversationId: "c1" };
    expect(panelMove("fourier.main", tab)).toEqual({ of: "fourier.main", tab: "config", session: "", conversation: "c1" });
    // a project's page for the same agent is still the same agent
    expect(panelMove("fourier.main", { view: "agents-v2", projectSlug: "openscout", agentId: "fourier.main", sessionId: "s3" })).toEqual({
      of: "fourier.main",
      tab: "",
      session: "s3",
      conversation: "",
    });
    // the name the panel was given (an alias) counts as the agent
    expect(panelMove("fourier.main", { view: "agents-v2", agentId: "fourier" }, ["fourier"])?.of).toBe("fourier.main");
    expect(panelMove("fourier.main", { view: "agents-v2", agentId: "dirac.main" })).toBeNull();
    expect(panelMove("fourier.main", { view: "terminal", agentId: "fourier.main", mode: "takeover" } as Route)).toBeNull();
    expect(panelMove("fourier.main", { view: "sessions", sessionId: "s1" })).toBeNull();
    expect(panelMove("fourier.main", { view: "agents-v2" })).toBeNull();
  });

  test("Back from a real move comes to the page the panel sits on", () => {
    const watch: Route = { view: "views", viewId: "watch" };
    const own = { view: "agents-v2" as const, agentId: "fourier.main" };
    expect(panelReturnTo(own, "fourier.main", watch)).toBe(watch);
    expect(panelReturnTo({ view: "agents-v2", agentId: "fourier" }, "fourier.main", watch, ["fourier"])).toBe(watch);
    const other: Route = { view: "inbox" };
    expect(panelReturnTo(other, "fourier.main", watch)).toBe(other);
    expect(panelReturnTo(undefined, "fourier.main", watch)).toBeUndefined();
  });
});

describe("Agent picks", () => {
  test("an Agent session panel follows the latest Agent panel showing its agent", () => {
    const picks = createAgentPicks();
    expect(picks.latestFor("fourier.main")).toBeNull();
    picks.publish("a", { agentId: "fourier.main", sessionId: "s1", tab: null });
    picks.publish("b", { agentId: "dirac.main", sessionId: "s9", tab: null });
    expect(picks.latestFor("fourier.main")?.sessionId).toBe("s1");
    picks.publish("c", { agentId: "fourier.main", sessionId: "s2", tab: "observe" });
    expect(picks.latestFor("fourier.main")).toMatchObject({ from: "c", sessionId: "s2", tab: "observe" });
    picks.withdraw("c");
    expect(picks.latestFor("fourier.main")?.from).toBe("a");
    picks.withdraw("a");
    expect(picks.latestFor("fourier.main")).toBeNull();
    expect(picks.latestFor("dirac.main")?.sessionId).toBe("s9");
  });

  test("the same pick again changes nothing; a change moves the version", () => {
    const picks = createAgentPicks();
    let heard = 0;
    const stop = picks.subscribe(() => heard++);
    picks.publish("a", { agentId: "fourier.main", sessionId: "s1", tab: null });
    const v = picks.version();
    picks.publish("a", { agentId: "fourier.main", sessionId: "s1", tab: null });
    expect(picks.version()).toBe(v);
    expect(heard).toBe(1);
    picks.publish("a", { agentId: "fourier.main", sessionId: "s2", tab: null });
    expect(picks.version()).not.toBe(v);
    picks.withdraw("missing");
    expect(heard).toBe(2);
    stop();
  });
});
