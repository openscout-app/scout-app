/*
 * The agent the web app stands in for a native harness session (one Scout
 * did not start): its id and its name, "Claude 0f10496b". In one place, so
 * every surface that names a session, or seeds its face by that name, agrees.
 */

/** A native session's agent id: `native:<harness>:<session>`. */
export function nativeAgentId(source: string, sessionId: string): string {
  return `native:${source}:${sessionId}`;
}

/** A native session's agent name: its harness and the first eight characters of its session. */
export function nativeAgentName(source: string, sessionId: string | null | undefined): string {
  const harness = source ? `${source[0]?.toUpperCase()}${source.slice(1)}` : "Native";
  const short = sessionId ? sessionId.replace(/\.jsonl$/u, "").slice(0, 8) : "session";
  return `${harness} ${short}`;
}
