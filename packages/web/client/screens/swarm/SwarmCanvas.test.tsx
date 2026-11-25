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

const { SwarmCanvas } = await import("./SwarmCanvas.tsx");
const { askDeeds, swarmPulls } = await import("../../lib/swarm-code.ts");
const { CORE_SPLIT } = await import("../../lib/swarm-goal.ts");
const { findInitiatives } = await import("../../lib/swarm-initiatives.ts");

const MIN = 60_000;
const now = Date.parse("2026-10-21T16:20:00Z");

function run(id: string, agentId: string, createdAt: number, text: string) {
  return {
    id, agentId, createdAt, source: "ask", requesterId: "operator", state: "completed",
    input: { task: `Task for ${agentId}` }, output: { text }, updatedAt: createdAt + MIN, completedAt: createdAt + MIN,
    agentName: `core-split-${agentId}-popper-4`,
    metadata: { flightMetadata: { source: "scout-mcp", requesterDisplayName: "Arach", returnAddress: { actorId: "operator", sessionId: "mcp:point-1" } } },
  };
}

const [initiative] = findInitiatives([
  run("a-1", "a", now - 50 * MIN, "Opened arach/scout#54."),
  run("c-1", "c", now - 40 * MIN, "Opened arach/scout#55."),
] as never, { now, goals: [CORE_SPLIT] });
const asks = initiative!.swarms.flatMap((swarm) => swarm.asks);
const pulls = swarmPulls({ asks });

function render(states: Map<string, unknown>): string {
  return renderToStaticMarkup(createElement(SwarmCanvas, {
    initiative: initiative!, now, orientation: "horizontal", pulls, deeds: askDeeds(asks, pulls), states: states as never,
    selectedId: null, onSelectLane() {}, onSelectRepo() {},
  }));
}

const state = (number: number, value: string, mergedAt: string | null) => [`arach/scout#${number}`, {
  key: `arach/scout#${number}`, repo: "arach/scout", number, state: value, title: "", url: "", mergedAt, closedAt: mergedAt, updatedAt: null,
}] as const;

describe("SwarmCanvas", () => {
  test("dashes a lane's code edge while its pull request has not merged, and names the repository's latest merge", () => {
    const html = render(new Map([state(54, "merged", "2026-10-21T16:06:00Z"), state(55, "draft", null)]));
    // Lane A's #54 merged; lane C's #55 is a draft.
    expect(html.match(/class="swarm-wire is-code[^"]*"/g)?.sort()).toEqual(['class="swarm-wire is-code is-waiting"', 'class="swarm-wire is-code"']);
    expect(html).toContain("#54 merged 14 min ago");
  });

  test("draws code edges plain until GitHub's states are known", () => {
    const html = render(new Map());
    expect(html).not.toContain("is-waiting");
    expect(html).toContain("Lane C moved #55 last");
  });
});
