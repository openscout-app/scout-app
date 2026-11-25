import type { ConversationDefinition } from "@openscout/protocol";
import type { ChatBootstrap, ChatChannelLastMessage, ChatSpaceView } from "./chat-api.ts";
import { defaultRoomSpace, type RoomSource } from "./rooms-navigation.ts";

export interface RoomsCatalogApi {
  bootstrap(options?: { recoverSession?: boolean; space?: string | null }): Promise<ChatBootstrap>;
  spaces(): Promise<{ spaces: ChatSpaceView[] }>;
}

export interface RoomsCatalogSpace {
  id: string;
  title: string;
  conversations: ConversationDefinition[];
  lastMessages: Record<string, ChatChannelLastMessage>;
}

export interface RoomsCatalog {
  source: RoomSource;
  name: string;
  spaces: RoomsCatalogSpace[];
}

export async function readRoomsCatalog(api: RoomsCatalogApi, source: RoomSource): Promise<RoomsCatalog> {
  const initial = await api.bootstrap({ recoverSession: true, space: null });
  const fallbackSpace: ChatSpaceView = {
    slug: initial.space ?? defaultRoomSpace(source),
    title: source === "slack" ? "Slack" : "Home",
    conversationId: null,
    isDefault: true,
  };
  const spaces = initial.spaces?.length ? initial.spaces : [fallbackSpace];
  const readings = await Promise.all(spaces.map(async (space): Promise<RoomsCatalogSpace> => {
    const bootstrap = initial.space === space.slug
      ? initial
      : await api.bootstrap({ recoverSession: true, space: space.slug });
    return {
      id: bootstrap.space ?? space.slug,
      title: space.title,
      conversations: bootstrap.channels,
      lastMessages: bootstrap.lastMessages ?? {},
    };
  }));
  return {
    source,
    name: source === "slack" && initial.source?.kind === "slack" ? initial.source.name : source === "slack" ? "Slack" : "Scout",
    spaces: readings,
  };
}
