import type { SessionTerminalHints, SessionTerminalTarget } from "../../../lib/session-terminal-hop.ts";
import type { Route } from "../../../lib/types.ts";
import type { SessionBoardRow } from "../../sessions/session-board-model.ts";
import type { SessionSelection } from "../../sessions/slot-deck.ts";
import type { TerminalMode, TerminalRoute } from "./terminal-target-model.ts";

/*
 * A Session thread's Terminal view: the terminal that already runs the
 * session, in the thread's place. That is the surface every hop control finds
 * for it (lib/session-terminal-hop.ts) or, when none matches, the terminal of
 * the Scout agent that runs it, drawn as the Terminals page draws that agent.
 * Nothing here starts a terminal: an agent is offered only when it already
 * has one. Pure, so it tests without a DOM; session-thread.tsx draws it.
 */

/** The session's own id: its ref without `session:` and the harness. */
export function sessionRefLeaf(sessionRef: string): string {
  return sessionRef.replace(/^session:/u, "").replace(/^[A-Za-z][A-Za-z0-9_-]{0,15}:/u, "");
}

/** What the session's terminal is found by: its ref, its harness session id, and its agent. */
export function sessionTerminalHints(selection: SessionSelection, row: SessionBoardRow | undefined): SessionTerminalHints {
  return {
    agentId: row?.conversation?.agentId ?? null,
    sessionRefs: [selection.sessionRef, row?.sessionId],
  };
}

type AgentLike = { id: string; harnessSessionId: string | null; terminalSurface?: { sessionName: string } | null };

/** What an agent is known by: its id, its handle (the id before `.<workspace>.<node>`), its harness session, its terminal's name. */
function agentNames(agent: AgentLike): string[] {
  return [agent.id, agent.id.split(".", 1)[0]!, agent.harnessSessionId, agent.terminalSurface?.sessionName]
    .filter((name): name is string => Boolean(name));
}

/**
 * The Scout agent that runs the session: the one known by this session's id
 * (a session Scout started is its agent's handle and names its terminal),
 * else its conversation's agent. Two different agents prove nothing, so they
 * give none.
 */
export function sessionTerminalAgent<A extends AgentLike>(
  agents: readonly A[],
  selection: SessionSelection,
  row: SessionBoardRow | undefined,
): A | null {
  const ids = new Set([sessionRefLeaf(selection.sessionRef), row?.sessionId].filter((id): id is string => Boolean(id)));
  const runs = agents.filter((agent) => agentNames(agent).some((name) => ids.has(name)));
  if (new Set(runs.map((agent) => agent.id)).size === 1) return runs[0]!;
  if (runs.length > 0) return null;
  const conversationAgent = row?.conversation?.agentId;
  return conversationAgent ? agents.find((agent) => agent.id === conversationAgent) ?? null : null;
}

/** The terminal the view draws: a found surface, or the agent's own terminal. */
export type SessionTerminal =
  | { kind: "surface"; target: SessionTerminalTarget }
  | { kind: "agent"; agentId: string };

export type SessionTerminalOffer =
  | { available: true; terminal: SessionTerminal }
  | { available: false; reason: string };

/**
 * Whether the Terminal view has a terminal to show, or why not. The
 * inventory lists this host's terminals, and an agent's terminal is drawn
 * from this host, so a session on another host has none here. The agent is
 * offered once the inventory has answered, so a found surface never replaces
 * it on screen.
 */
export function sessionTerminalOffer(input: {
  resolved: boolean;
  target: SessionTerminalTarget | null;
  agent: { id: string; hasTerminal: boolean } | null;
  selection: SessionSelection;
  localNodeId: string | null;
}): SessionTerminalOffer {
  const { resolved, target, agent, selection, localNodeId } = input;
  if (target) return { available: true, terminal: { kind: "surface", target } };
  if (!resolved) return { available: false, reason: "Looking for this session's terminal" };
  if (selection.machineId && localNodeId && selection.machineId !== localNodeId) {
    return { available: false, reason: "This session runs on another host" };
  }
  if (agent?.hasTerminal) return { available: true, terminal: { kind: "agent", agentId: agent.id } };
  return { available: false, reason: "No terminal runs this session on this host" };
}

/** The terminal route the view draws, observed unless the operator took it over. */
export function sessionTerminalRoute(terminal: SessionTerminal, mode: TerminalMode): TerminalRoute {
  if (terminal.kind === "agent") return { view: "terminal", agentId: terminal.agentId, mode };
  return { view: "terminal", terminalSessionId: terminal.target.session.id, terminalSurfaceKey: terminal.target.surfaceKey, mode };
}

/** Which terminal it is, not how it is watched: the key it mounts under. */
export function sessionTerminalKey(terminal: SessionTerminal): string {
  return terminal.kind === "agent" ? `agent|${terminal.agentId}` : `${terminal.target.session.id}|${terminal.target.surfaceKey}`;
}

/** A herdr session draws its projection whatever the mode, so it has no Observe or Take over. */
export function sessionTerminalHasModes(terminal: SessionTerminal): boolean {
  return terminal.kind === "agent" || terminal.target.surface.backend !== "herdr";
}

/**
 * Where a link inside the session's terminal goes. The same terminal in
 * another mode stays in the panel (Take over lasts until the session
 * changes); anything else, another terminal included, opens on the page.
 */
export function sessionTerminalStep(next: Route, terminal: SessionTerminal): { to: "panel"; mode: TerminalMode } | { to: "page" } {
  if (next.view !== "terminal" || next.terminalBackend) return { to: "page" };
  const shown = sessionTerminalRoute(terminal, "observe");
  const same = terminal.kind === "agent"
    ? next.agentId === shown.agentId && !next.terminalSessionId && !next.terminalSurfaceKey
    : !next.agentId
      && (Boolean(next.terminalSessionId) || Boolean(next.terminalSurfaceKey))
      && (next.terminalSessionId ?? shown.terminalSessionId) === shown.terminalSessionId
      && (next.terminalSurfaceKey ?? shown.terminalSurfaceKey) === shown.terminalSurfaceKey;
  return same ? { to: "panel", mode: next.mode === "takeover" ? "takeover" : "observe" } : { to: "page" };
}
