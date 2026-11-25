import type { SessionEntry, TailDiscoverySnapshot, TailEvent } from "../../lib/types.ts";

/**
 * The Sessions board's reads, shared by everything that draws the board: the
 * slot screen (Basic web) and every Session board and Session thread panel on
 * a view. Five panels make one poll, not five. Pure — reads, timers and
 * visibility come in — so the rules test without a DOM; the React side is
 * use-session-board.ts.
 *
 *   - Counted: the first reader reads the machine's node id once, reads the
 *     four sources, and starts the 15s poll (skipped while the page is
 *     hidden); the last reader stops it. What was read stays, so a panel that
 *     comes back paints at once while it reads again.
 *   - One read at a time: a Refresh or poll during a read joins it.
 *   - A source that fails keeps its last good value, and the board says some
 *     sources are unavailable until a read gets them all.
 *   - Broker events coalesce: a burst asks for one read per second, however
 *     many panels heard it.
 *   - Live tail events land once each, however many panels pass them on, in
 *     one change per 250ms; the newest 1000 are kept.
 */

export const SESSION_BOARD_POLL_MS = 15_000;
export const SESSION_BOARD_EVENT_REFRESH_MS = 1_000;
export const SESSION_BOARD_LIVE_BATCH_MS = 250;
export const SESSION_BOARD_EVENT_LIMIT = 1_000;
export const SESSION_BOARD_SOURCES_ERROR =
  "Some session sources are unavailable. Showing the last successful reads; Refresh to retry.";

export type SessionBoardSnapshot = {
  conversations: SessionEntry[];
  discovery: TailDiscoverySnapshot | null;
  events: TailEvent[];
  /** No read has settled yet. */
  loading: boolean;
  /** A read is in flight. */
  reading: boolean;
  error: string | null;
  /** When the last read settled: the board's clock for "working" and ages. */
  now: number;
  localNodeId: string | null;
};

export type SessionBoardDeps = {
  /** GET /api/sessions */
  legacy: () => Promise<SessionEntry[]>;
  /** GET /api/conversations?limit=250 */
  conversations: () => Promise<SessionEntry[]>;
  /** GET /api/tail/discover */
  discover: () => Promise<TailDiscoverySnapshot>;
  /** GET /api/tail/recent?limit=1000&transcripts=true */
  recent: () => Promise<{ events: TailEvent[] }>;
  /** This machine's node id, from /api/mesh. */
  localNode: () => Promise<string | null>;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  visible: () => boolean;
  now: () => number;
};

export type SessionBoardStore = {
  /** Stable until it changes, so React can read it as a snapshot. */
  get: () => SessionBoardSnapshot;
  subscribe: (listener: () => void) => () => void;
  /** Count a reader in; returns the release. */
  mount: () => () => void;
  /** Read the four sources now (or join the read in flight). */
  refresh: () => Promise<void>;
  /** A broker data event: one read per second however many arrive. */
  requestRefresh: () => void;
  /** A live tail event, passed on by any number of readers. */
  pushLive: (event: TailEvent) => void;
  /** How many readers are counted in, for tests and diagnostics. */
  readers: () => number;
};

/** The legacy session list, with the conversations read laid over it by id. */
export function mergeConversations(legacy: readonly SessionEntry[] | null, comms: readonly SessionEntry[] | null): SessionEntry[] {
  const byId = new Map((legacy ?? []).map((s) => [s.id, s]));
  for (const session of comms ?? []) {
    const old = byId.get(session.id);
    // A chat id joins descriptions, not execution ids. Retain the legacy
    // provider alias only when both reads identify the same execution.
    const member = session.participants?.find((p) => p.actorId === session.agentId);
    const backing = session.sessionId ?? member?.sessionId;
    const sameExecution = old && session.agentId === old.agentId && session.harness === old.harness && backing
      && (backing === old.sessionId || backing === old.harnessSessionId);
    byId.set(session.id, sameExecution
      ? { ...old, ...session, sessionId: session.sessionId ?? backing, harnessSessionId: session.harnessSessionId ?? old.harnessSessionId }
      : session);
  }
  return [...byId.values()];
}

/** A /api/tail/recent read joined to what is held: one per id (the held copy wins), oldest first, the newest `limit`. */
export function mergeRecentEvents(current: readonly TailEvent[], recent: readonly TailEvent[], limit = SESSION_BOARD_EVENT_LIMIT): TailEvent[] {
  return [...new Map([...recent, ...current].map((e) => [e.id, e])).values()].sort((a, b) => a.ts - b.ts).slice(-limit);
}

/** Live events appended in arrival order, each replacing an older copy of itself; the newest `limit`. */
export function appendLiveEvents(current: readonly TailEvent[], batch: readonly TailEvent[], limit = SESSION_BOARD_EVENT_LIMIT): TailEvent[] {
  if (batch.length === 0) return current as TailEvent[];
  const ids = new Set(batch.map((e) => e.id));
  return [...current.filter((e) => !ids.has(e.id)), ...batch].slice(-limit);
}

export function createSessionBoardStore(deps: SessionBoardDeps): SessionBoardStore {
  let snapshot: SessionBoardSnapshot = {
    conversations: [],
    discovery: null,
    events: [],
    loading: true,
    reading: false,
    error: null,
    now: deps.now(),
    localNodeId: null,
  };
  const listeners = new Set<() => void>();
  let readers = 0;
  let inFlight: Promise<void> | null = null;
  let meshReading = false;
  let pollTimer: unknown = null;
  let eventTimer: unknown = null;
  let liveTimer: unknown = null;
  const pendingLive = new Map<string, TailEvent>();

  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  const patch = (next: Partial<SessionBoardSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    emit();
  };

  const readLocalNode = () => {
    if (snapshot.localNodeId || meshReading) return;
    meshReading = true;
    deps.localNode().then(
      (id) => {
        meshReading = false;
        if (id && id !== snapshot.localNodeId) patch({ localNodeId: id });
      },
      () => {
        // a later reader asks again
        meshReading = false;
      },
    );
  };

  const refresh = (): Promise<void> => {
    if (inFlight) return inFlight;
    patch({ reading: true });
    inFlight = (async () => {
      const [legacy, comms, discovered, recent] = await Promise.allSettled([
        deps.legacy(),
        deps.conversations(),
        deps.discover(),
        deps.recent(),
      ]);
      const next: Partial<SessionBoardSnapshot> = {
        loading: false,
        reading: false,
        now: deps.now(),
        error: [legacy, comms, discovered, recent].some((r) => r.status === "rejected") ? SESSION_BOARD_SOURCES_ERROR : null,
      };
      if (legacy.status === "fulfilled" || comms.status === "fulfilled") {
        next.conversations = mergeConversations(
          legacy.status === "fulfilled" ? legacy.value : null,
          comms.status === "fulfilled" ? comms.value : null,
        );
      }
      if (discovered.status === "fulfilled") next.discovery = discovered.value;
      if (recent.status === "fulfilled") next.events = mergeRecentEvents(snapshot.events, recent.value.events);
      inFlight = null;
      patch(next);
    })();
    return inFlight;
  };

  const schedulePoll = () => {
    pollTimer = deps.setTimer(() => {
      pollTimer = null;
      if (readers === 0) return;
      if (deps.visible()) void refresh();
      schedulePoll();
    }, SESSION_BOARD_POLL_MS);
  };

  const flushLive = () => {
    liveTimer = null;
    const batch = [...pendingLive.values()];
    pendingLive.clear();
    if (batch.length) patch({ events: appendLiveEvents(snapshot.events, batch) });
  };

  const stop = () => {
    for (const handle of [pollTimer, eventTimer, liveTimer]) if (handle !== null) deps.clearTimer(handle);
    pollTimer = eventTimer = liveTimer = null;
    pendingLive.clear();
  };

  return {
    get: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    mount() {
      readers += 1;
      if (readers === 1) {
        readLocalNode();
        void refresh();
        schedulePoll();
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        readers -= 1;
        if (readers === 0) stop();
      };
    },
    refresh,
    requestRefresh() {
      if (readers === 0 || eventTimer !== null) return;
      eventTimer = deps.setTimer(() => {
        eventTimer = null;
        if (readers > 0) void refresh();
      }, SESSION_BOARD_EVENT_REFRESH_MS);
    },
    pushLive(event) {
      if (readers === 0) return;
      // a copy that arrives again moves to the end, as each arrival did one at a time
      pendingLive.delete(event.id);
      pendingLive.set(event.id, event);
      if (liveTimer === null) liveTimer = deps.setTimer(flushLive, SESSION_BOARD_LIVE_BATCH_MS);
    },
    readers: () => readers,
  };
}
