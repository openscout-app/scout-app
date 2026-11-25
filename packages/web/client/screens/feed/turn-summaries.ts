/**
 * Each post's newest turn in two lines (GET /api/feed/summaries), shared by
 * Home's "Back to you" and the Feed's items. Rows on screen ask by post and
 * turn; asks made close together go out as one read. While the server is
 * still writing some, the read repeats a few times, then stops. A post with
 * no summary reads null, and its row keeps the words it has.
 *
 * The model is never called on the client's clock: the server queues a turn
 * once and keeps what it writes (server/turn-summary.ts).
 */
import { useEffect, useSyncExternalStore } from "react";
import type { FeedSummaries, FeedTurnSummary } from "../../../shared/api/feed.ts";
import { api } from "../../lib/api.ts";

/** Asks closer together than this share a read. */
const BATCH_MS = 60;
/** While some are being written: read again this soon, at most this many times in a row. */
export const PENDING_MS = 4_000;
export const PENDING_READS = 12;
/** Post ids per read; the server takes at most 40. */
const PER_READ = 40;

type Read = (ids: readonly string[]) => Promise<FeedSummaries>;
type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

const keyOf = (postId: string, at: number) => `${postId}@${at}`;

export function createTurnSummaryReader(read: Read, timers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }) {
  /** By post and turn time: the summary, null for none, absent until read. */
  const known = new Map<string, FeedTurnSummary | null>();
  /** Posts on screen now, by key, with how many rows show each. */
  const shown = new Map<string, { postId: string; rows: number }>();
  const listeners = new Set<() => void>();
  let timer: unknown = null;
  let pendingReads = 0;
  let reading = false;
  let again = false;
  let unavailable = false;

  const notify = () => { for (const fn of listeners) fn(); };

  function schedule(ms: number): void {
    if (unavailable || timer !== null) return;
    timer = timers.set(() => { timer = null; void run(); }, ms);
  }

  async function run(): Promise<void> {
    if (reading) { again = true; return; }
    const keys = [...shown.keys()];
    if (!keys.length) return;
    reading = true;
    let pending = false;
    try {
      for (let i = 0; i < keys.length; i += PER_READ) {
        const chunk = keys.slice(i, i + PER_READ);
        const res = await read(chunk.map((key) => shown.get(key)!.postId));
        if (!res.available) { unavailable = true; break; }
        for (const key of chunk) {
          const postId = shown.get(key)?.postId ?? key.slice(0, key.lastIndexOf("@"));
          known.set(key, res.summaries[postId] ?? null);
        }
        pending ||= res.pending;
      }
      notify();
    } catch {
      // A failed read keeps what it had; the rows keep their words.
      pending = false;
    } finally {
      reading = false;
    }
    if (again) { again = false; schedule(BATCH_MS); return; }
    if (pending && pendingReads < PENDING_READS) { pendingReads += 1; schedule(PENDING_MS); }
    else pendingReads = 0;
  }

  return {
    /** A row shows this post's turn; returns its release. */
    show(postId: string, at: number): () => void {
      const key = keyOf(postId, at);
      const held = shown.get(key);
      if (held) held.rows += 1;
      else shown.set(key, { postId, rows: 1 });
      if (!known.has(key)) { pendingReads = 0; schedule(BATCH_MS); }
      return () => {
        const entry = shown.get(key);
        if (!entry) return;
        entry.rows -= 1;
        if (entry.rows <= 0) shown.delete(key);
      };
    },
    get(postId: string, at: number): FeedTurnSummary | null {
      return known.get(keyOf(postId, at)) ?? null;
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    /** For tests: the read now, without waiting on the batch. */
    flush: run,
  };
}

const reader = createTurnSummaryReader((ids) => api<FeedSummaries>(`/api/feed/summaries?posts=${ids.map(encodeURIComponent).join(",")}`));

/** The summary of this post's turn at `at`, or null while none exists. Pass null to ask for nothing. */
export function useTurnSummary(postId: string | null, at: number): FeedTurnSummary | null {
  useEffect(() => (postId ? reader.show(postId, at) : undefined), [postId, at]);
  return useSyncExternalStore(reader.subscribe, () => (postId ? reader.get(postId, at) : null), () => null);
}
