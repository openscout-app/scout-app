import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import { boardIdFor, copyOf, foldBoard, sharedKey, type BoardEvent, type BoardFrame } from "../../shared/boards.ts";

const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;
let root = "";
let app: Hono;
let closeWebDb: () => void;

// Import after the control home is redirected, so web-state.sqlite is a
// throwaway file and never the operator's.
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "openscout-boards-"));
  process.env.OPENSCOUT_CONTROL_HOME = root;
  ({ closeWebDb } = await import("../db/internal/web-db.ts"));
  closeWebDb();
  const { mountBoardRoutes } = await import("./boards.ts");
  app = new Hono();
  mountBoardRoutes(app);
});

afterEach(() => {
  closeWebDb?.();
  rmSync(root, { recursive: true, force: true });
  if (originalControlHome === undefined) delete process.env.OPENSCOUT_CONTROL_HOME;
  else process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
});

const projectBoard = boardIdFor({ kind: "project", id: "/repo/demo-app" });
const path = (boardId: string, rest = "events") => `/api/boards/${encodeURIComponent(boardId)}/${rest}`;

async function post(boardId: string, events: unknown[]) {
  const res = await app.request(path(boardId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events }),
  });
  return { status: res.status, json: (await res.json()) as { events?: BoardEvent[]; error?: string } };
}

async function read(boardId: string, after = 0) {
  const res = await app.request(`${path(boardId)}?after=${after}`);
  return (await res.json()) as { events: BoardEvent[] };
}

describe("board routes", () => {
  test("a board nobody touched reads empty", async () => {
    expect((await read(projectBoard)).events).toEqual([]);
    const res = await app.request("/api/boards");
    expect(await res.json()).toEqual({ ok: true, boards: [] });
  });

  test("events number from 1 per board, in order, under an id with slashes", async () => {
    const first = await post(projectBoard, [
      { kind: "place", frameKey: "flight:f1", x: 0, y: 0 },
      { kind: "place", frameKey: "flight:f2", x: 400, y: 0 },
    ]);
    expect(first.status).toBe(201);
    expect(first.json.events?.map((e) => e.seq)).toEqual([1, 2]);
    expect(first.json.events?.[0].actorId).toBe("operator");

    const other = await post(boardIdFor({ kind: "work", id: "w1" }), [{ kind: "unplace", frameKey: "flight:f1" }]);
    expect(other.json.events?.[0].seq).toBe(1);

    await post(projectBoard, [{ kind: "unplace", frameKey: "flight:f2" }]);
    const all = await read(projectBoard);
    expect(all.events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect((await read(projectBoard, 2)).events.map((e) => e.seq)).toEqual([3]);

    const state = foldBoard(all.events);
    expect([...state.placed.keys()]).toEqual(["flight:f1"]);

    const boards = (await (await app.request("/api/boards")).json()) as { boards: { boardId: string; seq: number }[] };
    expect(boards.boards.map((b) => b.boardId).sort()).toEqual([projectBoard, "work:w1"].sort());
  });

  test("a promotion and its placement land together", async () => {
    const frame: BoardFrame = {
      key: "flight:f1",
      kind: "flight",
      layer: "codex",
      title: "Fix",
      summary: null,
      at: 5,
      state: "completed",
      ref: { flightId: "f1" },
      revision: "completed@5",
    };
    const res = await post(projectBoard, [
      { kind: "promote", frameKey: frame.key, copy: copyOf(frame) },
      { kind: "place", frameKey: sharedKey(frame.key), x: 0, y: -400 },
    ]);
    expect(res.status).toBe(201);
    const state = foldBoard((await read(projectBoard)).events);
    expect(state.promoted.get(frame.key)?.copy.revision).toBe("completed@5");
    expect(state.placed.get(sharedKey(frame.key))).toEqual({ x: 0, y: -400 });
  });

  test("one bad event rejects the whole append", async () => {
    const res = await post(projectBoard, [
      { kind: "place", frameKey: "flight:f1", x: 0, y: 0 },
      { kind: "promote", frameKey: "flight:f1" },
    ]);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("event 1 is not a board event");
    expect((await read(projectBoard)).events).toEqual([]);
  });

  test("unknown boards and empty appends are refused", async () => {
    expect((await app.request(path("canvas:x"))).status).toBe(400);
    expect((await post(projectBoard, [])).status).toBe(400);
  });
});
