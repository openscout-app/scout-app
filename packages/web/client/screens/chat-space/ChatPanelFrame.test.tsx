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

const { ChatPanelFrame, ChatPanelGlyph, chatPanelTransitionMs } = await import("./ChatPanelFrame.tsx");

describe("ChatPanelFrame", () => {
  test("zero-duration and millisecond transitions close without an arbitrary wait", () => {
    expect(chatPanelTransitionMs("0s")).toBe(0);
    expect(chatPanelTransitionMs("0.28s, 0.2s")).toBe(280);
    expect(chatPanelTransitionMs("200ms, 80ms")).toBe(200);
    expect(chatPanelTransitionMs("not-a-duration")).toBe(0);
  });

  test("keeps the aside semantics and exposes its open and closing states", () => {
    const open = renderToStaticMarkup(createElement(ChatPanelFrame, {
      "aria-label": "Thread", overlay: false,
    }, createElement("div", null, "Replies")));
    const closing = renderToStaticMarkup(createElement(ChatPanelFrame, {
      "aria-label": "Thread", overlay: true, closing: true,
    }, createElement("div", null, "Replies")));

    expect(open).toContain("<aside");
    expect(open).toContain('data-state="open"');
    expect(open).toContain('aria-label="Thread"');
    expect(open).toContain("Replies");
    expect(closing).toContain('data-state="closing"');
    expect(closing).toContain('data-overlay="true"');
  });

  test("keeps the local text glyph while the hosted SVG icon is opt-in", () => {
    const markup = renderToStaticMarkup(createElement(ChatPanelGlyph, {
      glyph: "×",
    }, createElement("svg", { "data-hosted-icon": "close" })));

    expect(markup).toContain(">×</span>");
    expect(markup).toContain("var(--hc-panel-glyph-display, inline)");
    expect(markup).toContain("var(--hc-panel-icon-display, none)");
    expect(markup).toContain('data-hosted-icon="close"');
  });
});
