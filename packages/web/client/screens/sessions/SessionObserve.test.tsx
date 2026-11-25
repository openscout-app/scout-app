import { describe, expect, mock, test } from "bun:test";

import { describeObserveEvidence } from "../../lib/observe-fidelity.ts";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../node_modules/react-dom/server.node.js");

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));
mock.module("../../lib/api.ts", () => ({
  api: async () => {
    throw new Error("Unexpected API call during static observe rendering.");
  },
  peekApiGet: () => null,
  refreshSessionAuth: async () => false,
}));
mock.module("../../lib/sse.ts", () => ({
  isBrokerDataEvent: () => false,
  isBrokerEventStreamLive: () => false,
  isBrokerReconcileEvent: () => false,
  onBrokerEventStreamLiveChange: () => () => undefined,
  useBrokerEvents: () => undefined,
  useBrokerEventsRefresh: () => undefined,
  observeBrokerEvents: () => () => undefined,
  subscribeBrokerEvents: () => () => undefined,
}));
mock.module("../../scout/Provider.tsx", () => ({
  useScout: () => ({ navigate: () => undefined }),
  useOptionalScout: () => ({ navigate: () => undefined }),
}));
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;
const {
  SessionObserveEmbedStatus,
  SessionObserveReceiptView,
} = await import("./SessionObserveEvidence.tsx");
const { SessionEmbedObserveContent } = await import("./SessionEmbedScreen.tsx");

const brokerReceipts = {
  events: [
    {
      id: "spinoza-2:registered",
      t: 0,
      kind: "boot" as const,
      text: "Session registered - Spinoza-2",
      detail: "codex - gpt-5.6-sol",
    },
    {
      id: "spinoza-2:handoff",
      t: 1,
      kind: "system" as const,
      text: "Harness session attached; waiting for trace events.",
      detail: "broker endpoint is live",
    },
  ],
  files: [],
  contextUsage: [],
  live: true,
};

describe("session observe evidence presentation", () => {
  test("does not count or mark synthetic broker receipts live in the embed header", () => {
    const evidence = describeObserveEvidence({
      source: "broker",
      fidelity: "synthetic",
      live: true,
      eventCount: brokerReceipts.events.length,
    });
    const html = renderToStaticMarkup(createElement(SessionObserveEmbedStatus, {
      source: "broker",
      fidelity: "synthetic",
      sessionId: "session-spinoza-2",
      evidence,
    }));

    expect(html).toContain("No trace events");
    expect(html).not.toContain("2 events");
    expect(html).not.toContain("s-observe-embed-status-live");
  });

  test("renders synthetic broker setup records as marker-less receipts", () => {
    const html = renderToStaticMarkup(createElement(SessionObserveReceiptView, {
      events: brokerReceipts.events,
    }));

    expect(html).toContain('aria-label="Session setup receipts"');
    expect(html).toContain("No observed trace activity");
    expect(html).toContain("Session registered - Spinoza-2");
    expect(html).toContain("Harness session attached; waiting for trace events.");
    expect(html).not.toContain("s-observe-row-bead");
    expect(html).not.toContain("s-observe-transport");
  });

  test("propagates broker synthetic fidelity through the resolved session embed", () => {
    const html = renderToStaticMarkup(createElement(SessionEmbedObserveContent, {
      lookup: {
        kind: "observe",
        refId: "session-spinoza-2",
        session: null,
        observe: {
          kind: "broker",
          refId: "session-spinoza-2",
          agentId: "session-spinoza-2",
          source: "broker",
          fidelity: "synthetic",
          historyPath: null,
          sessionId: "session-spinoza-2",
          updatedAt: Date.now(),
          data: brokerReceipts,
        },
      },
    }));

    expect(html).toContain("No trace events");
    expect(html).toContain('aria-label="Session setup receipts"');
    expect(html).not.toContain("2 events");
    expect(html).not.toContain("s-observe-embed-status-live");
    expect(html).not.toContain("s-observe-transport");
  });
});

const nativeCodexTurns = {
  events: [
    {
      id: "ask-1",
      t: 1,
      kind: "ask" as const,
      text: "Work on the native Mac app session presentation.",
    },
    {
      id: "read-1",
      t: 2,
      kind: "tool" as const,
      tool: "Read",
      arg: "ScoutObserveView.swift",
      text: "Read · ScoutObserveView.swift",
    },
    {
      id: "think-1",
      t: 3,
      kind: "think" as const,
      text: "This is an observed native session, not a Scout-managed chat.",
    },
    {
      id: "msg-1",
      t: 4,
      kind: "message" as const,
      text: "I'll present this as a conversation, with a way to inspect the trace.",
    },
  ],
  files: [],
  contextUsage: [],
  live: true,
  metadata: {
    session: {
      adapterType: "codex",
      model: "gpt-5.6-sol",
    },
  },
};

describe("observed native session conversation presentation", () => {
  test("reads the embed as a thread, with no origin label, and defaults to conversation turns", () => {
    const html = renderToStaticMarkup(createElement(SessionEmbedObserveContent, {
      lookup: {
        kind: "observe",
        refId: "codex-native-1",
        session: null,
        observe: {
          kind: "history",
          refId: "codex-native-1",
          agentId: null,
          source: "history",
          fidelity: "timestamped",
          historyPath: "/tmp/codex.jsonl",
          sessionId: "codex-native-1",
          updatedAt: Date.now(),
          data: nativeCodexTurns,
        },
      },
    }));

    // The plate names the session the way its lane does: harness and runtime.
    expect(html).toContain("s-lane-card--plate");
    expect(html).toContain("Codex");
    expect(html).toContain("s-observe--conversation");
    // The same thread grammar a Scout chat uses: the operator's bubble, the work, the reply.
    expect(html).toContain("s-session-view s-observed-thread");
    expect(html).toContain("s-thread-msg--you");
    expect(html).toContain("Work on the native Mac app session presentation.");
    expect(html).toContain("present this as a conversation, with a way to inspect the trace.");
    expect(html).toContain("aria-label=\"Session presentation\"");
    expect(html).toContain("Conversation");
    expect(html).toContain("Trace");
    // Where the session started is routing, not something the thread announces.
    expect(html).not.toContain("Native session");
    expect(html).not.toContain("Scout-managed chat");
    expect(html).not.toContain("s-observe-spine");
    expect(html).not.toContain("s-observe-transport");
    // The source file link is a trace detail; the conversation leaves it out.
    expect(html).not.toContain("s-observe-source");
  });

  test("leaves input to a host that draws its own composer, and names the session it shows", () => {
    const lookup = {
      kind: "observe" as const,
      refId: "codex-native-1",
      session: null,
      observe: {
        kind: "history" as const,
        refId: "codex-native-1",
        agentId: null,
        source: "history" as const,
        fidelity: "timestamped" as const,
        historyPath: "/tmp/codex.jsonl",
        sessionId: "codex-native-1",
        updatedAt: Date.now(),
        data: nativeCodexTurns,
      },
    };
    const own = renderToStaticMarkup(createElement(SessionEmbedObserveContent, { lookup }));
    expect(own).toContain("s-observe-compose");

    const hosted = renderToStaticMarkup(createElement(SessionEmbedObserveContent, {
      lookup,
      sessionRef: "session:codex:codex-native-1",
      composer: false,
    }));
    expect(hosted).not.toContain("s-observe-compose");
    expect(hosted).not.toContain("s-observe-scrubber");
    expect(hosted).toContain("s-thread-msg--you");
    expect(hosted).toContain("data-session-ref=\"session:codex:codex-native-1\"");
    expect(hosted).toContain("data-session-state=\"observe\"");
  });

  test("gives each request its turn and drops the start row", () => {
    const html = renderToStaticMarkup(createElement(SessionEmbedObserveContent, {
      lookup: {
        kind: "observe",
        refId: "codex-native-2",
        session: null,
        observe: {
          kind: "history",
          refId: "codex-native-2",
          agentId: null,
          source: "history",
          fidelity: "timestamped",
          historyPath: "/tmp/codex.jsonl",
          sessionId: "codex-native-2",
          updatedAt: Date.now(),
          data: {
            ...nativeCodexTurns,
            events: [
              { id: "boot-1", t: 0, kind: "boot" as const, text: "Session started · gpt-5.6-sol", detail: "demo-app · 2 turns" },
              { id: "ask-1", t: 1, kind: "ask" as const, text: "First request." },
              { id: "msg-1", t: 2, kind: "message" as const, text: "First reply." },
              { id: "read-1", t: 3, kind: "tool" as const, tool: "Read", arg: "a.ts", text: "Read · a.ts" },
              { id: "msg-2", t: 4, kind: "message" as const, text: "Second reply." },
              { id: "ask-2", t: 5, kind: "ask" as const, text: "Second request." },
              { id: "msg-3", t: 6, kind: "message" as const, text: "Third reply." },
            ],
          },
        },
      },
    }));

    expect(html.match(/s-observed-turn"/g)?.length).toBe(2);
    expect(html.match(/s-thread-msg--you/g)?.length).toBe(2);
    expect(html).toContain("First request.");
    expect(html).toContain("Second request.");
    // A reply before the turn's last step is narration and folds into the work;
    // the replies after it are the answer.
    expect(html).not.toContain("First reply.");
    expect(html).toContain("Second reply.");
    expect(html).toContain("Third reply.");
    const thread = html.slice(html.indexOf("s-observed-thread"));
    expect(thread.indexOf("Second reply.")).toBeLessThan(thread.indexOf("Second request."));
    expect(html).not.toContain("Session started");
  });
});

test("the ledger hides unavailable counts but keeps known zeroes", async () => {
  const { SessionObserveContextRail } = await import("./SessionObserve.tsx");
  const empty = { events: [], files: [], contextUsage: [], live: false };
  const renderRail = (data: Parameters<typeof SessionObserveContextRail>[0]["data"]) => renderToStaticMarkup(createElement(SessionObserveContextRail, { data, surface: "context" }));
  expect(renderRail(empty)).not.toContain('class="s-ledger-figures"');
  const known = renderRail({ ...empty, events: [{ id: "a", t: 1, kind: "ask", text: "Hello" }] });
  expect(known).toContain('class="is-zero">0</b> tools');
  expect(known).not.toContain('</b> turns');
});

test("the computer-use timeline reveals a returned native record only after its result", async () => {
  const { SessionComputerActivity } = await import("../activity/ComputerUse.tsx");
  const data = { calls: [{ at: 1000, returnedAt: 5000, harness: "Claude Code" as const, provider: "Action" as const, operation: "Begin drive", nativeRun: "action/fixture" }], nativeOrigin: "host" };
  const render = (through: number) => renderToStaticMarkup(createElement(SessionComputerActivity, { data, through }));
  expect(render(999)).toBe("");
  expect(render(2000)).toContain("Requested");
  expect(render(2000)).not.toContain("Native record");
  expect(render(5000)).toContain("Tool returned");
  expect(render(5000)).toContain("Native record");
});
