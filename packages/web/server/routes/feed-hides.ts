/**
 * Hide anything on Home or the Feed, and bring it back.
 *
 *   GET    /api/feed/hides           every hide: [{ id, at }]
 *   POST   /api/feed/hides           { id, at }: hide the item until it has something newer than `at`
 *   DELETE /api/feed/hides?id=<id>   undo
 *
 * The web server keeps these itself (server/feed/hides.ts); nothing reaches the runtime.
 * Every Feed read leaves a hidden item out: threads in the projection's write pass,
 * Slack threads and quota warnings in /api/feed/sources.
 */
import type { Hono } from "hono";
import { z } from "zod";

import type { FeedHide } from "../../shared/api/feed-hides.ts";
import type { HideStore } from "../feed/hides.ts";
import { readJsonBody } from "../request-body.ts";

const hideBody = z.object({
  id: z.string().min(1).max(512),
  at: z.number().int().nonnegative(),
});

/** `written` puts a change into the Feed's projection; the answer waits for it, so the caller's next read is current. */
export function mountFeedHideRoutes(app: Hono, store: HideStore, now: () => number = Date.now, written: () => Promise<void> = async () => {}) {
  app.get("/api/feed/hides", (c) => c.json({ hides: store.list(now()) satisfies FeedHide[] }));

  app.post("/api/feed/hides", async (c) => {
    const parsed = await readJsonBody(c, hideBody);
    if (!parsed.ok) return parsed.response;
    store.hide(parsed.body, now());
    await written().catch(() => {});
    return c.json({ ok: true });
  });

  app.delete("/api/feed/hides", async (c) => {
    const id = c.req.query("id");
    if (!id) return c.json({ error: "Say which item to show again." }, 400);
    store.show(id);
    await written().catch(() => {});
    return c.json({ ok: true });
  });
}
