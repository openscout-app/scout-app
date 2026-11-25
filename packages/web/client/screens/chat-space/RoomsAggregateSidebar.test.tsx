import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import type { ConversationDefinition } from "@openscout/protocol";
import { directRowLabel, RoomsAggregateSidebar, roomRowLabel } from "./RoomsAggregateSidebar.tsx";
import type { RoomsDirect } from "./rooms-directs.ts";
import type { RoomsCatalog } from "./rooms-catalog.ts";

// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
const conversation = (id: string, title: string): ConversationDefinition => ({ id, title, kind: "channel" } as ConversationDefinition);
const places: RoomsCatalog[] = [
  { source: "scout", name: "Scout", spaces: [{ id: "home", title: "Home", conversations: [conversation("shared", "Scout design")], lastMessages: {} }] },
  { source: "slack", name: "Example workspace", spaces: [{ id: "slack", title: "Slack", conversations: [conversation("shared", "#design")], lastMessages: {} }] },
];

const scoutDirect: RoomsDirect = { id: "dm-1", title: "Ada", provider: "scout", hostId: null, hostName: null, kind: "direct", participantIds: ["operator", "ada"], lastMessageAt: 1 };
const hostDirect: RoomsDirect = { id: "dm-2", title: "Cy", provider: null, hostId: "host-2", hostName: "Studio", kind: "direct", participantIds: ["operator", "cy"], lastMessageAt: 1 };

function draw(errors: string[] = [], options: { loading?: boolean; places?: RoomsCatalog[]; directs?: RoomsDirect[]; activeDirectId?: string | null } = {}) {
  return renderToStaticMarkup(createElement(RoomsAggregateSidebar, {
    places: options.places ?? places,
    loading: options.loading ?? false,
    errors,
    onRetry: () => {},
    activeSource: "scout",
    activeSpace: "home",
    activeChannelId: "shared",
    readStates: {},
    onSelect: () => {},
    directs: options.directs,
    activeDirectId: options.activeDirectId,
  }));
}

describe("All channels sidebar", () => {
  test("groups identical channel ids by provider and marks only the actual open room", () => {
    const markup = draw();
    expect(markup).toContain("Scout design");
    expect(markup).toContain("#design");
    expect(markup).toContain("Example workspace");
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="Scout design, Scout"');
    expect(markup).toContain('aria-label="#design, Slack"');
  });

  test("states a provider read failure instead of presenting an empty catalog", () => {
    const markup = draw(["Slack channels could not be refreshed. Connection lost."]);
    expect(markup).toContain("Slack channels could not be refreshed. Connection lost.");
    expect(markup).toContain("Try again");
  });

  test("does not call an unread catalog empty", () => {
    const markup = draw([], { loading: true, places: [] });
    expect(markup).toContain("Loading channels");
    expect(markup).not.toContain("No conversations are available");
  });

  test("keeps the unread count in the row's accessible name", () => {
    const scout = places[0];
    const space = scout.spaces[0];
    expect(roomRowLabel("design", scout, space, "3")).toBe("design, Scout, 3 unread");
    expect(roomRowLabel("design", scout, space, "3+")).toBe("design, Scout, 3 unread or more");
    expect(roomRowLabel("design", scout, space, "+")).toBe("design, Scout, unread");
    const twoSpaces = { ...scout, spaces: [space, { ...space, id: "research", title: "Research" }] };
    expect(roomRowLabel("design", twoSpaces, twoSpaces.spaces[1], null)).toBe("design, Scout, Research");
  });

  test("lists Scout DMs under Scout and DMs on other hosts apart, naming the host", () => {
    const markup = draw([], { directs: [scoutDirect, hostDirect] });
    expect(markup).toContain('aria-label="Ada, Scout direct message"');
    expect(markup).toContain('aria-label="Cy, direct message on Studio"');
    expect(markup).toContain("Other hosts");
    const scoutSection = markup.slice(markup.indexOf('aria-label="Scout rooms"'), markup.indexOf('aria-label="Slack rooms"'));
    expect(scoutSection).toContain("Ada");
    expect(scoutSection).not.toContain("Cy");
  });

  test("an open DM is the one current row", () => {
    const markup = draw([], { directs: [scoutDirect], activeDirectId: "dm-1" });
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toMatch(/data-direct-id="dm-1"[^>]*aria-current="page"|aria-current="page"[^>]*data-direct-id="dm-1"/);
  });

  test("a failed Scout catalog still leaves Scout DMs reachable", () => {
    const markup = draw(["Scout channels could not be refreshed. Runtime unreachable."], { directs: [scoutDirect], places: [places[1]] });
    expect(markup).toContain('aria-label="Scout direct messages"');
    expect(directRowLabel(scoutDirect)).toBe("Ada, Scout direct message");
  });
});
