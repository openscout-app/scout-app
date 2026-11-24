export type AskKind = "file" | "doc" | "media" | "update";

/** The questions offered for a kind of artifact. The last one of each is about the agent, not the artifact. */
export const ASK_QUESTIONS: Record<AskKind, readonly string[]> = {
  file: [
    "What changed here, in two sentences?",
    "Does this do what the agent was asked?",
    "What looks risky or unfinished?",
    "What should I ask the agent about this?",
  ],
  doc: [
    "What is this, in two sentences?",
    "Does it answer what the agent was asked?",
    "What is missing from it?",
    "Where is the agent on what it was asked?",
  ],
  media: [
    "Why would the agent have made this?",
    "Where is the agent on what it was asked?",
    "What has the agent produced so far?",
  ],
  /* an agent's latest update, in Projects › Agents */
  update: [
    "What did the agent do, in two sentences?",
    "Did it finish what it was asked?",
    "What is left open or risky?",
    "What should I reply?",
  ],
};
