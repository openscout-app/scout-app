import { describe, expect, test } from "bun:test";
import type { SessionTerminalTarget } from "../../../lib/session-terminal-hop.ts";
import type { SessionBoardRow } from "../../sessions/session-board-model.ts";
import {
  sessionRefLeaf,
  sessionTerminalAgent,
  sessionTerminalHasModes,
  sessionTerminalHints,
  sessionTerminalKey,
  sessionTerminalOffer,
  sessionTerminalRoute,
  sessionTerminalStep,
  type SessionTerminal,
} from "./session-terminal-model.ts";

const target = (backend = "tmux"): SessionTerminalTarget => ({
  session: { id: "term-1" } as never,
  surface: { backend } as never,
  surfaceKey: `${backend}:default:scout-a`,
  via: "sourceSessionId",
});
const surface = (backend = "tmux"): SessionTerminal => ({ kind: "surface", target: target(backend) });
const agentTerminal: SessionTerminal = { kind: "agent", agentId: "session-abc" };
const selection = { sessionRef: "session:claude:abc", machineId: "node-here" };
const rowWith = (over: object) => over as unknown as SessionBoardRow;

describe("Session thread › Terminal", () => {
  test("a session's own id is its ref without session: and the harness", () => {
    expect(sessionRefLeaf("session:claude:session-mw58")).toBe("session-mw58");
    expect(sessionRefLeaf("session:codex:c")).toBe("c");
    expect(sessionRefLeaf("abc")).toBe("abc");
  });

  test("finds the terminal by the session's ref, its harness session id and its agent", () => {
    const row = rowWith({ sessionId: "abc", conversation: { agentId: "session-abc" } });
    expect(sessionTerminalHints(selection, row)).toEqual({ agentId: "session-abc", sessionRefs: ["session:claude:abc", "abc"] });
    expect(sessionTerminalHints(selection, undefined)).toEqual({ agentId: null, sessionRefs: ["session:claude:abc", undefined] });
  });

  test("the agent that runs the session is the one whose id or harness session is the session's", () => {
    const agents = [
      { id: "session-mw58", harnessSessionId: "session-mw58" },
      { id: "reviewer", harnessSessionId: "native-1" },
      { id: "lead", harnessSessionId: null },
    ];
    expect(sessionTerminalAgent(agents, { sessionRef: "session:claude:session-mw58" }, undefined)?.id).toBe("session-mw58");
    expect(sessionTerminalAgent(agents, { sessionRef: "session:claude:x" }, rowWith({ sessionId: "native-1" }))?.id).toBe("reviewer");
    // a session Scout started: its agent's handle, and the name of its tmux session
    const started = [{ id: "session-mw58.main.dev-host", harnessSessionId: "c1eac66a", terminalSurface: { sessionName: "session-mw58" } }];
    expect(sessionTerminalAgent(started, { sessionRef: "session:claude:session-mw58" }, undefined)?.id).toBe("session-mw58.main.dev-host");
    const hidden = [{ id: "relay.main.dev-host", harnessSessionId: null, terminalSurface: { sessionName: "session-mw58" } }];
    expect(sessionTerminalAgent(hidden, { sessionRef: "session:claude:session-mw58" }, undefined)?.id).toBe("relay.main.dev-host");
    // one handle on two workspaces is two agents
    const branches = [{ id: "session-mu9.a.dev-host", harnessSessionId: null }, { id: "session-mu9.b.dev-host", harnessSessionId: null }];
    expect(sessionTerminalAgent(branches, { sessionRef: "session:claude:session-mu9" }, undefined)).toBeNull();
    // only when nothing runs it by id: its conversation's agent
    expect(sessionTerminalAgent(agents, { sessionRef: "session:claude:x" }, rowWith({ sessionId: "y", conversation: { agentId: "lead" } }))?.id).toBe("lead");
    expect(sessionTerminalAgent(agents, { sessionRef: "session:claude:x" }, undefined)).toBeNull();
    // two different agents prove nothing
    const twins = [{ id: "a", harnessSessionId: "s" }, { id: "b", harnessSessionId: "s" }];
    expect(sessionTerminalAgent(twins, { sessionRef: "session:claude:s" }, rowWith({ conversation: { agentId: "a" } }))).toBeNull();
    // the same agent listed twice is still one
    expect(sessionTerminalAgent([twins[0]!, twins[0]!], { sessionRef: "session:claude:s" }, undefined)?.id).toBe("a");
  });

  test("is offered only when a terminal exists, and otherwise says why", () => {
    const found = target();
    const base = { resolved: true, target: null, agent: null, selection, localNodeId: "node-here" };
    expect(sessionTerminalOffer({ ...base, target: found })).toEqual({ available: true, terminal: { kind: "surface", target: found } });
    expect(sessionTerminalOffer({ ...base, agent: { id: "session-abc", hasTerminal: true } }))
      .toEqual({ available: true, terminal: agentTerminal });
    // an agent with no terminal is not offered: taking it over would start one
    expect(sessionTerminalOffer({ ...base, agent: { id: "session-abc", hasTerminal: false } }))
      .toEqual({ available: false, reason: "No terminal runs this session on this host" });
    // the agent waits for the inventory, so a found surface never replaces it on screen
    expect(sessionTerminalOffer({ ...base, resolved: false, agent: { id: "session-abc", hasTerminal: true } }))
      .toEqual({ available: false, reason: "Looking for this session's terminal" });
    expect(sessionTerminalOffer({ ...base, selection: { ...selection, machineId: "mini" }, agent: { id: "session-abc", hasTerminal: true } }))
      .toEqual({ available: false, reason: "This session runs on another host" });
    expect(sessionTerminalOffer(base)).toEqual({ available: false, reason: "No terminal runs this session on this host" });
    // without a known host, a session is taken as this host's
    expect(sessionTerminalOffer({ ...base, selection: { sessionRef: "s" }, localNodeId: null }))
      .toEqual({ available: false, reason: "No terminal runs this session on this host" });
  });

  test("draws the found surface or the agent's terminal, observed or taken over", () => {
    expect(sessionTerminalRoute(surface(), "observe"))
      .toEqual({ view: "terminal", terminalSessionId: "term-1", terminalSurfaceKey: "tmux:default:scout-a", mode: "observe" });
    expect(sessionTerminalRoute(surface(), "takeover").mode).toBe("takeover");
    expect(sessionTerminalRoute(agentTerminal, "observe")).toEqual({ view: "terminal", agentId: "session-abc", mode: "observe" });
    expect(sessionTerminalKey(surface())).toBe("term-1|tmux:default:scout-a");
    expect(sessionTerminalKey(agentTerminal)).toBe("agent|session-abc");
  });

  test("a herdr session has no Observe or Take over", () => {
    expect(sessionTerminalHasModes(surface("tmux"))).toBe(true);
    expect(sessionTerminalHasModes(agentTerminal)).toBe(true);
    expect(sessionTerminalHasModes(surface("herdr"))).toBe(false);
  });

  test("a link to the same terminal changes its mode in the panel; anything else opens on the page", () => {
    const shown = sessionTerminalRoute(surface(), "observe");
    expect(sessionTerminalStep({ ...shown, mode: "takeover" }, surface())).toEqual({ to: "panel", mode: "takeover" });
    expect(sessionTerminalStep({ view: "terminal", terminalSessionId: "term-1", mode: "observe" }, surface())).toEqual({ to: "panel", mode: "observe" });
    expect(sessionTerminalStep({ view: "terminal", terminalSessionId: "term-2", mode: "takeover" }, surface())).toEqual({ to: "page" });
    expect(sessionTerminalStep({ view: "terminal", agentId: "a", mode: "takeover" }, surface())).toEqual({ to: "page" });
    expect(sessionTerminalStep({ view: "terminal" }, surface())).toEqual({ to: "page" });
    expect(sessionTerminalStep({ view: "agents" } as never, surface())).toEqual({ to: "page" });
    expect(sessionTerminalStep({ view: "terminal", agentId: "session-abc", mode: "takeover" }, agentTerminal)).toEqual({ to: "panel", mode: "takeover" });
    // only an explicit takeover drives
    expect(sessionTerminalStep({ view: "terminal", agentId: "session-abc" }, agentTerminal)).toEqual({ to: "panel", mode: "observe" });
    expect(sessionTerminalStep({ view: "terminal", agentId: "other", mode: "observe" }, agentTerminal)).toEqual({ to: "page" });
    expect(sessionTerminalStep({ view: "terminal", terminalSessionId: "term-1", mode: "observe" }, agentTerminal)).toEqual({ to: "page" });
  });
});
