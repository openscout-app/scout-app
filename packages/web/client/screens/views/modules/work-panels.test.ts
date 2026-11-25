import { describe, expect, mock, test } from "bun:test";

import type { Agent, Route, WorkDetail, WorkItem } from "../../../lib/types.ts";

/*
 * The Work view's panels, rendered to markup with the shared work reads and
 * the Work page's screen mocked (the pattern in projects-panels.test.ts). The
 * screen stub records which parts each panel asked it for.
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

const item = (over: Partial<WorkItem>): WorkItem => ({
  id: "w1",
  title: "Port the Work view",
  summary: null,
  ownerId: "agent-a",
  ownerName: "Ada",
  nextMoveOwnerId: "agent-a",
  nextMoveOwnerName: "Ada",
  conversationId: "c1",
  createdAt: 1_000,
  updatedAt: 2_000,
  parentId: null,
  parentTitle: null,
  state: "working",
  acceptanceState: "none",
  priority: null,
  currentPhase: "Building",
  attention: "silent",
  activeChildWorkCount: 0,
  activeFlightCount: 1,
  lastMeaningfulAt: Date.now() - 60_000,
  lastMeaningfulSummary: null,
  ...over,
});

const detail: WorkDetail = {
  ...item({ parentId: "w0", parentTitle: "The rebuild", lastMeaningfulSummary: "[ask:f-1] Done: panels in" }),
  childWork: [item({ id: "w2", title: "Child task", attention: "interrupt" })],
  activeFlights: [],
  timeline: [],
  primaryInvocation: { flightId: "f1", requesterId: "operator", requesterName: null, createdAt: 1 } as WorkDetail["primaryInvocation"],
  allFlights: [
    {
      id: "f1", invocationId: "i1", agentId: "agent-a", agentName: "Ada", conversationId: "c9", collaborationRecordId: null,
      state: "queued", summary: "Waiting on the thread", startedAt: Date.now() - 120_000, completedAt: null, sessions: [],
      dispatchOutcome: { status: "queued_until_online", reason: "thread_held_externally", checkedAt: 1 },
    },
  ],
  inventory: undefined as unknown as WorkDetail["inventory"],
};

const list: WorkItem[] = [
  item({ id: "w1", title: "Port the Work view" }),
  item({ id: "w3", title: "Review the port", state: "review", nextMoveOwnerId: "operator", ownerId: "agent-b", lastMeaningfulAt: Date.now() }),
];

const detailReads: string[] = [];
const listReads: string[] = [];
mock.module("../../work/use-work-detail.ts", () => ({
  workDetailPath: (id: string) => `/api/work/${id}`,
  useWorkDetail: (workId: string) => (detailReads.push(workId), workId === "w1"
    ? { detail, error: null, loaded: true }
    : { detail: null, error: workId ? "not found" : null, loaded: true }),
  useWorkList: (path: string) => (listReads.push(path), { value: list, error: null, loaded: true }),
  useWorkMaterialPick: () => [null, () => undefined],
  useWorkFilesShown: () => false,
}));

type ScreenCall = { workId: string; parts: readonly string[]; own: boolean; keyScope: boolean };
const screenCalls: ScreenCall[] = [];
mock.module("../../work/WorkDetailScreen.tsx", () => ({
  WorkDetailScreen: ({ workId, panel }: { workId: string; panel: { parts: readonly string[]; own: boolean; keyScope?: unknown; extra?: (d: WorkDetail) => unknown } }) => {
    screenCalls.push({ workId, parts: panel.parts, own: panel.own, keyScope: typeof panel.keyScope === "function" });
    return createElement("div", { "data-screen": panel.parts.join(" ") }, (panel.extra?.(detail) ?? null) as never);
  },
}));
mock.module("../../work/WorkCasefileSections.tsx", () => ({
  CopyMark: () => null,
}));

const { ScoutContext } = await import("../../../scout/Provider.tsx");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");
const { workModule } = await import("./work.tsx");
const { workItemModule } = await import("./work-item.tsx");
const { workTimelineModule } = await import("./work-timeline.tsx");
const { workTailModule } = await import("./work-tail.tsx");
const { workFilesModule } = await import("./work-files.tsx");
const { workFlightsModule } = await import("./work-flights.tsx");
const { workPeopleModule } = await import("./work-people.tsx");

const noop = () => undefined;
const agents = [
  { id: "agent-a", name: "Ada", authorityNodeId: "m1" },
  { id: "agent-b", name: "Bo", authorityNodeId: "m2" },
] as unknown as Agent[];

function render(module: { Component: unknown }, route: Route, config: Record<string, string> = {}): string {
  const scout = { route, navigate: noop, agents, agentsLoaded: true, operatorName: "Art" };
  const props = { instanceId: "t", route, navigate: noop, config, setConfig: noop };
  const body = createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never));
  return renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, body));
}

const page: Route = { view: "work", workId: "w1" };

describe("the Work list", () => {
  test("marks the page's item, a review that is the operator's move, and counts", () => {
    const html = render(workModule, page, { show: "all" });
    expect(listReads.at(-1)).toBe("/api/work?active=false&limit=60");
    expect(html).toMatch(/aria-current="true"[^>]*><span class="vw-strong vw-ell">Port the Work view/);
    expect(html).toContain(">Awaiting your review<");
    expect(html).toContain('class="hud-grid-count"');
    expect(html).not.toContain("Needs you");
  });

  test("the page's ?machineId= keeps that machine's work", () => {
    const html = render(workModule, { view: "work", workId: "w1", machineId: "m2" } as Route);
    expect(listReads.at(-1)).toBe("/api/work?limit=40");
    expect(html).toContain("Review the port");
    expect(html).not.toContain("Port the Work view");
  });
});

describe("the detail panels", () => {
  test("each asks the Work page's screen for its own part, following the page", () => {
    screenCalls.length = 0;
    for (const module of [workItemModule, workTimelineModule, workTailModule, workFilesModule]) render(module, page, { work: "@route" });
    expect(screenCalls.map((c) => [c.parts.join(""), c.workId, c.own, c.keyScope])).toEqual([
      ["head", "w1", true, false],
      ["timeline", "w1", true, false],
      ["tail", "w1", true, false],
      ["files", "w1", true, true],
    ]);
  });

  test("the Work item panel is the head alone: the case is in the run's Details plate, not a card of its own", () => {
    const html = render(workItemModule, page, { work: "@route" });
    expect(html).toContain('data-screen="head"');
    for (const label of ["Case", "Acceptance", "Record", "Case ID"]) expect(html).not.toContain(`>${label}<`);
    // on its own page it is the page: no Open full, no Unpin
    expect(html).not.toContain("Open full");
    expect(html).not.toContain("Unpin");
  });

  test("pinned elsewhere: not the page's own, with Open full and Unpin", () => {
    screenCalls.length = 0;
    const html = render(workFilesModule, { view: "inbox" }, { work: "w1" });
    expect(screenCalls[0]).toMatchObject({ workId: "w1", own: false, keyScope: true });
    expect(html).toContain(">Open full<");
    expect(html).toContain(">Unpin<");
  });

  test("with no work item, a panel says how to pick one", () => {
    expect(render(workTimelineModule, { view: "work", workId: "" }, { work: "@route" })).toContain("Pick a work item in Work");
    expect(render(workTimelineModule, { view: "inbox" }, {})).toContain("Pick a work item from Scope");
  });
});

describe("the Flights panel", () => {
  test("each flight with its delivery, the Run mark, a Chat chip, then child work", () => {
    const html = render(workFlightsModule, page, { work: "@route" });
    expect(html).toContain(">Run<");
    expect(html).toContain("Queued until online: its thread is open in another app");
    expect(html).toContain(">Chat<");
    expect(html).toContain("Child work");
    expect(html).toContain("Child task");
    expect(html).toContain(">Blocked<");
  });

  test("an unknown work item says so", () => {
    expect(render(workFlightsModule, page, { work: "w-missing" })).toContain("Work item not found.");
  });
});

describe("the Participants panel", () => {
  test("roles per person; the operator is listed by name and is not a link", () => {
    const html = render(workPeopleModule, page, { work: "@route" });
    expect(html).toContain("Owner · Ran");
    expect(html).toMatch(/<div class="vw-row vw-row--person"><span class="vw-strong vw-ell">Art<\/span><span class="vw-dim vw-ell">Asked/);
    expect(html).toMatch(/<button type="button" class="vw-row vw-row--person"[^>]*><span class="vw-strong vw-ell">Ada/);
  });
});
