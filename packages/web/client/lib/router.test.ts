import { describe, expect, mock, test } from "bun:test";
import type * as ReactModule from "react";

// @ts-expect-error -- the relative .js path keeps bun's runtime resolution to the real react
// module; a bare "react" specifier would be hijacked by tsconfig `paths` to the .d.ts. The cast
// restores the proper types that the path import otherwise loses.
const React = (await import("../../node_modules/react/index.js")) as typeof ReactModule;

mock.module("react", () => React);

const {
  buildScopePath,
  preserveLocationSearch,
  SCOPE_PATH_PREFIX,
  SCOPE_ROUTE_SEGMENTS,
} = await import("../scope/paths.ts");
const { clearRouteMachineScope, canonicalHrefForRoute, routeFromUrl, routeKey, routePath, setRouteMachineScope } = await import("./router.ts");
const { normalizeRoute } = await import("./synthetic-agent-routing.ts");
const { isProjectsPage } = await import("../screens/views/modules/projects-model.ts");
const { formatTerminalSurfaceId } = await import("@openscout/protocol");
const surfaceId = (backend: string, hostSession: string) => formatTerminalSurfaceId({ backend, hostSession });
const { resolveRoutedSessionId, resolveSelectedSessionId, sortSessionsByRecency } = await import("./session-catalog.ts");

describe("scope route parsing", () => {
  const origin = "http://127.0.0.1:43120";

  test("feedback has a direct settings route", () => {
    expect(routeFromUrl(`${origin}/settings/feedback`)).toEqual({ view: "settings", section: "feedback" });
    expect(routePath({ view: "settings", section: "feedback" })).toBe("/settings/feedback");
  });

  test("work embed keeps work identity and machine scope", () => {
    expect(routeFromUrl(`${origin}/embed/work?workId=work-review&machineId=machine-a`)).toEqual({
      view: "work", workId: "work-review", machineId: "machine-a",
    });
  });

  test("scope lanes routes map to ops lanes", () => {
    expect(routeFromUrl(`${origin}${SCOPE_PATH_PREFIX}`)).toEqual({
      view: "ops",
      mode: "lanes",
    });
    expect(routeFromUrl(`${origin}${buildScopePath(SCOPE_ROUTE_SEGMENTS.lanes)}`)).toEqual({
      view: "ops",
      mode: "lanes",
    });
  });

  test("legacy scout-prefixed routes still parse", () => {
    expect(routeFromUrl(`${origin}/scout/sessions/sess-legacy`)).toEqual({
      view: "sessions",
      sessionId: "sess-legacy",
    });
  });

  test("legacy scout-prefixed routes canonicalize to /scope/*", () => {
    expect(canonicalHrefForRoute("/scout/sessions/sess-legacy", "", "")).toBe(
      "/scope/sessions/sess-legacy",
    );
    expect(canonicalHrefForRoute("/scout", "", "")).toBe("/scope");
    expect(canonicalHrefForRoute("/scout/tail", "?q=codex", "")).toBe("/scope/tail?q=codex");
    // Already-canonical scope URLs are left alone.
    expect(canonicalHrefForRoute("/scope/sessions/sess-legacy", "", "")).toBeNull();
  });

  test("trailing slashes canonicalize without a redirect round-trip", () => {
    // The canonical router owns slash normalization (this used to ping-pong
    // against a second redirect in the retired router layer).
    expect(canonicalHrefForRoute("/projects/", "", "")).toBe("/projects");
    expect(canonicalHrefForRoute("/fleet/", "", "")).toBe("/");
    expect(canonicalHrefForRoute("/projects", "", "")).toBeNull();
  });

  test("bare /projects opens the Projects page; the agent feed is /agents", () => {
    for (const url of ["/projects", "/projects/"]) {
      const route = routeFromUrl(`http://127.0.0.1:43120${url}`);
      expect(route).toEqual({ view: "agents-v2", indexView: "projects" });
      expect(isProjectsPage(route)).toBe(true);
      expect(routePath(route)).toBe("/projects");
    }
    // an old /projects?view=agents link is the feed, and its canonical path is /agents
    const activity = routeFromUrl("http://127.0.0.1:43120/projects?view=agents");
    expect(isProjectsPage(activity)).toBe(false);
    expect(routePath(activity)).toBe("/agents");
    // a route built in code with no index view is the feed, as everywhere else
    expect(routePath({ view: "agents-v2" })).toBe("/agents");
    expect(routePath({ view: "agents-v2", indexView: "sessions" })).toBe("/projects?view=sessions");
    // legacy agents paths keep landing on the feed
    for (const url of ["/agents", "/agents-v2", "/agents.deprecated"]) {
      expect(isProjectsPage(routeFromUrl(`http://127.0.0.1:43120${url}`))).toBe(false);
    }
    // an old /projects?select= link is the feed's peek
    expect(routeFromUrl("http://127.0.0.1:43120/projects?select=hudson.main")).toEqual({
      view: "agents-v2",
      selectedAgentId: "hudson.main",
    });
  });

  test("the Projects page's preview lives in the URL: a PR, or a worktree, and a file in it", () => {
    const pr = routeFromUrl("http://127.0.0.1:43120/projects/openscout?pr=1878&file=packages%2Fweb%2Fa.ts");
    expect(pr).toEqual({ view: "agents-v2", projectSlug: "openscout", pr: 1878, file: "packages/web/a.ts" });
    expect(routePath(pr)).toBe("/projects/openscout?pr=1878&file=packages%2Fweb%2Fa.ts");
    const wt = routeFromUrl("http://127.0.0.1:43120/projects/openscout?worktree=%2Fdev%2Fdemo-app");
    expect(wt).toEqual({ view: "agents-v2", projectSlug: "openscout", worktree: "/dev/demo-app" });
    expect(routePath(wt)).toBe("/projects/openscout?worktree=%2Fdev%2Fdemo-app");
    // a file alone, or a PR that is no number, is no preview
    expect(routeFromUrl("http://127.0.0.1:43120/projects/openscout?file=a.ts")).toEqual({ view: "agents-v2", projectSlug: "openscout" });
    expect(routeFromUrl("http://127.0.0.1:43120/projects/openscout?pr=x")).toEqual({ view: "agents-v2", projectSlug: "openscout" });
    // a selected session is the preview; a stray PR is not written beside it
    expect(routePath({ view: "agents-v2", projectSlug: "openscout", sessionId: "codex:s1", pr: 3 })).toBe("/projects/openscout/sessions/codex%3As1");
  });

  test("scope tail and sessions routes round-trip", () => {
    const tailRoute = routeFromUrl(`${origin}${buildScopePath(SCOPE_ROUTE_SEGMENTS.tail, { tailQuery: "codex" })}`);
    expect(tailRoute).toEqual({
      view: "ops",
      mode: "tail",
      tailQuery: "codex",
    });

    expect(routeFromUrl(`${origin}${buildScopePath(SCOPE_ROUTE_SEGMENTS.sessions)}`)).toEqual({
      view: "sessions",
    });

    expect(routeFromUrl(`${origin}${buildScopePath(SCOPE_ROUTE_SEGMENTS.sessions, { sessionId: "sess-1" })}`)).toEqual({
      view: "sessions",
      sessionId: "sess-1",
    });
  });

  test("scope agents maps to the agents directory", () => {
    expect(routeFromUrl(`${origin}${buildScopePath(SCOPE_ROUTE_SEGMENTS.agents)}`)).toEqual({
      view: "agents-v2",
    });
  });

  test("preserveLocationSearch carries only whitelisted global params", () => {
    // Whitelisted feature-flag keys follow the navigation…
    expect(preserveLocationSearch("/scope", "?ffBundle=scope-instrument&no-ops"))
      .toBe("/scope?ffBundle=scope-instrument&no-ops=");
    expect(preserveLocationSearch("/scope/tail?q=codex", "?ffBundle=scope-instrument"))
      .toBe("/scope/tail?q=codex&ffBundle=scope-instrument");
    expect(preserveLocationSearch("/mesh", "?ff.ops.control=off&ffAudience=power"))
      .toBe("/mesh?ff.ops.control=off&ffAudience=power");
    // …route-local params (layout, select, tab, q) never leak across…
    expect(preserveLocationSearch("/scope", "?ffBundle=scope-instrument&layout=grid"))
      .toBe("/scope?ffBundle=scope-instrument");
    expect(preserveLocationSearch("/messages", "?tab=observe&q=thread-1&select=a-1"))
      .toBe("/messages");
    // …and machineId is not whitelisted: it propagates only via the
    // MACHINE_SCOPED_VIEWS route rules, so generic preservation drops it.
    expect(preserveLocationSearch("/projects/pomo/sessions/s1", "?select=pomo.main&machineId=node-a"))
      .toBe("/projects/pomo/sessions/s1");
  });

  test("preserveLocationSearch keeps the beside columns while you stay in Comms", () => {
    // `open` names the conversations kept beside the Comms stage. It follows a
    // navigation from one conversation to the next on any /messages path…
    expect(preserveLocationSearch("/messages/chn-b", "?open=c%3Achn-a&view=canvas"))
      .toBe("/messages/chn-b?open=c%3Achn-a");
    expect(preserveLocationSearch("/messages/agent/agent-2?thread=chn-b", "?open=c%3Achn-a"))
      .toBe("/messages/agent/agent-2?thread=chn-b&open=c%3Achn-a");
    // …and stays behind when you leave the surface.
    expect(preserveLocationSearch("/scope", "?open=c%3Achn-a")).toBe("/scope");
    expect(preserveLocationSearch("/messagesx", "?open=c%3Achn-a")).toBe("/messagesx");
  });

  test("a link to a room or a message keeps its address through canonicalization", () => {
    // The room surface owns ?channel=, ?message= and ?space= on /rooms; the
    // canonicalizer must leave them for it to read on load.
    expect(canonicalHrefForRoute("/rooms", "?channel=chn-a&message=m-1", "")).toBeNull();
    expect(canonicalHrefForRoute("/rooms", "?space=team&channel=chn-a", "")).toBeNull();
    expect(preserveLocationSearch("/rooms", "?channel=chn-a&message=m-1&tab=x"))
      .toBe("/rooms?channel=chn-a&message=m-1");
    // A Slack room keeps its place, so a reload stays in Slack.
    expect(canonicalHrefForRoute("/rooms", "?source=slack&channel=C5T1RA2RZ", "")).toBeNull();
    // All channels also keeps its active provider through canonicalization.
    expect(canonicalHrefForRoute("/rooms", "?source=all&provider=slack&space=slack%3AT033DG5M6&channel=C5T1RA2RZ", "")).toBeNull();
    // …and they mean nothing anywhere else.
    expect(preserveLocationSearch("/messages", "?channel=chn-a&message=m-1")).toBe("/messages");
    expect(preserveLocationSearch("/messages", "?source=slack")).toBe("/messages");
    expect(preserveLocationSearch("/messages", "?provider=slack")).toBe("/messages");
  });

  test("sessions route stays under /scope when the browser is in the scope namespace", () => {
    expect(routePath({ view: "sessions" }, "/scope/lanes")).toBe("/scope/sessions");
    expect(routePath({ view: "sessions" }, "/scope/sessions")).toBe("/scope/sessions");
    expect(routePath({ view: "sessions" }, "/sessions")).toBe("/sessions");
  });
});

describe("agents route parsing", () => {
  test("flight observe routes preserve explicit session and split selection", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/flights/flight-1/observe?session=session-2&compare=session-1",
    );

    expect(route).toEqual({
      view: "sessions",
      flightId: "flight-1",
      sessionId: "session-2",
      compareSessionId: "session-1",
    });
    expect(routePath(route)).toBe(
      "/flights/flight-1/observe?session=session-2&compare=session-1",
    );
  });

  test("legacy conversations path canonicalizes to messages", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/conversations")).toEqual({
      view: "messages",
    });
    expect(routePath({ view: "messages" })).toBe("/messages");
  });

  test("agent chat routes preserve opaque chat ids", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/openscout-6.main.mini/c/c.openscout-chat");

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "openscout-6.main.mini",
      conversationId: "c.openscout-chat",
      tab: "message",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini/c/c.openscout-chat");
  });

  test("project agent session resource routes preserve session focus", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/projects/scope/agents/scope.main.arts-mac-mini-local/sessions/019efa89-4392-72f1-af6c-860951059bcb",
    );

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "scope.main.arts-mac-mini-local",
      projectSlug: "scope",
      sessionId: "019efa89-4392-72f1-af6c-860951059bcb",
    });
    expect(routePath(route)).toBe(
      "/projects/scope/agents/scope.main.arts-mac-mini-local/sessions/019efa89-4392-72f1-af6c-860951059bcb",
    );
  });

  test("deprecated agents-v2 message hash routes open the message tab and serialize canonically", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/agents-v2/scope.main.arts-mac-mini-local#msg-msg-mqtjmvqd-n734dq",
    );

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "scope.main.arts-mac-mini-local",
      tab: "message",
    });
    expect(routePath(route)).toBe(
      "/agents/scope.main.arts-mac-mini-local?tab=message",
    );
  });

  test("machine-scoped routes round-trip through URLs", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/fleet?machineId=node-b")).toEqual({
      view: "inbox",
      machineId: "node-b",
    });
    expect(routePath({ view: "inbox", machineId: "node-b" })).toBe("/?machineId=node-b");

    expect(routeFromUrl("http://127.0.0.1:43120/mesh?machineId=node-b")).toEqual({
      view: "mesh",
      machineId: "node-b",
    });
    expect(routePath({ view: "mesh", machineId: "node-b" })).toBe("/network?machineId=node-b");

    expect(routeFromUrl("http://127.0.0.1:43120/mesh-ops/wi-1?machineId=node-b")).toEqual({
      view: "mesh-ops",
      itemId: "wi-1",
      machineId: "node-b",
    });
    expect(routePath({ view: "mesh-ops", itemId: "wi-1", machineId: "node-b" })).toBe(
      "/mesh-ops/wi-1?machineId=node-b",
    );

    expect(routeFromUrl("http://127.0.0.1:43120/work/work-1?machineId=node-b")).toEqual({
      view: "work",
      workId: "work-1",
      machineId: "node-b",
    });
    expect(routePath({ view: "work", workId: "work-1", machineId: "node-b" })).toBe(
      "/work/work-1?machineId=node-b",
    );

    expect(routeFromUrl(
      "http://127.0.0.1:43120/follow?view=chat&workId=work-1&machineId=node-b",
    )).toEqual({
      view: "follow",
      preferredView: "chat",
      workId: "work-1",
      machineId: "node-b",
    });
    expect(routePath({
      view: "follow",
      preferredView: "chat",
      workId: "work-1",
      machineId: "node-b",
    })).toBe("/follow?view=chat&workId=work-1&machineId=node-b");

    expect(routeFromUrl("http://127.0.0.1:43120/providers?machineId=node-b")).toEqual({
      view: "harnesses",
      machineId: "node-b",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/harnesses?machineId=node-b")).toEqual({
      view: "harnesses",
      machineId: "node-b",
    });
    expect(routePath({ view: "harnesses", machineId: "node-b" })).toBe("/providers?machineId=node-b");
  });

  test("machine scope composes with existing route query params", () => {
    const agentRoute = routeFromUrl("http://127.0.0.1:43120/agents/hudson.main?tab=observe&machineId=node-b");
    expect(agentRoute).toEqual({
      view: "agents-v2",
      agentId: "hudson.main",
      tab: "observe",
      machineId: "node-b",
    });
    expect(routePath(agentRoute)).toBe("/agents/hudson.main?tab=observe&machineId=node-b");

    const conversationRoute = routeFromUrl("http://127.0.0.1:43120/c/c.hudson-chat?compose=ask&machineId=node-b");
    expect(conversationRoute).toEqual({
      view: "conversation",
      conversationId: "c.hudson-chat",
      machineId: "node-b",
    });
    expect(routePath(conversationRoute)).toBe("/c/c.hudson-chat?machineId=node-b");

    // Route unification retired filter/sort: legacy params are dropped, but the
    // machine scope still composes with the conversation route.
    const messagesRoute = routeFromUrl(
      "http://127.0.0.1:43120/messages/c.font-studio?filter=channel&sort=unread&machineId=node-b",
    );
    expect(messagesRoute).toEqual({
      view: "messages",
      conversationId: "c.font-studio",
      machineId: "node-b",
    });
    expect(routePath(messagesRoute)).toBe("/messages/c.font-studio?machineId=node-b");
  });

  test("machine scope helpers set and explicitly clear scoped routes", () => {
    expect(setRouteMachineScope({ view: "agents-v2" }, "node-b")).toEqual({
      view: "agents-v2",
      machineId: "node-b",
    });
    expect(routePath(clearRouteMachineScope({ view: "agents-v2", machineId: "node-b" }))).toBe("/agents");
    expect(setRouteMachineScope({ view: "settings" }, "node-b")).toEqual({ view: "settings" });
  });

  test("observe deep links preserve the explicit observe tab", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/openscout-6.main.mini/c/c.openscout-chat?tab=observe");

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "openscout-6.main.mini",
      conversationId: "c.openscout-chat",
      tab: "observe",
    });
    expect(routePath(route)).toBe("/agents/openscout-6.main.mini/c/c.openscout-chat?tab=observe");
  });

  test("synthetic agent observe links normalize to session observe", () => {
    const route = normalizeRoute(
      routeFromUrl(
        "http://127.0.0.1:43120/agents/native%3Aclaude%3A1e753cef-92ae-4e22-a365-0f5d23a07652?tab=observe",
      ),
    );

    expect(route).toEqual({
      view: "sessions",
      sessionId: "1e753cef-92ae-4e22-a365-0f5d23a07652",
    });
    expect(routePath(route)).toBe(
      "/sessions/1e753cef-92ae-4e22-a365-0f5d23a07652",
    );
  });


  test("agent-scoped session routes round-trip", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/agents/hudson.main/sessions/codex-thread-1");

    expect(route).toEqual({
      view: "agents-v2",
      agentId: "hudson.main",
      sessionId: "codex-thread-1",
    });
    expect(routePath(route)).toBe("/agents/hudson.main/sessions/codex-thread-1");
  });

  test("standalone session routes carry agent context as quiet query metadata", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/sessions/codex-thread-1?agentId=hudson.main");

    expect(route).toEqual({
      view: "sessions",
      sessionId: "codex-thread-1",
      agentId: "hudson.main",
    });
    expect(routePath(route)).toBe("/sessions/codex-thread-1?agentId=hudson.main");
    if (route.view !== "sessions") throw new Error("expected a sessions route");
    expect(routePath({ ...route, machineId: "node-b" })).toBe(
      "/sessions/codex-thread-1?agentId=hudson.main&machineId=node-b",
    );
  });

  test("follow routes preserve Scout ids and preferred view", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/follow?view=tail&flightId=flight-1&invocationId=inv-1&conversationId=c.hudson-chat&workId=work-1&targetAgentId=hudson.main",
    );

    expect(route).toEqual({
      view: "follow",
      preferredView: "tail",
      flightId: "flight-1",
      invocationId: "inv-1",
      conversationId: "c.hudson-chat",
      workId: "work-1",
      targetAgentId: "hudson.main",
    });
    expect(routePath(route)).toBe(
      "/follow?view=tail&flightId=flight-1&invocationId=inv-1&conversationId=c.hudson-chat&workId=work-1&targetAgentId=hudson.main",
    );
  });

  test("tail routes preserve an optional focus query", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/ops/tail?q=019ddb1b-test-thread");

    expect(route).toEqual({
      view: "ops",
      mode: "tail",
      tailQuery: "019ddb1b-test-thread",
    });
    expect(routePath(route)).toBe("/ops/tail?q=019ddb1b-test-thread");
  });

  test("retired overview and world routes land on Control without leaking query params", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/ops/week?source=live")).toEqual({ view: "ops", mode: "mission" });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/world?source=realtime")).toEqual({ view: "ops", mode: "mission" });
    expect(routePath(routeFromUrl("http://127.0.0.1:43120/ops/week?source=live"))).toBe("/ops/control");
    expect(routeFromUrl("http://127.0.0.1:43120/ops/lanes?source=live")).not.toHaveProperty("source");
  });
  test("retired overview, world, and fleet aliases canonicalize to Control", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/ops/week?data=team")).toEqual({ view: "ops", mode: "mission" });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/overview")).toEqual({ view: "ops", mode: "mission" });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/world")).toEqual({ view: "ops", mode: "mission" });
    expect(routeFromUrl("http://127.0.0.1:43120/embed/world")).toEqual({ view: "ops", mode: "mission" });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/fleet")).toEqual({ view: "ops", mode: "mission" });
    expect(routePath({ view: "ops", mode: "world" })).toBe("/ops/control");
    expect(routeFromUrl("http://127.0.0.1:43120/ops/lanes?data=team")).not.toHaveProperty("dataset");
  });

  test("Lanes lives at /sessions/lanes, and the old /ops/lanes still opens it", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/sessions/lanes")).toEqual({ view: "ops", mode: "lanes" });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/lanes")).toEqual({ view: "ops", mode: "lanes" });
    expect(routeFromUrl("http://127.0.0.1:43120/sessions/lanes?no-ops")).toEqual({ view: "ops", mode: "lanes" });
    // a session id still opens that session; only the bare /sessions/lanes is Lanes
    expect(routeFromUrl("http://127.0.0.1:43120/sessions/lanes-1")).toMatchObject({ view: "sessions", sessionId: "lanes-1" });
    const remote = routeFromUrl(
      "http://127.0.0.1:43120/sessions/hosts/mini/session%3Acodex%3Asession-mueacotq-vxcfg1?machineId=mach-ignored",
    );
    expect(remote).toEqual({
      view: "sessions",
      sessionId: "session:codex:session-mueacotq-vxcfg1",
      hostLabel: "mini",
    });
    expect(routePath(remote)).toBe("/sessions/hosts/mini/session%3Acodex%3Asession-mueacotq-vxcfg1");
    expect(routeFromUrl("http://127.0.0.1:43120/sessions/hosts")).toEqual({ view: "sessions" });
    expect(routeFromUrl("http://127.0.0.1:43120/sessions/hosts/mini")).toEqual({ view: "sessions" });
    expect(routePath({ view: "ops", mode: "lanes" })).toBe("/sessions/lanes");
  });

  test("Lanes keeps the lane its Lane panel reads: ?sessionId= and ?targetAgentId= round-trip", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/sessions/lanes?sessionId=native%3Acodex%3A019a");
    expect(route).toEqual({ view: "ops", mode: "lanes", sessionId: "native:codex:019a" });
    expect(routePath(route)).toBe("/sessions/lanes?sessionId=native%3Acodex%3A019a");
    expect(routePath(routeFromUrl("http://127.0.0.1:43120/ops/lanes?agentId=scout.ada"))).toBe("/sessions/lanes?targetAgentId=scout.ada");
    // retired world floor redirects to Control without leaking session selection
    expect(routePath({ view: "ops", mode: "world", sessionId: "s1" })).toBe("/ops/control");
  });

  test("agent lanes bypass the broad ops feature gate", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/ops/lanes?no-ops")).toEqual({
      view: "ops",
      mode: "lanes",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/control?no-ops")).toEqual({
      view: "inbox",
    });
  });

  test("terminal routes tolerate trailing punctuation on mode deep links", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/terminal/hero.master?mode=takeover.")).toEqual({
      view: "terminal",
      agentId: "hero.master",
      mode: "takeover",
    });
  });

  test("terminal routes preserve registered session surface deep links", () => {
    const route = routeFromUrl("http://127.0.0.1:43120/terminal?session=ts.123&surface=zellij%3Ascout-zj&mode=observe");

    expect(route).toEqual({
      view: "terminal",
      terminalSessionId: "ts.123",
      terminalSurfaceKey: surfaceId("zellij", "scout-zj"),
      mode: "observe",
    });
    expect(routePath(route)).toBe("/terminal/zellij/scout-zj?mode=observe");
  });

  test("terminal routes support backend/session path deep links", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/terminal/tmux/relay-atelier-card-w-eury8m-master-arts-mac-mini-local-claude?mode=takeover",
    );

    expect(route).toEqual({
      view: "terminal",
      terminalSurfaceKey: surfaceId("tmux", "relay-atelier-card-w-eury8m-master-arts-mac-mini-local-claude"),
      mode: "takeover",
    });
    expect(routePath(route)).toBe(
      "/terminal/tmux/relay-atelier-card-w-eury8m-master-arts-mac-mini-local-claude?mode=takeover",
    );
  });

  test("terminal routes support fresh backend tabs", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/terminal/new?backend=zellij&agent=codex&name=scout-zj-tab-1&tab=tab-1&socketDir=/tmp/z",
    );

    expect(route).toEqual({
      view: "terminal",
      terminalBackend: "zellij",
      terminalAgent: "codex",
      terminalSessionName: "scout-zj-tab-1",
      terminalTabId: "tab-1",
      zellijSocketDir: "/tmp/z",
    });
    expect(routePath(route)).toBe(
      "/terminal/new?backend=zellij&agent=codex&name=scout-zj-tab-1&tab=tab-1&socketDir=%2Ftmp%2Fz",
    );
  });

  test("ops issues route accepts error-oriented aliases", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/ops/advisor")).toEqual({
      view: "ops",
      mode: "advisor",
    });
    // Legacy slug — the surface was never a plan reader.
    expect(routeFromUrl("http://127.0.0.1:43120/ops/plan")).toEqual({
      view: "ops",
      mode: "advisor",
    });
    // Ops › In flight replaced Host Advisor: its own address, the old ones still land
    expect(routeFromUrl("http://127.0.0.1:43120/ops/in-flight")).toEqual({
      view: "ops",
      mode: "advisor",
    });
    expect(routePath({ view: "ops", mode: "advisor" })).toBe("/ops/in-flight");
    expect(routePath({ view: "ops", mode: "advisor", planDocumentId: "plan-1" })).toBe("/ops/in-flight?plan=plan-1");
    expect(routeFromUrl("http://127.0.0.1:43120/ops/advisor?plan=plan-1")).toEqual({
      view: "ops",
      mode: "advisor",
      planDocumentId: "plan-1",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/issues")).toEqual({
      view: "ops",
      mode: "issues",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/ops/errors")).toEqual({
      view: "ops",
      mode: "issues",
    });
    expect(routePath({ view: "ops", mode: "issues" })).toBe("/ops/issues");
  });

  test("messages index route round-trips", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/messages")).toEqual({
      view: "messages",
    });
    expect(routePath({ view: "messages" })).toBe("/messages");
  });

  test("search route round-trips", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/search")).toEqual({
      view: "search",
    });
    expect(routePath({ view: "search" })).toBe("/search");
    expect(routeFromUrl("http://127.0.0.1:43120/search/knowledge")).toEqual({
      view: "search",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/search/indexer")).toEqual({
      view: "search",
      mode: "indexer",
    });
    expect(routePath({ view: "search", mode: "knowledge" })).toBe("/search");
    expect(routePath({ view: "search", mode: "indexer" })).toBe("/search/indexer");
  });

  test("rooms keeps surface selectors in the query without remounting the shell", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/rooms")).toEqual({ view: "rooms" });
    expect(routeFromUrl("http://127.0.0.1:43120/rooms?channel=chn-1")).toEqual({ view: "rooms" });
    expect(routePath({ view: "rooms" })).toBe("/rooms");
    expect(routePath({
      view: "rooms",
      source: "slack",
      space: "team",
      channelId: "C 1",
      messageId: "1700000000.000100",
    })).toBe("/rooms?source=slack&space=team&channel=C+1&message=1700000000.000100");
  });

  test("briefings routes round-trip", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/briefings")).toEqual({
      view: "briefings",
    });
    expect(routePath({ view: "briefings" })).toBe("/briefings");
    expect(routeFromUrl("http://127.0.0.1:43120/briefings/brief-42")).toEqual({
      view: "briefings",
      briefingId: "brief-42",
    });
    expect(routePath({ view: "briefings", briefingId: "brief-42" })).toBe(
      "/briefings/brief-42",
    );
    // Encoded ids survive the round trip — parse and serialization must agree
    // on decoding.
    expect(routeFromUrl("http://127.0.0.1:43120/briefings/b%2F1")).toEqual({
      view: "briefings",
      briefingId: "b/1",
    });
    expect(routePath({ view: "briefings", briefingId: "b/1" })).toBe(
      "/briefings/b%2F1",
    );
  });

  test("a board address keeps its scope id, slashes and colons included", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/boards")).toEqual({ view: "boards" });
    const route = { view: "boards" as const, boardId: "project:/repo/demo-app" };
    const path = routePath(route);
    expect(path).toBe("/boards/project%3A%2Frepo%2Fdemo-app");
    expect(routeFromUrl(`http://127.0.0.1:43120${path}`)).toEqual(route);
  });

  test("static view prefixes round-trip", () => {
    // Simple static views: URL and Route must round-trip exactly.
    for (const view of [
      "repos",
      "activity",
      "review",
    ] as const) {
      expect(routeFromUrl(`http://127.0.0.1:43120/${view}`)).toEqual({ view });
      expect(routePath({ view })).toBe(`/${view}`);
    }
    // The Network page is named Network in every user-facing surface, so
    // /network is canonical and /mesh stays a working alias for old links.
    expect(routeFromUrl("http://127.0.0.1:43120/network")).toEqual({ view: "mesh" });
    expect(routeFromUrl("http://127.0.0.1:43120/mesh")).toEqual({ view: "mesh" });
    expect(routePath({ view: "mesh" })).toBe("/network");

    expect(routeFromUrl("http://127.0.0.1:43120/providers")).toEqual({ view: "harnesses" });
    expect(routeFromUrl("http://127.0.0.1:43120/harnesses")).toEqual({ view: "harnesses" });
    expect(routePath({ view: "harnesses" })).toBe("/providers");
    // Removed legacy aliases still parse, but serialize to their canonical destinations.
    expect(routeFromUrl("http://127.0.0.1:43120/fleet")).toEqual({ view: "inbox" });
    expect(routePath({ view: "inbox" })).toBe("/");
    // A link to a Feed post: Home with that post expanded, kept in its own scroll memory.
    expect(routeFromUrl("http://127.0.0.1:43120/?post=post%3Aabc")).toEqual({ view: "inbox", post: "post:abc" });
    expect(routePath({ view: "inbox", post: "post:abc" })).toBe("/?post=post%3Aabc");
    expect(canonicalHrefForRoute("/", "?post=post%3Aabc", "")).toBeNull();
    expect(routeKey({ view: "inbox", post: "post:abc" })).not.toBe(routeKey({ view: "inbox" }));
    expect(routeFromUrl("http://127.0.0.1:43120/fleet?post=post%3Aabc")).toEqual({ view: "inbox" });
    expect(routeFromUrl("http://127.0.0.1:43120/conversations")).toEqual({ view: "messages" });
    expect(routePath({ view: "messages" })).toBe("/messages");
    // Dispatch/broker is retired in scout-app and canonicalizes to Control.
    expect(routeFromUrl("http://127.0.0.1:43120/dispatch")).toEqual({ view: "ops", mode: "mission" });
    expect(routeFromUrl("http://127.0.0.1:43120/broker")).toEqual({ view: "ops", mode: "mission" });
    expect(routePath({ view: "broker" })).toBe("/ops/control");
    expect(routeFromUrl("http://127.0.0.1:43120/dispatch?filter=delivered")).toEqual({
      view: "ops",
      mode: "mission",
    });
    expect(routePath({ view: "broker", filter: "failed" })).toBe("/ops/control");
    // /channels is a legacy alias onto the unified conversation route; it parses
    // but never serializes back — canonical form is /messages/<id>.
    expect(routeFromUrl("http://127.0.0.1:43120/channels/chan-1")).toEqual({
      view: "messages",
      conversationId: "chan-1",
    });
    expect(routePath({ view: "messages", conversationId: "chan-1" })).toBe("/messages/chan-1");
    expect(routeFromUrl("http://127.0.0.1:43120/channels")).toEqual({ view: "messages" });
    expect(routeFromUrl("http://127.0.0.1:43120/work/w-1")).toEqual({
      view: "work",
      workId: "w-1",
    });
    expect(routePath({ view: "work", workId: "w-1" })).toBe("/work/w-1");
    // Mesh Ops: bare index plus deep-linked item, mirroring /work.
    expect(routeFromUrl("http://127.0.0.1:43120/mesh-ops")).toEqual({ view: "mesh-ops" });
    expect(routePath({ view: "mesh-ops" })).toBe("/mesh-ops");
    expect(routeFromUrl("http://127.0.0.1:43120/mesh-ops/wi-1")).toEqual({
      view: "mesh-ops",
      itemId: "wi-1",
    });
    expect(routePath({ view: "mesh-ops", itemId: "wi-1" })).toBe("/mesh-ops/wi-1");
    // Encoded ids survive the round trip.
    expect(routeFromUrl("http://127.0.0.1:43120/mesh-ops/wi%2F1")).toEqual({
      view: "mesh-ops",
      itemId: "wi/1",
    });
    expect(routePath({ view: "mesh-ops", itemId: "wi/1" })).toBe("/mesh-ops/wi%2F1");
    // Bare /work is the Work view with no item picked.
    expect(routeFromUrl("http://127.0.0.1:43120/work")).toEqual({ view: "work", workId: "" });
    expect(routePath({ view: "work", workId: "" })).toBe("/work");
    expect(routeFromUrl("http://127.0.0.1:43120/settings/agents/a-1")).toEqual({
      view: "settings",
      section: "agents",
      agentId: "a-1",
    });
    expect(routePath({ view: "settings", section: "agents", agentId: "a-1" })).toBe(
      "/settings/agents/a-1",
    );
  });

  test("nested resource prefixes round-trip", () => {
    // Sessions surface: bare + session-scoped, both view "sessions".
    expect(routeFromUrl("http://127.0.0.1:43120/sessions")).toEqual({ view: "sessions" });
    expect(routePath({ view: "sessions" })).toBe("/sessions");
    expect(routeFromUrl("http://127.0.0.1:43120/sessions/sess-1")).toEqual({
      view: "sessions",
      sessionId: "sess-1",
    });
    expect(routePath({ view: "sessions", sessionId: "sess-1" })).toBe("/sessions/sess-1");
    // Percent-encoded session id survives the round trip.
    expect(routeFromUrl("http://127.0.0.1:43120/sessions/s%2F1")).toEqual({
      view: "sessions",
      sessionId: "s/1",
    });
    expect(routePath({ view: "sessions", sessionId: "s/1" })).toBe("/sessions/s%2F1");

    // Messages surface: bare + conversation-scoped, both view "messages".
    expect(routeFromUrl("http://127.0.0.1:43120/messages")).toEqual({ view: "messages" });
    expect(routePath({ view: "messages" })).toBe("/messages");
    expect(routeFromUrl("http://127.0.0.1:43120/messages/c.font-studio")).toEqual({
      view: "messages",
      conversationId: "c.font-studio",
    });
    expect(routePath({ view: "messages", conversationId: "c.font-studio" })).toBe(
      "/messages/c.font-studio",
    );
    expect(
      routeFromUrl(
        "http://127.0.0.1:43120/messages/agent/worker%2Fmain?thread=conv%2Fthread&machineId=node-a",
      ),
    ).toEqual({
      view: "messages",
      agentId: "worker/main",
      threadId: "conv/thread",
      machineId: "node-a",
    });
    expect(routePath({
      view: "messages",
      agentId: "worker/main",
      threadId: "conv/thread",
      machineId: "node-a",
    })).toBe(
      "/messages/agent/worker%2Fmain?thread=conv%2Fthread&machineId=node-a",
    );

    // Conversation detail (/c/{id}) and agent-info (/agent/{id}).
    expect(routeFromUrl("http://127.0.0.1:43120/c/c.hudson-chat")).toEqual({
      view: "conversation",
      conversationId: "c.hudson-chat",
    });
    expect(routePath({ view: "conversation", conversationId: "c.hudson-chat" })).toBe(
      "/c/c.hudson-chat",
    );
    expect(routeFromUrl("http://127.0.0.1:43120/agent/c.hudson-chat")).toEqual({
      view: "agent-info",
      conversationId: "c.hudson-chat",
    });
    expect(routePath({ view: "agent-info", conversationId: "c.hudson-chat" })).toBe(
      "/agent/c.hudson-chat",
    );
    // Percent-encoded conversation id round-trips through /c/$conversationId.
    expect(routeFromUrl("http://127.0.0.1:43120/c/c%2Fslash")).toEqual({
      view: "conversation",
      conversationId: "c/slash",
    });
    expect(routePath({ view: "conversation", conversationId: "c/slash" })).toBe("/c/c%2Fslash");

    // Follow: bare canonical form is view "follow".
    expect(routeFromUrl("http://127.0.0.1:43120/follow")).toEqual({ view: "follow" });
    expect(routePath({ view: "follow" })).toBe("/follow");

    // Terminal: bare + agent + backend/session path shapes, all view "terminal".
    expect(routeFromUrl("http://127.0.0.1:43120/terminal")).toEqual({ view: "terminal" });
    expect(routePath({ view: "terminal" })).toBe("/terminal");
    expect(routeFromUrl("http://127.0.0.1:43120/terminal/hero.master")).toEqual({
      view: "terminal",
      agentId: "hero.master",
    });
    expect(routePath({ view: "terminal", agentId: "hero.master" })).toBe("/terminal/hero.master");
    expect(routeFromUrl("http://127.0.0.1:43120/terminal/tmux/scout-zj")).toEqual({
      view: "terminal",
      terminalSurfaceKey: surfaceId("tmux", "scout-zj"),
    });
    expect(routePath({ view: "terminal", terminalSurfaceKey: surfaceId("tmux", "scout-zj") })).toBe(
      "/terminal/tmux/scout-zj",
    );

    // Project registry shapes — every /projects/* path parses to view "agents-v2".
    expect(routeFromUrl("http://127.0.0.1:43120/projects")).toEqual({ view: "agents-v2", indexView: "projects" });
    expect(routeFromUrl("http://127.0.0.1:43120/projects/lattices")).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
    });
    expect(routePath({ view: "agents-v2", projectSlug: "lattices" })).toBe("/projects/lattices");
    expect(routeFromUrl("http://127.0.0.1:43120/projects/lattices/agents")).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      indexView: "agents",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/projects/lattices/agents/lattices.main")).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      agentId: "lattices.main",
    });
    expect(
      routePath({ view: "agents-v2", projectSlug: "lattices", agentId: "lattices.main" }),
    ).toBe("/projects/lattices/agents/lattices.main");
    expect(
      routeFromUrl("http://127.0.0.1:43120/projects/lattices/agents/lattices.main/c/c.foo"),
    ).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      agentId: "lattices.main",
      conversationId: "c.foo",
      tab: "message",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/projects/lattices/sessions")).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      indexView: "sessions",
    });

    // Canonical /agents/* agent detail shapes — all view "agents-v2".
    expect(routeFromUrl("http://127.0.0.1:43120/agents")).toEqual({ view: "agents-v2" });
    expect(routeFromUrl("http://127.0.0.1:43120/agents/hudson.main")).toEqual({
      view: "agents-v2",
      agentId: "hudson.main",
    });
    expect(routePath({ view: "agents-v2", agentId: "hudson.main" })).toBe("/agents/hudson.main");

    // Legacy /agents-v2/* input parses to agents-v2 and serializes canonically to /agents.
    expect(routeFromUrl("http://127.0.0.1:43120/agents-v2/hudson.main")).toEqual({
      view: "agents-v2",
      agentId: "hudson.main",
    });
    expect(routeFromUrl("http://127.0.0.1:43120/agents-v2/sessions/sess-9")).toEqual({
      view: "agents-v2",
      sessionId: "sess-9",
    });

    // Legacy /agents.deprecated/* → agents-v2 (canonical /agents / /agents/:id).
    expect(routeFromUrl("http://127.0.0.1:43120/agents.deprecated")).toEqual({ view: "agents-v2" });
    expect(routePath({ view: "agents-v2" })).toBe("/agents");
    expect(routeFromUrl("http://127.0.0.1:43120/agents.deprecated/hudson.main")).toEqual({
      view: "agents-v2",
      agentId: "hudson.main",
    });
    expect(routePath({ view: "agents-v2", agentId: "hudson.main" })).toBe(
      "/agents/hudson.main",
    );
    expect(routeFromUrl("http://127.0.0.1:43120/agents.deprecated/hudson.main/c/c.foo")).toEqual({
      view: "agents-v2",
      agentId: "hudson.main",
      conversationId: "c.foo",
      tab: "message",
    });
    // The session-resource shape is a session observe surface, not agents-v2.
    expect(
      routeFromUrl("http://127.0.0.1:43120/agents.deprecated/hudson.main/sessions/sess-1"),
    ).toEqual({
      view: "sessions",
      agentId: "hudson.main",
      sessionId: "sess-1",
    });

    // ops and repo-diff views are not a function of the path prefix alone.
    // /ops/* can resolve to "inbox" when the ops gate is off or ?no-ops is set.
    expect(routeFromUrl("http://127.0.0.1:43120/ops/control?no-ops")).toEqual({ view: "inbox" });
    // /repo-diff without ?path falls through to the inbox default.
    expect(routeFromUrl("http://127.0.0.1:43120/repo-diff")).toEqual({ view: "inbox" });
  });

  test("messages route keeps conversationId and drops legacy filter/sort params", () => {
    const route = routeFromUrl(
      "http://127.0.0.1:43120/messages/c.font-studio?filter=channel&sort=unread",
    );
    expect(route).toEqual({ view: "messages", conversationId: "c.font-studio" });
    expect(routePath(route)).toBe("/messages/c.font-studio");
  });

  test("messages routes carry no query params of their own", () => {
    expect(routePath({ view: "messages" })).toBe("/messages");
    expect(routePath({ view: "messages", conversationId: "c.foo" })).toBe("/messages/c.foo");
  });

  test("project registry routes round-trip and old agents-v2 input serializes canonically", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/agents-v2")).toEqual({
      view: "agents-v2",
    });
    expect(routePath({ view: "agents-v2" })).toBe("/agents");
    // The project list owns /projects; the feed owns /agents; both round-trip.
    expect(routePath({ view: "agents-v2", indexView: "projects" })).toBe("/projects");
    expect(routeFromUrl("http://127.0.0.1:43120/projects?view=projects")).toEqual({ view: "agents-v2", indexView: "projects" });
    expect(routeFromUrl("http://127.0.0.1:43120/agents")).toEqual({ view: "agents-v2" });
    expect(routePath({ view: "agents-v2", indexView: "sessions" })).toBe("/projects?view=sessions");

    const scoped = routeFromUrl(
      "http://127.0.0.1:43120/projects/lattices/sessions?state=needs",
    );
    expect(scoped).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      stateFilter: "needs",
      indexView: "sessions",
    });
    expect(routeFromUrl(`http://127.0.0.1:43120${routePath(scoped)}`)).toEqual(scoped);

    const agent = routeFromUrl("http://127.0.0.1:43120/projects/lattices/agents/lattices.main/sessions/c.foo");
    expect(agent).toEqual({
      view: "agents-v2",
      agentId: "lattices.main",
      projectSlug: "lattices",
      sessionId: "c.foo",
    });
    expect(routePath(agent)).toBe("/projects/lattices/agents/lattices.main/sessions/c.foo");

    const session = routeFromUrl("http://127.0.0.1:43120/projects/lattices/sessions/c.foo");
    expect(session).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      indexView: "sessions",
      sessionId: "c.foo",
    });
    expect(routePath(session)).toBe("/projects/lattices/sessions/c.foo");

    const oldNoisySession = routeFromUrl(
      "http://127.0.0.1:43120/projects/lattices/sessions/c.foo?select=lattices.main",
    );
    expect(oldNoisySession).toEqual({
      view: "agents-v2",
      projectSlug: "lattices",
      indexView: "sessions",
      sessionId: "c.foo",
      selectedAgentId: "lattices.main",
    });
    expect(routePath(oldNoisySession)).toBe("/projects/lattices/sessions/c.foo");

    const selected = routeFromUrl(
      "http://127.0.0.1:43120/projects/hudson?select=grok.main",
    );
    expect(selected).toEqual({
      view: "agents-v2",
      projectSlug: "hudson",
      selectedAgentId: "grok.main",
    });
    expect(routePath(selected)).toBe("/projects/hudson?select=grok.main");
  });

  test("agent config tab routes round-trip and legacy definitions alias", () => {
    const configRoute = routeFromUrl("http://127.0.0.1:43120/agents/codex.main?tab=config");
    expect(configRoute).toEqual({
      view: "agents-v2",
      agentId: "codex.main",
      tab: "config",
    });
    expect(routePath(configRoute)).toBe("/agents/codex.main?tab=config");

    const legacyRoute = routeFromUrl("http://127.0.0.1:43120/agents.deprecated/hudson.main?tab=definitions");
    expect(legacyRoute).toEqual({
      view: "agents-v2",
      agentId: "hudson.main",
      tab: "config",
    });
    expect(routePath(legacyRoute)).toBe("/agents/hudson.main?tab=config");
  });

  test("agent configuration settings routes round-trip", () => {
    expect(routeFromUrl("http://127.0.0.1:43120/settings/agents")).toEqual({
      view: "settings",
      section: "agents",
    });
    expect(routePath({ view: "settings", section: "agents" })).toBe("/settings/agents");

    const detailRoute = routeFromUrl("http://127.0.0.1:43120/settings/agents/openscout-6.main.mini");
    expect(detailRoute).toEqual({
      view: "settings",
      section: "agents",
      agentId: "openscout-6.main.mini",
    });
    expect(routePath(detailRoute)).toBe("/settings/agents/openscout-6.main.mini");
  });
});

describe("session catalog selection", () => {
  const sessions = [
    {
      id: "active-session",
      startedAt: 300,
      cwd: "/repo",
    },
    {
      id: "routed-session",
      startedAt: 200,
      cwd: "/repo",
      surfaceSessionId: "tmux:routed",
    },
    {
      id: "scope-catalog-session",
      startedAt: 150,
      cwd: "/example/workstation-user/dev/scope",
      harness: "codex",
      surfaceSessionId: "relay-scope-live-arts-mac-mini-local-codex",
      harnessSessionId: "relay-scope-codex",
      runtimeSessionId: "runtime-scope-codex",
    },
    {
      id: "scope-claude-session",
      startedAt: 125,
      cwd: "/example/workstation-user/dev/scope",
      harness: "claude",
      surfaceSessionId: "relay-scope-live-arts-mac-mini-local-claude",
    },
    {
      id: "focused-session",
      startedAt: 100,
      cwd: "/repo",
    },
  ];

  test("normalizes routed surface ids to catalog session ids", () => {
    expect(resolveRoutedSessionId("tmux:routed", sessions)).toBe("routed-session");
    expect(resolveRoutedSessionId("missing-session", sessions)).toBeNull();
  });

  test("normalizes routed stable aliases to catalog session ids", () => {
    expect(resolveRoutedSessionId("relay-scope-codex", sessions)).toBe("scope-catalog-session");
    expect(resolveRoutedSessionId("runtime-scope-codex", sessions)).toBe("scope-catalog-session");
  });

  test("normalizes compact relay refs to matching harness surfaces", () => {
    expect(resolveRoutedSessionId("relay-scope-claude", sessions)).toBe("scope-claude-session");
    expect(resolveRoutedSessionId("relay-scope-codex", sessions)).toBe("scope-catalog-session");
  });

  test("prefers a valid routed session over stale focused and active sessions", () => {
    const sorted = sortSessionsByRecency(sessions, "active-session");

    expect(
      resolveSelectedSessionId(
        "agent-1",
        { agentId: "agent-1", sessionId: "focused-session" },
        "active-session",
        sorted,
        "relay-scope-codex",
      ),
    ).toBe("scope-catalog-session");
  });

  test("falls back to active session when routed session is invalid (no parallel focus)", () => {
    const sorted = sortSessionsByRecency(sessions, "active-session");

    expect(
      resolveSelectedSessionId(
        "agent-1",
        { agentId: "agent-1", sessionId: "focused-session" },
        "active-session",
        sorted,
        "missing-session",
      ),
    ).toBe("active-session");
  });
});


describe("Requests entry routing", () => {
  test("shell and native embed resolve to the same standalone entry", () => {
    expect(routeFromUrl("http://localhost:43122/inbox")).toEqual({ view: "requests" });
    // /requests is the Inbox's old address
    expect(routeFromUrl("http://localhost:43122/requests")).toEqual({ view: "requests" });
    expect(routeFromUrl("http://localhost:43122/embed/requests?profile=macos.requests")).toEqual({ view: "requests" });
    expect(routePath({ view: "requests" })).toBe("/inbox");
  });

  test("?request= is the open request, and round-trips", () => {
    expect(routeFromUrl("http://localhost:43122/requests?request=need%3Am1")).toEqual({ view: "requests", requestId: "need:m1" });
    expect(routeFromUrl("http://localhost:43122/requests?request=")).toEqual({ view: "requests" });
    expect(routeFromUrl("http://localhost:43122/requests?request=%20%20")).toEqual({ view: "requests" });
    expect(routeFromUrl("http://localhost:43122/embed/requests?profile=macos.requests&request=permission%3Ap")).toEqual({ view: "requests", requestId: "permission:p" });
    const path = routePath({ view: "requests", requestId: "tmux-host-permission:a/s" });
    expect(path).toBe("/inbox?request=tmux-host-permission%3Aa%2Fs");
    expect(routeFromUrl(`http://localhost:43122${path}`)).toEqual({ view: "requests", requestId: "tmux-host-permission:a/s" });
    // ?machineId= means nothing on Requests: it is not read and not written
    expect(routeFromUrl("http://localhost:43122/requests?machineId=mini")).toEqual({ view: "requests" });
  });
});

test("review URL falls back to inbox with the review flag disabled", () => {
  const previous = globalThis.window;
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {
      location: new URL("http://127.0.0.1:43120/review?ff.surface.review=off"),
      localStorage: { getItem: () => null },
    } });
    expect(routeFromUrl("http://127.0.0.1:43120/review")).toEqual({ view: "inbox" });
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = previous;
  }
});

test("Workspace and legacy Canvas links are retired to Feed in scout-app", () => {
  const origin = "http://127.0.0.1:43120";
  const previous = globalThis.window;
  const at = (href: string) => Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: {
    location: new URL(href, origin),
    localStorage: { getItem: () => null },
  } });
  try {
    at("/workspace?ff.surface.canvas=on");
    for (const path of ["/workspace", "/canvas", "/workspace/scout%20apps?end=1763060400000&hours=4"]) {
      expect(routeFromUrl(origin + path)).toEqual({ view: "inbox" });
    }
    expect(routePath({ view: "canvas" })).toBe("/");
  } finally {
    if (previous === undefined) Reflect.deleteProperty(globalThis, "window");
    else globalThis.window = previous;
  }
});
