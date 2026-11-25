import { resolveTerminalRelaySessionKey } from "../../lib/terminal-relay.ts";

/**
 * The relay session an agent's takeover connects to, as the relay stores it
 * (hudsonkit keeps its id at `hudson.relay.<key>`): the same key the relay
 * binding computes for an agent with no terminal surface, which is the only
 * agent a takeover bootstraps. A panel's relay scope is part of it.
 *
 * Bootstrapping a takeover clears it before queueing the agent's resume
 * command, so the command lands in a fresh pty rather than the last one.
 * queueTakeover clears only the older names (`scout-takeover-<agentId>`),
 * which stopped matching when the relay key gained its control mode and, in
 * a panel, its scope.
 */
export function takeoverRelayKey(agentId: string, scope?: string | null): string {
  return resolveTerminalRelaySessionKey({ agentId, agent: null, terminalSurface: null, mode: "takeover", scope });
}
