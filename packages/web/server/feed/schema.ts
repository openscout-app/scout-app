import { Database } from "bun:sqlite";

/** The preview projection is disposable. Work and discussion never get copied into a project file. */
export function openFeed() {
  const db = new Database(":memory:");
  db.exec(`
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      -- Enriched inputs for incremental projection, never the canonical records.
      CREATE TABLE inputs(id TEXT NOT NULL, source TEXT NOT NULL, at INTEGER NOT NULL,
        payload TEXT NOT NULL, repos TEXT NOT NULL, refs TEXT NOT NULL, PRIMARY KEY(source,id));
      CREATE TABLE pull_facts(key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE feed_slots(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, placement TEXT NOT NULL, state TEXT NOT NULL,
        title TEXT NOT NULL, caption TEXT, refs TEXT NOT NULL, at INTEGER NOT NULL, day TEXT NOT NULL,
        input_key TEXT NOT NULL, reviewed INTEGER NOT NULL, updated_seq INTEGER NOT NULL, candidate TEXT,
        head TEXT, detail TEXT, files TEXT, removed_at INTEGER
      );
      CREATE INDEX feed_order ON feed_slots(at DESC, id);
      CREATE INDEX feed_changes ON feed_slots(updated_seq);
      CREATE INDEX feed_days ON feed_slots(day DESC);
    `);
  const epoch = Date.now() * 1024;
  db.query("INSERT INTO meta VALUES ('seq', ?), ('floor', ?)").run(String(epoch), String(epoch));
  return db;
}
