import type { Hono } from "hono";
import { z } from "zod";

import { OPERATOR_LAYER, parseBoardId, sanitizeEventInput, type BoardEventInput } from "../../shared/boards.ts";
import { appendBoardEvents, MAX_APPEND, queryBoardEvents, queryBoards } from "../db/boards.ts";
import { readJsonBody } from "../request-body.ts";

const appendBody = z.object({ events: z.array(z.unknown()).max(MAX_APPEND).optional() });

/**
 * Boards (shared/boards.ts). The routes carry only a board's own events;
 * the client projects automatic frames from the records it already reads.
 * Every write comes from this web server, so its actor is the operator.
 */
export function mountBoardRoutes(app: Hono) {
  app.get("/api/boards", (c) => c.json({ ok: true, boards: queryBoards() }));

  app.get("/api/boards/:boardId/events", (c) => {
    const boardId = c.req.param("boardId");
    if (!parseBoardId(boardId)) return c.json({ error: "unknown board" }, 400);
    const after = Number(c.req.query("after") ?? 0);
    const events = queryBoardEvents(boardId, Number.isFinite(after) ? after : 0);
    return c.json({ ok: true, boardId, events });
  });

  app.post("/api/boards/:boardId/events", async (c) => {
    const boardId = c.req.param("boardId");
    if (!parseBoardId(boardId)) return c.json({ error: "unknown board" }, 400);
    const parsed = await readJsonBody(c, appendBody);
    if (!parsed.ok) return parsed.response;
    const raw = parsed.body.events ?? [];
    const inputs: BoardEventInput[] = [];
    for (const [i, item] of raw.entries()) {
      const input = sanitizeEventInput(item);
      if (!input) return c.json({ error: `event ${i} is not a board event` }, 400);
      inputs.push(input);
    }
    if (!inputs.length) return c.json({ error: "events are required" }, 400);
    const events = appendBoardEvents(boardId, OPERATOR_LAYER, inputs);
    return c.json({ ok: true, boardId, events }, 201);
  });
}
