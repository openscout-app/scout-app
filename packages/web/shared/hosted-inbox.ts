/**
 * The hosted cross-space Inbox: one person's view of what is addressed to them
 * or waiting on someone, across every space they can read.
 *
 * It is a projection. Each space's Durable Object computes its own rows from its
 * canonical records (messages, read positions, requests, questions, approvals,
 * attention preferences) on every read, under that space's own authorization.
 * Nothing here is stored, copied or acknowledged separately: clearing a row
 * means acting through the record's own route (mark read, answer, decide).
 */

/** What the row is about. */
export type HostedInboxKind =
  /** An unread message that names you. */
  | "mention"
  /** An agent asked you a question on one of your asks. */
  | "question"
  /** Your question was answered; close it or reopen it. */
  | "review"
  /** An agent wants approval to act on your ask. */
  | "approval"
  /** Your ask is queued or running with an agent. */
  | "ask"
  /** Your ask is blocked waiting on someone else. */
  | "blocked"
  /** Your ask failed recently. */
  | "failed";

/** Whose move it is. "you" is the signed-in person. */
export type HostedInboxTurn = "you" | "waiting";

export interface HostedInboxActor {
  id: string;
  name: string;
  kind: "you" | "person" | "agent";
}

export interface HostedInboxItem {
  /** Stable across reads: kind plus the canonical record id. */
  id: string;
  kind: HostedInboxKind;
  /** The canonical record's own state, verbatim (unread, open, answered, pending, queued, running, waiting, failed). */
  state: string;
  turn: HostedInboxTurn;
  /** Who owns the next action. */
  next: HostedInboxActor;
  /** Who the row came from: the message author, the asking agent, or the ask's target. */
  from: { id: string; name: string };
  space: { id: string; title: string; slug?: string };
  channel: { id: string; title: string };
  /** The exact message the row points at, and its thread root when it is a reply. */
  messageId: string;
  rootMessageId: string | null;
  /** One line: an excerpt, the question, the approval title, or the ask summary. */
  title: string;
  detail?: string;
  at: number;
  /** Present only when the existing route for this record can act on it from here. */
  action?:
    | { kind: "mark-read"; messageId: string; rootMessageId: string | null }
    | { kind: "answer"; questionId: string; version: number; updatedAt: number }
    | { kind: "review"; questionId: string; version: number; updatedAt: number }
    | { kind: "decide"; flightId: string; blockId: string; version: number; requestVersion: number; risk: string };
  /** Muted channels still list responsibilities; this says the channel is muted. */
  muted?: boolean;
}

export type HostedInboxSpaceStatus =
  /** Read in full. */
  | "ok"
  /** The space refused this account: access was removed or never held. */
  | "denied"
  /** The space did not answer in time or failed; its rows are missing from this page. */
  | "unavailable";

export interface HostedInboxSpaceResult {
  status: HostedInboxSpaceStatus;
  /** Present for ok and unavailable spaces; a denied space is not named. */
  space?: { id: string; title: string; slug: string };
  /** A denied space's opaque id only, so a client can purge what it kept from it. */
  spaceId?: string;
  /** True when the space had more rows than one read returns. */
  truncated?: boolean;
}

export interface HostedInboxPage {
  items: HostedInboxItem[];
  spaces: HostedInboxSpaceResult[];
  /** Opaque; present when more spaces remain to be read. */
  nextCursor: string | null;
  /** Spaces the account can reach in all, across every page. */
  totalSpaces: number;
  computedAt: number;
}

/** Per-space bound on rows; the space reports `truncated` past it. */
export const HOSTED_INBOX_SPACE_ITEMS = 100;
/** Spaces read per page; each read is one Durable Object call. */
export const HOSTED_INBOX_SPACES_PER_PAGE = 12;
/** A failed ask stays listed this long; there is no separate dismissal record. */
export const HOSTED_INBOX_FAILED_WINDOW_MS = 72 * 60 * 60 * 1000;

const KIND_ORDER: Record<HostedInboxKind, number> = {
  approval: 0, question: 1, review: 2, mention: 3, failed: 4, blocked: 5, ask: 6,
};

/** Your turn first; inside each group the most urgent kind, then the newest. */
export function compareHostedInboxItems(left: HostedInboxItem, right: HostedInboxItem): number {
  if (left.turn !== right.turn) return left.turn === "you" ? -1 : 1;
  if (left.turn === "you" && KIND_ORDER[left.kind] !== KIND_ORDER[right.kind]) return KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
  return right.at - left.at || left.id.localeCompare(right.id);
}

export function hostedInboxSpacesCursor(offset: number): string {
  return `hinbox.v1.${offset}`;
}

export function readHostedInboxSpacesCursor(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return 0;
  const match = /^hinbox\.v1\.(\d{1,6})$/.exec(raw);
  return match ? Number(match[1]) : null;
}
