import { describe, expect, test } from "bun:test";

import type { WebWorkBoardCard, WebWorkItem, WebWorkMoveDecision, WebWorkMoveResponse, WebWorkStation } from "../../../../shared/api/web.ts";
import {
  answerBand, claimLifts, columnDefinition, defaultFolded, initials, isYourMove, laneFoldKey, lanesByOwner, OPERATOR_ID, ownerOptions, priorityRank, readDisplay,
  ENDED_FLIGHT_STATES, liveSessionRoute, placeCards, placeFrom, placeStation, readFolded, SESSION_PHASES, SESSION_QUIET_AFTER_MS, sessionPhase, refusalIsAsk, stationAsk, tintOf, unreachable, verdictNote, visibleCards, writeFolded, writeProps,
} from "./board-model.ts";

const station = (id: string, state: string, rules: WebWorkStation["rules"] = []): WebWorkStation => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), state, purpose: null, rules, judges: [],
});

const STATIONS = [
  station("backlog", "open"),
  station("doing", "working", [{ id: "own", check: "mover_is_owner", effect: "hold", message: "Only the owner starts it. Claim it first.", shadow: false }]),
  station("waiting", "waiting", [{ id: "wait", check: "has_waiting_on", effect: "deny", message: "Say what it is waiting on.", shadow: false }]),
  station("review", "review"),
  station("done", "done"),
  station("dropped", "cancelled", [{ id: "why", check: "has_note", effect: "deny", message: "Say why it is dropped.", shadow: false }]),
];
const BY_ID = new Map(STATIONS.map((s) => [s.id, s]));

function card(id: string, at: string, item: Partial<WebWorkItem> = {}, extra: Partial<WebWorkBoardCard> = {}): WebWorkBoardCard {
  return {
    station: at, reviewPending: false, revision: 1, next: [],
    item: {
      id, title: `Item ${id}`, summary: null, ownerId: null, ownerName: null, nextMoveOwnerId: null, nextMoveOwnerName: null,
      conversationId: null, createdAt: 0, updatedAt: 0, parentId: null, parentTitle: null, state: "open", acceptanceState: "none",
      priority: null, currentPhase: "", attention: "none" as WebWorkItem["attention"], activeChildWorkCount: 0, activeFlightCount: 0,
      lastMeaningfulAt: 0, lastMeaningfulSummary: null, ...item,
    },
    ...extra,
  };
}

const decision = (verdict: WebWorkMoveDecision["verdict"], fails: Array<[string, string]> = [], review: "pending" | "not_needed" = "not_needed"): WebWorkMoveDecision => ({
  verdict, from: "backlog", to: "doing", toState: "working", judges: [], review,
  reasons: fails.map(([check, message]) => ({ ruleId: check, scope: "station", check, outcome: "fail" as const, effect: verdict, message })),
});

describe("board model", () => {
  test("names agents by the last word of their session name", () => {
    expect(initials("demo-app-planck-9")).toBe("PL");
    expect(initials("Ada")).toBe("AD");
    expect(initials(null)).toBe("");
    expect(tintOf("a")).toBe(tintOf("a"));
    expect(tintOf("a")).toBeLessThan(6);
  });

  test("ranks priority words and treats anything else as none", () => {
    expect(priorityRank("Urgent")).toBe(4);
    expect(priorityRank("medium")).toBe(2);
    expect(priorityRank(null)).toBe(0);
    expect(priorityRank("p1")).toBe(0);
  });

  test("your move is the operator's next move on unsettled work", () => {
    const yours = card("a", "review", { nextMoveOwnerId: OPERATOR_ID });
    expect(isYourMove(yours, BY_ID.get("review"))).toBe(true);
    expect(isYourMove({ ...yours, station: "done" }, BY_ID.get("done"))).toBe(false);
    expect(isYourMove({ ...yours, item: { ...yours.item, failedRun: { flightId: "flt-1" } } }, BY_ID.get("review"))).toBe(false);
  });

  test("views, owners, settled stations and search narrow the cards", () => {
    const cards = [
      card("a", "review", { nextMoveOwnerId: OPERATOR_ID, ownerId: "s1", ownerName: "planck", lastMeaningfulAt: 1 }),
      card("b", "doing", { activeFlightCount: 1, liveFlight: { id: "f", state: "running", sessionId: null, harness: null, startedAt: Date.now(), lastActivityAt: Date.now() }, ownerId: "s2", ownerName: "turing", title: "Fix the relay", lastMeaningfulAt: 3, priority: "high" }),
      card("c", "done", { ownerId: "s1", ownerName: "planck", lastMeaningfulAt: 2 }, { reviewPending: true }),
    ];
    const base = { view: "all" as const, owners: [], hideSettled: false, query: "" };
    expect(visibleCards(cards, BY_ID, { ...base, view: "my-move" }, "manual").map((c) => c.item.id)).toEqual(["a"]);
    expect(visibleCards(cards, BY_ID, { ...base, view: "working" }, "manual").map((c) => c.item.id)).toEqual(["b"]);
    expect(visibleCards(cards, BY_ID, { ...base, view: "review" }, "manual").map((c) => c.item.id)).toEqual(["c"]);
    expect(visibleCards(cards, BY_ID, { ...base, owners: ["s1"] }, "manual").map((c) => c.item.id)).toEqual(["a", "c"]);
    expect(visibleCards(cards, BY_ID, { ...base, hideSettled: true }, "manual").map((c) => c.item.id)).toEqual(["a", "b"]);
    expect(visibleCards(cards, BY_ID, { ...base, query: "relay" }, "manual").map((c) => c.item.id)).toEqual(["b"]);
    expect(visibleCards(cards, BY_ID, base, "updated").map((c) => c.item.id)).toEqual(["b", "c", "a"]);
    expect(visibleCards(cards, BY_ID, base, "priority").map((c) => c.item.id)).toEqual(["b", "c", "a"]);
  });

  test("owners and lanes put the busiest first and no owner last", () => {
    const cards = [card("a", "doing"), card("b", "doing", { ownerId: "s1", ownerName: "planck" }), card("c", "done", { ownerId: "s1", ownerName: "planck" })];
    expect(ownerOptions(cards).map((o) => [o.id, o.count])).toEqual([["s1", 2], ["", 1]]);
    expect(lanesByOwner(cards).map((l) => l.key)).toEqual(["s1", ""]);
  });

  test("a verdict reads as one line in the runtime's words", () => {
    expect(verdictNote(decision("allow"))).toBe("Moves now.");
    expect(verdictNote(decision("allow", [], "pending"))).toBe("Moves, then waits for review.");
    expect(verdictNote(decision("hold", [["mover_is_owner", "Only the owner starts it. Claim it first."]]))).toBe("Only the owner starts it. Claim it first.");
    expect(verdictNote(decision("deny"))).toBe("The lifecycle does not allow it.");
    expect(verdictNote(unreachable(BY_ID.get("done"), BY_ID.get("doing")!))).toBe("No path from Done to Doing.");
  });

  test("stations that need a note or a blocker ask before the move", () => {
    expect(stationAsk(BY_ID.get("waiting")!)).toBe("waiting");
    expect(stationAsk(BY_ID.get("dropped")!)).toBe("note");
    expect(stationAsk(BY_ID.get("doing")!)).toBe(null);
    expect(refusalIsAsk(decision("deny", [["has_waiting_on", "Say what it is waiting on."]]))).toBe(true);
    expect(refusalIsAsk(decision("deny", [["has_waiting_on", "x"], ["transition", "y"]]))).toBe(false);
    expect(claimLifts(decision("hold", [["mover_is_owner", "Claim it first."]]))).toBe(true);
    expect(claimLifts(decision("hold", [["children_settled", "Settle the sub-items first."]]))).toBe(false);
  });

  test("a card keeps a band only for answers the runtime did not apply", () => {
    const answer = (d: WebWorkMoveDecision, applied: boolean): WebWorkMoveResponse => ({ decision: d, applied });
    expect(answerBand(answer(decision("allow"), true))).toBe(null);
    expect(answerBand(answer(decision("hold", [["children_settled", "Settle the sub-items first."]]), false))).toEqual({ kind: "hold", text: "Settle the sub-items first." });
    expect(answerBand(undefined)).toBe(null);
  });

  test("folded sections start with the done and cancelled stations and round-trip through the panel config", () => {
    const base = defaultFolded(STATIONS);
    expect(base).toEqual(["done", "dropped"]);
    expect([...readFolded(undefined, base)]).toEqual(["done", "dropped"]);
    expect([...readFolded("", base)]).toEqual(["done", "dropped"]);
    expect([...readFolded("none", base)]).toEqual([]);
    expect([...readFolded("review,done", base)]).toEqual(["review", "done"]);
    expect(writeFolded(["dropped", "done"], base)).toBe("");
    expect(writeFolded(["dropped"], base)).toBe("dropped");
    expect(writeFolded([], base)).toBe("none");
    expect(writeFolded(["done", "review", "done"], base)).toBe("done,review");
    expect([...readFolded(writeFolded(["review"], base), base)]).toEqual(["review"]);
    expect(writeFolded([], [])).toBe("");
    expect(laneFoldKey("")).toBe("-");
    expect([...readFolded(writeFolded([laneFoldKey(""), "s1"], []), [])]).toEqual(["-", "s1"]);
  });

  test("display settings round-trip through the panel config", () => {
    expect(readDisplay({})).toEqual({ layout: "board", order: "manual", view: "all", props: ["priority", "owner", "age", "status"], compact: false, showEmpty: true });
    expect(readDisplay({ layout: "list", order: "priority", view: "my-move", props: "none", compact: "1", empty: "0" }))
      .toEqual({ layout: "list", order: "priority", view: "my-move", props: [], compact: true, showEmpty: false });
    expect(readDisplay({ layout: "bogus" }).layout).toBe("board");
    expect(writeProps(["owner", "priority"])).toBe("priority,owner");
    expect(writeProps([])).toBe("none");
    expect(writeProps(["status", "age", "owner", "priority"])).toBe("");
    expect(readDisplay({ props: writeProps(["age"]) }).props).toEqual(["age"]);
  });
});

const NOW = 10_000_000;
const flight = (state: string, quietFor = 0, sessionId: string | null = "session-1") => ({
  activeFlightCount: 1,
  liveFlight: { id: "flt-1", state, sessionId, harness: "claude", startedAt: NOW - quietFor, lastActivityAt: NOW - quietFor },
});

describe("sessionPhase", () => {
  const phase = (item: Partial<WebWorkItem>) => sessionPhase(card("x", "backlog", item).item, NOW);

  test("running with recent activity is working; past the quiet window it is stale", () => {
    expect(phase(flight("running"))).toBe("working");
    expect(phase(flight("running", SESSION_QUIET_AFTER_MS))).toBe("working");
    expect(phase(flight("running", SESSION_QUIET_AFTER_MS + 1))).toBe("stale");
  });

  test("queued and waking are starting, waiting is waiting, whatever their age", () => {
    expect(phase(flight("queued", SESSION_QUIET_AFTER_MS * 10))).toBe("starting");
    expect(phase(flight("waking"))).toBe("starting");
    expect(phase(flight("waiting", SESSION_QUIET_AFTER_MS * 10))).toBe("waiting");
  });

  test("no flight, or an ended one, is none; a count without a flight is not working", () => {
    expect(phase({})).toBe("none");
    expect(phase({ activeFlightCount: 3 })).toBe("none");
    for (const state of ENDED_FLIGHT_STATES) expect(phase(flight(state))).toBe("none");
  });

  test("a running flight with no activity evidence is stale, not working", () => {
    expect(phase({ activeFlightCount: 1, liveFlight: { id: "f", state: "running", sessionId: null, harness: null, startedAt: null, lastActivityAt: null } })).toBe("stale");
  });
});

describe("placeStation", () => {
  const STD = [station("backlog", "open"), station("ready", "open"), ...STATIONS.slice(1)];
  const place = (at: string, item: Partial<WebWorkItem> = {}) => placeStation(card("x", at, item), STD, NOW);
  const stale = flight("running", SESSION_QUIET_AFTER_MS + 60_000);

  test("Doing holds only a running flight with recent activity", () => {
    expect(place("doing", flight("running"))).toBe("doing");
    expect(place("doing", stale)).toBe("ready");
    expect(place("doing", flight("queued"))).toBe("ready");
    expect(place("doing", {})).toBe("ready");
    expect(place("doing", { activeFlightCount: 1 })).toBe("ready");
  });

  test("a working session brings open or waiting work into Doing", () => {
    for (const at of ["backlog", "ready", "waiting"]) expect(place(at, flight("running"))).toBe("doing");
  });

  test("a flight waiting on someone stands in Waiting", () => {
    for (const at of ["backlog", "ready", "doing", "waiting"]) expect(place(at, flight("waiting"))).toBe("waiting");
  });

  test("starting and stale work keeps the runtime's open or waiting station", () => {
    for (const at of ["backlog", "ready", "waiting"]) {
      expect(place(at, flight("queued"))).toBe(at);
      expect(place(at, stale)).toBe(at);
    }
  });

  test("review, done and dropped stay where the runtime has them, whatever the session", () => {
    for (const at of ["review", "done", "dropped"]) {
      for (const item of [flight("running"), flight("waiting"), stale, {}]) expect(place(at, item)).toBe(at);
    }
  });

  test("moved cards are copies; cards that stay are the same object", () => {
    const cards = [card("a", "doing"), card("b", "ready")];
    const placed = placeCards(cards, STD, NOW);
    expect(placed.map((c) => c.station)).toEqual(["ready", "ready"]);
    expect(placed[0]).not.toBe(cards[0]);
    expect(placed[1]).toBe(cards[1]);
  });

  test("a card goes stale on the clock alone", () => {
    const c = card("x", "doing", flight("running"));
    expect(placeStation(c, STD, NOW)).toBe("doing");
    expect(placeStation(c, STD, NOW + SESSION_QUIET_AFTER_MS + 1)).toBe("ready");
  });
});

describe("liveSessionRoute", () => {
  test("opens the flight's current session, or the flight before it has one", () => {
    expect(liveSessionRoute(card("x", "doing", flight("running")).item)).toEqual({ view: "sessions", sessionId: "session-1" });
    expect(liveSessionRoute(card("x", "doing", flight("queued", 0, null)).item)).toEqual({ view: "sessions", flightId: "flt-1" });
    expect(liveSessionRoute(card("x", "doing").item)).toBeNull();
    expect(liveSessionRoute(card("x", "doing", flight("completed")).item)).toBeNull();
  });
});

describe("columnDefinition", () => {
  const STD = [station("backlog", "open"), station("ready", "open"), ...STATIONS.slice(1)];
  const def = (id: string) => columnDefinition(STD.find((s) => s.id === id)!, STD);
  const minutes = `${SESSION_QUIET_AFTER_MS / 60_000} min`;

  test("Doing spells out the whole chain from the constants", () => {
    const d = def("doing");
    expect(d.rule).toBe("Its phase is working and the runtime has it in Doing, Backlog, Ready or Waiting.");
    expect(d.reads.join(" ")).toContain("item.liveFlight.lastActivityAt");
    expect(d.qualifies).toEqual([`working: flight \`running\`, activity within ${minutes}`]);
    expect(d.excluded).toEqual([
      `stale: flight \`running\`, no activity for over ${minutes} → Ready`,
      "starting: flight `queued`, `waking` → Ready",
      "waiting: flight `waiting` → Waiting",
      "none: no unended flight (ended: `completed`, `failed`, `cancelled`) → Ready",
    ]);
    expect(d.liveness).toContain(minutes);
    expect(d.precedence).toEqual([
      "Review, Done, Dropped: the runtime's station stands; session phase is not read.",
      "Phase working → Doing.",
      "Phase waiting → Waiting.",
      "Any other phase keeps the runtime's station, but not Doing: it goes to Ready.",
    ]);
  });

  test("Doing's rule names the same flight states the phases use", () => {
    const text = JSON.stringify(def("doing"));
    for (const phase of Object.values(SESSION_PHASES)) for (const state of phase.flightStates) expect(text).toContain(`\`${state}\``);
  });

  test("Ready takes back what Doing can't hold", () => {
    const d = def("ready");
    expect(d.rule).toBe("Its phase is stale, starting or none and the runtime has it in Ready or Doing.");
    expect(d.excluded.map((t) => t.split(":")[0])).toEqual(["working", "waiting"]);
  });

  test("a station the board never moves reads only the runtime's station", () => {
    const d = def("done");
    expect(d.rule).toBe("The runtime's station is Done (state `done`).");
    expect(d.liveness).toBeNull();
  });

  test("every definition agrees with placeFrom", () => {
    for (const s of STD) {
      const d = columnDefinition(s, STD);
      for (const t of d.excluded) {
        const phase = t.split(":")[0] as keyof typeof SESSION_PHASES;
        expect(t.endsWith(`→ ${placeFrom(s, phase, STD).name}`)).toBe(true);
      }
    }
  });
});
