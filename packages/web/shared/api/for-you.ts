/**
 * Home's For you cards: each item that waits on the operator, drawn for its
 * kind. The server classifies each item by rules from its typed fields, and
 * uses a small model only where the rules cannot tell. For free text it keeps
 * one cached digest of the core ask, computed once per source text.
 *
 * Served by GET /api/feed/for-you. A card's `id` is the For you row it
 * draws: `request:<attention item id>` or a feed post id.
 */
import type { FeedDiffFile } from "./feed.ts";

export type ForYouKind = "permission" | "decision" | "question" | "review" | "push" | "blocked";

export const FOR_YOU_KINDS: readonly ForYouKind[] = ["permission", "decision", "question", "review", "push", "blocked"];

/** What the rules read from the item's typed fields. Nothing here comes from a model. */
export type ForYouFacts =
  | {
      kind: "permission";
      /** The tool, when the harness named it: "Bash", "EnterWorktree". */
      tool: string | null;
      /** The action as the hero: a command, a path, or a tool and its target. */
      target: string | null;
      targetKind: "command" | "path" | "tool" | null;
      /** Where it runs: the project folder. */
      scope: string | null;
      /** Why, in the agent's words, when it gave one. */
      reason: string | null;
      /** The answers the ask declared (`scout ask --operator --permission --option …`), sent as the reply. */
      options: ForYouOption[];
    }
  | {
      kind: "decision";
      question: string | null;
      /** Only options the source declared. */
      options: ForYouOption[];
      /** The default the ask declared, if any. */
      defaultAction: string | null;
    }
  | { kind: "question"; question: string | null }
  | {
      kind: "review";
      pr: { label: string; title: string; url: string };
      additions: number | null;
      deletions: number | null;
      fileCount: number | null;
      /** The largest files, from the head's per-file stat. */
      files: FeedDiffFile[];
    }
  | { kind: "push"; branch: string; commits: number | null; additions: number | null; deletions: number | null }
  | { kind: "blocked"; stuckOn: string | null };

export type ForYouOption = { label: string; description: string | null; recommended: boolean };

/**
 * The core of an ask, written by the digest model for the reader and checked
 * against the source: options and a recommendation the source does not
 * contain are dropped, never shown.
 */
export type ForYouDigest = {
  /** The ask in one line: the question, the decision, or what the agent wants to do. */
  ask: string;
  /** What is at stake, in one short line. */
  stake: string | null;
  /** A decision's options, each found in the source. */
  options: ForYouOption[];
  /** A permission's action, scope and reason. */
  action: { target: string | null; targetKind: "command" | "path" | "tool" | null; scope: string | null; reason: string | null } | null;
  /** The default the ask declared, in the reader's words. */
  defaultAction: string | null;
};

/** What a card can do, each backed by a runtime path. */
export type ForYouAnswer =
  /** Allow and Deny (and Always when the runtime offers it) on a permission. */
  | { via: "request"; always: boolean }
  /** A decision's options or a question's reply, sent as the operator's message on the thread. */
  | { via: "reply"; conversationId: string; replyToMessageId: string | null }
  /** A successor task on the work (POST /api/work/:id/continue). */
  | { via: "continue"; workId: string }
  /** The Feed's primary move on the post. */
  | { via: "post" }
  | { via: "none" };

export type ForYouCard = {
  id: string;
  kind: ForYouKind;
  /** Rules decided the kind, or the classifier model did. */
  classifiedBy: "rules" | "model";
  facts: ForYouFacts;
  digest: ForYouDigest | null;
  /** ready: the digest is in; pending: being written; none: not needed or no model; failed: the call failed. */
  digestState: "ready" | "pending" | "none" | "failed";
  answer: ForYouAnswer;
};

export type ForYouResponse = {
  generatedAt: number;
  cards: ForYouCard[];
  /** True while a digest is being written; the page reads again shortly. */
  pending: boolean;
  model: { available: boolean };
};
