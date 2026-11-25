/**
 * The operator's latest move on a Feed post, made from the Feed or Home: a
 * reply, a reaction, a decision, a follow-up, Done or Drop, a question to
 * Scoutbot. The move itself went to the runtime (or to Scoutbot); this is the
 * web server's receipt of it, kept so the post says what was last done on it
 * after a reload, a restart or a rebuilt projection, whether or not the work
 * changed since.
 */
export const FEED_MOVE_KINDS = ["reply", "continue", "react", "ship", "push", "decide", "answer", "done", "drop", "ask"] as const;
export type FeedMoveKind = (typeof FEED_MOVE_KINDS)[number];

/** `id` is the post's id as the Feed serves it; `label` is the move's own words, short; `at` is when the server took it. */
export type FeedMove = { id: string; kind: FeedMoveKind; label: string; at: number };

/** The longest label kept: the post shows one line of it. */
export const MOVE_LABEL_MAX = 200;

/**
 * Whether a move answers the turn that finished at `turnAt`: it came after
 * the turn and was a move on the work. Asking Scoutbot about a post is not.
 * An answered turn no longer waits in Back to you; a newer turn waits again.
 */
export function answersTurn(move: FeedMove | null | undefined, turnAt: number): boolean {
  return Boolean(move && move.kind !== "ask" && move.at >= turnAt);
}

const quote = (label: string) => (label ? `: “${label}”` : "");

/** The move in a few words, from the operator's side: "You replied: “…”", "You marked it done". */
export function moveWords(move: Pick<FeedMove, "kind" | "label">): string {
  const label = move.label.replace(/\s+/g, " ").trim();
  switch (move.kind) {
    case "reply": return `You replied${quote(label)}`;
    case "continue": return `You asked for more${quote(label)}`;
    case "react": return label ? `You reacted: ${label}` : "You reacted";
    case "ship": return "You said ship it";
    case "push": return "You asked to push it";
    case "decide": return label ? `You chose ${label}` : "You decided";
    case "answer": return `You answered${quote(label)}`;
    case "done": return "You marked it done";
    case "drop": return "You dropped it";
    case "ask": return `You asked Scoutbot${quote(label)}`;
  }
}
