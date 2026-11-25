import { describe, expect, test } from "bun:test";
import type { ConversationDefinition } from "@openscout/protocol";
import type { ChatBootstrap } from "./chat-api.ts";
import { readRoomsCatalog, type RoomsCatalogApi } from "./rooms-catalog.ts";

const viewer = { actorId: "operator", displayName: "Operator", isOperator: true } as ChatBootstrap["viewer"];
const conversation = (id: string, title: string): ConversationDefinition => ({ id, title, kind: "channel" } as ConversationDefinition);

describe("Rooms catalogs", () => {
  test("reads every accessible Scout space and keeps their room identities separate", async () => {
    const requested: Array<string | null | undefined> = [];
    const api: RoomsCatalogApi = {
      async bootstrap(options) {
        requested.push(options?.space);
        if (options?.space === "research") {
          return { viewer, space: "research", channels: [conversation("shared-id", "Research room")] };
        }
        return {
          viewer,
          space: "home",
          channels: [conversation("shared-id", "Home room")],
          spaces: [
            { slug: "home", title: "Home", conversationId: null, isDefault: true },
            { slug: "research", title: "Research", conversationId: null, isDefault: false },
          ],
        };
      },
      async spaces() { throw new Error("The bootstrap already supplied the spaces"); },
    };
    const catalog = await readRoomsCatalog(api, "scout");
    expect(requested).toEqual([null, "research"]);
    expect(catalog.spaces.map((space) => [space.id, space.conversations[0].title])).toEqual([
      ["home", "Home room"],
      ["research", "Research room"],
    ]);
    expect(catalog.spaces[0].conversations[0].id).toBe(catalog.spaces[1].conversations[0].id);
  });

  test("uses the connected Slack workspace name and supports a pre-spaces backend", async () => {
    const api: RoomsCatalogApi = {
      async bootstrap() {
        return {
          viewer,
          source: { kind: "slack", name: "Example workspace" },
          channels: [conversation("C1", "#general")],
        };
      },
      async spaces() { throw new Error("A single-place backend does not need another request"); },
    };
    const catalog = await readRoomsCatalog(api, "slack");
    expect(catalog.name).toBe("Example workspace");
    expect(catalog.spaces).toHaveLength(1);
    expect(catalog.spaces[0].id).toBe("slack");
    expect(catalog.spaces[0].conversations[0].title).toBe("#general");
  });
});
