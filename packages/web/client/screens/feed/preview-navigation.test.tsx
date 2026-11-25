import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { ReadOnlyPostActions } from "./ReadOnlyPostActions.tsx";

const head = { conversationId: "chat/one", workId: "work?x&y", owner: { sessionId: "original/turn" }, agent: { harness: "codex" } } as FeedPostHead;
const render = (post: FeedPostHead) => renderToStaticMarkup(<ReadOnlyPostActions post={post} navigate={() => {}} />);

test("Open in Chat carries both opaque IDs, not a channel's latest messages", () => {
  const html = render(head);
  expect(html).toContain('href="/c/chat%2Fone?workId=work%3Fx%26y"');
  expect(html).toContain("Open in Chat");
  expect(html).not.toMatch(/textarea|<button|>Ship|>Hide|>React|>Continue/);
});
test("a standalone post can only offer its qualified recorded session", () => {
  expect(render({ ...head, conversationId: null })).toContain('href="/sessions/session%3Acodex%3Aoriginal%2Fturn"');
  expect(render({ ...head, conversationId: null, owner: { ...head.owner, sessionId: null } })).toBe("");
});
