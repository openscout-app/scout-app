/**
 * Board events: the deliberate acts on a board (shared/boards.ts), in the web
 * server's own database. Append-only. Each board numbers its events from 1;
 * the number is assigned in the same transaction as the insert, so two
 * writers can never share a sequence and nothing is ever replaced.
 *
 * This is the web spike's home for boards. The event shape is the one the
 * runtime will own, so the rows can move there unchanged.
 */

import { BOARD_EVENTS_PAGE_SIZE, type BoardEvent, type BoardEventInput } from "../../shared/boards.ts";
import { webDb } from "./internal/web-db.ts";

type BoardEventRow = {
  board_id: string;
  seq: number;
  at: number;
  actor_id: string;
  kind: string;
  frame_key: string;
  payload_json: string;
};

export type BoardSummary = { boardId: string; seq: number; events: number; lastAt: number };

/** Most events one append takes: a promotion plus its placement, a few notes. */
export const MAX_APPEND = 20;

function eventFromRow(row: BoardEventRow): BoardEvent {
  const payload = JSON.parse(row.payload_json) as BoardEventInput;
  return { ...payload, boardId: row.board_id, seq: row.seq, at: row.at, actorId: row.actor_id };
}

/** Events after `after`, oldest first. */
export function queryBoardEvents(boardId: string, after = 0): BoardEvent[] {
  return (webDb().query(
    `SELECT * FROM board_events
     WHERE board_id = ?1 AND seq > ?2
     ORDER BY seq ASC
     LIMIT ?3`,
  ).all(boardId, Math.max(0, Math.floor(after)), BOARD_EVENTS_PAGE_SIZE) as BoardEventRow[]).map(eventFromRow);
}

/** Every board with events, most recently changed first. */
export function queryBoards(limit = 200): BoardSummary[] {
  return (webDb().query(
    `SELECT board_id, MAX(seq) AS seq, COUNT(*) AS events, MAX(at) AS last_at
     FROM board_events
     GROUP BY board_id
     ORDER BY last_at DESC
     LIMIT ?1`,
  ).all(Math.max(1, Math.min(1000, Math.floor(limit)))) as {
    board_id: string;
    seq: number;
    events: number;
    last_at: number;
  }[]).map((r) => ({ boardId: r.board_id, seq: r.seq, events: r.events, lastAt: r.last_at }));
}

/** Appends events in order, numbering them after the board's last event. */
export function appendBoardEvents(
  boardId: string,
  actorId: string,
  inputs: readonly BoardEventInput[],
  now = Date.now(),
): BoardEvent[] {
  const db = webDb();
  const nextSeq = db.query("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM board_events WHERE board_id = ?1");
  const insert = db.query(
    `INSERT INTO board_events (board_id, seq, at, actor_id, kind, frame_key, payload_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  );
  return db.transaction(() =>
    inputs.map((input) => {
      const { seq } = nextSeq.get(boardId) as { seq: number };
      insert.run(boardId, seq, now, actorId, input.kind, input.frameKey, JSON.stringify(input));
      return { ...input, boardId, seq, at: now, actorId };
    }),
  ).immediate();
}
