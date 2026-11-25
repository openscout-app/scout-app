import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("./request-progress.css", () => ({}));
const { RequestProgress } = await import("./RequestProgress.tsx");

const html = (props: Parameters<typeof RequestProgress>[0]) => renderToStaticMarkup(<RequestProgress {...props} />);
const noop = () => {};

test("a decision moves from the click, and only a stall or an unconfirmed send offers Retry", () => {
  const sending = html({ delivery: { state: "sending", label: "Allow once" }, busy: true, stalled: false, onRetry: noop });
  expect(sending).toContain("is-sending");
  expect(sending).toContain("Sending to the session");
  expect(sending).not.toContain("Retry");

  const stalled = html({ delivery: { state: "sending", label: "Allow once" }, busy: true, stalled: true, onRetry: noop });
  expect(stalled).toContain("Still waiting on the session");
  expect(stalled).toContain("Retry");

  const unconfirmed = html({ delivery: { state: "unconfirmed", label: "Deny" }, busy: false, stalled: false, onRetry: noop });
  expect(unconfirmed).toContain("It may still have landed");
  expect(unconfirmed).toContain("Retry");
});

test("a landed decision says what it did; refusals and ended requests are left to the surface", () => {
  expect(html({ delivery: { state: "delivered", label: "Allow once" }, busy: false, stalled: false, onRetry: noop })).toContain("Allowed once");
  expect(html({ delivery: { state: "delivered", label: "Deny" }, busy: false, stalled: false, onRetry: noop })).toContain("Denied");
  expect(html({ delivery: { state: "refused", label: "Deny", reason: "Changed" }, busy: false, stalled: false, onRetry: noop })).toBe("");
  expect(html({ delivery: null, busy: false, stalled: false, onRetry: noop })).toBe("");
});
