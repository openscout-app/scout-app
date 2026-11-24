import { describe, expect, test } from "bun:test";
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PostActions } from "./PostActions.tsx";
import { PostDetail } from "./PostDetail.tsx";
import { FeedCapabilitiesProvider } from "./feed-capabilities.tsx";

function head(partial: Partial<FeedPostHead> = {}): FeedPostHead {
  return {
    id: "post:a", version: 1, day: "2026-11-16", at: 1, class: "landed", reviewed: false, selected: true, score: 1, title: "Fix the sidebar",
    caption: "It fits now.", writtenBy: "reply", line: null, agent: { name: "ada", harness: "claude" }, others: 0, thread: null, state: "done",
    lead: { kind: "text", ref: null }, change: null, joined: [], prs: [], prCount: 0, forYou: null, backToYou: false, updates: 0, workId: "work-1", conversationId: null,
    owner: { agentId: "agent-ada", sessionId: null, cwd: null }, study: null, project: null, ...partial,
  };
}

const draw = (post: FeedPostHead, sheet: boolean): string =>
  renderToStaticMarkup(React.createElement(PostActions, { post, navigate: () => {}, sheet }));

describe("the box to write to the agent", () => {
  test("in the lightbox it is open under the moves, and says where the words go", () => {
    const html = draw(head({ owner: { agentId: "agent-ada", sessionId: "s-1", cwd: null } }), true);
    expect(html).toContain('class="rb"');
    expect(html).toContain('placeholder="Steer ada"');
    expect(html).toContain("Goes to its session.");
    // One box: no single-line field and no word button beside it.
    expect(html).not.toContain("pa-field");
    expect(html).not.toContain(">Send<");
  });

  test("without a session it follows up on the work", () => {
    const html = draw(head(), true);
    expect(html).toContain('placeholder="Follow up with ada"');
    expect(html).toContain("Goes as a follow-up task.");
  });

  test("an agent's own post is answered with a reply", () => {
    const html = draw(head({ agentPost: { own: true } as FeedPostHead["agentPost"], owner: { agentId: "agent-ada", sessionId: "s-1", cwd: null } }), true);
    expect(html).toContain('placeholder="Reply to ada"');
  });

  test("in the stream it stays closed until Continue opens it", () => {
    const html = draw(head(), false);
    expect(html).not.toContain('class="rb"');
    expect(html).toContain("Continue");
  });

  test("send is a round button that waits for text", () => {
    const html = draw(head(), true);
    expect(html).toMatch(/<button type="button" class="rb-send" aria-label="Send"[^>]*disabled=""/);
  });
});

test("the detail shows the outcome and links back to the discussion that produced it", () => {
  const post = head({ conversationId: "thread/1", owner: { agentId: "agent-ada", sessionId: "session/2", cwd: null } });
  const detail = <PostDetail post={post} navigate={() => {}} leadShown={false} detail={{
    id: post.id, version: post.version, asked: "Make the drawer fit.", branch: null,
    body: { landed: "The drawer fits.", checks: null, next: null, open: null },
    earlier: [], prs: [], leads: [], diff: null, agents: [], posterCandidates: [],
  }} />;
  const html = renderToStaticMarkup(detail);
  expect(html).toContain("The drawer fits.");
  expect(html).toContain('href="/c/thread%2F1?workId=work-1"');
  expect(html).toContain('href="/sessions/session%2F2"');
  expect(html).toContain('href="/work/work-1"');
  expect(html).toContain('href="/?post=post%3Aa"');

  const readOnly = renderToStaticMarkup(
    <FeedCapabilitiesProvider capabilities={{ readOnly: true }}>{detail}</FeedCapabilitiesProvider>,
  );
  expect(readOnly).toContain('href="/c/thread%2F1?workId=work-1"');
  expect(readOnly).toContain('href="/sessions/session%3Aclaude%3Asession%2F2"');
  expect(readOnly).not.toContain('href="/work/work-1"');
});
