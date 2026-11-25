/**
 * Live harness sessions on the board, Scout-started or native.
 *
 * Work items only cover what went through Scout (asks, pins). A Claude Code
 * or Codex session started in a terminal never becomes work, so the board
 * also reads the sessions the Sessions screen reads — Scout conversations
 * plus the broker's tail discovery — and gives each live one a row:
 * working → Departures, a turn that just ended → Arrivals.
 *
 * The broker pushes transcript lines as they are written (tail.events), so
 * the pool stays fresh between polls; the poll fills in discovery and
 * quieter sessions, and merges with what was pushed instead of replacing
 * it. What the board shows still changes only on its pass (ArrivalsBoard).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../lib/api.ts";
import { useBrokerRefresh, type BrokerRefreshPolicy } from "../../../lib/broker-refresh.ts";
import { isBrokerDataEvent } from "../../../lib/sse.ts";
import { useTailEvents } from "../../../lib/tail-events.ts";
import type { Agent, MeshStatus, SessionEntry, TailDiscoveredProcess, TailDiscoveredTranscript, TailDiscoverySnapshot, TailEvent } from "../../../lib/types.ts";
import { buildSessionBoardRows, type SessionBoardRow } from "../../sessions/session-board-model.ts";
import { FRAME_MS } from "./board-motion.ts";

export { sessionThreads, withIdentity } from "./board-sessions-model.ts";
import { ARRIVED_WINDOW_MS, boardEvents, isConversational, latestLines, mergeTailEvents, sessionMachines, sessionReads, sessionTranscripts, type LatestLine, type SessionRead } from "./board-sessions-model.ts";
import type { TapInTranscript } from "./tap-in-model.ts";

const REFRESH: BrokerRefreshPolicy = {
  matches: isBrokerDataEvent,
  debounceMs: 2_000,
  activeWhen: "visible",
  fallbackPollMs: 15_000,
  livePollMs: 30_000,
};

export type BoardSessions = {
  /** Includes direct work conversations, whose retired targets may be absent from the roster. */
  conversations: SessionEntry[];
  rows: SessionBoardRow[];
  latest: Map<string, LatestLine>;
  reads: Map<string, SessionRead>;
  /** Discovery's title, registry status and ask for each session, by session id: what Tap in shows beside its own reads. */
  transcripts: Map<string, TapInTranscript>;
  /** The machine a session row runs on, by its board row id; rows on this Mac are not in it. */
  machines: Map<string, string>;
  /** The first read has come back (or given up), so the board can settle. */
  loaded: boolean;
  /** The transcript lines kept (the shared window, per-session reads, what was pushed): the folded strip plots them per pass. */
  events: readonly TailEvent[];
};

/** At most this many per-session reads per refresh. */
const TOP_UP_MAX = 8;
/** The events kept: the shared window, the per-session reads and what was pushed since. */
const EVENTS_CAP = 1_200;
/** A read that has not answered in this long is given up: 10 s. */
const FETCH_TIMEOUT_MS = 625 * FRAME_MS;
/** A burst of pushed lines rebuilds the rows once, about a second after it starts. */
const PUSH_SETTLE_MS = 64 * FRAME_MS;

type Inputs = {
  conversations: SessionEntry[];
  transcripts: TailDiscoveredTranscript[];
  /** Null until discovery has answered: no verdict on which processes are gone. */
  processes: TailDiscoveredProcess[] | null;
  /** When discovery read the registry and the process table: lines written after it outrank them. */
  discoveredAt: number | null;
  events: TailEvent[];
  localNodeId: string | null;
  loaded: boolean;
};

function timeout(): AbortSignal | undefined {
  try { return AbortSignal.timeout(FETCH_TIMEOUT_MS); } catch { return undefined; }
}

const get = <T,>(path: string) => api<T>(path, { signal: timeout() });

/** The Sessions screen's sources, read by the companion (it has no ScoutProvider). */
export function useBoardSessionRows(agents: Agent[], operatorName: string | null): BoardSessions {
  const [rows, setRows] = useState<BoardSessions>({ conversations: [], rows: [], latest: new Map(), reads: new Map(), transcripts: new Map(), machines: new Map(), loaded: false, events: [] });
  const inputs = useRef<Inputs>({ conversations: [], transcripts: [], processes: null, discoveredAt: null, events: [], localNodeId: null, loaded: false });
  const agentsRef = useRef(agents); agentsRef.current = agents;
  const operatorRef = useRef(operatorName); operatorRef.current = operatorName;
  const pending = useRef(false);
  const pushed = useRef<TailEvent[]>([]);
  const settle = useRef<number | undefined>(undefined);

  const rebuild = useCallback(() => {
    const i = inputs.current;
    const shown = boardEvents(i.events);
    const rows = buildSessionBoardRows({
      conversations: i.conversations, transcripts: i.transcripts, events: shown,
      agents: agentsRef.current, attention: [], now: Date.now(), operatorName: operatorRef.current, localNodeId: i.localNodeId,
    });
    setRows({
      conversations: i.conversations,
      rows,
      latest: latestLines(shown),
      reads: sessionReads({ events: i.events, transcripts: i.transcripts, processes: i.processes, discoveredAt: i.discoveredAt }),
      transcripts: sessionTranscripts(i.transcripts),
      machines: sessionMachines(rows, i.localNodeId),
      loaded: i.loaded,
      events: i.events,
    });
  }, []);

  /** Merge what was pushed since the last rebuild, then rebuild. */
  const flush = useCallback(() => {
    window.clearTimeout(settle.current);
    settle.current = undefined;
    if (pushed.current.length) {
      inputs.current.events = mergeTailEvents(inputs.current.events, pushed.current, EVENTS_CAP);
      pushed.current = [];
    }
    rebuild();
  }, [rebuild]);

  useTailEvents((event) => {
    if (
      event.source !== "claude"
      && event.source !== "codex"
      && event.source !== "antigravity"
      && event.source !== "grok"
      && event.source !== "kimi"
      && event.source !== "opencode"
      && event.source !== "cursor"
    ) return;
    pushed.current.push(event);
    if (settle.current === undefined) settle.current = window.setTimeout(flush, PUSH_SETTLE_MS);
  });
  useEffect(() => () => window.clearTimeout(settle.current), []);

  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    try {
      const [comms, discovered, recent, mesh] = await Promise.allSettled([
        get<SessionEntry[]>("/api/conversations?limit=120"),
        // fresh: past the web server's cache; shallow: without a deep scan.
        get<TailDiscoverySnapshot>("/api/tail/discover?fresh=1&scope=shallow"),
        get<{ events: TailEvent[] }>("/api/tail/recent?limit=400&transcripts=true&fresh=1"),
        inputs.current.localNodeId ? Promise.resolve(null) : get<MeshStatus>("/api/mesh"),
      ]);
      const i = inputs.current;
      if (comms.status === "fulfilled") i.conversations = comms.value;
      if (discovered.status === "fulfilled") {
        i.transcripts = discovered.value.transcripts ?? [];
        i.processes = discovered.value.processes ?? null;
        i.discoveredAt = discovered.value.generatedAt ?? null;
      }
      if (recent.status === "fulfilled") i.events = mergeTailEvents(i.events, recent.value.events ?? [], EVENTS_CAP);
      // Every session still within the board's window can get its own short read when the shared window misses it.
      // Only what a session itself said or did counts as read: a window holding only its system
      // lines, or only its subagents' lines, has not.
      const seen = new Set(i.events.filter(isConversational).map((e) => e.sessionId));
      const now = Date.now();
      const missed = i.transcripts
        .filter((t) => t.sessionId && !seen.has(t.sessionId) && !t.parentSessionId && now - (t.lastEventAt ?? t.mtimeMs) < ARRIVED_WINDOW_MS)
        .sort((a, b) => (b.lastEventAt ?? b.mtimeMs) - (a.lastEventAt ?? a.mtimeMs))
        .slice(0, TOP_UP_MAX);
      const extra = await Promise.allSettled(missed.map((t) =>
        get<{ events: TailEvent[] }>(`/api/tail/recent?limit=40&transcripts=true&fresh=1&sessionId=${encodeURIComponent(t.sessionId!)}`)));
      const more = extra.flatMap((r) => (r.status === "fulfilled" ? r.value.events ?? [] : []));
      if (more.length) i.events = mergeTailEvents(i.events, more, EVENTS_CAP);
      if (mesh.status === "fulfilled" && mesh.value) i.localNodeId = mesh.value.localNode?.id ?? mesh.value.health.nodeId ?? null;
    } finally {
      pending.current = false;
      inputs.current.loaded = true;
    }
    flush();
  }, [flush]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { rebuild(); }, [agents, operatorName, rebuild]);
  useBrokerRefresh(() => void load(), REFRESH);
  return rows;
}
