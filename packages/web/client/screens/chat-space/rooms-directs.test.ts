import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "../../lib/types.ts";
import { roomsDirectConversation, roomsDirectsForFamily, roomsDirectsFromConversations } from "./rooms-directs.ts";

const entry = (overrides: Partial<SessionEntry>): SessionEntry => ({
  id: "conv",
  kind: "direct",
  title: "conv",
  participantIds: ["operator", "agent-a"],
  lastMessageAt: null,
  ...overrides,
} as SessionEntry);

const sessions: SessionEntry[] = [
  entry({ id: "dm-older", title: "Ada", lastMessageAt: 100 }),
  entry({ id: "dm-newer", title: "Brook", lastMessageAt: 300 }),
  entry({ id: "dm-remote", title: "Cy", lastMessageAt: 200, remoteMachineId: "host-2", remoteMachineName: "Studio" }),
  entry({ id: "observed", title: "Agents talking", participantIds: ["agent-a", "agent-b"], lastMessageAt: 400 }),
  entry({ id: "room", kind: "channel", title: "design", participantIds: ["operator"], lastMessageAt: 500 }),
  entry({ id: "group", kind: "group_direct", title: "Trio", participantIds: ["operator", "agent-a", "agent-b"], lastMessageAt: 50 }),
];

describe("Scout DMs in Chats", () => {
  test("lists the operator's own DMs only, newest first", () => {
    const directs = roomsDirectsFromConversations(sessions);
    expect(directs.map((direct) => direct.id)).toEqual(["dm-newer", "dm-remote", "dm-older", "group"]);
    // Observed agent-to-agent directs and channels are not DMs of the operator.
    expect(directs.some((direct) => direct.id === "observed" || direct.id === "room")).toBe(false);
  });

  test("a DM on this host is Scout's; a DM on another host has no provider and names its host", () => {
    const directs = roomsDirectsFromConversations(sessions);
    expect(directs.find((direct) => direct.id === "dm-older")).toMatchObject({ provider: "scout", hostId: null });
    expect(directs.find((direct) => direct.id === "dm-remote")).toMatchObject({ provider: null, hostId: "host-2", hostName: "Studio" });
  });

  test("All lists every DM, Scout only its own, and Slack none of Scout's", () => {
    const directs = roomsDirectsFromConversations(sessions);
    expect(roomsDirectsForFamily(directs, "all")).toHaveLength(4);
    expect(roomsDirectsForFamily(directs, "scout").map((direct) => direct.id)).toEqual(["dm-newer", "dm-older", "group"]);
    expect(roomsDirectsForFamily(directs, "slack")).toEqual([]);
  });

  test("a Scout DM row keeps its kind and is marked as a DM, not a room", () => {
    const [group] = roomsDirectsFromConversations([sessions[5]]);
    const row = roomsDirectConversation(group);
    expect(row).toMatchObject({ id: "group", kind: "group_direct", title: "Trio", metadata: { roomsDirect: true } });
  });
});
