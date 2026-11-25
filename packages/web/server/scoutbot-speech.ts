// A typed Scoutbot reply has two forms: the written reply the panel renders,
// and a short spoken version for when the operator has voice on. The model
// writes the spoken version in a fenced `scout-speech` block after the reply;
// the service lifts it out before the reply is stored, so the written body
// never shows it.
//
// The rule rides on the system prompt at call time, not in the saved prompt,
// so it still applies when the operator has edited the prompt in settings.

export const SCOUTBOT_SPOKEN_SUMMARY_RULE = [
  "When your reply runs past about three sentences, or holds a list, table, or code, end it with a spoken version for the operator's speaker: a fenced block tagged `scout-speech` (open with ```scout-speech), after any scout-ui block.",
  "The spoken version is one or two plain sentences that give the answer and, when the written reply holds more, say the rest is on screen. No markdown, lists, IDs, file paths, or URLs in it.",
  "Leave the block out of a short reply; a short reply is read aloud as written.",
].join("\n");

export function withSpokenSummaryRule(systemPrompt: string): string {
  return `${systemPrompt}\n${SCOUTBOT_SPOKEN_SUMMARY_RULE}`;
}

const SPEECH_FENCE = /(^|\n)[ \t]*```[ \t]*scout-speech[ \t]*\n([\s\S]*?)(?:\n[ \t]*```[ \t]*(?=\n|$)|$)/g;

/** Lift every `scout-speech` block out of a reply; the last non-empty one is the spoken version. */
export function splitScoutbotSpokenSummary(text: string): { body: string; spoken: string | null } {
  let spoken: string | null = null;
  const body = text.replace(SPEECH_FENCE, (_match, lead: string, inner: string) => {
    const said = inner.replace(/\s+/g, " ").trim();
    if (said) spoken = said;
    return lead;
  });
  return { body: body.replace(/\n{3,}/g, "\n\n").trim(), spoken };
}
