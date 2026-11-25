/**
 * The work board: lifecycle stations as columns, work items as cards.
 *
 * The runtime owns placement, the checks on a move and the move ledger; this
 * route joins its placements with the work list read from the projection and
 * forwards moves and reviews. The web server never decides a move.
 */
import type { Hono } from "hono";
import { z } from "zod";
import { queryWorkItems } from "../db-queries.ts";
import { continueScoutWork, moveScoutWork, readScoutWorkBoard, readScoutWorkMoves, reviewScoutWorkMove, type ScoutWorkBoardRead } from "../core/broker/service.ts";
import { readJsonBody } from "../request-body.ts";
import type { WebWorkBoard, WebWorkItem, WebWorkLifecycle, WebWorkMove, WebWorkMoveResponse } from "../../shared/api/web.ts";
import { MAX_WORK_LIST_IDS } from "./work-list-query.ts";

const WORK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const moveBody = z.object({
  to: z.string().min(1).max(128),
  note: z.string().max(2000).optional(),
  claim: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  waitingOn: z.object({ label: z.string().min(1).max(500) }).optional(),
});

const continueBody = z.object({
  body: z.string().min(1).max(4000),
  requestId: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
});

const reviewBody = z.object({
  moveId: z.string().min(1).max(200),
  revision: z.number().int().min(0),
  verdict: z.enum(["confirm", "reopen", "consult"]),
  note: z.string().max(2000).optional(),
});

function webLifecycle(summary: ScoutWorkBoardRead["lifecycle"]): WebWorkLifecycle {
  const { lifecycle } = summary;
  return {
    id: lifecycle.id,
    name: lifecycle.name,
    version: lifecycle.version,
    hash: summary.hash,
    description: lifecycle.description ?? null,
    stations: lifecycle.stations.map((s) => ({
      id: s.id, name: s.name, state: s.state, purpose: s.purpose ?? null,
      rules: (s.rules ?? []).map((r) => ({ id: r.id, check: r.check?.kind ?? "", effect: r.effect, message: r.message, shadow: Boolean(r.shadow) })),
      judges: (s.judges ?? []).map((j) => ({ id: j.id, criterion: j.criterion })),
    })),
    transitions: lifecycle.transitions.map((t) => ({ from: t.from, to: t.to, name: t.name ?? null })),
  };
}

/** Cards in runtime order; an item the projection has not caught up with yet waits for the next read. */
export function joinWorkBoard(read: ScoutWorkBoardRead, lookup: (ids: string[]) => WebWorkItem[]): WebWorkBoard {
  const ids = read.items.map((i) => i.workId).filter((id) => WORK_ID.test(id));
  const byId = new Map<string, WebWorkItem>();
  for (let i = 0; i < ids.length; i += MAX_WORK_LIST_IDS) {
    for (const item of lookup(ids.slice(i, i + MAX_WORK_LIST_IDS))) byId.set(item.id, item);
  }
  return {
    lifecycle: webLifecycle(read.lifecycle),
    lifecycles: read.lifecycles.map((l) => ({ id: l.lifecycle.id, name: l.lifecycle.name })),
    cards: read.items.flatMap((placed) => {
      const item = byId.get(placed.workId);
      return item ? [{ station: placed.station, reviewPending: placed.reviewPending, revision: placed.revision, next: placed.next, item }] : [];
    }),
  };
}

function failure(error: unknown): { message: string; status: 400 | 409 | 502 } {
  const status = (error as { status?: number }).status;
  return { message: error instanceof Error ? error.message : String(error), status: status === 409 || status === 400 ? status : 502 };
}

export type WorkContinue = typeof continueScoutWork;

/**
 * `continueWork` defaults to the runtime; tests pass a fake. The reply is the
 * successor's flight, or the runtime's refusal in one line.
 */
export function mountWorkBoardRoutes(app: Hono, continueWork: WorkContinue = continueScoutWork) {
  app.get("/api/work/board", async (c) => {
    try {
      const read = await readScoutWorkBoard(c.req.query("lifecycle") || undefined);
      return c.json(joinWorkBoard(read, (ids) => queryWorkItems({ ids, activeOnly: false, limit: ids.length })));
    } catch (error) {
      const { message } = failure(error);
      return c.json({ error: `Couldn't read the board from the runtime: ${message}` }, 502);
    }
  });

  app.get("/api/work/moves", async (c) => {
    const workId = c.req.query("workId") || undefined;
    if (workId && !WORK_ID.test(workId)) return c.json({ error: "Invalid workId." }, 400);
    try {
      return c.json({ moves: await readScoutWorkMoves<WebWorkMove>(workId) });
    } catch (error) {
      return c.json({ error: failure(error).message }, 502);
    }
  });

  app.post("/api/work/:id/move", async (c) => {
    const workId = c.req.param("id");
    if (!WORK_ID.test(workId)) return c.json({ error: "Invalid work id." }, 400);
    const parsed = await readJsonBody(c, moveBody);
    if (!parsed.ok) return parsed.response;
    try {
      return c.json(await moveScoutWork<WebWorkMoveResponse>({ workId, ...parsed.body }));
    } catch (error) {
      const { message, status } = failure(error);
      return c.json({ error: message }, status);
    }
  });

  // A successor task for the same agent: `scout ask --continue <work>`.
  app.post("/api/work/:id/continue", async (c) => {
    const workId = c.req.param("id");
    if (!WORK_ID.test(workId)) return c.json({ error: "Invalid work id." }, 400);
    const parsed = await readJsonBody(c, continueBody);
    if (!parsed.ok) return parsed.response;
    if (!parsed.body.body.trim()) return c.json({ error: "Say what to do next." }, 400);
    try {
      // A continue is a follow-up on a task, which the runtime allows only from the task's asker or its operator
      // actor ("operator"). The operator's name is a separate actor, so sending as it was refused.
      const result = await continueWork({ workId, body: parsed.body.body, requestId: parsed.body.requestId, senderId: "operator" });
      if (!result.usedBroker) return c.json({ error: "The runtime is not reachable." }, 502);
      if ("rejected" in result) return c.json({ error: `The runtime refused it: ${result.rejected}` }, 409);
      return c.json(result);
    } catch (error) {
      const { message, status } = failure(error);
      return c.json({ error: message }, status);
    }
  });

  app.post("/api/work/:id/review", async (c) => {
    const workId = c.req.param("id");
    if (!WORK_ID.test(workId)) return c.json({ error: "Invalid work id." }, 400);
    const parsed = await readJsonBody(c, reviewBody);
    if (!parsed.ok) return parsed.response;
    try {
      return c.json(await reviewScoutWorkMove<{ move: WebWorkMove; status: string; station?: string }>({ workId, ...parsed.body }));
    } catch (error) {
      const { message, status } = failure(error);
      return c.json({ error: message }, status);
    }
  });
}
