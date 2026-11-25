import { describe, expect, test } from "bun:test";
import type { TerminalSessionRecord, TerminalSurface } from "@openscout/protocol";
import { surfaceKey, surfaceKeyFromParts } from "../../../lib/terminal-sessions.ts";
import type { Agent, TerminalSurfaceDescriptor } from "../../../lib/types.ts";
import {
  agentForSurface,
  attachCommandFor,
  attachCommandForSurface,
  clearTarget,
  drives,
  filterRows,
  panelStep,
  restingRoute,
  TARGET_KEYS,
  targetConfig,
  targetIdentity,
  targetKind,
  targetRoute,
  targetRows,
  type TerminalRoute,
} from "./terminal-target-model.ts";

function surface(backend: "tmux" | "zellij" | "herdr", sessionName: string, extra: Partial<TerminalSurface> = {}): TerminalSurface {
  return {
    backend,
    sessionName,
    paneId: null,
    attachCommand: [backend, "attach", sessionName],
    observeCommand: null,
    relay: { backend, sessionName },
    state: "live",
    ...extra,
  };
}

function session(id: string, surfaces: TerminalSurface[], updatedAt = 1, extra: Partial<TerminalSessionRecord> = {}): TerminalSessionRecord {
  return {
    id,
    harness: "claude",
    sourceSessionId: id,
    cwd: "",
    resumeCommand: "",
    surfaces,
    createdAt: 1,
    updatedAt,
    metadata: {},
    ...extra,
  };
}

function agent(id: string, extra: Partial<Agent> = {}): Agent {
  return {
    id,
    name: id,
    handle: null,
    harness: "claude",
    state: "idle",
    projectRoot: null,
    cwd: null,
    updatedAt: 1,
    transport: "tmux",
    project: null,
    branch: null,
    harnessSessionId: null,
    terminalSurface: null,
    conversationId: null,
    retiredFromFleet: false,
    ...extra,
  } as Agent;
}

const surfaceOf = (a: Agent): TerminalSurfaceDescriptor | null => a.terminalSurface;
const herdrKey = surfaceKey(surface("herdr", "dev"));
/** What herdr's "Open terminal" navigates to (HerdrSession.tsx herdrTerminalRoute). */
const herdrTerminal: TerminalRoute = { view: "terminal", terminalBackend: "herdr", terminalAgent: "shell", terminalTabId: "herdr-dev", terminalSessionName: "dev" };

/** Settings as a panel would hold them: cleared keys are dropped. */
const kept = (patch: Record<string, string>) => Object.fromEntries(Object.entries(patch).filter(([, v]) => v));

describe("target settings and routes", () => {
  test("no target is the picker", () => {
    expect(targetRoute({})).toBeNull();
    expect(targetRoute({ mode: "takeover" })).toBeNull();
  });

  test("an agent is observed, never taken over", () => {
    expect(targetRoute({ agentId: "a1" })).toEqual({ view: "terminal", agentId: "a1", mode: "observe" });
    expect(targetRoute({ agentId: "a1", mode: "nonsense" })?.mode).toBe("observe");
  });

  test("a session with no mode is its summary", () => {
    expect(targetRoute({ terminalSessionId: "s1", terminalSurfaceKey: "tmux:main" })).toEqual({
      view: "terminal",
      terminalSessionId: "s1",
      terminalSurfaceKey: "tmux:main",
    });
  });

  test("routes at rest survive the trip through settings", () => {
    const routes: TerminalRoute[] = [
      { view: "terminal", agentId: "a1", mode: "observe" },
      { view: "terminal", terminalSessionId: "s1", terminalSurfaceKey: "tmux:main", mode: "observe" },
      { view: "terminal", terminalSessionId: "s1", terminalSurfaceKey: "tmux:main" },
      { view: "terminal", terminalSessionId: "h1", terminalSurfaceKey: herdrKey },
    ];
    for (const route of routes) expect(targetRoute(kept(targetConfig(route)))).toEqual(route);
  });

  test("a takeover is never saved: it rests as observe", () => {
    expect(targetConfig({ view: "terminal", agentId: "a1", mode: "takeover" }).mode).toBe("observe");
    expect(targetConfig({ view: "terminal", terminalSessionId: "s1", terminalSurfaceKey: "tmux:main", mode: "takeover" }).mode).toBe("observe");
    // settings saved before this rule read the same way, so a reload drives nothing
    expect(targetRoute({ agentId: "a1", mode: "takeover" })).toEqual({ view: "terminal", agentId: "a1", mode: "observe" });
    expect(targetRoute({ terminalSessionId: "s1", terminalSurfaceKey: "tmux:main", mode: "takeover" })?.mode).toBe("observe");
  });

  test("a host terminal rests as the session it attached to", () => {
    const projection = targetRoute(kept(targetConfig(herdrTerminal)));
    expect(projection).toEqual({ view: "terminal", terminalSurfaceKey: surfaceKeyFromParts("herdr", "dev")! });
    expect(targetKind(projection!)).toBe("herdr");
    expect(targetConfig(herdrTerminal).terminalBackend).toBe("");
    // saved before this rule: the herdr terminal reads as its projection, a pty as nothing
    expect(targetRoute({ terminalBackend: "herdr", terminalAgent: "shell", terminalTabId: "herdr-dev", terminalSessionName: "dev" })).toEqual(projection);
    expect(targetRoute({ terminalBackend: "tmux", terminalSessionName: "main" })).toEqual({
      view: "terminal",
      terminalSurfaceKey: surfaceKeyFromParts("tmux", "main")!,
      mode: "observe",
    });
    expect(targetRoute({ terminalBackend: "pty", terminalTabId: "t1" })).toBeNull();
  });

  test("a herdr session has no mode to keep", () => {
    expect(restingRoute({ view: "terminal", terminalSurfaceKey: herdrKey, mode: "takeover" })).toEqual({ view: "terminal", terminalSurfaceKey: herdrKey });
  });

  test("every key is written, so a new target never inherits the last one's", () => {
    const patch = targetConfig({ view: "terminal", terminalSessionId: "s1", terminalSurfaceKey: "tmux:main", mode: "observe" });
    expect(Object.keys(patch).sort()).toEqual([...TARGET_KEYS].sort());
    expect(patch.agentId).toBe("");
    const fromAgent = targetConfig({ view: "terminal", agentId: "a1" });
    expect(fromAgent.terminalSessionId).toBe("");
    expect(fromAgent.terminalBackend).toBe("");
  });

  test("a bare terminal route goes back to the picker", () => {
    expect(targetConfig({ view: "terminal" })).toEqual(clearTarget());
    expect(targetRoute(kept(targetConfig({ view: "terminal" })))).toBeNull();
  });

  test("kinds decide what the head offers", () => {
    expect(targetKind({ view: "terminal", agentId: "a1" })).toBe("agent");
    expect(targetKind({ view: "terminal", terminalSessionId: "s1", terminalSurfaceKey: "tmux:main" })).toBe("session");
    expect(targetKind({ view: "terminal", terminalSurfaceKey: herdrKey })).toBe("herdr");
    expect(targetKind({ view: "terminal", terminalBackend: "herdr", terminalSessionName: "dev" })).toBe("host");
  });
});

describe("following a route inside a panel", () => {
  const observing: TerminalRoute = { view: "terminal", agentId: "a1", mode: "observe" };
  const takingOver: TerminalRoute = { view: "terminal", agentId: "a1", mode: "takeover" };
  const step = (route: TerminalRoute, shown: TerminalRoute | null) => {
    const result = panelStep(route, shown);
    if (result.to !== "panel") throw new Error("expected the panel to move");
    return result;
  };

  test("a takeover is held for this mount; the settings keep the terminal observed", () => {
    const result = step(takingOver, observing);
    expect(result.driven).toEqual(takingOver);
    expect(targetRoute(kept(result.config))).toEqual(observing);
    const session: TerminalRoute = { view: "terminal", terminalSessionId: "s1", terminalSurfaceKey: "tmux:main", mode: "takeover" };
    expect(step(session, null).driven).toEqual(session);
    expect(step(session, null).config.mode).toBe("observe");
  });

  test("herdr's Open terminal is held; the settings keep the projection", () => {
    const projection: TerminalRoute = { view: "terminal", terminalSurfaceKey: surfaceKeyFromParts("herdr", "dev")! };
    const result = step(herdrTerminal, projection);
    expect(result.driven).toEqual(herdrTerminal);
    expect(targetRoute(kept(result.config))).toEqual(projection);
    // the panel compares the two by identity, so the held terminal stays on its projection
    expect(targetIdentity(targetRoute(kept(result.config)))).toBe(targetIdentity(projection));
  });

  test("a route at rest drives nothing", () => {
    expect(step(observing, takingOver).driven).toBeNull();
    expect(step({ view: "terminal", terminalSurfaceKey: herdrKey, mode: "takeover" }, null).driven).toBeNull();
  });

  test("an agent route with no mode keeps what the panel shows on that agent", () => {
    expect(step({ view: "terminal", agentId: "a1" }, takingOver).driven).toEqual(takingOver);
    expect(step({ view: "terminal", agentId: "a1" }, observing).driven).toBeNull();
    expect(step({ view: "terminal", agentId: "a2" }, takingOver).driven).toBeNull();
  });

  test("the bare route is the picker; a fresh pty has no place in a panel", () => {
    expect(step({ view: "terminal" }, observing)).toEqual({ to: "panel", config: clearTarget(), driven: null });
    expect(panelStep({ view: "terminal", terminalBackend: "pty", terminalTabId: "t1" }, observing)).toEqual({ to: "page" });
  });

  test("only takeovers and host terminals drive", () => {
    expect(drives(takingOver)).toBe(true);
    expect(drives(herdrTerminal)).toBe(true);
    expect(drives(observing)).toBe(false);
    expect(drives({ view: "terminal", terminalSessionId: "s1", terminalSurfaceKey: "tmux:main" })).toBe(false);
  });
});

describe("attach commands", () => {
  test("each host attaches its own way", () => {
    expect(attachCommandFor({ backend: "tmux", sessionName: "main", paneId: null, socketDir: null })).toBe("tmux attach -t main");
    expect(attachCommandFor({ backend: "zellij", sessionName: "z", paneId: null, socketDir: "/tmp/zj" })).toBe("ZELLIJ_SOCKET_DIR=/tmp/zj zellij attach z");
    expect(attachCommandFor({ backend: "herdr", sessionName: "default", paneId: null, socketDir: null })).toBe("herdr");
    expect(attachCommandFor({ backend: "herdr", sessionName: "dev", paneId: null, socketDir: null })).toBe("herdr session attach dev");
  });

  test("names that need quoting are quoted", () => {
    expect(attachCommandFor({ backend: "tmux", sessionName: "it's mine", paneId: null, socketDir: null })).toBe(`tmux attach -t 'it'\\''s mine'`);
  });

  test("a registered surface's own argv wins over a derived one", () => {
    const zj = surface("zellij", "z", { attachCommand: ["env", "ZELLIJ_SOCKET_DIR=/tmp/zj", "zellij", "attach", "z"] });
    expect(attachCommandForSurface(zj, null)).toBe("env ZELLIJ_SOCKET_DIR=/tmp/zj zellij attach z");
    const bare = surface("tmux", "main", { attachCommand: [] });
    expect(attachCommandForSurface(bare, { backend: "tmux", sessionName: "main", paneId: null, socketDir: null })).toBe("tmux attach -t main");
    expect(attachCommandForSurface(bare, null)).toBeNull();
  });
});

describe("the picker", () => {
  const bound = agent("builder", { terminalSurface: { backend: "tmux", sessionName: "relay-builder", paneId: null, socketDir: null }, updatedAt: 50 });

  test("an agent is found by its surface, else by a shared session name", () => {
    const s = session("s1", [surface("tmux", "relay-builder")]);
    expect(agentForSurface([bound], s, s.surfaces[0]!, surfaceOf)?.id).toBe("builder");
    const byName = agent("named", { harnessSessionId: "s2" });
    const s2 = session("s2", [surface("tmux", "other")]);
    expect(agentForSurface([byName], s2, s2.surfaces[0]!, surfaceOf)?.id).toBe("named");
    expect(agentForSurface([bound], s2, s2.surfaces[0]!, surfaceOf)).toBeNull();
  });

  test("running sessions, most recently active first; an agent's surface opens as the agent, observing", () => {
    const sessions = [
      session("s1", [surface("tmux", "relay-builder")], 10),
      session("old", [surface("tmux", "gone", { state: "exited" })], 99),
      session("h1", [surface("herdr", "dev", { paneId: "p1" }), surface("herdr", "dev", { paneId: "p2" })], 30),
      session("plain", [surface("zellij", "z")], 20, { origin: "discovered", metadata: { activityAt: 20 } }),
    ];
    const agents = [
      bound,
      // claims a terminal the host no longer lists: exited, so left out
      agent("stale", { terminalSurface: { backend: "tmux", sessionName: "vanished", paneId: null, socketDir: null }, updatedAt: 90 }),
      agent("no-terminal", { updatedAt: 95 }),
    ];
    const rows = targetRows(sessions, agents, surfaceOf);
    // the builder's session is newest through its agent (50), so it leads
    expect(rows.map((r) => r.id)).toEqual(["agent:builder", expect.stringContaining("session:h1"), expect.stringContaining("session:plain")]);
    expect(rows[0]!.route).toEqual({ view: "terminal", agentId: "builder", mode: "observe" });
    expect(rows[0]!.owner.startsWith("builder")).toBe(true);
    // herdr opens its projection, which has no read-only view
    expect(rows[1]!.route.mode).toBeUndefined();
    expect(rows[2]!.owner.startsWith("Standalone")).toBe(true);
    expect(rows[2]!.route.mode).toBe("observe");
  });

  test("a discovered session's probe time is not activity", () => {
    const now = 1_000_000;
    const rows = targetRows(
      [
        session("registered", [surface("tmux", "work")], now - 5_000, { metadata: { activityAt: now - 1_000 } }),
        // the server stamps a discovered record with the moment it probed it
        session("idle", [surface("tmux", "idle")], now, { origin: "discovered" }),
        session("idle-but-reported", [surface("tmux", "old")], now, { origin: "discovered", metadata: { activityAt: now - 9_000 } }),
      ],
      [],
      surfaceOf,
    );
    // reported activity leads; no reported activity goes last, whatever the stamp
    expect(rows.map((r) => r.title)).toEqual(["work", "old", "idle"]);
    expect(rows[2]!.activityAt).toBeNull();
  });

  test("an agent's own activity counts for its terminal", () => {
    const rows = targetRows(
      [
        session("s1", [surface("tmux", "relay-builder")], 10, { metadata: { activityAt: 10 } }),
        session("s2", [surface("tmux", "other")], 40, { metadata: { activityAt: 40 } }),
      ],
      [bound],
      surfaceOf,
    );
    expect(rows.map((r) => r.id)).toEqual(["agent:builder", expect.stringContaining("session:s2")]);
    expect(rows[0]!.activityAt).toBe(50);
  });

  test("ties keep one order, by name", () => {
    const sessions = [session("b", [surface("tmux", "beta")], 1, { origin: "discovered" }), session("a", [surface("tmux", "alpha")], 2, { origin: "discovered" })];
    expect(targetRows(sessions, [], surfaceOf).map((r) => r.title)).toEqual(["alpha", "beta"]);
    expect(targetRows([...sessions].reverse(), [], surfaceOf).map((r) => r.title)).toEqual(["alpha", "beta"]);
  });

  test("an agent with two surfaces opens by agent once; the other stays a session", () => {
    const panes = session("s1", [surface("tmux", "relay-builder", { paneId: "%1" }), surface("tmux", "relay-builder", { paneId: "%2" })], 10);
    const rows = targetRows([panes], [bound], surfaceOf);
    expect(rows.map((r) => r.kind).sort()).toEqual(["agent", "session"]);
  });

  test("an agent matched by session name alone owns the row but does not open it", () => {
    const named = agent("named", { harnessSessionId: "s2" });
    const rows = targetRows([session("s2", [surface("zellij", "other")], 10)], [named], surfaceOf);
    expect(rows.map((r) => r.kind)).toEqual(["session"]);
    expect(rows[0]!.owner.startsWith("named")).toBe(true);
  });

  test("a retired agent's terminal is a plain session", () => {
    const rows = targetRows([session("s1", [surface("tmux", "relay-builder")], 10)], [{ ...bound, retiredFromFleet: true }], surfaceOf);
    expect(rows.map((r) => r.kind)).toEqual(["session"]);
  });

  test("find matches every word, in any field", () => {
    const rows = targetRows([session("s1", [surface("tmux", "relay-builder")], 10, { cwd: "/example/me/dev/scout" })], [bound], surfaceOf);
    expect(filterRows(rows, "builder tmux")).toHaveLength(1);
    expect(filterRows(rows, "scout")).toHaveLength(1);
    expect(filterRows(rows, "zellij")).toHaveLength(0);
    expect(filterRows(rows, "  ")).toHaveLength(1);
  });
});
