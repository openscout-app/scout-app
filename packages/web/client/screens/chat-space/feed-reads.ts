import { compareMessagesAsc, encodeMessageHistoryCursor } from "../../../shared/message-pagination.ts";
import type { ChannelFeed, ChatMessage } from "./chat-api.ts";
import { mergeChatMessageRevisions, newestChatMessage } from "./chat-message-revisions.ts";
import { mergeChatRequestResponsibilities } from "./chat-request-state.ts";

/**
 * How a room's messages stay current without reading the room again on every
 * poll. A room is append-mostly, so the page reads it whole once, then asks
 * only for what came after the newest message it holds. A full read still
 * runs now and then, because an edit, a deletion or a reaction on an older
 * message is not an append.
 */

/** How often a catch-up read is replaced by a full read of the room. */
export const FEED_FULL_READ_MS = 30_000;

/** The newest position the page holds, as the server's history cursor. */
export function feedPosition(messages: readonly ChatMessage[]): string | null {
  let newest: ChatMessage | null = null;
  for (const message of messages) {
    if (!newest || compareMessagesAsc(message, newest) > 0) newest = message;
  }
  return newest ? encodeMessageHistoryCursor(newest) : null;
}

export type FeedReadResult = {
  feed: ChannelFeed;
  /** A catch-up reply left a gap: read the room in full now. */
  readRoomAgain: boolean;
  /** An empty full read was not shown; the next full read decides. */
  held: boolean;
};

/**
 * Fold one reply into what the page holds.
 *
 * A reply that carries `caughtUp` answered a catch-up read: its messages are
 * added to the ones on screen. Any other reply is a full read and replaces
 * them, except that an empty full read never empties a room that has messages
 * on the first time it is seen. A slow or short read looks exactly like that,
 * and a room flipping to its "nothing has been posted" intro is the failure
 * this guards against. `emptyFullReads` counts the empty full reads in a row,
 * so a room whose messages really were all deleted empties on the next full
 * read, one full-read interval later.
 */
export function applyFeedRead(
  previous: ChannelFeed | null,
  next: ChannelFeed,
  emptyFullReads: number,
): FeedReadResult {
  const requests = mergeChatRequestResponsibilities(previous?.requests ?? [], next.requests);
  if (typeof next.caughtUp === "boolean") {
    const byId = new Map((previous?.messages ?? []).map((message) => [message.id, message]));
    for (const message of next.messages) byId.set(message.id, newestChatMessage(byId.get(message.id), message));
    const messages = [...byId.values()].sort(compareMessagesAsc);
    return {
      feed: { ...previous, messages, requests, reachesStart: previous?.reachesStart },
      readRoomAgain: !next.caughtUp,
      held: false,
    };
  }
  const held = previous?.messages ?? [];
  if (next.messages.length === 0 && held.length > 0 && emptyFullReads < 1) {
    return { feed: { ...previous!, requests }, readRoomAgain: false, held: true };
  }
  return {
    feed: { ...next, messages: mergeChatMessageRevisions(held, next.messages), requests },
    readRoomAgain: false,
    held: false,
  };
}
