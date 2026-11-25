/**
 * Hidden items, kept in web-state.sqlite (`feed_hides`) so a hide outlives
 * feed.sqlite, which is a projection rebuilt from scratch. A hide is a display
 * choice the web server authors, not a dismissal: the runtime's work, request
 * or thread is unchanged, and reachable from its session and search.
 */
import type { FeedHide } from "../../shared/api/feed-hides.ts";
import { webDb } from "../db/internal/web-db.ts";

/** A hide older than this is dropped: the Feed is a 14-day window, so it covers nothing by then. */
export const HIDE_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

export type HideStore = {
  list(nowMs: number): FeedHide[];
  hide(hide: FeedHide, nowMs: number): void;
  show(id: string): void;
};

export function memoryHideStore(): HideStore & { rows: Map<string, FeedHide & { hiddenAt: number }> } {
  const rows = new Map<string, FeedHide & { hiddenAt: number }>();
  return {
    rows,
    list(nowMs) {
      for (const [id, row] of rows) if (nowMs - row.hiddenAt > HIDE_KEEP_MS) rows.delete(id);
      return [...rows.values()].map(({ id, at }) => ({ id, at }));
    },
    hide(hide, nowMs) { rows.set(hide.id, { ...hide, hiddenAt: nowMs }); },
    show(id) { rows.delete(id); },
  };
}

export function sqliteHideStore(db = webDb): HideStore {
  return {
    list(nowMs) {
      db().query("DELETE FROM feed_hides WHERE hidden_at < ?").run(nowMs - HIDE_KEEP_MS);
      return db().query<{ item_id: string; activity_at: number }, []>("SELECT item_id, activity_at FROM feed_hides").all()
        .map((row) => ({ id: row.item_id, at: row.activity_at }));
    },
    hide(hide, nowMs) {
      db().query("INSERT OR REPLACE INTO feed_hides (item_id, activity_at, hidden_at) VALUES (?, ?, ?)").run(hide.id, hide.at, nowMs);
    },
    show(id) {
      db().query("DELETE FROM feed_hides WHERE item_id = ?").run(id);
    },
  };
}
