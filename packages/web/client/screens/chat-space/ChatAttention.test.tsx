import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

import type { ChatReadState, ConversationDefinition } from "@openscout/protocol";

const { ChatAttention, ChatAttentionContent } = await import("./ChatAttention.tsx");
const { ChatQuestions } = await import("./ChatQuestions.tsx");
const { ChatRightPanel } = await import("./ChatRightPanel.tsx");

const channel = { id: "channel-general", title: "general" } as ConversationDefinition;
const states = {
  [channel.id]: {
    preferences: { notificationMode: "all", followedThreadIds: [], savedMessageIds: [] },
    lanes: [],
    pins: [],
  } as unknown as ChatReadState,
};
const callbacks = {
  onUnsave: () => {},
  onOpenSaved: () => {},
  onMode: () => {},
  onOpen: () => {},
  onUnfollow: () => {},
};
const props = {
  channels: [channel],
  channelId: channel.id,
  states,
  messages: [],
  busy: false,
  error: null,
  ...callbacks,
};

describe("ChatAttention", () => {
  test("keeps the local bell and tray, or renders only the bell for the hosted panel", () => {
    const tray = renderToStaticMarkup(createElement(ChatAttention, { ...props, open: true }));
    const bell = renderToStaticMarkup(createElement(ChatAttention, { ...props, open: true, showContent: false }));

    expect(tray).toContain("Activity and notifications");
    expect(tray).toContain('id="chat-attention-content"');
    expect(tray).toContain("Needs attention");
    expect(bell).toContain("Activity and notifications");
    expect(bell).not.toContain('id="chat-attention-content"');
  });

  test("renders the same activity model as organized panel content", () => {
    const markup = renderToStaticMarkup(createElement(ChatAttentionContent, { ...props, onClose: () => {} }));

    expect(markup).toContain("Activity notifications for this channel");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("Pinned in this channel");
    expect(markup).toContain("Saved messages");
    expect(markup).toContain("Followed threads");
    expect(markup).toContain("No new activity matching your preferences.");
  });

  test("lets the hosted panel choose a mode with segments and drops empty sections", () => {
    const tray = renderToStaticMarkup(createElement(ChatAttentionContent, { ...props, onClose: () => {} }));
    const panel = renderToStaticMarkup(createElement(ChatAttentionContent, { ...props, questionCounts: {}, layout: "panel", onClose: () => {} }));

    expect(tray).toContain("<select");
    expect(tray).not.toContain('role="radiogroup"');
    expect(panel).toContain('data-layout="panel"');
    expect(panel).toContain('role="radiogroup"');
    expect(panel).not.toContain("<select");
    expect(panel).toContain('aria-checked="true"');
    expect(panel).toContain("Nothing new.");
    for (const heading of ["Questions", "Unread", "Pinned", "Saved", "Followed threads"]) expect(panel).not.toContain(`<h3>${heading}`);
    expect(panel).not.toContain("No desktop notifications");
  });

  test("lists unread channels in the panel with a count and no filler sections", () => {
    const work = { id: "channel-work", title: "#scout/work" } as ConversationDefinition;
    const unreadStates = {
      ...states,
      [work.id]: {
        preferences: { notificationMode: "all", followedThreadIds: [], savedMessageIds: [] },
        lanes: [{ rootMessageId: null, unreadMessageIds: ["m1", "m2"], mentionMessageIds: [] }],
        pins: [],
      } as unknown as ChatReadState,
    };
    const panel = renderToStaticMarkup(createElement(ChatAttentionContent, {
      ...props, channels: [channel, work], states: unreadStates, layout: "panel", onClose: () => {},
    }));

    expect(panel).toContain("<h3>Unread</h3>");
    expect(panel).toContain("#scout/work");
    expect(panel).toContain('<span class="chat-attention-count">2</span>');
    expect(panel).not.toContain("Nothing new.");
    expect(panel).not.toContain("Saved");
  });

  test("opens Activity in the right sheet rather than above the feed", () => {
    const markup = renderToStaticMarkup(createElement(ChatRightPanel, {
      view: { kind: "activity" },
      channel,
      activity: createElement(ChatAttentionContent, { ...props, onClose: () => {} }),
      overlay: false,
      onClose: () => {},
    }));

    expect(markup).toContain('aria-label="Activity"');
    expect(markup).toContain('class="chat-rpanel-body chat-attention-panel"');
    expect(markup).toContain("Close panel");
    expect(markup).toContain("No new activity matching your preferences.");
  });

  test("does not call an unloaded roster empty", () => {
    const markup = renderToStaticMarkup(createElement(ChatRightPanel, {
      view: { kind: "members" }, channel, members: [], membersLoading: true,
      membersById: new Map(), invites: [], viewerActorId: "actor-arach",
      viewerIsOperator: false, nowMs: 0, overlay: false, onClose: () => {},
    }));
    expect(markup).toContain("Loading members…");
    expect(markup).not.toContain("The roster is empty.");
  });

  test("gives search and questions the same inspector frame", () => {
    for (const kind of ["search", "questions"] as const) {
      const title = kind === "search" ? "Search" : "Questions";
      const markup = renderToStaticMarkup(createElement(ChatRightPanel, {
        view: { kind }, channel, overlay: false, onClose: () => {},
      }));
      expect(markup).toContain(`aria-label="${title}"`);
      expect(markup).toContain(`>${title}</span>`);
      expect(markup).toContain("#general");
      expect(markup).toContain("Close panel");
      expect(markup).toContain("chat-rpanel-body chat-channel-tool-panel");
      expect(markup).toContain('data-channel-tools="true"');
      expect(markup).toContain("chat-rpanel-tools");
    }
  });

  test("names the Questions tool instead of showing a help glyph", () => {
    const markup = renderToStaticMarkup(createElement(ChatQuestions, {
      api: { questions: async () => ({ questions: [], nextCursor: null }) } as unknown as import("./chat-api.ts").ChatApi,
      channelId: channel.id,
      space: "scout",
      onChanged: () => {},
    }));
    expect(markup).toContain("chat-head-tool--questions");
    expect(markup).toContain("<span>Questions</span>");
    expect(markup).not.toContain("<svg");
  });
});
