import { describe, expect, mock, test } from "bun:test";

import type { ActivityFeedState } from "../../activity/activity-feed.ts";
import type { ActivityItem, Agent, Route } from "../../../lib/types.ts";

/*
 * The Activity view's panels and the Activity page, rendered to markup with
 * the shared /api/activity loop held still (the pattern in
 * projects-panels.test.ts). Run with --isolate, as the client suite is, so the
 * mocks stay in this file.
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

const item = (over: Partial<ActivityItem>): ActivityItem => ({
  id: "act-1",
  kind: "message_sent",
  ts: NOW - 60_000,
  actorName: "Hudson",
  title: null,
  summary: null,
  conversationId: null,
  workspaceRoot: null,
  agentId: null,
  agentName: null,
  flightId: null,
  invocationId: null,
  sessionId: null,
  messageId: null,
  recordId: null,
  ...over,
});

const ITEMS: ActivityItem[] = [
  item({ id: "act-1", title: "Asked Pomo for a review", agentId: "a-local", agentName: "Pomo", workspaceRoot: "/w/pomo", conversationId: "c-1" }),
  item({ id: "act-2", kind: "flight_created", ts: NOW - 30_000, title: "Started the sweep", agentId: "a-remote", workspaceRoot: "/w/talkie", recordId: "w-9" }),
  item({ id: "act-3", kind: "flight.completed", ts: NOW - 10_000, title: "A harness verdict" }),
];

// the shared loop, held at one answer (a real loop would read /api/activity)
let feedState: ActivityFeedState = { items: ITEMS, error: null, loading: false, refreshing: false, loadedAt: NOW - 5_000 };
const loads: string[] = [];
mock.module("../../activity/activity-feed.ts", () => ({
  ACTIVITY_PATH: "/api/activity",
  ACTIVITY_REFRESH_COALESCE_MS: 250,
  ACTIVITY_POLL_MS: 15_000,
  ACTIVITY_WARM_MS: 30_000,
  createActivityFeed: () => ({
    get: () => feedState,
    subscribe: () => () => undefined,
    mount: () => () => undefined,
    load: async (mode = "initial") => void loads.push(mode),
    scheduleRefresh: () => undefined,
    readers: () => 1,
  }),
}));
mock.module("../../../components/SessionHopMenu.tsx", () => ({
  SessionHopMenu: ({ label, className }: { label: string; className: string }) => createElement("button", { className }, label),
  sessionHopMenuItems: () => [],
}));

const { ScoutContext } = await import("../../../scout/Provider.tsx");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");
const { ActivityScreen } = await import("../../activity/ActivityScreen.tsx");
const { activityModule } = await import("./activity.tsx");
const { activityItemModule } = await import("./activity-item.tsx");
const { activityPicks } = await import("./activity-picks.ts");
const { FOLLOW_PAGE } = await import("./follow-page.ts");

const noop = () => undefined;
const agents = [
  { id: "a-local", authorityNodeId: "node-a" },
  { id: "a-remote", authorityNodeId: "node-b" },
] as unknown as Agent[];

function render(node: unknown, route: Route): string {
  const scout = { route, navigate: noop, agents, agentsLoaded: true };
  return renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, node));
}

function renderPanel(module: { Component: unknown }, route: Route, config: Record<string, string> = {}): string {
  const props = { instanceId: "t", route, navigate: noop, config, setConfig: noop };
  // a head slot, so ModuleHead's chips draw inline (createPortal is mocked to pass its children through)
  return render(createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never)), route);
}

/** /activity as the router reads it once it carries ?event=. */
const page = (eventId?: string, machineId?: string) =>
  ({ view: "activity", ...(eventId ? { eventId } : {}), ...(machineId ? { machineId } : {}) }) as Route;

const follow = { follow: FOLLOW_PAGE };

/** One record's markup in the log. */
function rowOf(html: string, id: string): string {
  return html.split("<article").find((chunk) => chunk.includes(`data-activity-id="${id}"`)) ?? "";
}

describe("the Activity page", () => {
  test("its head, counts and records, newest first, verdicts left out", () => {
    const html = render(createElement(ActivityScreen, { navigate: noop }), page());
    // the shared pane head: title, count and tools in one band, no subtitle
    expect(html).toContain('<h2 class="scout-pane-title">Activity</h2>');
    expect(html).toContain(">Refresh<");
    expect(html).toContain("Updated");
    // the count strip is gone; the pane head carries the one count
    for (const label of [">Events<", ">Actors<", ">Threads<"]) expect(html).not.toContain(label);
    expect(html.indexOf("Started the sweep")).toBeLessThan(html.indexOf("Asked Pomo for a review"));
    expect(html).not.toContain("A harness verdict");
    // groups and Open links, as the page drew them
    expect(html).toContain("Execution");
    expect(html).toContain("Delivery");
    expect(html).toContain(">Thread<");
    expect(html).toContain(">Pomo<");
    expect(html).toContain(">Terminal<");
    expect(html).toContain(">Details<");
  });
});

describe("the Activity panel", () => {
  test("on /activity it follows ?event=: that record is marked and, with no details panel, open under its row", () => {
    const html = renderPanel(activityModule, page("act-2"), follow);
    expect(rowOf(html, "act-2")).toContain('aria-current="true"');
    expect(rowOf(html, "act-1")).not.toContain("aria-current");
    expect(rowOf(html, "act-2")).toContain("sys-audit-entry-expanded");
    expect(html).toContain("Record id");
    expect(html).toContain(">Close<");
  });

  test("beside an Activity details panel, the pick is marked, not opened under its row", () => {
    const release = activityPicks.watch();
    try {
      const html = renderPanel(activityModule, page("act-2"), follow);
      expect(rowOf(html, "act-2")).toContain("is-selected");
      expect(html).not.toContain("sys-audit-entry-expanded");
      expect(html).not.toContain("Record id");
    } finally {
      release();
    }
  });

  test("the page's ?machineId= narrows it", () => {
    const html = renderPanel(activityModule, page(undefined, "node-a"), follow);
    expect(html).toContain("Asked Pomo for a review");
    expect(html).not.toContain("Started the sweep");
  });

  test("its head: the count and Refresh; Open full only off /activity", () => {
    const onPage = renderPanel(activityModule, page(), follow);
    expect(onPage).toMatch(/hud-grid-count[^>]*>2</);
    expect(onPage).toContain(">Refresh<");
    expect(onPage).not.toContain("Open full");
    expect(renderPanel(activityModule, { view: "inbox" })).toContain("Open full");
  });

  test("elsewhere it keeps its own pick from settings", () => {
    const html = renderPanel(activityModule, { view: "inbox" }, { event: "act-1" });
    expect(rowOf(html, "act-1")).toContain('aria-current="true"');
    expect(rowOf(html, "act-2")).not.toContain("aria-current");
    // a follow setting means nothing off its page
    const other = renderPanel(activityModule, { view: "inbox" }, { ...follow, event: "act-1" });
    expect(rowOf(other, "act-1")).toContain('aria-current="true"');
    // and an added panel on /activity keeps its own pick, not the page's
    const beside = renderPanel(activityModule, page("act-2"), { event: "act-1" });
    expect(rowOf(beside, "act-1")).toContain('aria-current="true"');
    expect(rowOf(beside, "act-2")).not.toContain("aria-current");
  });

  test("project and kind narrow it; nothing left says so", () => {
    const pomo = renderPanel(activityModule, page(), { ...follow, project: "/w/pomo" });
    expect(pomo).toContain("Asked Pomo for a review");
    expect(pomo).not.toContain("Started the sweep");
    const work = renderPanel(activityModule, page(), { ...follow, category: "work" });
    expect(work).toContain("Started the sweep");
    expect(work).not.toContain("Asked Pomo for a review");
    const none = renderPanel(activityModule, page(), { ...follow, project: "/w/pomo", category: "work" });
    expect(none).toContain("Nothing in this scope");
  });

  test("states: reading, unavailable with Try again, a failed refresh over the last snapshot", () => {
    const saved = feedState;
    try {
      feedState = { items: null, error: null, loading: true, refreshing: false, loadedAt: null };
      const reading = renderPanel(activityModule, page(), follow);
      expect(reading).toContain("Loading activity");
      expect(reading).not.toContain("hud-grid-count");

      feedState = { items: null, error: "broker down", loading: false, refreshing: false, loadedAt: null };
      const down = renderPanel(activityModule, page(), follow);
      expect(down).toContain("Activity is unavailable");
      expect(down).toContain("Try again");

      feedState = { ...saved, error: "broker down" };
      const stale = renderPanel(activityModule, page(), follow);
      expect(stale).toContain("Refresh failed.");
      expect(stale).toContain("Showing last confirmed snapshot");
      expect(stale).toContain("Asked Pomo for a review");
    } finally {
      feedState = saved;
    }
  });
});

describe("Activity details", () => {
  test("on /activity it shows the page's ?event= in full", () => {
    const html = renderPanel(activityItemModule, page("act-1"));
    expect(html).toContain("Asked Pomo for a review");
    for (const label of ["Event", "Recorded", "Actor", "Agent", "Workspace", "Thread", "Record id"]) expect(html).toContain(label);
    expect(html).toContain("Open Thread");
    expect(html).toContain(">Terminal<");
    expect(html).toContain(">Clear<");
    expect(html).not.toContain("Open full");
  });

  test("elsewhere it shows the latest pick of an Activity panel beside it", () => {
    activityPicks.publish("list", { item: ITEMS[1]!, clear: noop }, true);
    try {
      const html = renderPanel(activityItemModule, { view: "inbox" });
      expect(html).toContain("Started the sweep");
      expect(html).toContain("Open Work");
      expect(html).toContain("Open full");
    } finally {
      activityPicks.withdraw("list");
    }
  });

  test("a pick that aged out keeps the copy it was picked with", () => {
    activityPicks.publish("list", { item: item({ id: "gone", title: "An older record" }), clear: noop }, true);
    try {
      expect(renderPanel(activityItemModule, { view: "inbox" })).toContain("An older record");
    } finally {
      activityPicks.withdraw("list");
    }
  });

  test("nothing picked, or a page event no longer in recent activity", () => {
    expect(renderPanel(activityItemModule, page())).toContain("Pick an event in Activity");
    expect(renderPanel(activityItemModule, { view: "inbox" })).toContain("Pick an event in Activity");
    const gone = renderPanel(activityItemModule, page("missing"));
    expect(gone).toContain("isn&#x27;t in recent activity");
    expect(gone).toContain(">Clear<");
  });
});
