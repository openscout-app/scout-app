export type ReactionKind = "more" | "narrower" | "wrong" | "ship";

/** The four reactions, in the order they are offered: the label, and what it tells the agent to do. */
export const REACTIONS: readonly { kind: ReactionKind; label: string; means: string }[] = [
  { kind: "more", label: "More like this", means: "Keep going in this direction and do more of what this does." },
  { kind: "narrower", label: "Narrower", means: "The direction is right but this is too broad. Cut it down to its core and show me that." },
  { kind: "wrong", label: "Wrong question", means: "This answers the wrong question. Stop, and tell me in a sentence what you think I am asking before you go on." },
  { kind: "ship", label: "Ship it", means: "This is good. Finish it and get it ready to merge." },
];

export const reactionLabel = (kind: ReactionKind) => REACTIONS.find((r) => r.kind === kind)?.label ?? kind;

/** What the reaction is on, as the agent knows it: a path, and what the artifact is. */
export type ReactionTarget = { path: string; what: string };

/**
 * The message the session receives: what it is on, the reaction and its meaning, then the operator's own sentence.
 * `where` names the page it was sent from.
 */
export function reactionMessage(kind: ReactionKind, target: ReactionTarget, note: string, where = "the Canvas"): string {
  const r = REACTIONS.find((x) => x.kind === kind);
  if (!r) throw new Error(`Unknown reaction: ${kind}`);
  const said = note.replace(/\s+/g, " ").trim();
  return [
    `Reaction from the operator, sent from ${where}, on ${target.what} ${target.path}`,
    `${r.label}. ${r.means}`,
    ...(said ? [`In their words: ${said}`] : []),
  ].join("\n\n");
}
