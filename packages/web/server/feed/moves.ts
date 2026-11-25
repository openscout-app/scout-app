/**
 * The operator's latest move on each Feed post, kept in web-state.sqlite
 * (`feed_moves`) beside the hides, so it outlives a restart and feed.sqlite,
 * which is a projection rebuilt from scratch. A receipt, not a Scout record:
 * the move already went to the runtime or to Scoutbot. One row per post, the
 * newest move; the writer folds it into the post (shared/api/feed-moves.ts).
 */
import type { FeedMove } from "../../shared/api/feed-moves.ts";
import { webDb } from "../db/internal/web-db.ts";

/** A move older than this is dropped: the Feed is a 14-day window, so its post is gone by then. */
export const MOVE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export type MoveStore = {
  list(nowMs: number): FeedMove[];
  record(move: FeedMove): void;
};

export function memoryMoveStore(): MoveStore & { rows: Map<string, FeedMove> } {
  const rows = new Map<string, FeedMove>();
  return {
    rows,
    list(nowMs) {
      for (const [id, row] of rows) if (nowMs - row.at > MOVE_KEEP_MS) rows.delete(id);
      return [...rows.values()];
    },
    record(move) {
      const held = rows.get(move.id);
      if (!held || held.at <= move.at) rows.set(move.id, move);
    },
  };
}

export function sqliteMoveStore(db = webDb): MoveStore {
  return {
    list(nowMs) {
      db().query("DELETE FROM feed_moves WHERE moved_at < ?").run(nowMs - MOVE_KEEP_MS);
      return db()
        .query<{ item_id: string; kind: FeedMove["kind"]; label: string; moved_at: number }, []>("SELECT item_id, kind, label, moved_at FROM feed_moves")
        .all()
        .map((row) => ({ id: row.item_id, kind: row.kind, label: row.label, at: row.moved_at }));
    },
    record(move) {
      db()
        .query(
          `INSERT INTO feed_moves (item_id, kind, label, moved_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(item_id) DO UPDATE SET kind=excluded.kind, label=excluded.label, moved_at=excluded.moved_at
           WHERE excluded.moved_at >= feed_moves.moved_at`,
        )
        .run(move.id, move.kind, move.label, move.at);
    },
  };
}
