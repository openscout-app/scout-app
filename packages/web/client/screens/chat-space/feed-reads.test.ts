import { expect, test } from "bun:test";
import type { ChannelFeed, ChatMessage } from "./chat-api.ts";
import { applyFeedRead, feedPosition } from "./feed-reads.ts";

const message = (id: string, createdAt: number, body = id): ChatMessage => ({ id, actorId: "maya", body, class: "agent", createdAt });
const room = (...messages: ChatMessage[]): ChannelFeed => ({ messages, requests: [], reachesStart: true });

test("the position is the newest message in the shared order", () => {
  expect(feedPosition([])).toBeNull();
  expect(feedPosition([message("b", 2), message("a", 3), message("c", 2)])).toBe("3|a");
  expect(feedPosition([message("a", 2), message("b", 2)])).toBe("2|b");
});

test("a catch-up reply adds what came after and keeps the rest of the room", () => {
  const held = room(message("a", 1), message("b", 2));
  const result = applyFeedRead(held, { messages: [message("c", 3)], requests: [], caughtUp: true }, 0);
  expect(result.feed.messages.map(item => item.id)).toEqual(["a", "b", "c"]);
  expect(result.feed.reachesStart).toBe(true);
  expect(result).toMatchObject({ readRoomAgain: false, held: false });
});

test("an empty catch-up reply changes nothing on screen", () => {
  const held = room(message("a", 1));
  expect(applyFeedRead(held, { messages: [], requests: [], caughtUp: true }, 0).feed.messages).toEqual(held.messages);
});

test("a catch-up reply that left a gap asks for a full read", () => {
  const result = applyFeedRead(room(message("a", 1)), { messages: [message("z", 9)], requests: [], caughtUp: false }, 0);
  expect(result.readRoomAgain).toBe(true);
});

test("a catch-up reply carrying a message already held keeps its newest revision", () => {
  const edited = { ...message("a", 1, "Edited"), metadata: { chatCorrection: { revision: 1, editedAt: 2, changedBy: "maya" } } };
  const result = applyFeedRead(room(edited), { messages: [message("a", 1, "Original")], requests: [], caughtUp: true }, 0);
  expect(result.feed.messages).toEqual([edited]);
});

test("one empty full read never empties a room with messages", () => {
  const held = room(message("a", 1), message("b", 2));
  const first = applyFeedRead(held, room(), 0);
  expect(first.held).toBe(true);
  expect(first.feed.messages).toEqual(held.messages);
  const second = applyFeedRead(held, room(), 1);
  expect(second.held).toBe(false);
  expect(second.feed.messages).toEqual([]);
});

test("an empty first read is the room's real empty state", () => {
  expect(applyFeedRead(null, room(), 0)).toMatchObject({ held: false, feed: { messages: [] } });
});

test("a full reply from a server that ignores catch-up replaces the window", () => {
  const result = applyFeedRead(room(message("a", 1)), room(message("b", 2), message("c", 3)), 0);
  expect(result.feed.messages.map(item => item.id)).toEqual(["b", "c"]);
});
