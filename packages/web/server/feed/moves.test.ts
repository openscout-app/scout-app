import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Hono } from "hono";

import type { WebFeedTask } from "../../shared/api/feed.ts";
import { answersTurn, moveWords, type FeedMove } from "../../shared/api/feed-moves.ts";
import { mountFeedMoveRoutes } from "../routes/feed-moves.ts";
import { MOVE_KEEP_MS, memoryMoveStore, sqliteMoveStore } from "./moves.ts";
import { FeedTable } from "./table.ts";

const HOUR = 3_600_000;
const NOW = new Date(2026, 10, 15, 14, 0).getTime();
const APPS = "/example/op/dev/demo-app";
const ID = "mini:thread:s1";

/** A turn the operator asked for, answered, and not written on since: it waits in Back to you. */
function turn(partial: Partial<WebFeedTask> = {}): WebFeedTask {
  return {
    id: "w1", title: "Fix the header.", state: "done", accepted: false, operatorAsked: true, askedFrom: null, askedByAgent: false,
    ownerId: "agent-1", ownerName: "demo-app", harness: "claude", sessionId: "s1", conversationId: "chn-1",
    parentId: null, parentTitle: null, projectRoot: APPS, cwd: APPS, branch: null,
    createdAt: NOW - 3 * HOUR, updatedAt: NOW - HOUR, finishedAt: NOW - HOUR,
    replyId: "msg-1", reply: "Fixed the header.", operator: null,
    presentation: { status: "missing", title: null, caption: null }, shows: [], media: [], studies: [],
    ...partial,
  };
}

const ctx = (moves: FeedMove[] = []) => ({ pulls: [], repos: { [APPS]: "example-org/demo-app" }, attention: [], localBranches: [], hides: [], moves });

describe("a move on a post", () => {
  test("shows on the post and takes an answered turn out of Back to you", () => {
    const engine = new FeedTable({ originHost: "mini" });
    engine.apply({ context: ctx(), upsert: [turn()] });
    expect(engine.head(ID)?.backToYou).toBe(true);
    expect(engine.head(ID)?.move ?? null).toBeNull();

    const move: FeedMove = { id: ID, kind: "react", label: "Looks good", at: NOW - HOUR / 2 };
    expect(engine.apply({ context: ctx([move]) }).changed).toEqual([ID]);
    const head = engine.head(ID)!;
    expect(head.move).toEqual(move);
    expect(head.backToYou).toBe(false);
    expect(head.reviewed).toBe(true);
    // The same move again changes nothing.
    expect(engine.apply({ context: ctx([move]) }).changed).toEqual([]);

    // A newer turn waits again; the post still says what was last done.
    engine.apply({ upsert: [turn({ replyId: "msg-2", reply: "Fixed it again.", finishedAt: NOW - HOUR / 4 })] });
    expect(engine.head(ID)?.backToYou).toBe(true);
    expect(engine.head(ID)?.move).toEqual(move);
  });

  test("survives a rebuild from scratch: the post comes back with its move", () => {
    const move: FeedMove = { id: ID, kind: "continue", label: "Now the footer", at: NOW - HOUR / 2 };
    const before = new FeedTable({ originHost: "mini" });
    before.apply({ context: ctx([move]), upsert: [turn()] });
    const rebuilt = new FeedTable({ originHost: "mini" });
    rebuilt.apply({ context: ctx([move]), upsert: [turn()] });
    // A new file starts its own sequence: everything but the version is the same.
    expect({ ...rebuilt.head(ID), version: 0 }).toEqual({ ...before.head(ID), version: 0 });
    expect(rebuilt.head(ID)?.backToYou).toBe(false);
  });

  test("asking Scoutbot about a post is not a move on the work", () => {
    const engine = new FeedTable({ originHost: "mini" });
    const ask: FeedMove = { id: ID, kind: "ask", label: "What changed?", at: NOW - HOUR / 2 };
    engine.apply({ context: ctx([ask]), upsert: [turn()] });
    expect(engine.head(ID)?.move).toEqual(ask);
    expect(engine.head(ID)?.backToYou).toBe(true);
    expect(engine.head(ID)?.reviewed).toBe(false);
  });

  test("a move before the turn does not answer it", () => {
    expect(answersTurn({ id: ID, kind: "reply", label: "", at: 10 }, 20)).toBe(false);
    expect(answersTurn({ id: ID, kind: "reply", label: "", at: 20 }, 20)).toBe(true);
    expect(answersTurn(null, 20)).toBe(false);
  });

  test("reads as the operator's own move", () => {
    expect(moveWords({ kind: "reply", label: "Ship it  now" })).toBe("You replied: “Ship it now”");
    expect(moveWords({ kind: "decide", label: "Option B" })).toBe("You chose Option B");
    expect(moveWords({ kind: "done", label: "" })).toBe("You marked it done");
  });
});

const send = (a: Hono, method: string, path: string, body?: unknown) =>
  a.request(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("/api/feed/moves", () => {
  test("records the newest move per post, stamped by the server, and writes it through", async () => {
    let now = NOW;
    let writes = 0;
    const a = new Hono();
    mountFeedMoveRoutes(a, memoryMoveStore(), () => now, async () => { writes++; });
    expect((await send(a, "POST", "/api/feed/moves", { id: ID, kind: "ship", label: "" })).status).toBe(200);
    now += 1000;
    const second = await (await send(a, "POST", "/api/feed/moves", { id: ID, kind: "reply", label: `  ${"word ".repeat(80)}` })).json();
    expect(second.move.at).toBe(NOW + 1000);
    expect(second.move.label.length).toBeLessThanOrEqual(200);
    const { moves } = await (await send(a, "GET", "/api/feed/moves")).json();
    expect(moves.map((m: FeedMove) => m.kind)).toEqual(["reply"]);
    expect(writes).toBe(2);
  });

  test("a bad kind or a missing id says so", async () => {
    const a = new Hono();
    mountFeedMoveRoutes(a, memoryMoveStore());
    expect((await send(a, "POST", "/api/feed/moves", { id: ID, kind: "like" })).status).toBe(400);
    expect((await send(a, "POST", "/api/feed/moves", { id: "", kind: "done" })).status).toBe(400);
  });
});

describe("sqliteMoveStore", () => {
  test("keeps the newest move per post and drops one a month old", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE feed_moves (item_id TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, moved_at INTEGER NOT NULL)");
    const store = sqliteMoveStore(() => db);
    store.record({ id: "a", kind: "reply", label: "first", at: NOW - 10 });
    store.record({ id: "a", kind: "done", label: "", at: NOW });
    // A late receipt of an older move does not replace a newer one.
    store.record({ id: "a", kind: "drop", label: "", at: NOW - 5 });
    store.record({ id: "b", kind: "ship", label: "", at: NOW - MOVE_KEEP_MS - 1 });
    expect(store.list(NOW)).toEqual([{ id: "a", kind: "done", label: "", at: NOW }]);
  });
});
