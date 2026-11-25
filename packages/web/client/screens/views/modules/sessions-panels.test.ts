import { beforeEach, describe, expect, mock, test } from "bun:test";

import type { Flight, Route } from "../../../lib/types.ts";
import type { SessionBoardRow } from "../../sessions/session-board-model.ts";
import type { FlightRecordState } from "../../sessions/flight-observe.ts";

/*
 * The Sessions view's panels, rendered to markup with the shared board read,
 * the flight read and the session slot mocked (the pattern in
 * briefings-panels.test.ts). The slot's own rendering is held by
 * screens/sessions (SessionSteer.test.tsx and the rest).
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

const HERE = "node-here";
const row = (key: string, over: Partial<SessionBoardRow> = {}): SessionBoardRow => ({
  key: `${HERE}:codex:${key}`,
  selection: { sessionRef: `session:codex:${key}`, machineId: HERE },
  sessionId: key,
  title: `Session ${key}`,
  harness: "codex",
  project: "/w/app",
  branch: null,
  model: null,
  machine: HERE,
  machineName: null,
  working: false,
  asks: false,
  lastActiveAt: 1,
  preview: null,
  origin: { kind: "you", label: "started by you" },
  conversation: null,
  lane: null,
  ...over,
});

const board = {
  rows: [] as SessionBoardRow[],
  loading: false,
  error: null as string | null,
};
const flights: Record<string, FlightRecordState> = {};

mock.module("../../sessions/use-session-board.ts", () => ({
  useSessionBoard: () => ({
    ...board,
    reading: false,
    refresh: async () => undefined,
    now: 1,
    requests: { state: { items: [] }, error: null },
    localNodeId: HERE,
  }),
  useSessionBoardRows: () => board.rows,
}));
mock.module("../../sessions/use-flight-record.ts", () => ({
  useFlightRecord: (flightId: string | undefined) => (flightId && flights[flightId]) || { flight: null, loading: false, error: null },
}));
mock.module("../../sessions/SessionSlot.tsx", () => ({
  SessionSlot: ({ selection, inspector, density }: { selection: { sessionRef: string; machineId?: string }; inspector?: boolean; density?: string }) =>
    createElement("div", {
      "data-slot": selection.sessionRef,
      "data-machine": selection.machineId ?? "",
      "data-inspector": String(Boolean(inspector)),
      "data-density": density,
    }),
}));
mock.module("../../sessions/SessionObserve.tsx", () => ({ SessionObserve: () => null }));
mock.module("../../ops/AgentLaneCard.tsx", () => ({
  AgentLaneCard: () => createElement("div", { "data-lane-card": "" }),
}));

const { ScoutContext } = await import("../../../scout/Provider.tsx");
const { ModuleHeadSlot } = await import("./ModuleHead.tsx");
const { FOLLOW_PAGE } = await import("./panel-scope.ts");
const { sessionPicks } = await import("./session-picks.ts");
const { sessionBoardModule } = await import("./session-board.tsx");
const { sessionThreadModule } = await import("./session-thread.tsx");

const noop = () => undefined;

function renderPanel(module: { Component: unknown }, route: Route, config: Record<string, string> = {}, instanceId = "t"): string {
  const props = { instanceId, route, navigate: noop, config, setConfig: noop };
  const scout = { route, navigate: noop, agents: [], agentsLoaded: true };
  const panel = createElement(ModuleHeadSlot.Provider, { value: {} as never }, createElement(module.Component as never, props as never));
  return renderToStaticMarkup(createElement(ScoutContext.Provider, { value: scout as never }, panel));
}

const pressed = (html: string) => [...html.matchAll(/aria-pressed="true"[^>]*>.*?<strong>([^<]+)<\/strong>/g)].map((m) => m[1]);

beforeEach(() => {
  board.rows = [row("a"), row("b", { asks: true }), row("c", { working: true, selection: { sessionRef: "session:codex:c", machineId: "mini" }, machine: "mini", machineName: "Mini" })];
  board.loading = false;
  board.error = null;
  for (const key of Object.keys(flights)) delete flights[key];
  for (const id of ["beside", "t"]) sessionPicks.withdraw(id);
});

describe("Session board", () => {
  test("bare /sessions: every session, the first marked, the count and Refresh; plain words", () => {
    const html = renderPanel(sessionBoardModule, { view: "sessions" }, { follow: FOLLOW_PAGE });
    expect(html).toContain("Session a");
    expect(html).toContain("Session c");
    expect(pressed(html)).toEqual(["Session c"]);
    expect(html).toContain('class="hud-grid-count"');
    expect(html).toContain(">3<");
    expect(html).toContain("Refresh");
    expect(html).toContain(">Waiting<");
    expect(html).toContain(">Working<");
    expect(html).not.toContain("Open full");
    for (const absent of ["Needs input", "Needs you", "Steer", ">Ask<"]) expect(html).not.toContain(absent);
  });

  test("/sessions/:ref marks the page's session", () => {
    const html = renderPanel(sessionBoardModule, { view: "sessions", sessionId: "session:codex:b" }, { follow: FOLLOW_PAGE });
    expect(pressed(html)).toEqual(["Session b"]);
  });

  test("a flight page marks only the flight's session", () => {
    flights.f = { flight: { id: "f", state: "running", sessions: [] } as unknown as Flight, loading: false, error: null };
    const html = renderPanel(sessionBoardModule, { view: "sessions", flightId: "f" }, { follow: FOLLOW_PAGE });
    expect(pressed(html)).toEqual([]);
  });

  test("its scopes narrow it; Cards and Lanes", () => {
    const working = renderPanel(sessionBoardModule, { view: "sessions" }, { follow: FOLLOW_PAGE, show: "working" });
    expect(working).toContain("Session c");
    expect(working).not.toContain("Session a");
    expect(renderPanel(sessionBoardModule, { view: "sessions" }, { layout: "cards" })).toContain("s-session-board--cards");
    const lanes = renderPanel(sessionBoardModule, { view: "sessions" }, { layout: "lanes" });
    // rows without a lane stay rows
    expect(lanes).toContain('class="s-session-member"');
    expect(renderPanel(sessionBoardModule, { view: "sessions" }, { machine: "nowhere" })).toContain("No sessions in this panel&#x27;s scope");
  });

  test("as a List, rows sit under their project with their age; Cards keep no project lines", () => {
    board.rows = [row("a", { project: "/w/app", lastActiveAt: 10 }), row("b", { project: "/w/site", lastActiveAt: 20 }), row("c", { project: "/w/app", working: true, lastActiveAt: 1 })];
    const html = renderPanel(sessionBoardModule, { view: "sessions" }, { follow: FOLLOW_PAGE });
    const order = [...html.matchAll(/class="s-session-group">([^<]+)<|<strong>([^<]+)<\/strong>/g)].map((m) => m[1] ?? m[2]);
    expect(order).toEqual(["site", "Session b", "app", "Session c", "Session a"]);
    expect(pressed(html)).toEqual(["Session b"]);
    expect(html).toContain('data-state="idle">now<');
    expect(html).not.toContain("started by you");
    expect(renderPanel(sessionBoardModule, { view: "sessions" }, { layout: "cards" })).not.toContain("s-session-group");
  });

  test("off its page: its own pick is marked, with Open full", () => {
    const html = renderPanel(sessionBoardModule, { view: "activity" }, { session: "session:codex:c?machineId=mini" });
    expect(pressed(html)).toEqual(["Session c"]);
    expect(html).toContain("Open full");
  });

  test("quiet while the first read is on its way, and says when sources failed", () => {
    board.rows = [];
    board.loading = true;
    expect(renderPanel(sessionBoardModule, { view: "sessions" })).toContain("Reading sessions…");
    board.loading = false;
    expect(renderPanel(sessionBoardModule, { view: "sessions" })).toContain("No sessions yet.");
    board.rows = [row("a")];
    board.error = "Some session sources are unavailable.";
    expect(renderPanel(sessionBoardModule, { view: "sessions" })).toContain("Some session sources are unavailable.");
  });
});

describe("Session thread", () => {
  test("follows /sessions/:ref on the page's machine, with Desk's inspector and Pin", () => {
    const html = renderPanel(sessionThreadModule, { view: "sessions", sessionId: "session:codex:c", machineId: "mini" }, { session: FOLLOW_PAGE });
    expect(html).toContain('data-slot="session:codex:c"');
    expect(html).toContain('data-machine="mini"');
    expect(html).toContain('data-inspector="true"');
    expect(html).toContain(">Pin<");
    expect(html).not.toContain("Open full");
  });

  test("a flight page: the flight's bar, its latest session, and ?compare= beside it", () => {
    const sessions = [{ sessionId: "s1", harness: "codex", startedAt: 1, lastAcknowledgedAt: 1 }, { sessionId: "s2", harness: "claude", startedAt: 2, lastAcknowledgedAt: 2 }];
    flights.f = { flight: { id: "f", state: "running", sessions } as unknown as Flight, loading: false, error: null };
    const html = renderPanel(sessionThreadModule, { view: "sessions", flightId: "f", compareSessionId: "s1" }, { session: FOLLOW_PAGE });
    expect(html).toContain("Flight f · running");
    expect(html).toContain("Compare");
    expect(html).toContain('data-slot="s2"');
    expect(html).toContain('data-slot="s1"');
    expect(html).toContain("data-compare");
    expect(html).toContain('aria-label="Compared session"');
  });

  test("a flight that has not reported a session waits, and never shows a board's pick", () => {
    flights.f = { flight: { id: "f", state: "queued", sessions: [] } as unknown as Flight, loading: false, error: null };
    sessionPicks.publish("beside", "session:codex:a");
    const html = renderPanel(sessionThreadModule, { view: "sessions", flightId: "f" }, { session: FOLLOW_PAGE });
    expect(html).toContain("Waiting for the flight to report a session.");
    expect(html).not.toContain("data-slot");
  });

  test("bare /sessions and other views show the board's pick", () => {
    sessionPicks.publish("beside", "session:codex:a?machineId=node-here");
    const bare = renderPanel(sessionThreadModule, { view: "sessions" }, { session: FOLLOW_PAGE });
    expect(bare).toContain('data-slot="session:codex:a"');
    expect(bare).not.toContain("Open full");
    const elsewhere = renderPanel(sessionThreadModule, { view: "activity" });
    expect(elsewhere).toContain('data-slot="session:codex:a"');
    expect(elsewhere).toContain("Open full");
  });

  test("a shown session opens on its thread, with Terminal waiting until its terminal is found", () => {
    const html = renderPanel(sessionThreadModule, { view: "sessions", sessionId: "session:codex:c", machineId: "mini" }, { session: FOLLOW_PAGE });
    expect(html).toMatch(/aria-pressed="true"[^>]*>Thread</);
    expect(html).toMatch(/aria-pressed="false" aria-disabled="true"[^>]*title="Looking for this session&#x27;s terminal"[^>]*>Terminal</);
    expect(html).not.toContain(">Take over<");
    expect(html).toContain('data-slot="session:codex:c"');
  });

  test("two compared sessions have no Terminal", () => {
    const sessions = [{ sessionId: "s1", harness: "codex", startedAt: 1, lastAcknowledgedAt: 1 }, { sessionId: "s2", harness: "claude", startedAt: 2, lastAcknowledgedAt: 2 }];
    flights.f = { flight: { id: "f", state: "running", sessions } as unknown as Flight, loading: false, error: null };
    const html = renderPanel(sessionThreadModule, { view: "sessions", flightId: "f", compareSessionId: "s1" }, { session: FOLLOW_PAGE });
    expect(html).not.toContain(">Terminal<");
    expect(html).not.toContain(">Thread<");
  });

  test("with no pick it says how to get one", () => {
    expect(renderPanel(sessionThreadModule, { view: "activity" })).toContain("Pick a session in a Session board beside this panel");
  });

  test("pinned: Unpin and Open full; Reading has no inspector", () => {
    const html = renderPanel(sessionThreadModule, { view: "activity" }, { session: "session:codex:b", layout: "reading" });
    expect(html).toContain('data-slot="session:codex:b"');
    expect(html).toContain(">Unpin<");
    expect(html).toContain("Open full");
    expect(html).toContain('data-inspector="false"');
    expect(html).toContain('data-density="reading"');
  });
});
