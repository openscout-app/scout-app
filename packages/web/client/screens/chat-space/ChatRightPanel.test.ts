import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { ChatMessage } from "./chat-api.ts";
import { replyContinues } from "./ChatRightPanel.tsx";
import { TURN_GROUP_WINDOW_MS } from "./chat-space-model.ts";

const reply = (id: string, actorId: string, createdAt: number) => ({ id, actorId, createdAt }) as unknown as ChatMessage;

describe("thread reply grouping", () => {
  test("the first reply always opens a block", () => {
    expect(replyContinues([reply("a", "ada", 0)], 0)).toBe(false);
  });

  test("same author inside the window continues; a new author or a long pause does not", () => {
    const replies = [
      reply("a", "ada", 0),
      reply("b", "ada", 60_000),
      reply("c", "bo", 90_000),
      reply("d", "bo", 90_000 + TURN_GROUP_WINDOW_MS + 1),
    ];
    expect(replyContinues(replies, 1)).toBe(true);
    expect(replyContinues(replies, 2)).toBe(false);
    expect(replyContinues(replies, 3)).toBe(false);
  });
});

test("members keeps channel read bookkeeping out of its header", () => {
  const source = readFileSync(new URL("./ChatRightPanel.tsx", import.meta.url), "utf8");
  const members = source.slice(source.indexOf('aria-label="Members"'));
  const header = members.slice(0, members.indexOf("</header>"));
  expect(header).not.toContain("onMarkChannelRead");
  expect(header).toContain("inChannel.length");
  expect(members).toContain("chat-channel-actions");
  expect(members).toContain("Mark all as read");
});
