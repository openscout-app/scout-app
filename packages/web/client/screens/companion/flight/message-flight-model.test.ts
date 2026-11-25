import { describe, expect, test } from "bun:test";

import {
  awayPoint,
  deskFigures,
  demoFlightMessage,
  easeFlight,
  endOf,
  flightDuration,
  flightPath,
  FLIGHT_FRESH_MS,
  FLIGHTS_PER_MESSAGE,
  messageFlights,
  nearestOnBox,
  type FlightDesk,
} from "./message-flight-model.ts";
import type { FlowSourceMessage } from "../../../lib/comms-flow.ts";

const NOW = 1_800_000_000_000;

const desk: FlightDesk = {
  operatorIds: new Set(["operator", "Arach"]),
  figures: [
    { pin: "work-hudson", agentId: "hudson-pauli-3", conversationId: "dm-hudson" },
    { pin: "session:s-42", sessionId: "s-42", conversationId: "dm-s42" },
  ],
};

function msg(partial: Partial<FlowSourceMessage>): FlowSourceMessage {
  return { id: "m1", conversationId: "c1", actorId: "operator", body: "hi", createdAt: NOW, ...partial };
}

describe("endOf", () => {
  test("the operator, under any of its ids, and Scoutbot are the board", () => {
    expect(endOf("operator", desk)).toEqual({ kind: "board" });
    expect(endOf("Arach", desk)).toEqual({ kind: "board" });
    expect(endOf("scoutbot", desk)).toEqual({ kind: "board" });
  });

  test("a figure answers to its agent, its session and its pin", () => {
    expect(endOf("hudson-pauli-3", desk)).toEqual({ kind: "figure", pin: "work-hudson" });
    expect(endOf("s-42", desk)).toEqual({ kind: "figure", pin: "session:s-42" });
    expect(endOf("session:s-42", desk)).toEqual({ kind: "figure", pin: "session:s-42" });
  });

  test("anyone else is away", () => {
    expect(endOf("mini-codex-7", desk)).toEqual({ kind: "away", actorId: "mini-codex-7" });
  });
});

describe("messageFlights", () => {
  test("an ask to an agent on another host leaves the board and flies away", () => {
    const flights = messageFlights(msg({ metadata: { targetAgentId: "mini-codex-7" } }), desk, NOW);
    expect(flights).toEqual([{ id: "m1:mini-codex-7", from: { kind: "board" }, to: { kind: "away", actorId: "mini-codex-7" } }]);
  });

  test("its answer flies in from away to the board", () => {
    const answer = msg({ id: "m2", actorId: "mini-codex-7", metadata: { requestedReturnAddress: { actorId: "operator" } } });
    expect(messageFlights(answer, desk, NOW)).toEqual([
      { id: "m2:board", from: { kind: "away", actorId: "mini-codex-7" }, to: { kind: "board" } },
    ]);
  });

  test("agent to agent on the desk flies figure to figure", () => {
    const flights = messageFlights(msg({ actorId: "hudson-pauli-3", metadata: { targetSessionId: "s-42" } }), desk, NOW);
    expect(flights.map((f) => [f.from, f.to])).toEqual([[{ kind: "figure", pin: "work-hudson" }, { kind: "figure", pin: "session:s-42" }]]);
  });

  test("a reply under the agent's own id lands from the session that ran it", () => {
    const reply = msg({ actorId: "codex-unlisted", metadata: { responderSessionId: "s-42", requestedReturnAddress: { actorId: "operator" } } });
    expect(messageFlights(reply, desk, NOW)[0]?.from).toEqual({ kind: "figure", pin: "session:s-42" });
  });

  test("a message to a figure's thread, addressed to nobody, goes between that figure and the board", () => {
    expect(messageFlights(msg({ conversationId: "dm-hudson" }), desk, NOW).map((f) => f.to)).toEqual([{ kind: "figure", pin: "work-hudson" }]);
    const back = msg({ conversationId: "dm-hudson", actorId: "hudson-pauli-3" });
    expect(messageFlights(back, desk, NOW).map((f) => [f.from.kind, f.to.kind])).toEqual([["figure", "board"]]);
  });

  test("a message to a conversation no figure owns does not guess a recipient", () => {
    expect(messageFlights(msg({ conversationId: "room-general" }), desk, NOW)).toEqual([]);
  });

  test("traffic between two away agents is not this desk's", () => {
    expect(messageFlights(msg({ actorId: "mini-a", metadata: { targetAgentId: "mini-b" } }), desk, NOW)).toEqual([]);
  });

  test("status lines, broker posts, replays and self-sends draw nothing", () => {
    expect(messageFlights(msg({ class: "status", metadata: { targetAgentId: "mini-a" } }), desk, NOW)).toEqual([]);
    expect(messageFlights(msg({ actorId: "system", metadata: { targetAgentId: "hudson-pauli-3" } }), desk, NOW)).toEqual([]);
    expect(messageFlights(msg({ createdAt: NOW - FLIGHT_FRESH_MS - 1, metadata: { targetAgentId: "mini-a" } }), desk, NOW)).toEqual([]);
    expect(messageFlights(msg({ metadata: { targetAgentId: "scoutbot" } }), desk, NOW)).toEqual([]);
  });

  test("a broadcast is capped and each recipient flies once", () => {
    const ids = ["a", "b", "a", "c", "d", "e", "f"];
    const flights = messageFlights(msg({ metadata: { relayTargetIds: ids } }), desk, NOW);
    expect(flights).toHaveLength(FLIGHTS_PER_MESSAGE);
    expect(new Set(flights.map((f) => f.id)).size).toBe(FLIGHTS_PER_MESSAGE);
  });
});

describe("deskFigures", () => {
  test("reads who each pin is from its row, else from the pin's last-seen agent", () => {
    const rows: Record<string, { identityId?: string; conversationId?: string }> = {
      "work-1": { identityId: "hudson-pauli-3", conversationId: "dm-1" },
      "session:abc": { identityId: "native:claude:abc" },
    };
    const figures = deskFigures(["work-1", "session:abc", "work-gone"], (pin) => rows[pin], { "work-gone": "lattices-ada-2" });
    expect(figures).toEqual([
      { pin: "work-1", agentId: "hudson-pauli-3", sessionId: null, conversationId: "dm-1" },
      { pin: "session:abc", agentId: "native:claude:abc", sessionId: "abc", conversationId: null },
      { pin: "work-gone", agentId: "lattices-ada-2", sessionId: null, conversationId: null },
    ]);
    // A message addressed to the raw session finds the native figure.
    expect(endOf("abc", { operatorIds: new Set(), figures })).toEqual({ kind: "figure", pin: "session:abc" });
  });
});

describe("demo", () => {
  test("the demo script draws every kind of flight on the demo desk", () => {
    const demoDesk: FlightDesk = { operatorIds: new Set(["operator"]), figures: [{ pin: "demo-ada" }, { pin: "demo-descartes" }] };
    const kinds = Array.from({ length: 6 }, (_, i) => messageFlights(demoFlightMessage(i, NOW), demoDesk, NOW).map((f) => `${f.from.kind}>${f.to.kind}`)).flat();
    expect(kinds).toEqual(["board>figure", "figure>figure", "figure>away", "away>board", "board>away", "figure>board"]);
  });
});

describe("geometry", () => {
  test("a flight touches the board's edge nearest the other end", () => {
    const box = { left: 100, top: 100, right: 300, bottom: 200 };
    expect(nearestOnBox(box, { x: 50, y: 150 })).toEqual({ x: 100, y: 150 });
    expect(nearestOnBox(box, { x: 200, y: 110 })).toEqual({ x: 200, y: 100 });
  });

  test("away is over the top edge, or out the nearer side when already near the top", () => {
    expect(awayPoint({ x: 1400, y: 800 }, 1600, 1000)).toEqual({ x: 1280, y: -40 });
    expect(awayPoint({ x: 1500, y: 60 }, 1600, 1000)).toEqual({ x: 1640, y: 180 });
    expect(awayPoint({ x: 100, y: 60 }, 1600, 1000).x).toBe(-40);
  });

  test("the arc bows upward in either direction", () => {
    const control = (d: string) => Number(d.split(" ")[5]);
    expect(control(flightPath({ x: 0, y: 500 }, { x: 1000, y: 500 }))).toBeLessThan(500);
    expect(control(flightPath({ x: 1000, y: 500 }, { x: 0, y: 500 }))).toBeLessThan(500);
  });

  test("the ease starts and ends still, is monotonic, and passes the middle", () => {
    expect(easeFlight(0)).toBe(0);
    expect(easeFlight(1)).toBe(1);
    let last = 0;
    for (let i = 1; i <= 20; i++) { const v = easeFlight(i / 20); expect(v).toBeGreaterThanOrEqual(last); last = v; }
    expect(easeFlight(0.5)).toBeGreaterThan(0.4);
    expect(easeFlight(0.5)).toBeLessThan(0.75);
  });

  test("duration grows with distance and is capped", () => {
    expect(flightDuration({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(520);
    expect(flightDuration({ x: 0, y: 0 }, { x: 5000, y: 0 })).toBe(1100);
  });
});
