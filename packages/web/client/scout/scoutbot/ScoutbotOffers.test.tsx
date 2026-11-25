import { describe, expect, mock, test } from "bun:test";

import type { ScoutbotOffer } from "../../lib/scoutbot.ts";

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

const { ScoutbotOfferRows, scoutbotOfferRow } = await import("./ScoutbotOffers.tsx");
const { scoutbotOfferMarkKey } = await import("../../lib/scoutbot-marks.ts");

const DRAFT = "Main is red since the last merge.\nCan you look at the failing check?";

const REPLY = [
  "The build on main is red. Hudson owns that lane.",
  "```scout-ui",
  JSON.stringify([
    { type: "ask-agent", offer: true, targetLabel: "hudson", body: DRAFT, reason: "Hudson owns the build" },
    { type: "navigate", offer: true, route: { view: "mesh" }, reason: "See which host is behind" },
  ]),
  "```",
].join("\n");

/** Renders with the given marks in this browser's storage, then puts the
 * global back so other test files see no window. */
function render(options: { latest: boolean; marks?: Record<string, string>; body?: string }): string {
  const scope = globalThis as { window?: unknown };
  const before = scope.window;
  scope.window = {
    localStorage: {
      getItem: () => JSON.stringify(options.marks ?? {}),
      setItem: () => undefined,
    },
  };
  try {
    return renderToStaticMarkup(
      createElement(ScoutbotOfferRows, {
        messageId: "m1",
        body: options.body ?? REPLY,
        latest: options.latest,
        onRun: () => undefined,
        onSend: async () => undefined,
      }),
    );
  } finally {
    if (before === undefined) delete scope.window;
    else scope.window = before;
  }
}

describe("scoutbotOfferRow", () => {
  test("a message to an agent reads as who, the whole draft, why, and Send", () => {
    const offer: ScoutbotOffer = { type: "ask-agent", targetLabel: "hudson", body: DRAFT, reason: "Hudson owns the build" };

    expect(scoutbotOfferRow(offer)).toEqual({ who: "hudson", what: DRAFT, why: "Hudson owns the build", verb: "Send" });
  });

  test("a page reads by its product name, with the reason as what", () => {
    const offer: ScoutbotOffer = { type: "navigate", route: { view: "mesh" }, reason: "See which host is behind" };

    expect(scoutbotOfferRow(offer)).toEqual({ who: "Hosts", what: "See which host is behind", why: null, verb: "Go" });
  });

  test("a file reads by its name, with the path when there is no reason", () => {
    const offer: ScoutbotOffer = { type: "view-file", path: "/repo/docs/build.md" };

    expect(scoutbotOfferRow(offer)).toEqual({ who: "build.md", what: "/repo/docs/build.md", why: null, verb: "Open" });
  });
});

describe("ScoutbotOfferRows", () => {
  test("offers each step under the reply the conversation ends on", () => {
    const html = render({ latest: true });

    expect(html).toContain("hudson");
    expect(html).toContain("Main is red since the last merge.");
    expect(html).toContain("Can you look at the failing check?");
    expect(html).toContain("Hudson owns the build");
    expect(html).toContain(">Send</button>");
    expect(html).toContain("Hosts");
    expect(html).toContain(">Go</button>");
    expect(html).toContain('title="Not now"');
    expect(html).not.toContain(">Sent<");
  });

  test("draws nothing for a reply without offers", () => {
    expect(render({ latest: true, body: "Nothing to add." })).toBe("");
  });

  test("an offer nobody took is gone once the conversation moves on", () => {
    expect(render({ latest: false })).toBe("");
  });

  test("a sent message stays as a line saying so, with nothing left to tap", () => {
    const html = render({ latest: false, marks: { [scoutbotOfferMarkKey("m1", 0)]: "sent" } });

    expect(html).toContain("hudson");
    expect(html).toContain(">Sent<");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Hosts");
  });

  test("Not now sets one row aside and leaves the others", () => {
    const html = render({ latest: true, marks: { [scoutbotOfferMarkKey("m1", 0)]: "held" } });

    expect(html).not.toContain("hudson");
    expect(html).toContain("Hosts");
  });

  test("with every row set aside it draws nothing", () => {
    const marks = {
      [scoutbotOfferMarkKey("m1", 0)]: "held",
      [scoutbotOfferMarkKey("m1", 1)]: "held",
    };

    expect(render({ latest: true, marks })).toBe("");
  });
});
