/**
 * Readonly SQLite handle for the web server's direct reads of the control-plane
 * database. Lifted from db-queries.ts as part of SCO-031 Phase A.
 */

import { Database } from "bun:sqlite";
import { observeSqliteDatabase } from "@openscout/runtime/sqlite-adapter";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";
import { join } from "node:path";

/* ── DB path ── */

/**
 * The control-plane home of the runtime this server serves. The core resolver
 * honours OPENSCOUT_CONTROL_HOME and otherwise derives the home from
 * OPENSCOUT_INSTANCE, so a dev-instance preview reads its own runtime's store
 * and never the live one under ~/.openscout/control-plane.
 */
export function resolveControlHome(): string {
  return resolveOpenScoutSupportPaths().controlHome;
}

export function resolveDbPath(): string {
  return process.env.SCOUT_INSPECT_READ_DB || join(resolveControlHome(), "control-plane.sqlite");
}

/* ── Readonly connection (WAL-visible without periodic reopen) ── */

let _db: Database | null = null;
const DB_BUSY_TIMEOUT_MS = 250; // keep UI reads short under broker write contention

export function configureReadonlyDb(db: Database, busyTimeoutMs = DB_BUSY_TIMEOUT_MS): void {
  db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs}`);
  db.exec("PRAGMA query_only = ON");
}

/** A caller-owned read connection; close it after use. Zero timeout permits async retries. */
export function openReadonlyDb(busyTimeoutMs = DB_BUSY_TIMEOUT_MS, path = resolveDbPath()): Database {
  const connection = observeSqliteDatabase(new Database(path, { readonly: true }), {
    database: "web-control-plane",
  });
  try {
    configureReadonlyDb(connection, busyTimeoutMs);
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
}

/** Optional path initializes a worker-owned connection before any projections run. */
export function db(path?: string): Database {
  if (!_db) {
    _db = openReadonlyDb(DB_BUSY_TIMEOUT_MS, path);
  }
  return _db;
}

/** Call on server shutdown. */
export function closeDb(): void {
  _db?.close();
  _db = null;
}
