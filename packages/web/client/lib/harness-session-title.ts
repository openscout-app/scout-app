import type { TailDiscoveredTranscript } from "./types.ts";

/**
 * The `--name` Scout gives a harness it starts for an agent (core's
 * `localAgentLaunchName`). The harness keeps it as the session's agent name
 * (and, on older runtimes, its only title), so a transcript under this name is
 * that agent's session seen from the harness.
 */
const LAUNCH_NAME_SUFFIX = "-relay-agent";

export const scoutLaunchName = (agentId: string) => `${agentId}${LAUNCH_NAME_SUFFIX}`;
export const isScoutLaunchName = (name: string) => name.trim().endsWith(LAUNCH_NAME_SUFFIX);

/**
 * What a harness writes where a title would go when the first prompt was a
 * paste or nothing yet: "Pasted content", "[Pasted text #2]", "Untitled". It
 * names no work.
 */
const PLACEHOLDER_TITLE = /^\[?(?:pasted (?:content|text)(?: #?\d+)?(?: \+\d+ lines)?|untitled|new (?:session|chat|conversation))\]?[.:…\s]*$/i;
export const isPlaceholderTitle = (name: string) => PLACEHOLDER_TITLE.test(name.trim());

/**
 * A harness session's own name, when it has one: a custom title, an agent
 * name, then the harness's AI title, as core merges them. Scout's launch name
 * is an id, not a title, and a placeholder ("Pasted content") names no work,
 * so both are passed over for the next candidate.
 */
export function harnessSessionTitle(
  transcript: Pick<TailDiscoveredTranscript, "title" | "customTitle" | "agentName" | "aiTitle">,
): string | null {
  for (const candidate of [transcript.customTitle, transcript.agentName, transcript.aiTitle, transcript.title]) {
    const name = candidate?.trim();
    if (name && !isScoutLaunchName(name) && !isPlaceholderTitle(name)) return name;
  }
  return null;
}

/**
 * The name to show for a session: the operator's name or its current work
 * title when the runtime has one (`sessionName`), else the harness's own.
 * Every list and page that labels a transcript reads this, so a rename shows
 * everywhere at once.
 */
export function sessionTitle(
  transcript: Pick<TailDiscoveredTranscript, "title" | "customTitle" | "agentName" | "aiTitle" | "sessionName" | "sessionNameSource">,
): string | null {
  const named = transcript.sessionNameSource ? transcript.sessionName?.trim() : null;
  return named || harnessSessionTitle(transcript);
}

/** True when the operator named the session: that name wins over any task line. */
export function operatorNamedSession(transcript: Pick<TailDiscoveredTranscript, "sessionName" | "sessionNameSource">): boolean {
  return transcript.sessionNameSource === "operator" && Boolean(transcript.sessionName?.trim());
}

/**
 * A name the runtime made from a session agent's id rather than one someone
 * chose: `session-mwfnli2f-rclj11`, its launch name, or the title-cased
 * "Session Mwfnli2f Rclj11". It says nothing a reader can use.
 */
export function isGeneratedSessionName(name: string | null | undefined): boolean {
  const value = name?.trim();
  if (!value) return false;
  if (isScoutLaunchName(value)) return true;
  return /^session[\s-][a-z0-9]{6,}[\s-][a-z0-9]{4,}$/iu.test(value);
}
