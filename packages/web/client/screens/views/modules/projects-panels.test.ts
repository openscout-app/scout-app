import { describe, expect, mock, test } from "bun:test";

import type { InboxProject, InboxSession, InboxThread } from "../../projects/projects-inbox-model.ts";
import type { Route } from "../../../lib/types.ts";
import { MAC_HOME_ROOT } from "../../../../test-support/path-fixtures.ts";

/*
 * The Projects view's panels, rendered to markup with the shared Projects
 * loop mocked (the pattern in screens/projects/ProjectsInbox.test.ts).
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

const project = (over: Partial<InboxProject>): InboxProject => ({
  slug: "pomo",
  title: "Pomo",
  root: "/workspace/pomo",
  agentCount: 1,
  sessionCount: 1,
  liveSessionCount: 0,
  worktreeCount: 0,
  worktrees: [],
  needs: 0,
  working: 0,
  threadCount: 1,
  lastActivityAt: NOW - 60_000,
  branches: [],
  ...over,
});

const projects = [
  project({ slug: "pomo", title: "Pomo", needs: 1 }),
  project({ slug: "talkie", title: "Talkie", root: "/workspace/talkie", liveSessionCount: 1 }),
  project({ slug: "quiet", title: "Quiet", root: "/workspace/quiet", sessionCount: 0 }),
];

const session: InboxSession = {
  id: "pomo:session:s1",
  kind: "session",
  projectSlug: "pomo",
  projectTitle: "Pomo",
  projectRoot: "/workspace/pomo",
  workspaceRoot: "/workspace/pomo",
  agentId: null,
  agentName: "Codex session",
  harness: "codex",
  branch: null,
  work: "Verify the sessions route",
  group: "recent",
  needs: false,
  working: false,
  lastActivityAt: NOW - 60_000,
  latestReplyAt: null,
  latestReplyPreview: null,
  sessionCount: 1,
  contextPct: null,
  conversationId: null,
  sessionId: "s1",
  route: { view: "sessions", sessionId: "s1" },
};

const thread: InboxThread = {
  id: "talkie:agent:a1",
  kind: "agent",
  projectSlug: "talkie",
  projectTitle: "Talkie",
  projectRoot: "/workspace/talkie",
  workspaceRoot: null,
  agentId: "a1",
  agentName: "Talkie agent",
  harness: "claude",
  branch: null,
  work: "Ship the voice pass",
  group: "working",
  needs: false,
  working: true,
  lastActivityAt: NOW - 30_000,
  sessionCount: 0,
  contextPct: null,
  conversationId: "c-a1",
  sessionId: null,
};

// the routes the shared loop was read with, so a panel's machine scope shows
const inboxReads: Route[] = [];
mock.module("../../projects/useProjectsInbox.ts", () => ({
  refreshProjectsInbox: () => undefined,
  useProjectsInbox: (route: Route) => (inboxReads.push(route), {
    model: { projects, threads: [thread], sessions: [session], projectAliases: { "pomo-wt": "pomo" } },
    agents: [],
    nowMs: NOW,
    loading: false,
    error: null,
  }),
}));
mock.module("../../sessions/SessionRefScreen.tsx", () => ({
  SessionRefScreen: ({ sessionRef }: { sessionRef: string }) => createElement("div", { "data-session-ref": sessionRef }, `Resolved ${sessionRef}`),
}));

const { ScoutContext } = await import("../../../scout/Provider.tsx");
const { ProjectsRail } = await import("../../projects/ProjectsRail.tsx");
const { ProjectScopeHeader } = await import("../../projects/ProjectsInbox.tsx");
const { projectsModule } = await import("./projects.tsx");
const { projectModule } = await import("./project.tsx");
const { projectSessionsModule } = await import("./project-sessions.tsx");
const { sessionModule } = await import("./session.tsx");
const { worktreesModule } = await import("./worktrees.tsx");
const { FOLLOW_PAGE } = await import("./panel-scope.ts");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");

const noop = () => undefined;
const model = { projects, threads: [thread], sessions: [session], projectAliases: {} };

function renderPanel(
  module: { Component: unknown },
  route: Route,
  config: Record<string, string> = {},
): string {
  const scout = { route, navigate: noop, agents: [], agentsLoaded: true };
  const props = { instanceId: "t", route, navigate: noop, config, setConfig: noop };
  // a head slot, so ModuleHead's chips draw inline (createPortal is mocked to pass its children through)
  const body = createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never));
  return renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, body));
}

const list: Route = { view: "agents-v2", indexView: "projects" };

describe("the project list panel", () => {
  test("the panel shows the state lens as plain words and leaves Search to the nav", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectsRail, { route: { view: "agents-v2" }, navigate: noop, variant: "panel", onStateFilter: noop }),
    );
    expect(html).toContain('data-variant="panel"');
    expect(html).toContain('aria-label="Project state"');
    for (const label of ["All", "Asking", "Live", "Idle"]) expect(html).toContain(`>${label}`);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("Search all Scout");
  });

  test("a row is one line: the name, then Asking or the age; the root is the tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectsRail, { route: { view: "agents-v2" }, navigate: noop, variant: "panel", onStateFilter: noop }),
    );
    expect(html).toMatch(/title="[^"]*workspace\/pomo"[^>]*aria-label="Open \/Pomo"/);
    expect(html).toMatch(/\/Pomo<\/span><span class="pi-projectState" data-state="needs">Asking</);
    expect(html).toMatch(/\/Talkie<\/span><time class="pi-projectAge">/);
    expect(html).not.toContain("worktree");
    expect(html).not.toContain(">Active<");
  });

  test("the lens offers only the states some project is in", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectsRail, { route: { view: "agents-v2" }, navigate: noop, variant: "panel", onStateFilter: noop, zeroPreview: true }),
    );
    expect(html).not.toContain("pi-railLenses");
  });

  test("the page rail is unchanged: no lens, Search all Scout kept", () => {
    const html = renderToStaticMarkup(createElement(ProjectsRail, { route: { view: "agents-v2" }, navigate: noop }));
    expect(html).toContain('data-variant="rail"');
    expect(html).not.toContain("pi-railLenses");
    expect(html).toContain("Search all Scout");
  });

  test("?state= narrows the list, on the page and in the panel", () => {
    const asking = renderToStaticMarkup(
      createElement(ProjectsRail, { route: { view: "agents-v2" }, navigate: noop, variant: "panel", stateFilter: "needs", onStateFilter: noop }),
    );
    expect(asking).toContain("/Pomo");
    expect(asking).not.toContain("/Talkie");
    expect(asking).not.toContain("/Quiet");

    const html = renderPanel(projectsModule, { ...list, stateFilter: "live" } as Route);
    expect(html).toContain("/Talkie");
    expect(html).not.toContain("/Pomo");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Live/);
  });

  test("a saved Host scope still reads only that machine's projects", () => {
    expect(projectsModule.scopes?.map((scope) => scope.key)).toEqual(["host"]);
    inboxReads.length = 0;
    renderPanel(projectsModule, { view: "terminal" }, { host: "remote" });
    expect(inboxReads.some((route) => "machineId" in route && route.machineId === "remote")).toBe(true);
    // unset, it keeps the page's machine
    inboxReads.length = 0;
    renderPanel(projectsModule, { ...list, machineId: "peer" } as Route);
    expect(inboxReads.every((route) => "machineId" in route && route.machineId === "peer")).toBe(true);
  });
});

describe("the project panel", () => {
  test("a project head without the page's facet tabs, which the panels replace", () => {
    const route = { view: "agents-v2" as const, projectSlug: "pomo" };
    const panel = renderToStaticMarkup(
      createElement(ProjectScopeHeader, { route, navigate: noop, slug: "pomo", model, mode: "overview", repoProject: null, variant: "panel" }),
    );
    const page = renderToStaticMarkup(
      createElement(ProjectScopeHeader, { route, navigate: noop, slug: "pomo", model, mode: "overview", repoProject: null }),
    );
    expect(panel).toContain("Pomo");
    expect(page).toContain(">Overview<");
    expect(panel).not.toContain(">Overview<");
    expect(panel).not.toContain(">Sessions<");
  });

  test("on the list it is where work is live: asking first, then live, no tile for a quiet project", () => {
    const html = renderPanel(projectModule, list, { project: FOLLOW_PAGE });
    expect(html).toContain("Live now");
    expect(html).toContain(">Asking<");
    expect(html).toContain("Ship the voice pass");
    expect(html.indexOf("/Pomo")).toBeGreaterThan(-1);
    expect(html.indexOf("/Pomo")).toBeLessThan(html.indexOf("/Talkie"));
    expect(html).not.toContain("/Quiet");
  });

  test("on a project page it follows the page, through a folded slug", () => {
    const html = renderPanel(projectModule, { view: "agents-v2", projectSlug: "pomo-wt" }, { project: FOLLOW_PAGE });
    expect(html).toContain("Pomo");
    expect(html).toContain("All projects");
  });
});

describe("the sessions and session panels", () => {
  test("on the list, every project's sessions; on a project page, its own", () => {
    const all = renderPanel(projectSessionsModule, list, { project: FOLLOW_PAGE });
    expect(all).toContain("Verify the sessions route");

    const talkie = renderPanel(projectSessionsModule, { view: "agents-v2", projectSlug: "talkie" }, { project: FOLLOW_PAGE });
    // no sessions: the project's agent threads, as the page showed
    expect(talkie).toContain("Ship the voice pass");
    expect(talkie).not.toContain("Verify the sessions route");
  });

  test("?harness= narrows the rows on the view's own route", () => {
    const html = renderPanel(projectSessionsModule, { view: "agents-v2", projectSlug: "pomo", harness: "claude" } as Route, { project: FOLLOW_PAGE });
    expect(html).not.toContain("Verify the sessions route");
  });

  test("the Session panel draws the page's selected session; nothing selected is quiet", () => {
    const route: Route = { view: "agents-v2", projectSlug: "pomo", indexView: "sessions", sessionId: "s1" };
    const html = renderPanel(sessionModule, route, { session: FOLLOW_PAGE });
    expect(html).toContain('data-session-ref="s1"');
    expect(html).toContain("Open full");

    expect(html).toContain(">Clear<");

    const pinned = renderPanel(sessionModule, { view: "agents-v2", projectSlug: "talkie" }, { session: "s1" });
    expect(pinned).toContain('data-session-ref="s1"');
    expect(pinned).toContain(">Unpin<");

    const none = renderPanel(sessionModule, { view: "agents-v2", projectSlug: "pomo" }, { session: FOLLOW_PAGE });
    expect(none).not.toContain("data-session-ref");
  });

  test("a native process ref is never drawn as a session", () => {
    const html = renderPanel(sessionModule, { view: "agents-v2", projectSlug: "pomo", sessionId: "native:process:42" }, { session: FOLLOW_PAGE });
    expect(html).not.toContain("data-session-ref");
  });
});

describe("the worktrees panel", () => {
  test("with no project chosen it asks for one", () => {
    expect(renderPanel(worktreesModule, list, { project: FOLLOW_PAGE })).toContain("Pick a project");
  });

  test("a project's repository, with Repos one step away in the head", () => {
    const html = renderPanel(worktreesModule, { view: "agents-v2", projectSlug: "pomo" }, { project: FOLLOW_PAGE });
    expect(html).toContain(">Repos<");
    expect(html).toContain("pi-projectOverview");
  });
});

describe("agents that follow the page", () => {
  test("the page's project keeps the agents in any of its checkouts; no project on the page keeps them all", async () => {
    const { scopeAgents } = await import("./agents.tsx");
    const agents = [
      { id: "root", projectRoot: "~/dev/pomo" },
      { id: "worktree", projectRoot: `${MAC_HOME_ROOT}/workstation-user/dev/pomo-wt/fix` },
      { id: "other", projectRoot: `${MAC_HOME_ROOT}/workstation-user/dev/talkie` },
      { id: "retired", projectRoot: "~/dev/pomo", retiredFromFleet: true },
    ] as never[];
    const roots = [`${MAC_HOME_ROOT}/workstation-user/dev/pomo`, `${MAC_HOME_ROOT}/workstation-user/dev/pomo-wt/fix`];
    const ids = (list: Array<{ id: string }>) => list.map((a) => a.id);
    expect(ids(scopeAgents(agents, { project: FOLLOW_PAGE }, roots))).toEqual(["root", "worktree"]);
    expect(ids(scopeAgents(agents, { project: FOLLOW_PAGE }, null))).toEqual(["root", "worktree", "other"]);
    // a pinned root still matches exactly, as before
    expect(ids(scopeAgents(agents, { project: `${MAC_HOME_ROOT}/workstation-user/dev/talkie` }))).toEqual(["other"]);
  });

  test("on a page scoped to one machine, only that machine's agents in the project", async () => {
    const { scopeAgents } = await import("./agents.tsx");
    const agents = [
      { id: "local", projectRoot: "/repo", authorityNodeId: "here" },
      { id: "remote", projectRoot: "/repo", authorityNodeId: "remote" },
    ] as never[];
    const ids = (list: Array<{ id: string }>) => list.map((a) => a.id);
    expect(ids(scopeAgents(agents, { project: FOLLOW_PAGE }, ["/repo"], "remote"))).toEqual(["remote"]);
    expect(ids(scopeAgents(agents, { project: FOLLOW_PAGE }, ["/repo"], null))).toEqual(["local", "remote"]);
    // a panel with its own project ignores the page's machine (Host is its own scope)
    expect(ids(scopeAgents(agents, { project: "/repo" }, null, "remote"))).toEqual(["local", "remote"]);
  });
});
