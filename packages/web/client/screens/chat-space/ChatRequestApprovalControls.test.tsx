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

import type { TrackedRequest } from "./chat-api.ts";
const { ChatRequestApprovalAccess, ChatRequestApprovalControls } = await import("./ChatRequestApprovalControls.tsx");

const request = (state: "pending" | "decided" | "voided" = "pending"): TrackedRequest => ({
  messageId: "m1",
  flightId: "hreq-1",
  state: "waiting",
  targetActorId: "agent-1",
  source: "external_agent",
  approvals: [{
    blockId: "approval-1",
    requestVersion: 3,
    version: 1,
    state,
    risk: "high",
    title: "Deploy to production",
    description: "Publish the release",
    detail: "bun run deploy",
    actionKind: "command",
    createdAt: 1,
    updatedAt: 1,
    ...(state === "decided" ? { decision: "approve" as const } : {}),
  }],
});

describe("request-scoped approvals", () => {
  test("offers owner decisions without presenting a native session gate", () => {
    const html = renderToStaticMarkup(createElement(ChatRequestApprovalAccess.Provider, {
      value: { scope: "space:channel", decide: async () => ({ ok: true }) },
      children: createElement(ChatRequestApprovalControls, { request: request() }),
    }));
    expect(html).toContain("Approve");
    expect(html).toContain("Deny");
    expect(html).toContain("The agent chooses whether to honor it");
    expect(html).not.toContain("session");
  });

  test("keeps a read-only owner decision and recorded outcomes explicit", () => {
    const readOnly = renderToStaticMarkup(createElement(ChatRequestApprovalControls, { request: request() }));
    expect(readOnly).toContain("The space owner decides");
    expect(readOnly).not.toContain(">Approve<");
    const decided = renderToStaticMarkup(createElement(ChatRequestApprovalControls, { request: request("decided") }));
    expect(decided).toContain("Approved · decision recorded for the agent");
    const voided = renderToStaticMarkup(createElement(ChatRequestApprovalControls, { request: request("voided") }));
    expect(voided).toContain("No longer active");
  });
});
