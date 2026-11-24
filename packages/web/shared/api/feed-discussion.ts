/** The read-only portion of the production /api/messages response used by the
 * discussion opened from a Feed head. IDs are opaque, not display names. */
export type DiscussionMessage = {
  id: string;
  conversationId: string;
  chatId: string;
  cId: string;
  actorId: string;
  actorName: string;
  body: string;
  createdAt: number;
  class: string;
  replyToMessageId: string | null;
  threadConversationId: string | null;
};
