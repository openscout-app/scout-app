import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type * as ReactModule from "react";
import type * as ReactJsxRuntimeModule from "react/jsx-runtime";
import type * as ReactJsxDevRuntimeModule from "react/jsx-dev-runtime";
import type * as ReactDomServerModule from "react-dom/server";

// Keep Bun on the runtime modules instead of the local TS declaration aliases.
// @ts-expect-error -- untyped relative runtime import
const React = (await import("../../../node_modules/react/index.js")) as typeof ReactModule;
// @ts-expect-error -- untyped relative runtime import
const ReactJsxRuntime = (await import("../../../node_modules/react/jsx-runtime.js")) as typeof ReactJsxRuntimeModule;
// @ts-expect-error -- untyped relative runtime import
const ReactJsxDevRuntime = (await import("../../../node_modules/react/jsx-dev-runtime.js")) as typeof ReactJsxDevRuntimeModule;
// @ts-expect-error -- untyped relative runtime import
const ReactDomServer = (await import("../../../node_modules/react-dom/server.node.js")) as typeof ReactDomServerModule;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;
const { SCOUT_TERMINAL_HEADER_SLOT_IDS, TerminalHeaderMount } = await import("./TerminalHeaderMount.tsx");

describe("TerminalHeaderMount", () => {
  test("keeps task-completing controls in content when no title-row host exists", () => {
    const html = renderToStaticMarkup(createElement(
      TerminalHeaderMount,
      null,
      createElement("button", { type: "button" }, "Create"),
    ));

    expect(html).toContain('data-scout-terminal-header-fallback="actions"');
    expect(html).toContain(">Create</button>");
  });

  test("names the slot it fell back from so the inline row can place it", () => {
    const html = renderToStaticMarkup(createElement(TerminalHeaderMount, {
      slot: "search",
      children: createElement("input", { type: "search" }),
    }));

    expect(html).toContain("s-term-inline-header--search");
    expect(html).toContain('data-scout-terminal-header-fallback="search"');
  });

  // Off the Terminals view (the Workspace module on another view) there is no
  // top row: every piece that falls back gets a place in the panel's own row,
  // and the panel sizes against itself, never the window.
  test("every slot's fallback has a place in the view panel's row", () => {
    const css = readFileSync(new URL("../views/modules/terminal-workspace.css", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const slot of Object.keys(SCOUT_TERMINAL_HEADER_SLOT_IDS)) {
      expect(css).toContain(`.s-term-inline-header--${slot}`);
    }
    expect(css).toContain(".s-term-inline-bar");
    expect(css).not.toMatch(/\d(?:d|s|l)?v[hw]\b|@media|position:\s*fixed/);
  });
});
