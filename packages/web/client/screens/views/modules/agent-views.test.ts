import { describe, expect, mock, test } from "bun:test";

import type { Agent, Route } from "../../../lib/types.ts";

/*
 * The Agents and Agent views' panels, rendered to markup with the shared
 * Projects loop mocked (the pattern in projects-panels.test.ts). Effects do
 * not run here, so nothing is fetched: these check what each panel draws,
 * and where, on its own page and off it.
 */

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const NOW = 1_700_000_060_000;

const thread = {
  id: "openscout:agent:fourier.main",
  kind: "agent",
  projectSlug: "openscout",
  projectTitle: "OpenScout",
  projectRoot: "/workspace/openscout",
  workspaceRoot: null,
  agentId: "fourier.main",
  agentName: "fourier",
  harness: "claude",
  branch: null,
  work: "Port the Agents view",
  group: "working",
  needs: false,
  working: true,
  lastActivityAt: NOW - 30_000,
  sessionCount: 0,
  contextPct: null,
  conversationId: "c-fourier",
  sessionId: null,
};

mock.module("../../projects/useProjectsInbox.ts", () => ({
  refreshProjectsInbox: () => undefined,
  useProjectsInbox: () => ({
    model: { projects: [], threads: [thread], sessions: [], projectAliases: {} },
    agents: [],
    nowMs: NOW,
    loading: false,
    error: null,
  }),
}));

const agent = (over: Partial<Agent>): Agent =>
  ({
    id: "fourier.main",
    name: "fourier",
    handle: "fourier",
    agentClass: "general",
    harness: "claude",
    state: "available",
    projectRoot: "/workspace/openscout",
    project: "openscout",
    cwd: "/workspace/openscout",
    branch: "main",
    capabilities: [],
    skills: [],
    updatedAt: NOW - 60_000,
    ...over,
  }) as Agent;

const agents = [agent({}), agent({ id: "dirac.main", name: "dirac", handle: "dirac" })];

const { ScoutContext } = await import("../../../scout/Provider.tsx");
const { agentModule } = await import("./agent.tsx");
const { agentSessionModule } = await import("./agent-session.tsx");
const { agentCardModule } = await import("./agent-card.tsx");
const { agentActivityModule } = await import("./agent-activity.tsx");
const { FOLLOW_PAGE } = await import("./panel-scope.ts");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");

const noop = () => undefined;

function renderPanel(module: { Component: unknown }, route: Route, config: Record<string, string> = {}): string {
  const scout = { route, navigate: noop, agents, agentsLoaded: true, focusedSession: null, focusSession: noop };
  const props = { instanceId: "t", route, navigate: noop, config, setConfig: noop };
  // a head slot, so ModuleHead's chips draw inline (createPortal is mocked to pass its children through)
  const body = createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never));
  return renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, body));
}

const page: Route = { view: "agents-v2", agentId: "fourier.main", tab: "profile" };
const watch: Route = { view: "views", viewId: "watch" };
const follow = { agent: FOLLOW_PAGE };

describe("the Agent panel", () => {
  test("on the agent's page it is the page: Project back and the four tabs", () => {
    const html = renderPanel(agentModule, page, follow);
    expect(html).toContain("vw-ag-profile");
    for (const tab of ["Sessions", "Config", "Trace", "Message"]) expect(html).toContain(`>${tab}<`);
    expect(html).toContain("av2-profileBack");
    expect(html).toContain("fourier");
    expect(html).not.toContain("Open full");
  });

  test("pinned on another view: its own agent, no Project back, Open full in the head", () => {
    const html = renderPanel(agentModule, watch, { agent: "dirac.main" });
    expect(html).toContain("dirac");
    expect(html).toContain(">Sessions<");
    expect(html).not.toContain("av2-profileBack");
    expect(html).toContain("Open full");
  });

  test("an agent no one answers to says so; following with no agent on the page says how to fill it", () => {
    expect(renderPanel(agentModule, { view: "agents-v2", agentId: "nobody.main" }, follow)).toContain("Agent not found.");
    expect(renderPanel(agentModule, watch, follow)).toContain("Open an agent and its page follows here.");
    expect(renderPanel(agentModule, watch)).toContain("Pick an agent from Scope");
  });

  test("its tab, session and chat are live state, not a choice; Agent is its one scope", () => {
    expect(agentModule.state).toEqual(["of", "tab", "session", "conversation"]);
    expect(agentModule.scopes?.map((s) => [s.key, s.followsPage])).toEqual([["agent", "This page's agent"]]);
  });
});

describe("the Agent session panel", () => {
  test("on the agent's page it is the inspector: the Runtime readout, no Open full", () => {
    const html = renderPanel(agentSessionModule, page, follow);
    expect(html).toContain("vw-ag-session");
    expect(html).toContain("Runtime");
    expect(html).not.toContain("Open full");
  });

  test("pinned elsewhere it offers Open full; an unknown agent says so", () => {
    expect(renderPanel(agentSessionModule, watch, { agent: "fourier.main" })).toContain("Open full");
    expect(renderPanel(agentSessionModule, watch, { agent: "nobody.main" })).toContain("No agent answers to that name.");
  });
});

describe("the Agent card", () => {
  test("pinned on Watch: identity, presence, identity rows, and Open", () => {
    const html = renderPanel(agentCardModule, watch, { agent: "dirac.main" });
    expect(html).toContain("dirac");
    expect(html).toContain("@dirac");
    expect(html).toContain("Presence");
    expect(html).toContain("Identity");
    expect(html).toContain(">Open<");
  });

  test("on its own agent's page it needs no Open", () => {
    expect(renderPanel(agentCardModule, page, follow)).not.toContain(">Open<");
  });
});

describe("the Agent activity panel", () => {
  test("on the feed: the activity stage, and no peek until the page selects one", () => {
    const html = renderPanel(agentActivityModule, { view: "agents-v2" });
    expect(html).toContain('aria-label="Agent activity"');
    expect(html).not.toContain("vw-agf-peek");
  });

  test("a peek on the feed (?select=) draws beside it with Open · Observe · Clear", () => {
    const html = renderPanel(agentActivityModule, { view: "agents-v2", selectedAgentId: "fourier.main" });
    expect(html).toContain("vw-agf-peek");
    expect(html).toContain("Port the Agents view");
    expect(html).toContain("Clear");
  });

  test("a project page's selection is not the feed's: no peek there", () => {
    const html = renderPanel(agentActivityModule, { view: "agents-v2", projectSlug: "openscout", selectedAgentId: "fourier.main" });
    expect(html).not.toContain("vw-agf-peek");
  });

  test("its Agent scope says All agents when unset, and follows the page's agent", () => {
    expect(agentActivityModule.scopes?.map((s) => [s.key, s.allLabel, s.followsPage])).toEqual([["agent", "All agents", "This page's agent"]]);
  });
});
