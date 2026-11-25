import { describe, expect, test } from "bun:test";
import { conversationStep, type ConversationNavigationRow } from "./chat-conversation-navigation.ts";

const rows: ConversationNavigationRow[] = [
  { id: "a", unread: false, mentioned: false, muted: false },
  { id: "b", unread: true, mentioned: false, muted: false },
  { id: "c", unread: true, mentioned: false, muted: true },
  { id: "d", unread: true, mentioned: true, muted: true },
  { id: "e", unread: false, mentioned: false, muted: false },
];

describe("conversationStep", () => {
  test("moves in display order without wrapping", () => {
    expect(conversationStep(rows, "a", 1, false)).toBe("b");
    expect(conversationStep(rows, "b", -1, false)).toBe("a");
    expect(conversationStep(rows, "e", 1, false)).toBeNull();
    expect(conversationStep(rows, "a", -1, false)).toBeNull();
  });

  test("finds unread conversations and skips muted rows without mentions", () => {
    expect(conversationStep(rows, "a", 1, true)).toBe("b");
    expect(conversationStep(rows, "b", 1, true)).toBe("d");
    expect(conversationStep(rows, "d", -1, true)).toBe("b");
    expect(conversationStep(rows, "d", 1, true)).toBeNull();
  });

  test("starts at the nearest edge when no conversation is selected", () => {
    expect(conversationStep(rows, null, 1, false)).toBe("a");
    expect(conversationStep(rows, null, -1, true)).toBe("d");
    expect(conversationStep([], null, 1, false)).toBeNull();
  });
});
