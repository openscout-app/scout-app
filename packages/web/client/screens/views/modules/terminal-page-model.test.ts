import { describe, expect, mock, test } from "bun:test";
import type * as ReactModule from "react";
import type { Agent, Route } from "../../../lib/types.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import {
  followsPageTerminal,
  pageModeRoute,
  pageTerminal,
  pageTerminalKey,
  panelTerminal,
  TERMINAL_SCOPE,
  TERMINAL_SCOPE_KEY,
  terminalMode,
} from "./terminal-page-model.ts";
import { targetIdentity, type TerminalRoute } from "./terminal-target-model.ts";

// The relay binding's module reaches react through the api client. As in
// lib/terminal-relay.test.ts: the relative .js path keeps bun on the real
// react (a bare "react" is mapped to its .d.ts by tsconfig paths).
// @ts-expect-error -- untyped path import; the cast restores the types
const React = (await import("../../../../node_modules/react/index.js")) as typeof ReactModule;
mock.module("react", () => React);
const { resolveAgentTerminalSurface, resolveTerminalRelayBinding } = await import("../../../lib/terminal-relay.ts");

/*
 * The Terminal view on a terminal's page: its panels follow the page's
 * terminal, mark Observe and Take over the way the terminal reads its route,
 * and keep one relay through re-renders. Pure, so it runs without a DOM.
 */

const agentRoute = (extra: Partial<TerminalRoute> = {}): TerminalRoute => ({ view: "terminal", agentId: "a1", ...extra });
const sessionRoute = (extra: Partial<TerminalRoute> = {}): TerminalRoute => ({ view: "terminal", terminalSessionId: "s1", terminalSurfaceKey: "tmux:work", ...extra });
const herdrRoute: TerminalRoute = { view: "terminal", terminalSessionId: "h1", terminalSurfaceKey: "herdr:main" };
const hostRoute: TerminalRoute = { view: "terminal", terminalBackend: "pty", terminalAgent: "claude", terminalTabId: "t1" };

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "a1",
    name: "Ada",
    handle: null,
    transport: "tmux",
    harness: "claude",
    harnessSessionId: "relay-a1-claude",
    cwd: "/tmp/a1",
    projectRoot: "/tmp/a1",
    ...overrides,
  } as Agent;
}

describe("the page's terminal", () => {
  test("a terminal deep link names one; bare /terminal and other pages name none", () => {
    expect(pageTerminal(agentRoute())).toEqual(agentRoute());
    expect(pageTerminal(sessionRoute())).toEqual(sessionRoute());
    expect(pageTerminal(herdrRoute)).toEqual(herdrRoute);
    expect(pageTerminal(hostRoute)).toEqual(hostRoute);
    expect(pageTerminal({ view: "terminal" })).toBeNull();
    expect(pageTerminal({ view: "terminal", mode: "takeover" })).toBeNull();
    expect(pageTerminal({ view: "views", viewId: "terminal" } as Route)).toBeNull();
    expect(pageTerminal({ view: "inbox" })).toBeNull();
  });

  test("a panel follows the page only when its scope says so; else it keeps its own pick, at rest", () => {
    const page: Route = agentRoute({ mode: "takeover" });
    expect(followsPageTerminal({ [TERMINAL_SCOPE_KEY]: FOLLOW_PAGE })).toBe(true);
    expect(panelTerminal({ terminal: FOLLOW_PAGE }, page)).toEqual({ following: true, target: page as TerminalRoute });
    expect(panelTerminal({ terminal: FOLLOW_PAGE }, { view: "terminal" })).toEqual({ following: true, target: null });
    // its own pick rests observed, whatever the page shows
    expect(panelTerminal({ agentId: "b2", mode: "takeover" }, page)).toEqual({
      following: false,
      target: { view: "terminal", agentId: "b2", mode: "observe" },
    });
    expect(panelTerminal({}, page)).toEqual({ following: false, target: null });
  });

  test("the scope offers the page's terminal, and nothing else to pick from", () => {
    expect(TERMINAL_SCOPE.key).toBe("terminal");
    expect(TERMINAL_SCOPE.followsPage).toBe("This page's terminal");
    expect(TERMINAL_SCOPE.useOptions()).toEqual([]);
  });
});

describe("how a terminal is open: one answer for the index, the details and the session panel", () => {
  test("an explicit mode wins for an agent or a session", () => {
    expect(terminalMode(agentRoute({ mode: "observe" }))).toBe("observe");
    expect(terminalMode(agentRoute({ mode: "takeover" }))).toBe("takeover");
    expect(terminalMode(sessionRoute({ mode: "observe" }))).toBe("observe");
    expect(terminalMode(sessionRoute({ mode: "takeover" }))).toBe("takeover");
  });

  test("an agent named with no mode is taken over, as its relay connects", () => {
    expect(terminalMode(agentRoute())).toBe("takeover");
    // the relay's control mode for the same route
    const binding = resolveTerminalRelayBinding({ agentId: "a1", agent: agent(), terminalSurface: resolveAgentTerminalSurface(agent()), relayUrl: "ws://relay" });
    expect(binding.controlMode).toBe("takeover");
  });

  test("a session with no mode is its summary; a herdr layout its projection; a host terminal is driven", () => {
    expect(terminalMode(sessionRoute())).toBeNull();
    expect(terminalMode(herdrRoute)).toBeNull();
    expect(terminalMode({ ...herdrRoute, mode: "takeover" })).toBeNull();
    expect(terminalMode(hostRoute)).toBe("takeover");
  });

  test("Observe and Take over open the same terminal in that mode; herdr and host have no modes", () => {
    expect(pageModeRoute(agentRoute({ mode: "observe" }), "takeover")).toEqual({ view: "terminal", agentId: "a1", mode: "takeover" });
    expect(pageModeRoute(sessionRoute(), "observe")).toEqual({ ...sessionRoute(), mode: "observe" });
    expect(pageModeRoute(herdrRoute, "takeover")).toBeNull();
    expect(pageModeRoute(hostRoute, "takeover")).toBeNull();
  });
});

describe("one relay through re-renders", () => {
  // what a following panel mounts its terminal under, and what the relay hook connects with
  const mounted = (route: TerminalRoute, a: Agent) => {
    const binding = resolveTerminalRelayBinding({
      agentId: route.agentId,
      agent: a,
      terminalSurface: resolveAgentTerminalSurface(a),
      relayUrl: "ws://relay",
      harness: a.harness,
      cwd: a.cwd,
      mode: route.mode,
    });
    return { key: pageTerminalKey(route), sessionKey: binding.relayStorageSessionKey, url: binding.scopedRelayUrl, controlMode: binding.controlMode };
  };

  test("a new route object for the same terminal, and a fresh roster, change nothing the relay connects with", () => {
    const first = mounted(agentRoute({ mode: "observe" }), agent());
    // every render derives the page's route anew, and the roster polls
    for (let i = 0; i < 5; i++) {
      expect(mounted({ ...agentRoute({ mode: "observe" }) }, agent({ updatedAt: i } as Partial<Agent>))).toEqual(first);
    }
  });

  test("a change of mode keeps the panel's mount; the terminal itself moves its relay to the new control mode", () => {
    const observing = mounted(agentRoute({ mode: "observe" }), agent());
    const taking = mounted(agentRoute({ mode: "takeover" }), agent());
    expect(taking.key).toBe(observing.key);
    expect(taking.controlMode).toBe("takeover");
    expect(taking.sessionKey).not.toBe(observing.sessionKey);
  });

  test("another terminal is another mount", () => {
    expect(pageTerminalKey(agentRoute())).not.toBe(pageTerminalKey({ view: "terminal", agentId: "b2" }));
    expect(pageTerminalKey(sessionRoute())).not.toBe(pageTerminalKey(sessionRoute({ terminalSurfaceKey: "tmux:other" })));
    // a host terminal is named by what it runs and its tab, which pick its relay session
    expect(pageTerminalKey(hostRoute)).not.toBe(pageTerminalKey({ ...hostRoute, terminalTabId: "t2" }));
    expect(pageTerminalKey(hostRoute)).not.toBe(pageTerminalKey({ ...hostRoute, terminalAgent: "codex" }));
    expect(pageTerminalKey(hostRoute)).toBe(pageTerminalKey({ ...hostRoute }));
  });

  test("anything but a host terminal mounts as the panel's own pick does", () => {
    for (const route of [agentRoute(), sessionRoute({ mode: "observe" }), herdrRoute]) {
      expect(pageTerminalKey(route)).toBe(targetIdentity(route));
    }
    expect(pageTerminalKey(null)).toBe("");
  });

  test("following the page keeps the page's relay session; a picked terminal keeps its own, by panel", () => {
    const page = resolveTerminalRelayBinding({ agentId: "a1", agent: agent(), terminalSurface: resolveAgentTerminalSurface(agent()), relayUrl: "ws://relay", mode: "takeover" });
    const picked = resolveTerminalRelayBinding({ agentId: "a1", agent: agent(), terminalSurface: resolveAgentTerminalSurface(agent()), relayUrl: "ws://relay", mode: "takeover", scope: "terminal-session" });
    expect(page.relayStorageSessionKey).toBe("scout-tmux-a1-relay-a1-claude-takeover");
    expect(picked.relayStorageSessionKey).toBe("scout-tmux-a1-relay-a1-claude-takeover-terminal-session");
  });
});
