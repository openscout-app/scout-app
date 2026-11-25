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

const { RepoPanel } = await import("./RepoPanel.tsx");

const now = Date.parse("2026-10-21T16:20:00Z");
const pr = (number: number) => ({ key: `arach/scout#${number}`, repo: "arach/scout", number, url: `https://github.com/arach/scout/pull/${number}` });
const pulls = [
  { pr: pr(53), openedBy: "ask-53", workedBy: [], reviews: [], last: now - 30 * 60_000 },
  { pr: pr(55), openedBy: "ask-55", workedBy: [], reviews: [], last: now - 10 * 60_000 },
];
const lanes = [{
  id: "lane-a",
  name: "Lane A",
  asks: [
    { id: "ask-53", title: "Stage retention", reply: "Opened arach/scout#53", askedAt: now - 40 * 60_000, endedAt: now - 30 * 60_000 },
    { id: "ask-55", title: "Read consumers", reply: "Opened arach/scout#55", askedAt: now - 20 * 60_000, endedAt: now - 10 * 60_000 },
  ],
}];

function render(states: Map<string, unknown>): string {
  return renderToStaticMarkup(createElement(RepoPanel, {
    repo: "arach/scout", pulls, lanes: lanes as never, states: states as never, now, onSelectAsk() {}, onClose() {},
  }));
}

describe("RepoPanel", () => {
  test("says what became of each pull request when GitHub was read", () => {
    const state = (number: number, value: string, mergedAt: string | null) => ({
      key: `arach/scout#${number}`, repo: "arach/scout", number, state: value, title: "", url: pr(number).url, mergedAt, closedAt: mergedAt, updatedAt: null,
    });
    const html = render(new Map([
      ["arach/scout#53", state(53, "merged", "2026-10-21T16:06:00Z")],
      ["arach/scout#55", state(55, "draft", null)],
    ]));
    expect(html).toContain('<span class="swarm-repo-pull__state is-merged"> Merged 14 min ago.</span>');
    expect(html).toContain('<span class="swarm-repo-pull__state is-draft"> Still a draft.</span>');
  });

  test("says only what the asks say without states", () => {
    const html = render(new Map());
    expect(html).toContain("Lane A opened it.");
    expect(html).not.toContain("swarm-repo-pull__state");
  });
});
