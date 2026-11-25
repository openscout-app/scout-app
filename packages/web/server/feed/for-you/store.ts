/**
 * The For you digests, kept: one row per source key in web-state.sqlite
 * (`for_you_digests`), so a digest is written once per source text and read
 * on every Home load after. A failed call is kept too, and tried again only
 * after FAILED_RETRY_MS, so a broken model never runs on every read.
 *
 * The table's input_tokens, output_tokens and cost_usd columns are left at
 * their default 0: the calls run on the operator's plans, which do not price
 * them per call. The columns stay so an existing file needs no migration.
 */
import type { ForYouDigest, ForYouKind } from "../../../shared/api/for-you.ts";
import { webDb } from "../../db/internal/web-db.ts";

export const FAILED_RETRY_MS = 30 * 60_000;

export type DigestRow = {
  key: string;
  itemId: string;
  /** The kind the classifier chose, when it ran. */
  kind: ForYouKind | null;
  classifiedBy: "rules" | "model";
  digest: ForYouDigest | null;
  state: "ready" | "failed";
  model: string | null;
  error: string | null;
  createdAt: number;
};

export type DigestStore = {
  get(key: string): DigestRow | null;
  put(row: DigestRow): void;
};

export function memoryDigestStore(): DigestStore & { rows: Map<string, DigestRow> } {
  const rows = new Map<string, DigestRow>();
  return { rows, get: (key) => rows.get(key) ?? null, put: (row) => void rows.set(row.key, row) };
}

type SqlRow = {
  key: string; item_id: string; kind: string | null; classified_by: string | null; digest_json: string | null; state: string;
  model: string | null; error: string | null; created_at: number;
};

export function sqliteDigestStore(db = webDb): DigestStore {
  return {
    get(key) {
      const row = db().query<SqlRow, [string]>("SELECT * FROM for_you_digests WHERE key = ?").get(key);
      if (!row) return null;
      let digest: ForYouDigest | null = null;
      try {
        digest = row.digest_json ? JSON.parse(row.digest_json) as ForYouDigest : null;
      } catch {
        digest = null;
      }
      return {
        key: row.key,
        itemId: row.item_id,
        kind: (row.kind as ForYouKind | null) ?? null,
        classifiedBy: row.classified_by === "model" ? "model" : "rules",
        digest,
        state: row.state === "ready" ? "ready" : "failed",
        model: row.model,
        error: row.error,
        createdAt: row.created_at,
      };
    },
    put(row) {
      db().query(
        `INSERT OR REPLACE INTO for_you_digests
           (key, item_id, kind, classified_by, digest_json, state, model, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.key, row.itemId, row.kind, row.classifiedBy, row.digest ? JSON.stringify(row.digest) : null, row.state,
        row.model, row.error, row.createdAt,
      );
    },
  };
}
