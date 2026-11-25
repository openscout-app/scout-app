import { useEffect, useMemo, useState } from "react";

import { api } from "../../lib/api.ts";
import type { VercelBoardMirrorState } from "../../../shared/vercel-board-jobs.ts";

/*
 * Which of Scout's rooms are Vercel Board channels. Small and separate from
 * the Board views, so the Rooms page can tell the Vercel tab's rooms from
 * Scout's without loading those views.
 */

export const VERCEL_BOARD_SOURCE = "vercel-board";

export interface VercelBoardRoomRef {
  conversationId: string;
  connectionId: string;
  channel: string;
  mirror: VercelBoardMirrorState;
  connectionState?: string;
  board?: { name: string | null; team: string | null; url: string };
}

const VERCEL_BOARD_ROOMS_REREAD_MS = 60_000;

/** The runtime's Board rooms by conversation, and whether a first read has landed. */
export interface VercelBoardRooms {
  rooms: ReadonlyMap<string, VercelBoardRoomRef>;
  ready: boolean;
}

/**
 * Which rooms are Vercel Board channels, from the runtime's Board status. Read
 * on mount; a failed read (the page can load before its session cookie) tries
 * again a few times, backing off.
 */
export function useVercelBoardRooms(enabled: boolean): VercelBoardRooms {
  const [rooms, setRooms] = useState<ReadonlyMap<string, VercelBoardRoomRef>>(() => new Map());
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    // A failed read keeps the last good list: dropping it would draw every
    // Board room as an empty Scout room. The list is read again on a slow
    // clock, and sooner after a failure, so a room followed later appears and
    // a runtime that was busy at load does not leave the rooms unmarked.
    let alive = true;
    let next: ReturnType<typeof setTimeout> | undefined;
    const read = (failures: number) => {
      void api<{ rooms?: VercelBoardRoomRef[] }>("/api/vercel-board/rooms")
        .then(body => {
          if (!alive) return;
          if (Array.isArray(body.rooms)) setRooms(new Map(body.rooms.map(room => [room.conversationId, room])));
          setReady(true);
          next = setTimeout(() => read(0), VERCEL_BOARD_ROOMS_REREAD_MS);
        })
        .catch(() => {
          if (alive) next = setTimeout(() => read(failures + 1), Math.min(2_000 * 2 ** failures, VERCEL_BOARD_ROOMS_REREAD_MS));
        });
    };
    read(0);
    return () => { alive = false; clearTimeout(next); };
  }, [enabled]);
  return useMemo(() => ({ rooms, ready }), [rooms, ready]);
}
