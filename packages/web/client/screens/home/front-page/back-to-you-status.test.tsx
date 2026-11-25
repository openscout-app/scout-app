import { expect, test } from "bun:test";
// @ts-expect-error Load the React runtime rather than type-only aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Load the server renderer rather than type-only aliases.
const { renderToStaticMarkup } = await import("../../../../node_modules/react-dom/server.js");
const { SendStatus } = await import("./BackToYou.tsx");

const render = (props: Parameters<typeof SendStatus>[0]) => renderToStaticMarkup(React.createElement(SendStatus, props));

test("a failed send says why once and offers Dismiss when the row can leave", () => {
  const html = render({
    status: { at: "failed", text: "This host has no record of this session. It may have run on another host, or ended." },
    className: "fp-choiceStatus",
    onDismiss: () => {},
  });
  expect(html).toContain("Not sent. This host has no record of this session.");
  expect(html).toContain(">Dismiss</button>");
  expect(html).not.toContain("Not sent:");
});

test("a sent line and a failure with nowhere to go have no Dismiss; idle draws nothing", () => {
  expect(render({ status: { at: "done", text: "Typed into the session." }, className: "fp-turnStatus", onDismiss: () => {} })).not.toContain("Dismiss");
  expect(render({ status: { at: "failed", text: "Offline." }, className: "fp-choiceStatus" })).not.toContain("Dismiss");
  expect(render({ status: { at: "idle" }, className: "fp-turnStatus" })).toBe("");
});
