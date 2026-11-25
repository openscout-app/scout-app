/**
 * Scout direct conversations in Chats.
 *
 * Rooms and DMs share one list per tab. Slack's DMs arrive with Slack's own
 * catalog. Scout's arrive here, from the same conversation list the old
 * Direct page read: the operator's own DMs, as the runtime records them. No
 * row is invented and no transcript is imported.
 *
 * A DM belongs to a provider only when a record says so. A DM on this host's
 * runtime is Scout's. A DM read from another host through the host proxy has
 * no place on this host's Scout list, so it is listed in All only, named with
 * its host. Nothing in the conversation list links a Scout DM to Slack, so no
 * Scout DM is ever placed under Slack.
 */

import type { ConversationDefinition } from "@openscout/protocol";
import { conversationDisplayTitle, isOperatorDm } from "../../lib/conversations.ts";
import type { SessionEntry } from "../../lib/types.ts";
import type { RoomFamily } from "./rooms-navigation.ts";

export interface RoomsDirect {
  id: string;
  title: string;
  /** "scout" when this host's runtime holds it; null when only All may list it. */
  provider: "scout" | null;
  /** The host a proxied DM lives on. */
  hostId: string | null;
  hostName: string | null;
  kind: "direct" | "group_direct";
  participantIds: string[];
  lastMessageAt: number | null;
}

export function roomsDirectsFromConversations(sessions: readonly SessionEntry[]): RoomsDirect[] {
  return sessions
    .filter(isOperatorDm)
    .map((entry): RoomsDirect => ({
      id: entry.id,
      title: conversationDisplayTitle(entry),
      provider: entry.remoteMachineId ? null : "scout",
      hostId: entry.remoteMachineId ?? null,
      hostName: entry.remoteMachineId ? entry.remoteMachineName ?? entry.remoteMachineId : null,
      kind: entry.kind === "group_direct" ? "group_direct" : "direct",
      participantIds: entry.participantIds,
      lastMessageAt: entry.lastMessageAt,
    }))
    .sort((left, right) => (right.lastMessageAt ?? 0) - (left.lastMessageAt ?? 0)
      || left.title.localeCompare(right.title));
}

/** The Scout DMs a tab lists. Slack's tab lists Slack's own DMs instead. */
export function roomsDirectsForFamily(directs: readonly RoomsDirect[], family: RoomFamily): RoomsDirect[] {
  if (family === "all") return [...directs];
  if (family === "scout") return directs.filter((direct) => direct.provider === "scout");
  return [];
}

/**
 * A row for Scout's room list. The list draws conversations; this one is
 * marked so selecting it opens the DM rather than asking Scout's room API,
 * which serves channels only.
 */
export function roomsDirectConversation(direct: RoomsDirect): ConversationDefinition {
  return {
    id: direct.id,
    kind: direct.kind,
    title: direct.title,
    visibility: "private",
    shareMode: "local",
    authorityNodeId: "",
    participantIds: direct.participantIds,
    metadata: { roomsDirect: true },
  };
}
