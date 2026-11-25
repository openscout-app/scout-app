import { readChatMessageCorrection } from "@openscout/protocol";
import type { ChatMessage } from "./chat-api.ts";

export function chatMessagePreviewText(message: ChatMessage): string {
  if (readChatMessageCorrection(message.metadata)?.deletedAt != null) return "Message deleted";
  const richText = message.content?.flatMap((block) => {
    if ("text" in block && block.text) return [block.text];
    if (block.type === "attachment" && block.title) return [block.title];
    return [];
  })[0];
  return message.body.trim().slice(0, 100)
    || richText?.replace(/[*_~`[\]()>]/gu, "").trim().slice(0, 100)
    || message.attachments?.map(file => file.fileName || "Attachment").join(", ").slice(0, 100)
    || "Empty message";
}
