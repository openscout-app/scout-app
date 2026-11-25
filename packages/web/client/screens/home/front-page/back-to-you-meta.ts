/*
 * What a Back to you row says about the session, beyond its work: only what
 * earns its place.
 *
 *   name     the session's operator-given name or its work title (the
 *            runtime's session name), else the agent's own name when it is
 *            a real one. Never "demo-app session" or a crew codename
 *            ("epicurus-16"): those name nothing a reader can use.
 *   project  only when it differs from the page's usual project.
 *
 * Pure.
 */
import { isGeneratedSessionName } from "../../../lib/harness-session-title.ts";

/* "<project> session", as the runtime names an unnamed session agent. */
const PROJECT_SESSION = /^[\w.-]+ session$/i;
/* A crew codename: a word and a number ("epicurus-16", "tolstoy-5"). */
const CODENAME = /^[a-z]+-\d+$/i;

export function genericAgentName(name: string | null | undefined): boolean {
  const value = name?.trim();
  return !value || PROJECT_SESSION.test(value) || CODENAME.test(value) || isGeneratedSessionName(value);
}

/**
 * The line a failed send leaves under the row. A reason that already says
 * nothing was sent stands alone; any other reason is led by "Not sent."
 */
export function notSentLine(reason: string): string {
  const text = reason.replace(/\s+/g, " ").trim();
  if (!text) return "Not sent.";
  return /\b(nothing was sent|not sent)\b/i.test(text) ? text : `Not sent. ${text}`;
}

/** The session's name to show: its kept name, else a real agent name, else none. Never the row's own title again. */
export function turnName(input: { sessionName: string | null | undefined; agentName: string | null | undefined; title: string }): string | null {
  const same = (n: string) => n.trim().toLowerCase() === input.title.trim().toLowerCase();
  for (const candidate of [input.sessionName, input.agentName]) {
    const name = candidate?.trim();
    if (name && !genericAgentName(name) && !same(name)) return name;
  }
  return null;
}

/** The project most rows share: a row names its project only when it is another one. */
export function usualProject(projects: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const p of projects) if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  let best: string | null = null;
  for (const [p, n] of counts) if (!best || n > counts.get(best)!) best = p;
  return best;
}

/** What a decision click sends to the session, as its next turn. */
export function decisionBody(ask: string | null, option: string): string {
  return ask ? `${ask}: ${option}.` : `Go with ${option}.`;
}
