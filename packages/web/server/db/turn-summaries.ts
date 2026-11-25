/**
 * Home's turn summaries (server/turn-summary.ts), in the web server's own
 * database, so a turn is summarized once and every later load only reads.
 */
import type { FeedNeed } from "../../shared/api/feed.ts";
import type { TurnSummaryRow, TurnSummaryStore } from "../turn-summary.ts";
import { webDb } from "./internal/web-db.ts";

/** Rows older than this are dropped when the store opens: their turns have left the Feed's window. */
export const TURN_SUMMARY_KEEP_MS = 30 * 24 * 60 * 60_000;

type Row = {
  key: string; turn_id: string; post_id: string; state: string; gist: string | null; ask: string | null; need?: string | null; model: string | null;
  input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; error: string | null; attempts: number; created_at: number;
};

function readNeed(text: string | null | undefined): FeedNeed | null {
  if (!text) return null;
  try {
    const need = JSON.parse(text) as FeedNeed;
    return need && typeof need.kind === "string" ? need : null;
  } catch {
    return null;
  }
}

export function sqliteTurnSummaryStore(db = webDb, now: () => number = Date.now): TurnSummaryStore {
  let pruned = false;
  const open = () => {
    const database = db();
    if (!pruned) {
      pruned = true;
      // A database from before needs: the column is added once, empty; those rows read as written before needs.
      const columns = database.query<{ name: string }, []>("PRAGMA table_info(turn_summaries)").all();
      if (!columns.some((c) => c.name === "need")) database.exec("ALTER TABLE turn_summaries ADD COLUMN need TEXT");
      database.query("DELETE FROM turn_summaries WHERE created_at < ?").run(now() - TURN_SUMMARY_KEEP_MS);
    }
    return database;
  };
  return {
    get(key) {
      const row = open().query<Row, [string]>("SELECT * FROM turn_summaries WHERE key = ?").get(key);
      if (!row) return null;
      return {
        key: row.key,
        turnId: row.turn_id,
        postId: row.post_id,
        state: row.state === "ready" || row.state === "thin" ? row.state : "failed",
        gist: row.gist,
        ask: row.ask,
        need: readNeed(row.need),
        model: row.model,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        costUsd: row.cost_usd,
        error: row.error,
        attempts: row.attempts,
        createdAt: row.created_at,
      };
    },
    latestGist(turnId) {
      return open().query<{gist: string}, [string]>("SELECT gist FROM turn_summaries WHERE turn_id=? AND state='ready' ORDER BY created_at DESC, key LIMIT 1").get(turnId)?.gist ?? null;
    },
    put(row: TurnSummaryRow) {
      open().query(
        `INSERT OR REPLACE INTO turn_summaries
           (key, turn_id, post_id, state, gist, ask, need, model, input_tokens, output_tokens, cost_usd, error, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.key, row.turnId, row.postId, row.state, row.gist, row.ask, row.need ? JSON.stringify(row.need) : null, row.model,
        row.inputTokens, row.outputTokens, row.costUsd, row.error, row.attempts, row.createdAt,
      );
    },
  };
}
