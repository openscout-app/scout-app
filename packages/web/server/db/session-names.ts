/**
 * The companion's Summary names (server/session-titles.ts), in the web
 * server's own database, so a session named once keeps its name across
 * restarts instead of costing another model call.
 */

import type { SessionNameStore, StoredSessionName } from "../session-titles.ts";
import { webDb } from "./internal/web-db.ts";

/** Names older than this are dropped on load: their sessions are long gone from the board. */
export const SESSION_NAME_KEEP_MS = 30 * 24 * 60 * 60_000;

type SessionNameRow = { ref: string; title: string; model: string; named_at: number; turn_key: string };

export function sessionNameStore(now: () => number = Date.now): SessionNameStore {
  return {
    load(): StoredSessionName[] {
      const db = webDb();
      db.query("DELETE FROM session_names WHERE named_at < ?").run(now() - SESSION_NAME_KEEP_MS);
      const rows = db.query("SELECT ref, title, model, named_at, turn_key FROM session_names").all() as SessionNameRow[];
      return rows.map((row) => ({ ref: row.ref, title: row.title, model: row.model, at: row.named_at, turn: row.turn_key }));
    },
    save(name: StoredSessionName): void {
      webDb().query(
        `INSERT INTO session_names (ref, title, model, named_at, turn_key) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(ref) DO UPDATE SET title = excluded.title, model = excluded.model,
           named_at = excluded.named_at, turn_key = excluded.turn_key`,
      ).run(name.ref, name.title, name.model, name.at, name.turn);
    },
  };
}
