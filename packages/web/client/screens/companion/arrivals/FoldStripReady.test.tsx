import { expect, mock, test } from "bun:test";
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const runtime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const devRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Direct runtime path avoids the repository's React type-only alias in Bun.
const { renderToStaticMarkup } = await import("../../../../node_modules/react-dom/server.node.js");
mock.module("react", () => React);
mock.module("react/jsx-runtime", () => runtime);
mock.module("react/jsx-dev-runtime", () => devRuntime);
const { FoldStrip } = await import("./FoldStrip");

const thread = { id: "t1", handle: "ranger", task: "Fix the session route", project: null, harness: "claude", state: "waiting", now: "Fixed it." };

test("a Ready line in the folded strip says ready, not the working dots", () => {
  const html = renderToStaticMarkup(React.createElement(FoldStrip, {
    rows: [{ id: "t1", thread, remark: "READY", now: "Fixed it." }],
    activity: new Map(), page: 0, pages: 1, onTap: () => {},
  }));
  expect(html).toContain("is-ready");
  expect(html).toContain(">ready</span>");
  expect(html).not.toContain(">done</span>");
});
