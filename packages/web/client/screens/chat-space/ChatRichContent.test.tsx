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

import type { ChatMessage } from "./chat-api.ts";

const { ChatRichContent, attachmentColor, splitFieldLabel, taskState } = await import("./ChatRichContent.tsx");

function message(content: ChatMessage["content"]): ChatMessage {
  return {
    id: "m-1",
    actorId: "U1",
    actorName: "arach",
    class: "agent",
    body: "fallback",
    createdAt: 0,
    content,
  };
}

describe("Slack rich content", () => {
  test("task states read in Scout's words, and unknown ones say nothing", () => {
    expect(taskState("in_progress")).toEqual({ key: "in_progress", label: "Working" });
    expect(taskState("complete").label).toBe("Done");
    expect(taskState("failed")).toEqual({ key: "error", label: "Failed" });
    expect(taskState("unknown").label).toBeNull();
    expect(taskState("needs_review")).toEqual({ key: "unknown", label: "Needs review" });
  });

  test("attachment colors accept Slack's bare hex and legacy words only", () => {
    expect(attachmentColor("8E3EF0")).toBe("#8E3EF0");
    expect(attachmentColor("#abc")).toBe("#abc");
    expect(attachmentColor("good")).toBe("var(--green)");
    expect(attachmentColor("red; background: url(x)")).toBeUndefined();
    expect(attachmentColor(undefined)).toBeUndefined();
  });

  test("a field written as a bold line then a value splits into label and value", () => {
    expect(splitFieldLabel("**State**\n:in_progress: In progress")).toEqual({ label: "State", value: ":in_progress: In progress" });
    expect(splitFieldLabel("**Fixed** the build")).toBeNull();
    expect(splitFieldLabel("Plain value")).toBeNull();
  });

  test("a task card is static and its only controls are links that open Slack's URLs", () => {
    const html = renderToStaticMarkup(createElement(ChatRichContent, {
      message: message([
        {
          type: "task",
          title: "Rooms live-card renderer check",
          status: "complete",
          details: [{ type: "paragraph", text: "The same Slack message was updated." }],
          sources: [{ label: "Open Scout", url: "https://openscout.app" }],
        },
        { type: "actions", links: [{ label: "Review", url: "https://example.com/review" }] },
        { type: "section", fields: ["**Owner**\n@arach"] },
      ]),
    }));
    expect(html).toContain('data-state="complete"');
    expect(html).toContain(">Done<");
    expect(html).toContain('aria-label="Task: Rooms live-card renderer check, Done"');
    expect(html).not.toContain("<button");
    expect(html).not.toMatch(/animate|spin|pulse/u);
    expect(html.match(/target="_blank"/gu)?.length).toBe(2);
    expect(html).toContain("<strong>Owner</strong>");
  });
});
