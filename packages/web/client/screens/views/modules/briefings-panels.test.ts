import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { Route } from "../../../lib/types.ts";
import type { BriefingDetail, BriefingSummary } from "../../briefings/briefings-model.ts";

/*
 * The Briefings view's panels and the Briefings pages, rendered to markup with
 * the shared reads mocked (the pattern in projects-panels.test.ts).
 */

// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const React = await import("../../../../node_modules/react/index.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxRuntime = await import("../../../../node_modules/react/jsx-runtime.js");
// @ts-expect-error Bun tests load React's runtime entrypoint directly to avoid local TS path aliases.
const ReactJsxDevRuntime = await import("../../../../node_modules/react/jsx-dev-runtime.js");
// @ts-expect-error Bun tests load React DOM's runtime entrypoint directly to avoid local TS path aliases.
const ReactDomServer = await import("../../../../node_modules/react-dom/server.node.js");
const { createElement } = React;
const { renderToStaticMarkup } = ReactDomServer;

mock.module("react", () => React);
mock.module("react/jsx-runtime", () => ReactJsxRuntime);
mock.module("react/jsx-dev-runtime", () => ReactJsxDevRuntime);
mock.module("react-dom", () => ({ createPortal: (children: unknown) => children }));

const NOW = Date.now();

const summary = (id: string, title: string, over: Partial<BriefingSummary> = {}): BriefingSummary => ({
  id,
  kind: "fleet-home",
  title,
  summary: `${title}: two agents waiting on review.`,
  recommendation: null,
  preparedAt: NOW - 60_000,
  ttlMs: 60_000,
  observationCount: 2,
  createdAt: NOW - 60_000,
  ...over,
});

const detail = (id: string, title: string): BriefingDetail => ({
  id,
  kind: "tour",
  title,
  summary: `${title}: the fleet is quiet.`,
  recommendation: "Review atlas's diff first.",
  preparedAt: NOW - 60_000,
  ttlMs: 60_000,
  markdown: "**Two** agents are waiting.",
  brief: {
    id: `${id}-brief`,
    title,
    summary: "",
    recommendation: "",
    steps: [{ id: "s1", label: "Look at atlas", narration: "atlas has been waiting four minutes." }],
    actions: [{ label: "Open atlas", route: { view: "agents-v2", agentId: "atlas" } }],
    presented: null,
  },
  observations: [
    { text: "atlas is blocked on a permission request.", tone: "warn", references: [{ label: "atlas", kind: "agent", route: { view: "agents-v2", agentId: "atlas" } }] },
    { text: "Two sessions finished.", references: [{ label: "talkie", kind: "project", detail: "2 done" }] },
  ],
  snapshot: { state: { agents: [1, 2] } },
  call: { model: "gpt-5", systemPrompt: "system", operatorRequest: "brief me", responseId: "r1", telemetry: { elapsedMs: 1500, usage: null } },
  createdAt: NOW - 60_000,
});

type Handle = { detail: BriefingDetail | null; error: string | null; loaded: boolean; gone: boolean };
const reads = {
  list: { items: null as BriefingSummary[] | null, error: null as string | null, reading: false },
  details: {} as Record<string, Handle>,
};
const reloads: string[] = [];
let refreshes = 0;

mock.module("../../briefings/use-briefings.ts", () => ({
  useBriefingList: () => ({ ...reads.list, at: 0, refresh: () => undefined }),
  useBriefingDetail: (id: string): Handle => reads.details[id] ?? { detail: null, error: null, loaded: false, gone: false },
  reloadBriefing: (id: string) => void reloads.push(id),
  refreshBriefings: () => void (refreshes += 1),
}));
mock.module("../../home/left.tsx", () => ({
  HomeLeft: () => createElement("aside", { className: "ctx-panel", "data-home-left": "" }, "Recent agents"),
}));

const { ScoutContext } = await import("../../../scout/Provider.tsx");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");
const { FOLLOW_PAGE } = await import("./panel-scope.ts");
const { briefingPicks } = await import("./briefing-pick.ts");
const { briefingsModule } = await import("./briefings.tsx");
const { briefingModule } = await import("./briefing.tsx");
const { homeRecentModule } = await import("./home-recent.tsx");
const { BriefingsScreen } = await import("../../briefings/BriefingsScreen.tsx");
const { BriefingDetailScreen } = await import("../../briefings/BriefingDetailScreen.tsx");

const noop = () => undefined;
const archive: Route = { view: "briefings" };
const open: Route = { view: "briefings", briefingId: "b1" };
const watch: Route = { view: "views", viewId: "watch" };

function wrap(node: unknown, route: Route): string {
  const scout = { route, navigate: noop, agents: [], agentsLoaded: true };
  return renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, node as never));
}

function renderPanel(module: { Component: unknown }, route: Route, config: Record<string, string> = {}, instanceId = "t"): string {
  const props = { instanceId, route, navigate: noop, config, setConfig: noop };
  // a head slot, so ModuleHead's chips draw inline (createPortal is mocked to pass its children through)
  return wrap(createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never)), route);
}

beforeEach(() => {
  reads.list = { items: [summary("b2", "Morning brief"), summary("b1", "Tour of the fleet", { recommendation: "Look at atlas" })], error: null, reading: false };
  reads.details = {
    b1: { detail: detail("b1", "Tour of the fleet"), error: null, loaded: true, gone: false },
    b2: { detail: detail("b2", "Morning brief"), error: null, loaded: true, gone: false },
  };
  reloads.length = 0;
  refreshes = 0;
  briefingPicks.withdraw("beside");
});

describe("the Briefings panel", () => {
  test("on /briefings/:id: the archive's rows with the open one marked, the count and Refresh", () => {
    const html = renderPanel(briefingsModule, open);
    expect(html).toContain('data-variant="panel"');
    expect(html).toContain("Morning brief");
    expect(html).toContain("Tour of the fleet");
    expect(html).toMatch(/aria-current="true"[^>]*>.*?Tour of the fleet/);
    expect(html).toContain('class="hud-grid-count"');
    expect(html).toContain(">2<");
    expect(html).toContain("Refresh");
    expect(html).toContain("2 observations");
    expect(html).toContain("· Look at atlas");
    // on its own page there is no Open full
    expect(html).not.toContain("Open full");
  });

  test("elsewhere: its own pick is marked, with Open full", () => {
    const html = renderPanel(briefingsModule, watch, { briefing: "b2" });
    expect(html).toMatch(/aria-current="true"[^>]*>.*?Morning brief/);
    expect(html).toContain("Open full");
  });

  test("a read out says so; Refresh waits", () => {
    reads.list.reading = true;
    const html = renderPanel(briefingsModule, open);
    expect(html).toContain("Reading...");
    expect(html).toMatch(/disabled=""[^>]*>.*?Reading\.\.\./);
  });

  test("before the first read, a failed read, an empty archive, and a refresh that failed", () => {
    reads.list = { items: null, error: null, reading: true };
    expect(renderPanel(briefingsModule, archive)).toContain("Reading briefings…");
    reads.list = { items: null, error: "broker down", reading: false };
    expect(renderPanel(briefingsModule, archive)).toContain("Couldn&#x27;t read briefings: broker down");
    reads.list = { items: [], error: null, reading: false };
    expect(renderPanel(briefingsModule, archive)).toContain("No briefings yet.");
    reads.list = { items: [summary("b1", "Tour of the fleet")], error: "timeout", reading: false };
    const stale = renderPanel(briefingsModule, archive);
    expect(stale).toContain("Couldn&#x27;t refresh: timeout");
    expect(stale).toContain("Tour of the fleet");
  });
});

describe("the Briefing panel", () => {
  test("following /briefings/:id: the whole briefing, with Close and no Open full", () => {
    const html = renderPanel(briefingModule, open, { briefing: FOLLOW_PAGE });
    expect(html).toContain("<h2>Tour of the fleet</h2>");
    expect(html).toContain("tour briefing");
    expect(html).toContain("Review atlas&#x27;s diff first.");
    expect(html).toContain("Brief (markdown)");
    expect(html).toContain("Calls &amp; usage");
    expect(html).toContain("1.50s");
    expect(html).toContain("Look at atlas");
    expect(html).toContain("Observations (2)");
    expect(html).toContain("Read snapshot");
    expect(html).toContain("talkie · 2 done");
    expect(html).toContain(">Close<");
    expect(html).not.toContain("Open full");
    // its own page's briefing is not marked as the latest
    expect(html).not.toContain("briefing-detail-marker");
  });

  test("a warning says so in words, and the panel's buttons are chips", () => {
    const html = renderPanel(briefingModule, open, { briefing: FOLLOW_PAGE });
    expect(html).toContain('<span class="briefing-observation-tone">Warning</span>');
    expect(html).toMatch(/class="vw-chip"[^>]*>Open atlas</);
    expect(html).toMatch(/class="vw-chip"[^>]*>Show raw/);
    expect(html).not.toContain("s-btn");
  });

  test("on the bare archive it waits for a pick", () => {
    const html = renderPanel(briefingModule, archive, { briefing: FOLLOW_PAGE });
    expect(html).toContain("Pick a briefing in Briefings and it opens here.");
    expect(html).not.toContain(">Close<");
  });

  test("unset, anywhere: the latest briefing, marked so, with Open full", () => {
    const html = renderPanel(briefingModule, watch);
    expect(html).toContain("<h2>Morning brief</h2>");
    expect(html).toContain('<span class="briefing-detail-marker">Latest</span>');
    expect(html).toContain("Open full");
    expect(html).not.toContain(">Close<");
    expect(html).not.toContain(">Unpin<");
  });

  test("the latest waits on the archive read, and says when it failed", () => {
    reads.list = { items: null, error: null, reading: true };
    expect(renderPanel(briefingModule, watch)).toContain("Reading briefings…");
    reads.list = { items: null, error: "broker down", reading: false };
    expect(renderPanel(briefingModule, watch)).toContain("Couldn&#x27;t read briefings: broker down");
    reads.list = { items: [], error: null, reading: false };
    expect(renderPanel(briefingModule, watch)).toContain("No briefings yet.");
  });

  test("pinned: its own briefing on any page, with Unpin", () => {
    const html = renderPanel(briefingModule, open, { briefing: "b2" });
    expect(html).toContain("<h2>Morning brief</h2>");
    expect(html).toContain(">Unpin<");
    expect(html).toContain("Open full");
    expect(html).not.toContain(">Close<");
  });

  test("following the page off /briefings: the pick of a Briefings panel beside it", () => {
    expect(renderPanel(briefingModule, watch, { briefing: FOLLOW_PAGE })).toContain(
      "Pick a briefing in Briefings beside this panel, or pin one from Scope.",
    );
    briefingPicks.publish("beside", "b1", true);
    const html = renderPanel(briefingModule, watch, { briefing: FOLLOW_PAGE });
    expect(html).toContain("<h2>Tour of the fleet</h2>");
    expect(html).toContain("Open full");
    expect(html).not.toContain(">Close<");
  });

  test("gone, failed, and still reading", () => {
    reads.details.b1 = { detail: null, error: null, loaded: true, gone: true };
    expect(renderPanel(briefingModule, open, { briefing: FOLLOW_PAGE })).toContain("The archive no longer holds this briefing.");

    reads.details.b1 = { detail: null, error: "timeout", loaded: true, gone: false };
    const failed = renderPanel(briefingModule, open, { briefing: FOLLOW_PAGE });
    expect(failed).toContain("Couldn&#x27;t read this briefing: timeout");
    expect(failed).toContain(">Try again<");

    reads.details.b1 = { detail: null, error: null, loaded: false, gone: false };
    expect(renderPanel(briefingModule, open, { briefing: FOLLOW_PAGE })).toContain("Reading the briefing…");
  });

  test("the scope: this page's briefing, the latest when unset, or one briefing", () => {
    const [scope] = briefingModule.scopes ?? [];
    expect(scope?.key).toBe("briefing");
    expect(scope?.allLabel).toBe("Latest briefing");
    expect(scope?.followsPage).toBe("This page's briefing");
  });
});

describe("the Recent panel", () => {
  test("draws the Home rail the composed page no longer has", () => {
    const html = renderPanel(homeRecentModule, open);
    expect(html).toContain('class="vw-home-recent"');
    expect(html).toContain("data-home-left");
  });
});

describe("the Briefings pages, unchanged", () => {
  test("the archive page keeps its header, Refresh and rows", () => {
    const html = wrap(createElement(BriefingsScreen, { navigate: noop }), archive);
    expect(html).toContain("Rolling 100.");
    expect(html).toContain('class="s-btn"');
    expect(html).toContain(">Refresh<");
    expect(html).toContain('data-variant="page"');
    expect(html).toContain("Morning brief");
  });

  test("the archive page's empty, loading and failed states", () => {
    reads.list = { items: [], error: null, reading: false };
    expect(wrap(createElement(BriefingsScreen, { navigate: noop }), archive)).toContain("No briefings yet");
    reads.list = { items: null, error: null, reading: true };
    expect(wrap(createElement(BriefingsScreen, { navigate: noop }), archive)).toContain("Loading briefings...");
    reads.list = { items: null, error: "broker down", reading: false };
    expect(wrap(createElement(BriefingsScreen, { navigate: noop }), archive)).toContain("Couldn&#x27;t load briefings");
  });

  test("a briefing's page keeps its back link and page buttons; gone reads as not found", () => {
    const html = wrap(createElement(BriefingDetailScreen, { briefingId: "b1", navigate: noop }), open);
    expect(html).toContain("← back to briefings");
    expect(html).toMatch(/class="s-btn"[^>]*>Open atlas</);
    expect(html).not.toContain("vw-chip");

    reads.details.b1 = { detail: null, error: null, loaded: true, gone: true };
    const gone = wrap(createElement(BriefingDetailScreen, { briefingId: "b1", navigate: noop }), open);
    expect(gone).toContain("Couldn&#x27;t load briefing");
    expect(gone).toContain("not found");
  });
});
