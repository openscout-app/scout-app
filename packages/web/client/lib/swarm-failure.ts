/*
 * A failed ask's reason in a few plain words. The runtime records the
 * harness's own error, which runs long and names internals: "This content was
 * flagged for possible cybersecurity risk. If this seems wrong, try rephrasing
 * your request. … (cyberPolicy)", or "Stale running flight reconciled:
 * endpoint endpoint.session-….tmux moved to offline at 1792723280126". The
 * board says what happened in one short sentence, and keeps a provider's code,
 * the words a person searches for. A reason it does not know reads as its
 * first sentence.
 */

/** A wait in words: "30 s", "65 s", "4 min", "1 h", "1 h 15 min". Seconds up to a minute and a half. */
export function durationWords(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}

/** The first sentence, without its full stop: "Selected model is at capacity". */
function firstSentence(text: string): string {
  const sentence = text.match(/^(.+?[.!?])(?=\s|$)/su)?.[1] ?? text;
  return sentence.replace(/\.$/u, "").trim();
}

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

// A provider's code closes its message in parentheses, in camel case: "(cyberPolicy)", "(serverOverloaded)".
const PROVIDER_CODE = /\s\(([a-z][a-z0-9]*[A-Z]\w*)\)\s*$/u;

type Reading = [RegExp, (match: RegExpMatchArray) => string];

const READINGS: Reading[] = [
  // The provider's filter, whose message goes on to say how to apply for access.
  [/flagged for possible cybersecurity risk[\s\S]*\((\w+)\)\s*$/u, (m) => `Refused by the provider's cybersecurity filter (${m[1]})`],
  // The runtime could not reach or start the session, so the ask never began.
  [/^Endpoint resolution failed before execution: session \S+ is not currently reachable/u, () => "Its session was not reachable"],
  [
    /^Endpoint resolution failed before execution: Timed out after (\d+)ms waiting for Codex app-server startup/u,
    (m) => `Codex's app server did not start within ${durationWords(Number(m[1]))}`,
  ],
  [/^Endpoint resolution failed before execution: ([\s\S]+)$/u, (m) => capital(firstSentence(m[1]!))],
  // The runtime closed a flight it found still marked running.
  [/^Stale running flight reconciled: endpoint \S+ moved to (\w+)/u, (m) => `The runtime closed it when its session went ${m[1]}`],
  [/^Stale running flight reconciled: endpoint \S+ was replayed active .* without a live \w+ task/u, () => "No live task was running it, so the runtime closed it"],
  [/^Stale running flight reconciled: superseded by newer completed flight/u, () => "A newer flight replaced it"],
  [/^Stale running flight reconciled/u, () => "The runtime closed it as stale"],
  [/^Timed out waiting for local agent turn after (\d+)ms/u, (m) => `Timed out after ${durationWords(Number(m[1]))}`],
  [/^Local target \S+ completed without broker-visible output/u, () => "It finished with no reply the runtime could see"],
  [/^Codex completed without producing a final response/u, () => "Codex finished without a final response"],
  [
    /^tmux session \S+ did not show a ready Claude Code composer within (\d+)ms/u,
    (m) => `Claude Code's composer was not ready within ${durationWords(Number(m[1]))}`,
  ],
  // A JSON-RPC error carries its cause after the code: "session/prompt failed (-32603): No space left on device".
  [/^[\w/.-]+ failed \(-?\d+\): ([\s\S]+)$/u, (m) => firstSentence(m[1]!)],
];

/** A failed ask's reason as the board says it. */
export function failureWords(reason: string): string {
  const text = reason.trim();
  for (const [pattern, words] of READINGS) {
    const match = text.match(pattern);
    if (match) return words(match);
  }
  const code = text.match(PROVIDER_CODE);
  if (code) return `${firstSentence(text.slice(0, code.index))} (${code[1]})`;
  return firstSentence(text);
}
