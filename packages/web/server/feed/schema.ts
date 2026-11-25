import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { resolveWebStateDbPath } from "../db/internal/web-db.ts";
import { resolveDbPath } from "../db/internal/db.ts";

const FEED_APPLICATION_ID = 0x53464544; // SFED
// Bump when a stored post's head or candidate is computed differently, so the file rebuilds instead of keeping
// rows ranked the old way (3: a turn whose pull request shows a screenshot ranks as a picture, #2126).
export const FORMAT_VERSION = 3;
export function feedPath() {
  return process.env.OPENSCOUT_WEB_FEED_PATH || join(dirname(resolveWebStateDbPath()), "feed.sqlite");
}
export function openFeed(path: string) {
  if (path !== ":memory:") {
    const absolute = (p: string) => (existsSync(p) ? realpathSync(p) : resolve(p));
    if ([resolveDbPath(), resolveWebStateDbPath()].some((p) => absolute(p) === absolute(path))) {
      throw new Error("The Feed projection requires its own SQLite file");
    }
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  // Even a mistaken override must not turn someone else's SQLite file into a cache.
  const tables = db
    .query<
      { name: string },
      []
    >("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const appId = db.query<{ application_id: number }, []>("PRAGMA application_id").get()?.application_id;
  const legacy = !appId && tables.map((row) => row.name).join(",") === "feed_slots,inputs,meta,pull_facts";
  if (appId !== FEED_APPLICATION_ID && !legacy && (appId || tables.length)) {
    db.close();
    throw new Error("Refusing a non-Feed SQLite file");
  }
  // user_version is this disposable file's format_version, not a migration sequence.
  db.exec("PRAGMA journal_mode=WAL");
  db.transaction(() => {
    if (
      appId === FEED_APPLICATION_ID &&
      db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version === FORMAT_VERSION
    )
      return;
    for (const { name } of tables) db.exec(`DROP TABLE "${name.replaceAll('"', '""')}"`);
    db.exec(`
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- Enriched writer inputs, not Scout records. Needed to update a thread
      -- after restart without repeating its file checks or its runtime query.
      CREATE TABLE inputs(id TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL,
        payload TEXT NOT NULL, repos TEXT NOT NULL, refs TEXT NOT NULL, PRIMARY KEY(source,id));
      CREATE TABLE pull_facts(key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE feed_slots(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, placement TEXT NOT NULL, state TEXT NOT NULL,
        title TEXT NOT NULL, caption TEXT, refs TEXT NOT NULL, at INTEGER NOT NULL, day TEXT NOT NULL,
        input_key TEXT NOT NULL, reviewed INTEGER NOT NULL, updated_seq INTEGER NOT NULL, candidate TEXT,
        head TEXT, detail TEXT, summary_request TEXT, summary TEXT, files TEXT, removed_at INTEGER
      );
      CREATE INDEX feed_order ON feed_slots(at DESC, id);
      CREATE INDEX feed_changes ON feed_slots(updated_seq);
      CREATE INDEX feed_days ON feed_slots(day DESC);
      PRAGMA application_id=${FEED_APPLICATION_ID};
      PRAGMA user_version=${FORMAT_VERSION};
    `);
    // A client from an erased format must get a full snapshot, not a false 304.
    const epoch = Date.now() * 1024;
    db.query("INSERT INTO meta VALUES ('seq', ?), ('floor', ?)").run(String(epoch), String(epoch));
  }).immediate();
  return db;
}
