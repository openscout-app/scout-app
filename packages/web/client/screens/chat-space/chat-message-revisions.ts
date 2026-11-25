import { voiceNoteTranscriptions } from "../../../shared/voice-note-transcription.ts";
import { readChatMessageCorrection } from "@openscout/protocol";
import type { ChatMessage } from "./chat-api.ts";

/** A poll started before a confirmed edit must not restore an earlier body. */
export function newestChatMessage(current: ChatMessage | undefined, incoming: ChatMessage): ChatMessage {
  if (!current || current.id !== incoming.id) return incoming;
  const previousRevision = readChatMessageCorrection(current.metadata)?.revision ?? 0;
  const incomingRevision = readChatMessageCorrection(incoming.metadata)?.revision ?? 0;
  if (previousRevision > incomingRevision) return current;
  if (incomingRevision > previousRevision) return incoming;
  const notes = voiceNoteTranscriptions(incoming.metadata);
  const rank = { queued: 0, processing: 1, failed: 2, ready: 3 };
  let preserved = false;
  for (const [id, value] of Object.entries(voiceNoteTranscriptions(current.metadata))) {
    if (!incoming.attachments?.some(attachment => attachment.id === id)) continue;
    const next = notes[id];
    if (!next || value.updatedAt > next.updatedAt || value.updatedAt === next.updatedAt && rank[value.status] > rank[next.status]) {
      notes[id] = value; preserved = true;
    }
  }
  return preserved ? { ...incoming, metadata: { ...incoming.metadata, voiceNotes: notes } } : incoming;
}
export function mergeChatMessageRevisions(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const known = new Map(current.map(message => [message.id, message]));
  return incoming.map(message => newestChatMessage(known.get(message.id), message));
}
