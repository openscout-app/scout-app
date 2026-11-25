import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { hiddenBy } from "../../shared/api/feed-hides.ts";
import { Database } from "bun:sqlite";
import { HIDE_KEEP_MS, memoryHideStore, sqliteHideStore } from "../feed/hides.ts";
import { mountFeedHideRoutes } from "./feed-hides.ts";

const NOW = Date.parse("2026-11-19T18:00:00Z");

function app(now = () => NOW) {
  const store = memoryHideStore();
  const a = new Hono();
  mountFeedHideRoutes(a, store, now);
  return { a, store };
}

const send = (a: Hono, method: string, path: string, body?: unknown) =>
  a.request(path, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("/api/feed/hides", () => {
  test("hide, list, undo", async () => {
    const { a } = app();
    expect((await send(a, "POST", "/api/feed/hides", { id: "host:thread:s1", at: 100 })).status).toBe(200);
    expect(await (await send(a, "GET", "/api/feed/hides")).json()).toEqual({ hides: [{ id: "host:thread:s1", at: 100 }] });
    expect((await send(a, "DELETE", `/api/feed/hides?id=${encodeURIComponent("host:thread:s1")}`)).status).toBe(200);
    expect(await (await send(a, "GET", "/api/feed/hides")).json()).toEqual({ hides: [] });
  });

  test("a bad body or a missing id says so", async () => {
    const { a } = app();
    expect((await send(a, "POST", "/api/feed/hides", { id: "", at: 1 })).status).toBe(400);
    expect((await send(a, "POST", "/api/feed/hides", { id: "x" })).status).toBe(400);
    expect((await send(a, "DELETE", "/api/feed/hides")).status).toBe(400);
  });

  test("a hide a month old is dropped", async () => {
    let now = NOW;
    const { a } = app(() => now);
    await send(a, "POST", "/api/feed/hides", { id: "old", at: 1 });
    now = NOW + HIDE_KEEP_MS + 1;
    expect(await (await send(a, "GET", "/api/feed/hides")).json()).toEqual({ hides: [] });
  });
});

describe("sqliteHideStore", () => {
  test("keeps a hide, replaces it on a second hide, drops it on undo and after a month", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE feed_hides (item_id TEXT PRIMARY KEY, activity_at INTEGER NOT NULL, hidden_at INTEGER NOT NULL)");
    const store = sqliteHideStore(() => db);
    store.hide({ id: "a", at: 1 }, NOW);
    store.hide({ id: "a", at: 5 }, NOW);
    store.hide({ id: "b", at: 2 }, NOW - HIDE_KEEP_MS - 1);
    expect(store.list(NOW)).toEqual([{ id: "a", at: 5 }]);
    store.show("a");
    expect(store.list(NOW)).toEqual([]);
  });
});

describe("hiddenBy", () => {
  test("covers the item until it has something newer", () => {
    const hides = new Map([["post:a", 100]]);
    expect(hiddenBy(hides, "post:a", 100)).toBe(true);
    expect(hiddenBy(hides, "post:a", 90)).toBe(true);
    expect(hiddenBy(hides, "post:a", 101)).toBe(false);
    expect(hiddenBy(hides, "post:b", 100)).toBe(false);
  });
});
