import { describe, expect, test } from "bun:test";

import type { WebFlight, WebWorkItem } from "./api/web.ts";
import { flightFrame, materialFrame, messageFrame, nameFrames, projectAgent, workFrame } from "./board-projection.ts";
import {
  boardIdFor,
  CARD_H,
  CARD_W,
  copyOf,
  foldBoard,
  layoutBoard,
  noteFrames,
  OPERATOR_LAYER,
  orderLayers,
  parseBoardId,
  sanitizeEventInput,
  SHARED_LAYER,
  sharedFrames,
  sharedKey,
  type BoardEvent,
  type BoardEventInput,
  type BoardFrame,
} from "./boards.ts";

const frame = (key: string, layer: string, at: number, state: string | null = "running"): BoardFrame => ({
  key,
  kind: "flight",
  layer,
  title: key,
  summary: null,
  at,
  state,
  ref: {},
  revision: `${state}@${at}`,
});

let seq = 0;
const ev = (input: BoardEventInput, actorId = OPERATOR_LAYER): BoardEvent => ({
  ...input,
  boardId: "work:w1",
  seq: ++seq,
  at: 1_000 + seq,
  actorId,
});

describe("board ids", () => {
  test("round-trip each scope kind", () => {
    for (const scope of [
      { kind: "project", id: "/repo/scout" },
      { kind: "work", id: "work-abc" },
      { kind: "agent", id: "openscout-agent-2" },
    ] as const) {
      expect(parseBoardId(boardIdFor(scope))).toEqual(scope);
    }
  });

  test("an id keeps colons after the first", () => {
    expect(parseBoardId("agent:a:b")).toEqual({ kind: "agent", id: "a:b" });
  });

  test("reject unknown kinds, empty ids and control characters", () => {
    expect(parseBoardId("canvas:x")).toBeNull();
    expect(parseBoardId("work:")).toBeNull();
    expect(parseBoardId("work: padded")).toBeNull();
    expect(parseBoardId("work:a\nb")).toBeNull();
    expect(parseBoardId(42)).toBeNull();
  });
});

describe("event input", () => {
  test("rounds coordinates and drops what it cannot place", () => {
    expect(sanitizeEventInput({ kind: "place", frameKey: "flight:f1", x: 10.4, y: -3.6 }))
      .toEqual({ kind: "place", frameKey: "flight:f1", x: 10, y: -4 });
    expect(sanitizeEventInput({ kind: "place", frameKey: "flight:f1", x: Infinity, y: 0 })).toBeNull();
    expect(sanitizeEventInput({ kind: "place", frameKey: "", x: 0, y: 0 })).toBeNull();
    expect(sanitizeEventInput({ kind: "drop", frameKey: "flight:f1" })).toBeNull();
  });

  test("a promotion needs a copy and cannot promote a Shared frame", () => {
    const copy = copyOf(frame("flight:f1", "codex", 5));
    expect(sanitizeEventInput({ kind: "promote", frameKey: "flight:f1", copy })).toMatchObject({ kind: "promote" });
    expect(sanitizeEventInput({ kind: "promote", frameKey: "flight:f1" })).toBeNull();
    expect(sanitizeEventInput({ kind: "promote", frameKey: sharedKey("flight:f1"), copy })).toBeNull();
  });

  test("a promotion keeps a real millisecond timestamp", () => {
    const at = Date.UTC(2026, 9, 29, 21, 48);
    const input = sanitizeEventInput({ kind: "promote", frameKey: "work:w1", copy: copyOf(frame("work:w1", "codex", at)) });
    expect(input).toMatchObject({ kind: "promote", copy: { at } });
    expect(sanitizeEventInput({ kind: "promote", frameKey: "work:w1", copy: { ...copyOf(frame("work:w1", "codex", 1)), at: -1 } })).toBeNull();
  });

  test("notes need a note key and a body", () => {
    expect(sanitizeEventInput({ kind: "note.write", frameKey: "note:n1", body: "hi", x: 1, y: 2 }))
      .toEqual({ kind: "note.write", frameKey: "note:n1", body: "hi", x: 1, y: 2 });
    expect(sanitizeEventInput({ kind: "note.write", frameKey: "note:n1", body: "  " })).toBeNull();
    expect(sanitizeEventInput({ kind: "note.write", frameKey: "flight:f1", body: "hi" })).toBeNull();
  });
});

describe("fold", () => {
  test("later events win and folding a tail twice changes nothing", () => {
    const events = [
      ev({ kind: "place", frameKey: "flight:f1", x: 0, y: 0 }),
      ev({ kind: "place", frameKey: "flight:f1", x: 400, y: 0 }),
      ev({ kind: "place", frameKey: "flight:f2", x: 0, y: 400 }),
      ev({ kind: "unplace", frameKey: "flight:f2" }),
    ];
    const once = foldBoard(events);
    const twice = foldBoard(events, once);
    expect(once.placed.get("flight:f1")).toEqual({ x: 400, y: 0 });
    expect(once.placed.has("flight:f2")).toBe(false);
    expect(twice).toEqual(once);
  });

  test("events fold in sequence order, not arrival order", () => {
    const a = ev({ kind: "place", frameKey: "flight:f1", x: 1, y: 1 });
    const b = ev({ kind: "place", frameKey: "flight:f1", x: 2, y: 2 });
    expect(foldBoard([b, a]).placed.get("flight:f1")).toEqual({ x: 2, y: 2 });
  });

  test("a note keeps its author and takes the sequence of its last edit as its version", () => {
    const write = ev({ kind: "note.write", frameKey: "note:n1", body: "# Plan\nfirst", x: 0, y: 0 });
    const edit = ev({ kind: "note.write", frameKey: "note:n1", body: "# Plan\nsecond" }, "someone-else");
    const state = foldBoard([write, edit]);
    const note = state.notes.get("note:n1");
    expect(note).toMatchObject({ body: "# Plan\nsecond", actorId: OPERATOR_LAYER, version: edit.seq });
    expect(state.placed.get("note:n1")).toEqual({ x: 0, y: 0 });
    expect(noteFrames(state)[0]).toMatchObject({ title: "Plan", layer: OPERATOR_LAYER, revision: `note@${edit.seq}` });

    const removed = foldBoard([ev({ kind: "note.remove", frameKey: "note:n1" })], state);
    expect(removed.notes.size).toBe(0);
    expect(removed.placed.has("note:n1")).toBe(false);
  });
});

describe("promotion", () => {
  test("Shared holds the copy as promoted and marks it when the source moves on", () => {
    const before = frame("flight:f1", "codex", 10, "running");
    const state = foldBoard([ev({ kind: "promote", frameKey: before.key, copy: copyOf(before) })]);

    const same = sharedFrames(state, [before]);
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ key: sharedKey("flight:f1"), layer: SHARED_LAYER, sourceLayer: "codex", changed: false, missing: false });

    const after = frame("flight:f1", "codex", 20, "completed");
    const moved = sharedFrames(state, [after])[0];
    expect(moved).toMatchObject({ changed: true, state: "running", at: 10 });

    expect(sharedFrames(state, [])[0]).toMatchObject({ missing: true, changed: false });
  });

  test("unpromoting removes the copy and its placement", () => {
    const f = frame("flight:f1", "codex", 10);
    const state = foldBoard([
      ev({ kind: "promote", frameKey: f.key, copy: copyOf(f) }),
      ev({ kind: "place", frameKey: sharedKey(f.key), x: 0, y: 0 }),
      ev({ kind: "unpromote", frameKey: f.key }),
    ]);
    expect(state.promoted.size).toBe(0);
    expect(state.placed.size).toBe(0);
  });
});

describe("layout", () => {
  test("lanes run Shared, operator, then layers by newest frame", () => {
    const frames = [
      frame("a", "codex", 10),
      frame("b", "claude", 30),
      frame("c", OPERATOR_LAYER, 1),
      frame("d", SHARED_LAYER, 2),
    ];
    expect(orderLayers(frames)).toEqual([SHARED_LAYER, OPERATOR_LAYER, "claude", "codex"]);
    expect(orderLayers(frames, ["codex"])[0]).toBe("codex");
  });

  test("placed frames stay put and loose frames line up newest first beside them", () => {
    const frames = [frame("old", "codex", 1), frame("new", "codex", 9), frame("pinned", "codex", 5)];
    const layout = layoutBoard(frames, new Map([["pinned", { x: -1000, y: 0 }]]));
    const at = (key: string) => layout.frames.find((f) => f.frame.key === key)!;
    expect(at("pinned")).toMatchObject({ x: -1000, y: 0, placed: true });
    expect(at("new").x).toBeLessThan(at("old").x);
    expect(at("new").x).toBeGreaterThan(-1000 + CARD_W);
    expect(layout.lanes).toHaveLength(1);
    expect(layout.lanes[0]).toMatchObject({ layer: "codex", count: 2 });
  });

  test("lanes never overlap", () => {
    const frames = Array.from({ length: 20 }, (_, i) => frame(`f${i}`, i % 2 ? "codex" : "claude", i));
    const { lanes } = layoutBoard(frames, new Map());
    expect(lanes[1].y).toBeGreaterThanOrEqual(lanes[0].y + lanes[0].height);
    expect(lanes[0].height).toBeGreaterThan(CARD_H);
  });

  test("a duplicate key lays out once", () => {
    const layout = layoutBoard([frame("a", "codex", 1), frame("a", "codex", 2)], new Map());
    expect(layout.frames).toHaveLength(1);
  });
});

describe("projection", () => {
  const flight = (over: Partial<WebFlight>): WebFlight => ({
    id: "f1",
    invocationId: "i1",
    agentId: "codex",
    agentName: "Codex",
    conversationId: null,
    collaborationRecordId: null,
    state: "running",
    summary: null,
    startedAt: 100,
    completedAt: null,
    sessions: [],
    ...over,
  });

  test("a flight lands in its agent's layer and revises with its state", () => {
    const running = flightFrame(flight({}));
    const done = flightFrame(flight({ state: "completed", completedAt: 200, summary: "Fixed the route\nmore" }));
    expect(running).toMatchObject({ key: "flight:f1", layer: "codex", title: "Ask to Codex", at: 100 });
    expect(done).toMatchObject({ title: "Fixed the route", at: 200 });
    expect(done.revision).not.toBe(running.revision);
  });

  test("a frame that opens with its agent's id leads with the agent's name", () => {
    const raw = flightFrame(flight({ agentId: "session-ab12", state: "completed", completedAt: 200, summary: "session-ab12 replied." }));
    const [named] = nameFrames([raw], new Map([["session-ab12", "demo-app-spinoza-7"]]));
    expect(named).toMatchObject({ title: "demo-app-spinoza-7 replied.", summary: "demo-app-spinoza-7 replied.", revision: raw.revision });
    expect(nameFrames([raw], new Map())[0]).toBe(raw);
  });

  test("an agent board keeps only that agent's flights", () => {
    const frames = projectAgent("codex", [], [flight({}), flight({ id: "f2", agentId: "claude" })]);
    expect(frames.map((f) => f.key)).toEqual(["flight:f1"]);
  });

  test("work items sit with their owner; unowned ones are unattributed", () => {
    const item = { id: "w1", title: "Ship boards", summary: null, ownerId: null, state: "open", updatedAt: 5, createdAt: 1, lastMeaningfulAt: 0, lastMeaningfulSummary: null, conversationId: null } as unknown as WebWorkItem;
    expect(workFrame(item)).toMatchObject({ layer: "unattributed", at: 5, ref: { workId: "w1" } });
  });

  test("only message timeline entries become frames", () => {
    const base = { id: "t1", at: 5, actorId: "operator", actorName: null, title: null, summary: "hello", detailKind: null, flightId: null, messageId: "m1", conversationId: null };
    expect(messageFrame({ ...base, kind: "message" })).toMatchObject({ key: "message:m1", layer: "operator" });
    expect(messageFrame({ ...base, kind: "flight_started" })).toBeNull();
  });

  test("a material's revision ignores time and follows its diff", () => {
    const m = { id: "x", kind: "code", path: "a/b.ts", status: "modified", agentId: "codex", sessionId: null, worktreeRoot: null, scopePath: null, baseRef: null, headRef: null, diffStat: { branch: null, inflight: { additions: 3, deletions: 1 } }, evidence: [], confidence: "high" } as const;
    const f1 = materialFrame({ ...m, evidence: [] }, "w1", 10);
    const f2 = materialFrame({ ...m, evidence: [] }, "w1", 99);
    expect(f1).toMatchObject({ title: "b.ts", summary: "a/b.ts · +3 −1" });
    expect(f1.revision).toBe(f2.revision);
  });
});
