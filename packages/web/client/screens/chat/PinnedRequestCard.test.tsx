import { expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const runtime = await import("../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const devRuntime = await import("../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../node_modules/react-dom/server.node.js");
// @ts-expect-error Load the runtime used by avatar portals, not the typecheck alias.
const ReactDom = await import("../../../node_modules/react-dom/index.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => runtime);
mock.module("react/jsx-dev-runtime", () => devRuntime);
mock.module("react-dom", () => ReactDom);
import type { OperatorAttentionItem } from "../../lib/types.ts";
const { PinnedRequestCard } = await import("./PinnedRequestCard.tsx");

/*
 * The card pinned over a Chats thread decides the request in place, with the
 * decisions the runtime backs for it, and offers nothing it can't send.
 */

const dismiss = (recordId: string) =>
  ({ kind: "dismiss", label: "Dismiss", recordKind: "question", recordId }) as OperatorAttentionItem["actions"][number];

const base = (overrides: Partial<OperatorAttentionItem>): OperatorAttentionItem => ({
  id: "q", kind: "question", title: "Question", summary: null, detail: null, agentId: "a", agentName: "fab",
  conversationId: "c", updatedAt: 60_000, severity: "warning", sourceLabel: "Question", actions: [], ...overrides,
});

const render = (request: OperatorAttentionItem) =>
  renderToStaticMarkup(React.createElement(PinnedRequestCard, {
    request, onAnswer: () => {}, onSteer: () => {}, onOpen: () => {},
  }));

test("a permission request is allowed, denied or dismissed from the thread", () => {
  const html = render(base({
    id: "permission:p", title: "Permission request", sourceLabel: "Permission request",
    permission: { requestId: "p", version: "v", sessionId: "s", projectRoot: "/p" },
    actions: [
      { kind: "approve", label: "Allow once", value: "once" },
      { kind: "approve", label: "Allow always", value: "project" },
      { kind: "deny", label: "Deny", value: "deny" },
      dismiss("p"),
    ],
  }));
  expect(html).toContain("Permission request");
  expect(html).toContain(">Allow once<");
  expect(html).toContain(">Reply<");
  expect(html).toContain(">Deny<");
  expect(html).toContain(">Dismiss<");
  // Allow always sits beside Allow once; the session that asked is one click away
  expect(html).toContain(">Allow always<");
  expect(html.indexOf(">Allow once<")).toBeLessThan(html.indexOf(">Allow always<"));
  expect(html).toContain(">Open in terminal<");
});

test("a question with no session behind it offers no terminal", () => {
  const html = render(base({ id: "need:msg-2", actions: [dismiss("operator-question:msg-2")] }));
  expect(html).not.toContain("Open in terminal");
});

test("an agent's question is answered or dismissed, never approved", () => {
  const html = render(base({ id: "need:msg-1", actions: [dismiss("operator-question:msg-1")] }));
  expect(html).toContain(">Answer<");
  expect(html).toContain(">Dismiss<");
  expect(html).not.toContain(">Deny<");
  expect(html).not.toContain(">Reply<");
});

test("decisions the runtime doesn't back are not drawn", () => {
  const html = render(base({
    id: "question:q-1",
    actions: [
      { kind: "approve", label: "Fake approval" },
      { kind: "deny", label: "Fake denial" },
      { kind: "dismiss", label: "Dismiss" },
    ],
  }));
  expect(html).toContain(">Answer<");
  expect(html).not.toContain("Fake approval");
  expect(html).not.toContain("Fake denial");
  expect(html).not.toContain(">Dismiss<");
});
