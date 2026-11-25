import { describe, expect, mock, test } from "bun:test";

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDom = await import("../../node_modules/react-dom/index.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ReactDom);
mock.module(new URL("../scout/Provider.tsx", import.meta.url).pathname, () => ({
  useScout: () => ({
    openFilePreview: () => {},
  }),
  useOptionalScout: () => ({
    openFilePreview: () => {},
  }),
}));

const { MessageMarkup } = await import("./message-markup.tsx");

describe("MessageMarkup rendering", () => {
  test("renders escaped line breaks as separate message blocks", () => {
    const html = renderToStaticMarkup(createElement(MessageMarkup, {
      text: "Summary\\n\\nDetails\\n\\n- one\\n- two",
    }));

    expect(html).not.toContain("\\n");
    expect(html).toContain('<p class="s-message-markup-paragraph"><span>Summary</span></p>');
    expect(html).toContain('<p class="s-message-markup-paragraph"><span>Details</span></p>');
    expect(html).toContain('<ul class="s-message-markup-list"><li>');
  });

  test("renders a nested list inside its item and keeps the start number", () => {
    const html = renderToStaticMarkup(createElement(MessageMarkup, {
      text: "3. Parser\n   - nested\n4. CSS",
    }));

    expect(html).toContain('<ol class="s-message-markup-list" start="3"><li><span>Parser</span><ul class="s-message-markup-list"><li><span>nested</span></li></ul></li><li><span>CSS</span></li></ol>');
  });

  test("renders bare URLs as clickable links", () => {
    const html = renderToStaticMarkup(createElement(MessageMarkup, {
      text: "URL · http://localhost:3500/talkie-marks",
    }));

    expect(html).toContain("href=\"http://localhost:3500/talkie-marks\"");
    expect(html).toContain("target=\"_blank\"");
    expect(html).toContain("s-inline-link");
  });

  test("renders file paths as preview tokens without trailing punctuation", () => {
    const html = renderToStaticMarkup(createElement(MessageMarkup, {
      text: "See packages/web/client/app.css.",
    }));

    expect(html).toContain("s-path-token");
    expect(html).toContain("Open packages/web/client/app.css");
    expect(html).not.toContain("Open packages/web/client/app.css.");
  });
});
