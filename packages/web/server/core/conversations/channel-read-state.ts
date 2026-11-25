import { readChatAttentionPreferences, readChatPins } from "@openscout/protocol";
import type { ChatReadState, ConversationDefinition, ConversationReadCursor } from "@openscout/protocol";
import { ScoutBrokerHttpError } from "@openscout/runtime/broker-api";
import { projectChatReadLane, type ChatReadMessage } from "../../../shared/chat-read-state.ts";

export const CHAT_ATTENTION_PAGE_LIMIT = 500;
export class ChatReadPositionError extends Error {}

export interface ChatReadFailure {
  status: 400 | 409 | 502;
  body: { error: string; detail?: string };
  /** HTTP status the runtime answered with, or null when it gave no answer. */
  runtimeStatus: number | null;
  /** The underlying reason, for the server log. */
  cause: string;
}

function runtimeRefusalDetail(error: ScoutBrokerHttpError): string {
  try {
    const parsed = JSON.parse(error.body) as { detail?: unknown; error?: unknown };
    if (typeof parsed.detail === "string" && parsed.detail.trim()) return parsed.detail;
    if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  } catch {
    // Not JSON: the raw body is the reason.
  }
  return error.body.trim().slice(0, 500) || `runtime returned ${error.status}`;
}

/**
 * Map a failed read-state call to a response. A runtime 4xx is a definite
 * answer about this request, so it is a 409 that carries the runtime's
 * reason. Only a runtime 5xx or no answer at all is a 502 that may be retried.
 */
export function describeChatReadFailure(
  error: unknown,
  messages: { refused: string; unavailable: string },
): ChatReadFailure {
  if (error instanceof ChatReadPositionError) {
    return { status: 400, body: { error: error.message }, runtimeStatus: null, cause: error.message };
  }
  if (error instanceof ScoutBrokerHttpError) {
    const detail = runtimeRefusalDetail(error);
    if (error.status >= 400 && error.status < 500) {
      return { status: 409, body: { error: messages.refused, detail }, runtimeStatus: error.status, cause: detail };
    }
    return { status: 502, body: { error: messages.unavailable }, runtimeStatus: error.status, cause: detail };
  }
  const cause = error instanceof Error ? error.message : String(error);
  return { status: 502, body: { error: messages.unavailable }, runtimeStatus: null, cause };
}

export interface ChannelReadDependencies {
  loadMessages(conversationId: string, limit: number): Promise<ChatReadMessage[]>;
  loadCursors(conversationId: string): Promise<ConversationReadCursor[]>;
  markRead(conversationId: string, actorId: string, messageId: string): Promise<unknown>;
}

export function chatReadConversations(channelId: string, conversations: ConversationDefinition[]) {
  return [
    { id: channelId, rootMessageId: null as string | null },
    ...conversations.filter((item) => item.kind === "thread" && item.parentConversationId === channelId && item.messageId)
      .map((item) => ({ id: item.id, rootMessageId: item.messageId! })),
  ];
}

export async function readChatChannelState(input: {
  channelId: string;
  actorId: string;
  conversations: ConversationDefinition[];
  dependencies: ChannelReadDependencies;
}): Promise<ChatReadState> {
  const rootCursors = input.dependencies.loadCursors(input.channelId);
  const lanes = await Promise.all(chatReadConversations(input.channelId, input.conversations).map(async (conversation) => {
    const [messages, cursors] = await Promise.all([
      input.dependencies.loadMessages(conversation.id, CHAT_ATTENTION_PAGE_LIMIT),
      conversation.id === input.channelId ? rootCursors : input.dependencies.loadCursors(conversation.id),
    ]);
    return projectChatReadLane({
      actorId: input.actorId,
      rootMessageId: conversation.rootMessageId,
      messages,
      cursor: cursors.find((cursor) => cursor.actorId === input.actorId),
      pageLimit: CHAT_ATTENTION_PAGE_LIMIT,
    });
  }));
  const cursors = await rootCursors;
  const preferences = readChatAttentionPreferences(cursors.find(cursor => cursor.actorId === input.actorId)?.metadata?.chatAttention);
  return { channelId: input.channelId, actorId: input.actorId, lanes, preferences, pins: readChatPins(input.conversations.find(item => item.id === input.channelId)?.metadata?.chatPins) };
}

/** The route supplies authenticated actor identity and a freshly authorized
 * room. No actor, timestamp, conversation or sequence is accepted from clients.
 */
export async function markChatChannelRead(input: {
  channelId: string;
  actorId: string;
  rootMessageId: string | null;
  messageId: string;
  conversations: ConversationDefinition[];
  dependencies: ChannelReadDependencies;
}) {
  const conversation = chatReadConversations(input.channelId, input.conversations)
    .find((item) => item.rootMessageId === input.rootMessageId);
  if (!conversation) throw new ChatReadPositionError("Thread does not belong to this channel.");
  const messages = await input.dependencies.loadMessages(conversation.id, CHAT_ATTENTION_PAGE_LIMIT);
  if (!messages.some((message) => message.id === input.messageId)) {
    throw new ChatReadPositionError("Read position is not in this conversation's current message page.");
  }
  await input.dependencies.markRead(conversation.id, input.actorId, input.messageId);
}
