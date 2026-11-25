/**
 * The operator's latest move on a Feed post, as the Feed and Home made it.
 *
 *   GET  /api/feed/moves   every kept move: [{ id, kind, label, at }]
 *   POST /api/feed/moves   { id, kind, label }: the move just went through; the server stamps its time
 *
 * Posted after the move itself reached the runtime or Scoutbot; nothing here
 * reaches either. The web server keeps the newest move per post
 * (server/feed/moves.ts) and the Feed's writer folds it into the post, so the
 * post says what was last done on it across reloads, restarts and rebuilds.
 */
import type { Hono } from "hono";
import { z } from "zod";

import { FEED_MOVE_KINDS, MOVE_LABEL_MAX, type FeedMove } from "../../shared/api/feed-moves.ts";
import type { MoveStore } from "../feed/moves.ts";
import { readJsonBody } from "../request-body.ts";

const moveBody = z.object({
  id: z.string().min(1).max(512),
  kind: z.enum(FEED_MOVE_KINDS),
  label: z.string().max(4000).default(""),
});

function clipLabel(text: string): string {
  const plain = text.replace(/\s+/g, " ").trim();
  return plain.length > MOVE_LABEL_MAX ? `${plain.slice(0, MOVE_LABEL_MAX - 1)}…` : plain;
}

/** `written` puts the move into the Feed's projection; the answer waits for it, so the caller's next read is current. */
export function mountFeedMoveRoutes(app: Hono, store: MoveStore, now: () => number = Date.now, written: () => Promise<void> = async () => {}) {
  app.get("/api/feed/moves", (c) => c.json({ moves: store.list(now()) satisfies FeedMove[] }));

  app.post("/api/feed/moves", async (c) => {
    const parsed = await readJsonBody(c, moveBody);
    if (!parsed.ok) return parsed.response;
    const move: FeedMove = { id: parsed.body.id, kind: parsed.body.kind, label: clipLabel(parsed.body.label), at: now() };
    store.record(move);
    await written().catch(() => {});
    return c.json({ ok: true, move });
  });
}
