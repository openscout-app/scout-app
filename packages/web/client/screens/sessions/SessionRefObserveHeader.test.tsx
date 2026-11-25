import { describe, expect, mock, test } from "bun:test";

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

const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;
const { SessionRefObserveHeader } = await import("./SessionObserveEvidence.tsx");

const conversationEntry = {
  id: "chn-b82c0195fd2f40459dbaf3fee4d29c4f",
  kind: "direct",
  title: "Dewey",
  participantIds: ["operator", "agent-dewey"],
  agentId: "agent-dewey",
  agentName: "Dewey",
  harness: "kimi",
  sessionId: "session-unrelated-current",
  harnessSessionId: "session-unrelated-current",
  harnessLogPath: null,
  currentBranch: null,
  workspaceRoot: "/example/workstation-user/dev/unrelated-current-workspace",
  model: "kimi-stale-model",
  preview: null,
  messageCount: 0,
  lastMessageAt: null,
};

const observedBrokerData = {
  events: [
    {
      id: "session-mu79evpc-kxbokv:registered",
      t: 0,
      kind: "boot" as const,
      text: "Session registered - Dewey",
    },
    {
      id: "session-mu79evpc-kxbokv:handoff",
      t: 41,
      kind: "system" as const,
      text: "Invocation failed; no harness turns were captured.",
    },
  ],
  files: [],
  contextUsage: [],
  live: false,
  metadata: {
    session: {
      adapterType: "codex",
      model: "gpt-5.6-sol",
      cwd: "/example/workstation-user/dev/openscout-worktrees/herdr-scout-agent-profile",
      hostName: "devon-mini",
      source: "broker" as const,
    },
  },
};

describe("SessionRefObserveHeader", () => {
  test("prefers observed session metadata over stale conversation facts", () => {
    const html = renderToStaticMarkup(createElement(SessionRefObserveHeader, {
      session: conversationEntry,
      observe: {
        refId: "session-mu79evpc-kxbokv",
        sessionId: "session-mu79evpc-kxbokv",
        data: observedBrokerData,
      },
      machineId: "node-2",
      navigate: () => undefined,
    }));

    expect(html).toContain("/example/workstation-user/dev/openscout-worktrees/herdr-scout-agent-profile");
    expect(html).toContain("gpt-5.6-sol");
    expect(html).toContain("Codex");
    expect(html).toContain("devon-mini");
    expect(html).not.toContain("unrelated-current-workspace");
    expect(html).not.toContain("kimi-stale-model");
  });

  test("keeps the requested ref identity visible without a self-link", () => {
    const html = renderToStaticMarkup(createElement(SessionRefObserveHeader, {
      session: conversationEntry,
      observe: {
        refId: "session-mu79evpc-kxbokv",
        sessionId: "session-mu79evpc-kxbokv",
        data: observedBrokerData,
      },
      machineId: "node-2",
      navigate: () => undefined,
    }));

    expect(html).not.toContain("Open session");
    expect(html).toContain("s-session-context-strip-identity");
    expect(html).toContain("session-mu79evpc-kxbokv");
    expect(html).not.toContain("Return to conversation");
  });

  test("keeps a back link for a shared channel", () => {
    const html = renderToStaticMarkup(createElement(SessionRefObserveHeader, {
      session: { ...conversationEntry, kind: "channel" },
      observe: {
        refId: "session-mu79evpc-kxbokv",
        sessionId: "session-mu79evpc-kxbokv",
        data: observedBrokerData,
      },
      machineId: "node-2",
      navigate: () => undefined,
    }));

    expect(html).toContain('aria-label="Return to conversation chn-b82c0195fd2f40459dbaf3fee4d29c4f"');
  });

  test("uses matching conversation facts only when the session id matches", () => {
    const html = renderToStaticMarkup(createElement(SessionRefObserveHeader, {
      session: {
        ...conversationEntry,
        sessionId: "session-mu79evpc-kxbokv",
        workspaceRoot: "/example/workstation-user/dev/matched-workspace",
      },
      observe: {
        refId: "session-mu79evpc-kxbokv",
        sessionId: "session-mu79evpc-kxbokv",
        data: {
          events: [],
          files: [],
          contextUsage: [],
          live: false,
        },
      },
      machineId: "node-2",
      navigate: () => undefined,
    }));

    expect(html).toContain("/example/workstation-user/dev/matched-workspace");
  });
});
