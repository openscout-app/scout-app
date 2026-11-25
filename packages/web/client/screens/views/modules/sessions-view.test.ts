import { describe, expect, test } from "bun:test";
import type { Route } from "../../../lib/types.ts";
import { FOLLOW_PAGE } from "./follow-page.ts";
import { sessionPicks } from "./session-picks.ts";
import {
  boardCurrent,
  boardFilter,
  boardLayout,
  boardMode,
  boardOpen,
  boardOpenFull,
  decodeSessionPin,
  encodeSessionPin,
  machineOptions,
  pageCompare,
  pageRequestedRef,
  pageSelection,
  panelSession,
  projectOptions,
  sessionOptions,
  sessionPageRoute,
  stickyFirst,
  threadDensity,
  threadEmptyLine,
  threadOffersOpenFull,
  threadOffersPin,
  threadSource,
} from "./sessions-view-model.ts";

const REF = "session:codex:abc";
const here = "node-here";
const local = { sessionRef: REF, machineId: here };
const remote = { sessionRef: REF, machineId: "mini" };
const trace = (...ids: string[]) => ids.map((sessionId, i) => ({ sessionId, startedAt: i, lastAcknowledgedAt: i, harness: "codex" }));

describe("a session kept as a setting", () => {
  test("round-trips the ref and the machine", () => {
    expect(encodeSessionPin({ sessionRef: REF })).toBe(REF);
    expect(encodeSessionPin(remote)).toBe(`${REF}?machineId=mini`);
    expect(decodeSessionPin(encodeSessionPin(remote))).toEqual(remote);
    expect(decodeSessionPin(encodeSessionPin({ sessionRef: REF, machineId: "a b/c" }))).toEqual({ sessionRef: REF, machineId: "a b/c" });
    expect(decodeSessionPin(encodeSessionPin({ sessionRef: REF, hostLabel: "mini" }))).toEqual({ sessionRef: REF, hostLabel: "mini" });
    expect(encodeSessionPin({ sessionRef: REF, hostLabel: "mini" })).toBe(`${REF}?host=mini`);
    expect(decodeSessionPin(REF)).toEqual({ sessionRef: REF });
  });

  test("names nothing when empty or following the page", () => {
    expect(encodeSessionPin(null)).toBe("");
    expect(decodeSessionPin("")).toBeNull();
    expect(decodeSessionPin(FOLLOW_PAGE)).toBeNull();
    expect(decodeSessionPin("?machineId=mini")).toBeNull();
  });
});

describe("the page's session", () => {
  test("/sessions/:ref names it; bare /sessions and other views name none", () => {
    expect(pageRequestedRef({ view: "sessions", sessionId: REF })).toBe(REF);
    expect(pageRequestedRef({ view: "sessions" })).toBeNull();
    expect(pageRequestedRef({ view: "work", workId: "w" } as Route)).toBeNull();
  });

  test("a flight page names ?session= when the flight has it, else its latest, and keeps an aged-out link", () => {
    expect(pageRequestedRef({ view: "sessions", flightId: "f", sessionId: "s1" }, trace("s1", "s2"))).toBe("s1");
    expect(pageRequestedRef({ view: "sessions", flightId: "f" }, trace("s1", "s2"))).toBe("s2");
    expect(pageRequestedRef({ view: "sessions", flightId: "f", sessionId: "gone" }, [])).toBe("gone");
    expect(pageRequestedRef({ view: "sessions", flightId: "f" }, [])).toBeNull();
  });

  test("the selection rides the page's ?machineId=, as the slot screen opened it", () => {
    expect(pageSelection({ view: "sessions", sessionId: REF, machineId: "mini" }, REF)).toEqual(remote);
    expect(pageSelection({ view: "sessions", sessionId: REF }, REF)).toEqual({ sessionRef: REF });
    expect(pageSelection({ view: "sessions", sessionId: REF, hostLabel: "mini" }, REF)).toEqual({ sessionRef: REF, hostLabel: "mini" });
    expect(pageCompare({ view: "sessions", flightId: "f", compareSessionId: "s2", machineId: "mini" })).toEqual({ sessionRef: "s2", machineId: "mini" });
    expect(pageCompare({ view: "sessions", flightId: "f", compareSessionId: "s2", hostLabel: "mini" })).toEqual({ sessionRef: "s2", hostLabel: "mini" });
    expect(pageCompare({ view: "sessions", flightId: "f" })).toBeNull();
  });
});

describe("a session's page", () => {
  test("a session on another machine carries its machine", () => {
    expect(sessionPageRoute({ view: "sessions" }, remote, here)).toEqual({ view: "sessions", sessionId: REF, machineId: "mini" });
  });

  test("a session that stays on a host is that host's page, and the machine scope is cleared", () => {
    const to = sessionPageRoute({ view: "sessions", machineId: "mach-carried" }, { sessionRef: REF, hostLabel: "mini" }, here);
    expect(to).toEqual({ view: "sessions", sessionId: REF, hostLabel: "mini", machineId: undefined });
    expect("machineId" in to).toBe(true);
  });

  test("a session on this machine clears a carried scope, with the key set so the router clears it", () => {
    const to = sessionPageRoute({ view: "sessions", machineId: "mini" }, local, here);
    expect(to).toEqual({ view: "sessions", sessionId: REF, machineId: undefined });
    expect("machineId" in to).toBe(true);
  });

  test("the page's own machine scope is kept when the session is on it", () => {
    expect(sessionPageRoute({ view: "sessions", machineId: here }, local, here).machineId).toBe(here);
  });

  test("with this machine unknown, the session's machine is kept", () => {
    expect(sessionPageRoute({ view: "sessions" }, local, null).machineId).toBe(here);
    expect(sessionPageRoute({ view: "sessions" }, { sessionRef: REF }, here).machineId).toBeUndefined();
  });
});

describe("Session board", () => {
  const page: Route = { view: "sessions" };
  const follows = { follow: FOLLOW_PAGE };

  test("is the page's board only on a Sessions page set to follow it", () => {
    expect(boardMode(follows, page)).toBe("route");
    expect(boardMode(follows, { view: "sessions", flightId: "f" })).toBe("route");
    expect(boardMode({}, page)).toBe("own");
    expect(boardMode(follows, { view: "activity" })).toBe("own");
  });

  test("its scopes make the slot screen's filter", () => {
    expect(boardFilter({})).toEqual({ scope: "all" });
    expect(boardFilter({ show: "asks", project: "/repo", machine: "local", harness: "codex" }))
      .toEqual({ scope: "asks", project: "/repo", machine: "local", harness: "codex" });
    expect(boardFilter({ show: "bogus" }).scope).toBe("all");
    expect(boardLayout({})).toBe("list");
    expect(boardLayout({ layout: "lanes" })).toBe("lanes");
    expect(boardLayout({ layout: "grid" })).toBe("list");
  });

  test("marks the first row until a pick, and holds it while it stays shown", () => {
    expect(stickyFirst(null, ["a", "b"])).toBe("a");
    expect(stickyFirst("b", ["a", "b"])).toBe("b");
    expect(stickyFirst("gone", ["a", "b"])).toBe("a");
    expect(stickyFirst(null, [])).toBeNull();
  });

  test("marks the page's session on its page, the first row on bare /sessions, only the flight's on a flight page", () => {
    const auto = { sessionRef: "session:claude:first" };
    expect(boardCurrent({ mode: "route", route: page, page: null, own: null, auto })).toBe(auto);
    expect(boardCurrent({ mode: "route", route: { view: "sessions", sessionId: REF }, page: { sessionRef: REF }, own: null, auto })).toEqual({ sessionRef: REF });
    expect(boardCurrent({ mode: "route", route: { view: "sessions", flightId: "f" }, page: null, own: null, auto })).toBeNull();
    expect(boardCurrent({ mode: "own", route: page, page: null, own: remote, auto })).toBe(remote);
    expect(boardCurrent({ mode: "own", route: page, page: null, own: null, auto })).toBe(auto);
  });

  test("the page's board writes the page in place, and leaves a flight page as a new entry", () => {
    expect(boardOpen({ route: page, mode: "route", selection: remote, followed: true, localNodeId: here }))
      .toEqual({ navigate: { view: "sessions", sessionId: REF, machineId: "mini" }, replace: true });
    expect(boardOpen({ route: { view: "sessions", flightId: "f" }, mode: "route", selection: local, followed: false, localNodeId: here }))
      .toEqual({ navigate: { view: "sessions", sessionId: REF, machineId: undefined }, replace: false });
  });

  test("any other board keeps the pick for a thread beside it, or opens the session's page", () => {
    expect(boardOpen({ route: { view: "activity" }, mode: "own", selection: remote, followed: true, localNodeId: here }))
      .toEqual({ pick: `${REF}?machineId=mini` });
    expect(boardOpen({ route: { view: "activity" }, mode: "own", selection: remote, followed: false, localNodeId: here }))
      .toEqual({ navigate: { view: "sessions", sessionId: REF, machineId: "mini" }, replace: false });
  });

  test("Open full: none on its page, else the marked session's page or /sessions", () => {
    expect(boardOpenFull("route", page, remote, here)).toBeNull();
    expect(boardOpenFull("own", { view: "activity" }, remote, here)).toEqual({ view: "sessions", sessionId: REF, machineId: "mini" });
    expect(boardOpenFull("own", { view: "activity" }, null, here)).toEqual({ view: "sessions" });
  });
});

describe("Session thread", () => {
  const on: Route = { view: "sessions", sessionId: REF, machineId: "mini" };

  test("following the page shows the page's session, on its machine", () => {
    expect(threadSource(on, FOLLOW_PAGE, REF)).toBe("page");
    expect(panelSession(on, FOLLOW_PAGE, REF, "session:claude:other")).toEqual({ selection: remote, source: "page" });
  });

  test("on bare /sessions and anywhere else, following shows the board's pick", () => {
    expect(panelSession({ view: "sessions" }, FOLLOW_PAGE, null, REF)).toEqual({ selection: { sessionRef: REF }, source: "pick" });
    expect(panelSession({ view: "activity" }, FOLLOW_PAGE, null, encodeSessionPin(remote))).toEqual({ selection: remote, source: "pick" });
    expect(panelSession({ view: "activity" }, FOLLOW_PAGE, null, null)).toEqual({ selection: null, source: "pick" });
  });

  test("a flight page never falls back to a pick while its flight reads", () => {
    expect(panelSession({ view: "sessions", flightId: "f" }, FOLLOW_PAGE, null, REF)).toEqual({ selection: null, source: "page" });
    expect(threadEmptyLine("page")).toBe("");
  });

  test("unset shows the pick even on its page; a pin shows its session anywhere", () => {
    expect(panelSession(on, "", REF, "session:claude:other").source).toBe("pick");
    expect(panelSession({ view: "activity" }, encodeSessionPin(remote), null, REF)).toEqual({ selection: remote, source: "pinned" });
  });

  test("Pin on a following thread with a session; Open full unless it is the page's own thread", () => {
    expect(threadOffersPin({ selection: remote, source: "page" })).toBe(true);
    expect(threadOffersPin({ selection: null, source: "pick" })).toBe(false);
    expect(threadOffersPin({ selection: remote, source: "pinned" })).toBe(false);
    expect(threadOffersOpenFull(on, { selection: remote, source: "page" })).toBe(false);
    expect(threadOffersOpenFull({ view: "sessions" }, { selection: remote, source: "pick" })).toBe(false);
    expect(threadOffersOpenFull({ view: "activity" }, { selection: remote, source: "pick" })).toBe(true);
    // pinned to the page's own session: already there; to another: offered
    expect(threadOffersOpenFull(on, { selection: remote, source: "pinned" })).toBe(false);
    expect(threadOffersOpenFull(on, { selection: { sessionRef: "session:claude:x" }, source: "pinned" })).toBe(true);
    expect(threadOffersOpenFull({ view: "activity" }, { selection: null, source: "pick" })).toBe(false);
  });

  test("Desk unless Reading or Sheet is chosen", () => {
    expect(threadDensity({})).toBe("desk");
    expect(threadDensity({ layout: "sheet" })).toBe("sheet");
    expect(threadDensity({ layout: "cards" })).toBe("desk");
  });
});

describe("scope choices", () => {
  const row = (over: Record<string, unknown>) => ({
    selection: { sessionRef: REF }, title: "Build", harness: "codex", project: "/w/app", machine: null, machineName: null, lastActiveAt: 1, ...over,
  });

  test("projects tell worktrees apart; machines by name, this machine when unnamed", () => {
    const rows = [row({ project: "/w/a/app" }), row({ project: "/w/b/app" }), row({ project: null })];
    expect(projectOptions(rows).map((o) => o.label)).toEqual(["a/app", "b/app"]);
    expect(machineOptions([row({}), row({ machine: "mini", machineName: "Mini" }), row({ machine: "mini" })]))
      .toEqual([{ value: "mini", label: "Mini" }, { value: "local", label: "This machine" }]);
  });

  test("sessions, most recent first, once each, as pins", () => {
    const options = sessionOptions([
      row({ title: "old", lastActiveAt: 1 }),
      row({ title: "new", selection: remote, machine: "mini", machineName: "Mini", lastActiveAt: 9 }),
      row({ title: "dup", lastActiveAt: 0 }),
    ]);
    expect(options).toEqual([
      { value: `${REF}?machineId=mini`, label: "new · codex · Mini" },
      { value: REF, label: "old · codex · This machine" },
    ]);
  });
});

describe("session picks", () => {
  test("a thread that shows picks counts in, and shows the latest board pick", () => {
    expect(sessionPicks.followed()).toBe(false);
    const release = sessionPicks.follow();
    sessionPicks.publish("board-1", REF);
    sessionPicks.publish("board-2", encodeSessionPin(remote));
    expect(sessionPicks.followed()).toBe(true);
    expect(sessionPicks.latest()).toBe(encodeSessionPin(remote));
    // clicking the row it already has makes it the latest again
    sessionPicks.publish("board-1", REF, true);
    expect(sessionPicks.latest()).toBe(REF);
    sessionPicks.withdraw("board-1");
    expect(sessionPicks.latest()).toBe(encodeSessionPin(remote));
    sessionPicks.withdraw("board-2");
    release();
    expect(sessionPicks.followed()).toBe(false);
    expect(sessionPicks.latest()).toBeNull();
  });
});
