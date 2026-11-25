import { describe, expect, mock, test } from "bun:test";

import type { OperatorAttentionItem } from "../lib/types.ts";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);

const { ScoutbotNextStack, scoutbotNextVerb, SCOUTBOT_NEXT_LIMIT } = await import("./ScoutbotNextStack.tsx");

function request(id: string, kind: OperatorAttentionItem["kind"], over: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem {
  return {
    id,
    kind,
    title: `Title ${id}`,
    summary: null,
    detail: null,
    agentId: `agent-${id}`,
    agentName: `Agent ${id}`,
    conversationId: null,
    updatedAt: 1_700_000_000_000,
    severity: "info",
    sourceLabel: "Runtime",
    actions: [],
    ...over,
  };
}

function render(items: OperatorAttentionItem[], held: readonly string[] | null = null): string {
  return renderToStaticMarkup(
    createElement(ScoutbotNextStack, {
      items,
      onOpen: () => undefined,
      onOpenAll: () => undefined,
      ...(held
        ? {
            isHeld: (item: OperatorAttentionItem) => held.includes(item.id),
            onHold: () => undefined,
          }
        : {}),
    }),
  );
}

describe("ScoutbotNextStack", () => {
  test("draws nothing when nothing is waiting", () => {
    expect(render([])).toBe("");
  });

  test("gives each kind of request one verb", () => {
    expect(scoutbotNextVerb(request("a", "approval"))).toBe("Review");
    expect(scoutbotNextVerb(request("b", "question"))).toBe("Answer");
    expect(scoutbotNextVerb(request("c", "ask"))).toBe("Reply");
    expect(scoutbotNextVerb(request("d", "configuration"))).toBe("Set up");
    expect(scoutbotNextVerb(request("e", "work_item"))).toBe("Open");
    expect(scoutbotNextVerb(request("f", "session"))).toBe("Open");
  });

  test("names who it is about, what it is and the verb", () => {
    const html = render([request("a", "question")]);

    expect(html).toContain("Agent a");
    expect(html).toContain("Title a");
    expect(html).toContain("Answer");
    expect(html).not.toContain("More in Inbox");
  });

  test("falls back to the agent id, then the source, for who", () => {
    expect(render([request("a", "ask", { agentName: null })])).toContain("agent-a");
    expect(render([request("a", "ask", { agentName: null, agentId: null })])).toContain("Runtime");
  });

  test("offers a few rows and sends the rest to the Inbox, without a count", () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => request(id, "ask"));
    const html = render(items);

    expect(SCOUTBOT_NEXT_LIMIT).toBe(3);
    expect(html).toContain("Title c");
    expect(html).not.toContain("Title d");
    expect(html).toContain("More in Inbox");
    expect(html).not.toMatch(/\d+ more/);
  });

  test("offers Not now only where the host can set a row aside", () => {
    expect(render([request("a", "ask")])).not.toContain("Not now");
    expect(render([request("a", "ask")], [])).toContain('title="Not now"');
  });

  test("a row set aside gives its place to the next one and stays in the Inbox", () => {
    const items = ["a", "b", "c", "d"].map((id) => request(id, "ask"));
    const html = render(items, ["a"]);

    expect(html).not.toContain("Title a");
    expect(html).toContain("Title d");
    expect(html).toContain("More in Inbox");
  });

  test("draws nothing when every row is set aside", () => {
    expect(render([request("a", "ask"), request("b", "question")], ["a", "b"])).toBe("");
  });
});
