import { describe, expect, mock, test } from "bun:test";

import type { ScoutbotAssistantSessionState } from "./scoutbot-model.ts";

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
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const { ChatHistory } = await import("./ScoutbotChat.tsx");
const { ScoutbotThinking } = await import("../../components/ScoutbotThinking.tsx");

const state: ScoutbotAssistantSessionState = {
  session: {
    id: "session-current",
    title: "Dispatch failures",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    model: "gpt-test",
    messageCount: 1,
    messages: [{
      id: "message-1",
      role: "user",
      body: "First failed example",
      createdAt: 1_700_000_001_000,
    }],
  },
  sessions: [{
    id: "session-current",
    title: "Dispatch failures",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
    model: "gpt-test",
    messageCount: 1,
  }],
  config: {
    editable: true,
    model: "gpt-test",
    systemPrompt: "test",
  },
};

function renderHistory(options: { startingNewChat?: boolean; sessionPickerOpen?: boolean; sending?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ChatHistory, {
      state,
      sessionPickerOpen: options.sessionPickerOpen ?? false,
      onToggleSessionPicker: () => undefined,
      onStartNewChat: () => undefined,
      startingNewChat: options.startingNewChat ?? false,
      onSwitchSession: () => undefined,
      switchingSessionId: null,
      sending: options.sending ?? false,
      briefing: false,
      pendingAsk: null,
      onArchiveSession: () => undefined,
      archivingSessionId: null,
    }),
  );
}

describe("ChatHistory", () => {
  test("keeps the dock figure decorative when its button announces the status", () => {
    const html = renderToStaticMarkup(createElement(ScoutbotThinking, { decorative: true }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Scoutbot is thinking");
  });
  test("shows Scoutbot's thinking figure only while a reply is pending", () => {
    const pending = renderHistory({ sending: true });
    expect(pending).toContain('class="scoutbot-thinking"');
    expect(pending).toContain('class="sr-only">Scoutbot is thinking');
    expect(pending).toContain('role="status"');
    expect(pending).not.toContain('>Thinking<');
    expect(renderHistory()).not.toContain('class="scoutbot-thinking"');
  });
  test("shows the thread without session mechanics", () => {
    const html = renderHistory();

    expect(html).toContain("First failed example");
    // no session title, id, message count, or chat switcher in front of the thread
    expect(html).not.toContain("Dispatch failures");
    expect(html).not.toContain("session-current");
    expect(html).not.toContain("msg");
    expect(html).not.toContain("Earlier conversations");
  });

  test("says where an old thread picks up and offers a fresh start", () => {
    const html = renderHistory();

    // the fixture's last message is from 2023
    expect(html).toContain("Picks up from");
    expect(html).toContain("Start fresh");
  });

  test("lists earlier conversations by title when the menu opens them", () => {
    const html = renderHistory({ sessionPickerOpen: true });

    expect(html).toContain("Earlier conversations");
    expect(html).toContain("Dispatch failures");
    expect(html).toContain("Current");
    expect(html).toContain('aria-label="Start fresh"');
    expect(html).not.toContain("session-current");
  });

  describe("offers", () => {
    const offered = [
      "Hudson owns that lane.",
      "```scout-ui",
      JSON.stringify({ type: "ask-agent", offer: true, targetLabel: "hudson", body: "Main is red. Can you look?" }),
      "```",
    ].join("\n");
    const reply = { id: "message-2", role: "assistant" as const, body: offered, createdAt: 1_700_000_002_000 };
    const followUp = { id: "message-3", role: "user" as const, body: "Thanks", createdAt: 1_700_000_003_000 };

    function renderThread(
      messages: ScoutbotAssistantSessionState["session"]["messages"],
      options: { handlers?: boolean; sending?: boolean } = {},
    ): string {
      return renderToStaticMarkup(
        createElement(ChatHistory, {
          state: { ...state, session: { ...state.session, messages } },
          sessionPickerOpen: false,
          onToggleSessionPicker: () => undefined,
          onStartNewChat: () => undefined,
          startingNewChat: false,
          onSwitchSession: () => undefined,
          switchingSessionId: null,
          sending: options.sending ?? false,
          briefing: false,
          pendingAsk: options.sending ? "Next question" : null,
          onArchiveSession: () => undefined,
          archivingSessionId: null,
          ...(options.handlers === false
            ? {}
            : { onRunOffer: () => undefined, onSendOffer: async () => undefined }),
        }),
      );
    }

    test("shows an offered message under the reply, as a draft with Send", () => {
      const html = renderThread([...state.session.messages, reply]);

      expect(html).toContain("Hudson owns that lane.");
      expect(html).toContain("Main is red. Can you look?");
      expect(html).toContain(">Send</button>");
      // the action block itself never shows
      expect(html).not.toContain("scout-ui");
      expect(html).not.toContain("ask-agent");
    });

    test("drops the offer once the operator has moved on, or is asking again", () => {
      expect(renderThread([...state.session.messages, reply, followUp])).not.toContain(">Send</button>");
      expect(renderThread([...state.session.messages, reply], { sending: true })).not.toContain(">Send</button>");
    });

    test("draws no offer where the host cannot run one", () => {
      const html = renderThread([...state.session.messages, reply], { handlers: false });

      expect(html).toContain("Hudson owns that lane.");
      expect(html).not.toContain(">Send</button>");
      expect(html).not.toContain("Main is red. Can you look?");
    });
  });

  test("disables starting fresh while a new conversation is being created", () => {
    const html = renderHistory({ startingNewChat: true, sessionPickerOpen: true });

    expect(html).toContain("Starting");
    expect(html).toContain("disabled");
  });
});
