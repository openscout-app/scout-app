import { describe, expect, mock, test } from "bun:test";

import type { OperatorAttentionItem, Route } from "../../../lib/types.ts";

/*
 * The Requests view's panels, rendered to markup over the one shared
 * operator-requests read, seeded the way a read would (the pattern in
 * RequestsScreen.test.tsx and activity-panels.test.ts). Run with --isolate, as
 * the client suite is, so the mocks stay in this file.
 */

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const { receiveRequests } = await import("../../../lib/operator-requests-store.ts");
const { requestReceipts } = await import("../../requests/request-receipts.ts");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");
const { requestsModule } = await import("./requests.tsx");
const { requestModule } = await import("./request.tsx");
const { requestPicks } = await import("./request-picks.ts");
const { FOLLOW_PAGE } = await import("./follow-page.ts");

const NOW = Date.now();
const noop = () => undefined;

const ask: OperatorAttentionItem = {
  id: "need:m1", kind: "question", title: "Review first?", summary: "Plan stage 2", detail: null, agentId: "a", agentName: "fab",
  conversationId: "c", updatedAt: NOW - 5 * 60_000, severity: "warning", sourceLabel: "Question",
  answer: { conversationId: "c", replyToMessageId: "m1", options: ["Looks right", "Needs work"] },
  actions: [{ kind: "open", label: "Open", route: { view: "conversation", conversationId: "c" } }],
};
const permission: OperatorAttentionItem = {
  ...ask, id: "permission:p", kind: "configuration", title: "Run the migration", summary: null, answer: undefined, sourceLabel: "Permission request",
  permission: { requestId: "p", version: "v", sessionId: "s", projectRoot: "/p" },
  actions: [{ kind: "approve", label: "Allow once", value: "once" }, { kind: "approve", label: "Allow always", value: "project" }, { kind: "deny", label: "Deny", value: "deny" }],
};

function seed(items: OperatorAttentionItem[]) {
  receiveRequests({ generatedAt: NOW, totals: { all: items.length, approvals: 0, configuration: 0, collaboration: items.length }, items });
}

function renderPanel(module: { Component: unknown }, route: Route, config: Record<string, string> = {}): string {
  const props = { instanceId: "t", route, navigate: noop, config, setConfig: noop };
  // a head slot, so ModuleHead's chips draw inline (createPortal is mocked to pass its children through)
  return renderToStaticMarkup(createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never)));
}

/** /requests as the router reads it once it carries ?request=. */
const page = (requestId?: string) => ({ view: "requests", ...(requestId ? { requestId } : {}) }) as Route;
const home: Route = { view: "inbox" };
const follow = { follow: FOLLOW_PAGE };

/** One row's button in the list. */
function rowOf(html: string, id: string): string {
  return html.split("<button").find((chunk) => chunk.includes(`data-request-id="${id}"`))?.split("</button>")[0] ?? "";
}

describe("the Requests panel", () => {
  test("on /requests it follows ?request=: the row is marked, its count and Refresh in the head", () => {
    seed([ask, permission]);
    const release = requestPicks.follow();
    try {
      const html = renderPanel(requestsModule, page("permission:p"), follow);
      expect(rowOf(html, "permission:p")).toContain('aria-current="true"');
      expect(rowOf(html, "need:m1")).not.toContain("aria-current");
      expect(html).toContain('class="hud-grid-count" data-attention="true"');
      expect(html).toContain(">Refresh<");
      // already the page: no Open full; the page's note on update times stays
      expect(html).not.toContain("Open full");
      expect(html).toContain(`class="vw-requests-note"`);
      for (const text of ["Ask", ">Permission<", "Review first?", "Run the migration", "fab", "5m"]) expect(html).toContain(text);
      // beside a Request panel nothing opens under the row
      expect(html).not.toContain("scout-request-card");
    } finally {
      release();
    }
  });

  test("with a Request panel beside it and nothing picked, it marks the first row, the one that panel shows", () => {
    seed([ask, permission]);
    const release = requestPicks.follow();
    try {
      const html = renderPanel(requestsModule, page(), follow);
      expect(rowOf(html, "need:m1")).toContain('aria-current="true"');
      expect(html).not.toContain("scout-request-card");
    } finally {
      release();
    }
  });

  test("with no Request panel beside it, the pick opens under its row with its decisions", () => {
    seed([ask, permission]);
    const html = renderPanel(requestsModule, page("permission:p"), follow);
    expect(rowOf(html, "permission:p")).toContain('aria-expanded="true"');
    expect(rowOf(html, "need:m1")).toContain('aria-expanded="false"');
    expect(html).toContain('class="vw-request-open"');
    for (const label of ["Allow once", "Allow always", "Deny"]) expect(html).toContain(label);
    // nothing picked: nothing marked, nothing open
    const bare = renderPanel(requestsModule, page(), follow);
    expect(bare).not.toContain("aria-current");
    expect(bare).not.toContain("scout-request-card");
  });

  test("off the page it keeps its own pick and offers Open full; Kind narrows the rows", () => {
    seed([ask, permission]);
    const html = renderPanel(requestsModule, home, { request: "need:m1" });
    expect(html).toContain("Open full");
    expect(html).toContain(">Looks right<");
    expect(html).not.toContain("vw-requests-note");
    const asks = renderPanel(requestsModule, home, { kind: "Ask" });
    expect(asks).toContain("Review first?");
    expect(asks).not.toContain("Run the migration");
    expect(renderPanel(requestsModule, home, { kind: "Approval" })).toContain("No open approvals.");
  });

  test("empty and unread states say so plainly; never 'Needs you'", () => {
    seed([]);
    const empty = renderPanel(requestsModule, page(), follow);
    expect(empty).toContain("No open requests. Approvals, questions and permission requests from your agents show up here.");
    // nothing waiting: the count stays quiet
    expect(empty).toContain('data-attention="false"');
    expect(empty).not.toMatch(/needs you/i);
  });

  test("a decision recorded on a request the source has dropped stays, marked Recorded, with Dismiss receipt", () => {
    seed([ask, permission]);
    requestReceipts.record(permission, { phase: "recorded", label: "Allowed once" });
    seed([ask]);
    try {
      const html = renderPanel(requestsModule, page("permission:p"), follow);
      const row = rowOf(html, "permission:p");
      expect(row).toContain("Recorded");
      expect(row).toContain("data-settled");
      expect(html).toContain("Allowed once");
      expect(html).toContain("Dismiss receipt");
      // the count is the source's open requests, not the receipts
      expect(html).toMatch(/class="hud-grid-count"[^>]*>1</);
    } finally {
      requestReceipts.dismiss("permission:p");
    }
  });
});

describe("the Request panel", () => {
  test("following the page: the page's request, whole, with its decisions and Clear", () => {
    seed([ask, permission]);
    const html = renderPanel(requestModule, page("permission:p"), { request: FOLLOW_PAGE });
    expect(html).toContain("Run the migration");
    for (const label of ["Allow once", "Allow always", "Deny"]) expect(html).toContain(label);
    expect(html).toContain(">Clear<");
    expect(html).not.toContain("Open full");
    expect(html).not.toContain("First open");
    expect(html).not.toMatch(/needs you/i);
  });

  test("nothing named: the first open request, marked so, with its own answers", () => {
    seed([ask, permission]);
    const html = renderPanel(requestModule, page(), { request: FOLLOW_PAGE });
    expect(html).toContain("First open");
    expect(html).toContain(">Looks right<");
    expect(html).toContain(">Needs work<");
    expect(html).toContain("Open conversation");
    expect(html).not.toContain(">Clear<");
  });

  test("off the page it shows a Requests panel's pick and offers Open full", () => {
    seed([ask, permission]);
    requestPicks.publish("list", "permission:p", true);
    try {
      const html = renderPanel(requestModule, home, { request: FOLLOW_PAGE });
      expect(html).toContain("Run the migration");
      expect(html).toContain("Open full");
      expect(html).not.toContain("First open");
    } finally {
      requestPicks.withdraw("list");
    }
  });

  test("pinned to a request no longer open: says so, and offers Unpin", () => {
    seed([ask]);
    const html = renderPanel(requestModule, home, { request: "permission:gone" });
    expect(html).toContain("Unpin");
    expect(html).not.toContain("scout-request-card");
    expect(html).not.toMatch(/needs you/i);
  });

  test("before the first read, and with nothing open", () => {
    seed([]);
    // the list beside it says the queue is empty; the item panel stays quiet
    expect(renderPanel(requestModule, page(), { request: FOLLOW_PAGE })).not.toContain("No open requests");
  });
});
