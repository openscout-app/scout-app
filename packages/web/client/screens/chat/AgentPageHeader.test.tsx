import { describe, expect, mock, test } from "bun:test";
import { MAC_HOME_ROOT } from "../../../test-support/path-fixtures.ts";
// @ts-expect-error Load the runtime, not this checkout's React declaration alias.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Bun tests need the runtime JSX module.
const jsx = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests need the runtime development JSX module.
const jsxDev = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Load the runtime server renderer.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => jsx);
mock.module("react/jsx-dev-runtime", () => jsxDev);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const { AgentPageHeader, headLine } = await import("./ConversationHeader.tsx");
import type { ConversationHeadReport } from "./ConversationHeader.tsx";

const VIEWS = [
  { id: "chat", label: "Chat", hint: "" },
  { id: "flow", label: "Flow", hint: "" },
];

function report(overrides: Partial<ConversationHeadReport> = {}): ConversationHeadReport {
  return {
    conversationId: "chn-1",
    task: "Make the session page nicer.\nWork only in this worktree.",
    harness: "claude",
    model: "claude-opus-5-5",
    effort: null,
    hostName: "dev-host.local",
    workspaceRoot: `${MAC_HOME_ROOT}/someone/dev/app`,
    branch: "session-view",
    state: { kind: "finished", at: 1_700_000_000_000 },
    requestAt: null,
    sessionRoute: null,
    ...overrides,
  };
}

function render(head: ConversationHeadReport | null, extra: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(React.createElement(AgentPageHeader, {
    name: "Demo app Session View",
    harness: "claude",
    head,
    fallbackState: null,
    subline: "demo-app",
    views: VIEWS,
    view: "chat",
    onChangeView: () => undefined,
    ...extra,
  }));
}

describe("Agent page header", () => {
  test("a finished session: name, Done with its time, then the task once with what runs it and where", () => {
    const html = render(report(), { onOpenSession: () => undefined });
    expect(html).toContain("Demo app Session View");
    expect(html).toContain('data-state="done"');
    expect(html).toContain(">Done<");
    expect(html).toContain("Make the session page nicer.");
    expect(html).not.toContain("Work only in this worktree");
    // each fact once: the task is the line and its tooltip, nothing else
    expect(html.match(/Make the session page nicer/g)?.length).toBe(2);
    expect(html).toContain(">Claude<");
    expect(html).toContain(">claude-opus-5-5<");
    expect(html).toContain(">dev-host<");
    expect(html).toContain(">~/dev/app<");
    expect(html).toContain("Open session");
    expect(html).toContain("session-view");
    // one line: no second line, no outcome or asks line
    expect(html).not.toContain("Outcome");
    expect(html).not.toContain("amv-line--2");
    // the harness mark, never a generated face
    expect(html).not.toContain("avatar");
  });

  test("a working session shows Working by the name", () => {
    const html = render(report({ state: { kind: "working", startedAt: Date.now() - 65_000 } }));
    expect(html).toContain('data-state="working"');
    expect(html).toContain(">Working<");
    expect(html).toContain("1m 5s");
  });

  test("a session waiting on a question shows Waiting; the question stays on the pinned card", () => {
    const html = render(report({
      state: { kind: "request", approval: false },
      requestAt: Date.now() - 120_000,
    }));
    expect(html).toContain('data-state="waiting"');
    expect(html).toContain(">Waiting<");
    expect(html).toContain("Waiting on your answer");
    expect(html).not.toContain("Needs you");
  });

  test("with no report it falls back to the live ask and the project line", () => {
    const html = render(null, { fallbackState: "working" });
    expect(html).toContain(">Working<");
    expect(html).toContain("demo-app");
    expect(html).not.toContain("Open session");
    expect(html).not.toContain("amv-menu");
  });

  test("only the views it is given are drawn", () => {
    const html = render(report());
    expect(html).toContain(">Chat<");
    expect(html).toContain(">Flow<");
    expect(html).not.toContain(">Map<");
    expect(html).not.toContain(">Canvas<");
  });

  test("headLine keeps the first line, drops markdown marks and backticks, and folds home", () => {
    expect(headLine(`## Read ${MAC_HOME_ROOT}/someone/dev/app/README.md\nmore`)).toBe("Read ~/dev/app/README.md");
    expect(headLine("\n\n- improve it on `session-view` only")).toBe("improve it on session-view only");
    expect(headLine("   ")).toBeNull();
  });
});
