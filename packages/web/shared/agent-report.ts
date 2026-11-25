/*
 * How an agent's report reads in a list: its name without its project's
 * prefix, and a leading status word lifted off the text. Pure: the Feed
 * engine and the agents pages share it.
 */

export function displayName(agent: string, project: string | null | undefined): string {
  if (!project) return agent;
  const prefix = `${project.toLowerCase()}-`;
  const rest = agent.toLowerCase().startsWith(prefix) ? agent.slice(prefix.length) : "";
  return rest ? rest : agent;
}

/* Agents often lead a report with a status word: "DONE — landed …". */
const STATUS_LEAD = /^(done|blocked)\s*(?:[—–:-]\s*|\.\s+)/i;

export function liftStatus(text: string): { status: "done" | "blocked" | null; text: string } {
  const match = STATUS_LEAD.exec(text);
  if (!match) return { status: null, text };
  const rest = text.slice(match[0].length);
  return {
    status: match[1]!.toLowerCase() === "done" ? "done" : "blocked",
    text: rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : text,
  };
}
