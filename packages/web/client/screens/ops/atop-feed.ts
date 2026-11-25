import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../lib/api.ts";
import { isScoutSurfaceActive, onScoutSurfaceActivated } from "../../lib/surface-activity.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import type {
  TailDiscoveredProcess,
  TailDiscoverySnapshot,
  TailEvent,
  TailSessionUsage,
  TailUsageSnapshot,
} from "../../lib/types.ts";
import {
  deriveRows,
  DISCOVERY_INTERVAL_MS,
  DISCOVERY_TIMEOUT_MS,
  EVENT_BUFFER_LIMIT,
  mergeEvents,
  RECENT_REPLAY_LIMIT,
  REPLAY_TIMEOUT_MS,
  SUMMARY_SAMPLE_BARS,
  summarize,
  USAGE_CATCH_UP_MS,
  USAGE_INTERVAL_MS,
  USAGE_RETRY_MS,
  usageSessionIds,
  type AtopFreshness,
  type AtopRow,
  type AtopSummary,
} from "./atop-model.ts";

/*
 * What Runtime watches, read once for the page and every Runtime panel on a
 * view: one event buffer, one discovery poll, one clock and one derive,
 * however many panels draw it. Started by the first reader, stopped with the
 * last; the next start replays the recent tail again, as the page did on
 * every mount.
 *
 * Read-only: every request here is a GET (atop-read-only.test.ts holds it).
 *
 * Light on the browser: a live event is only pushed onto `incoming`; the
 * buffer is merged (by event id) and the rows derived at most once per
 * frame batch, and not at all while the surface is hidden. A hidden surface
 * keeps a bounded `incoming` and catches up when it is shown again.
 *
 * Three reads, each one at a time and each with a timeout: the slim process
 * list every 5s, the rows' lifetime usage every 15s (a separate runtime read,
 * so discovery doesn't scan transcripts), and one process's parent chain when
 * its drawer opens. A runtime without an option ignores it: the slim list
 * comes back whole, `pid` returns every process, and a missing usage read
 * leaves tokens to the buffer.
 */

/** The slim list: parent chains left empty (the drawer reads one process's chain when it opens). */
export const DISCOVERY_PATH = "/api/tail/discover?parentChain=0";
/** One process with its parent chain. */
const discoveryDetailPath = (pid: number) => `/api/tail/discover?pid=${encodeURIComponent(String(pid))}`;
/** Lifetime tokens, model and last turn for up to USAGE_BATCH_LIMIT sessions. */
export const USAGE_PATH = "/api/tail/usage";

export type AtopFeed = {
  events: TailEvent[];
  discovery: TailDiscoverySnapshot | null;
  now: number;
  rows: AtopRow[];
  summary: AtopSummary;
  /** How old the snapshot on screen is, and whether the last read failed. */
  freshness: AtopFreshness;
  /** The active and working counts, sampled on every change, last SUMMARY_SAMPLE_BARS. */
  runHistory: number[];
  toolHistory: number[];
};

const EMPTY_SUMMARY: AtopSummary = { total: 0, running: 0, tooling: 0, idle: 0, harnesses: [], reqsPerMin: 0 };
const NO_SNAPSHOT: AtopFreshness = { generatedAt: null, failed: false };
const fresh = (): AtopFeed => ({
  events: [],
  discovery: null,
  now: Date.now(),
  rows: [],
  summary: EMPTY_SUMMARY,
  freshness: NO_SNAPSHOT,
  runHistory: [],
  toolHistory: [],
});

let feed: AtopFeed = fresh();
let events: TailEvent[] = [];
/** Arrivals not yet merged into `events`. */
let incoming: TailEvent[] = [];
/** A hidden surface's `incoming` dropped its oldest arrivals: replay the recent tail when shown. */
let overflowed = false;
let discovery: TailDiscoverySnapshot | null = null;
let freshness: AtopFreshness = NO_SNAPSHOT;
let usage = new Map<string, TailSessionUsage>();
let usageReading = false;
let usageNextAt = 0;
let now = Date.now();
let lastEvent: TailEvent | null = null;
let readers = 0;
let generation = 0;
let pending: ReturnType<typeof setTimeout> | null = null;
let stopRunning: (() => void) | null = null;
const listeners = new Set<() => void>();

/** Merge arrivals, rebuild rows and summary; sample the counts when they moved. */
function derive() {
  pending = null;
  if (incoming.length > 0) {
    events = mergeEvents(events, incoming, EVENT_BUFFER_LIMIT);
    incoming = [];
  }
  const rows = deriveRows(discovery, events, now, usage);
  const summary = summarize(rows, events, now);
  const moved =
    feed.runHistory.length === 0 || summary.running !== feed.summary.running || summary.tooling !== feed.summary.tooling;
  feed = {
    events,
    discovery,
    now,
    rows,
    summary,
    freshness,
    runHistory: moved ? [...feed.runHistory, summary.running].slice(-SUMMARY_SAMPLE_BARS) : feed.runHistory,
    toolHistory: moved ? [...feed.toolHistory, summary.tooling].slice(-SUMMARY_SAMPLE_BARS) : feed.toolHistory,
  };
  for (const listener of [...listeners]) listener();
  maybeReadUsage(rows);
}

function maybeReadUsage(rows: readonly AtopRow[]) {
  if (usageReading || readers === 0 || !isScoutSurfaceActive() || Date.now() < usageNextAt) return;
  const ids = usageSessionIds(rows);
  if (ids.length === 0) return;
  void readUsage(ids, generation);
}

async function readUsage(ids: string[], gen: number) {
  usageReading = true;
  try {
    const query = new URLSearchParams();
    for (const id of ids) query.append("sessionId", id);
    const snap = await api<TailUsageSnapshot>(`${USAGE_PATH}?${query}`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (gen !== generation) return;
    const next = new Map<string, TailSessionUsage>();
    for (const session of snap.sessions ?? []) {
      if (session && typeof session.sessionId === "string") next.set(session.sessionId, session);
    }
    usage = next;
    const catchingUp = [...next.values()].some((session) => session.complete === false);
    usageNextAt = Date.now() + (catchingUp ? USAGE_CATCH_UP_MS : USAGE_INTERVAL_MS);
    schedule();
  } catch {
    // a runtime without the usage read: tokens stay the buffer's; ask again later
    if (gen === generation) usageNextAt = Date.now() + USAGE_RETRY_MS;
  } finally {
    usageReading = false;
  }
}

/** Events arrive one socket frame at a time: draw them together, and only where someone can see them. */
function schedule() {
  if (pending == null && isScoutSurfaceActive()) pending = setTimeout(derive, 50);
}

/**
 * One tail event, from any reader's subscription. Every subscriber is handed
 * the same object in turn, so the second reader's copy is dropped here; a
 * repeat of an id already held is dropped when merged.
 */
function ingest(event: TailEvent) {
  if (event === lastEvent || readers === 0) return;
  lastEvent = event;
  incoming.push(event);
  // hidden: hold at most two buffers' worth, trimmed in one go
  if (incoming.length >= EVENT_BUFFER_LIMIT * 2) {
    incoming = incoming.slice(incoming.length - EVENT_BUFFER_LIMIT);
    overflowed = true;
  }
  schedule();
}

function start(): () => void {
  const gen = ++generation;
  let replayed = false;
  let discovering = false;
  const live = () => gen === generation;

  const replay = async () => {
    if ((replayed && !overflowed) || !isScoutSurfaceActive()) return;
    try {
      const result = await api<{ events: TailEvent[] }>(
        `/api/tail/recent?limit=${RECENT_REPLAY_LIMIT}`,
        { signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS) },
      );
      if (!live()) return;
      replayed = true;
      overflowed = false;
      // merged with whatever the live stream brought meanwhile, never over it
      events = mergeEvents(events, result.events ?? [], EVENT_BUFFER_LIMIT);
      schedule();
    } catch {
      /* the live stream still fills the buffer; the next activation retries */
    }
  };
  const discover = async () => {
    // one read at a time: a slow runtime is not asked again until it answers or times out
    if (discovering || !isScoutSurfaceActive()) return;
    discovering = true;
    try {
      const snap = await api<TailDiscoverySnapshot>(DISCOVERY_PATH, {
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (!live()) return;
      discovery = snap;
      freshness = { generatedAt: typeof snap.generatedAt === "number" ? snap.generatedAt : Date.now(), failed: false };
    } catch {
      if (!live()) return;
      // keep the last snapshot, and say so
      freshness = { ...freshness, failed: true };
    } finally {
      discovering = false;
      if (live()) schedule();
    }
  };

  void replay();
  void discover();
  const poll = setInterval(() => void discover(), DISCOVERY_INTERVAL_MS);
  // the clock keeps "12s ago", process ages and the active window current
  const clock = setInterval(() => {
    if (!isScoutSurfaceActive()) return;
    now = Date.now();
    schedule();
  }, 1_000);
  const stopActivation = onScoutSurfaceActivated(() => {
    now = Date.now();
    schedule();
    void replay();
    void discover();
  });

  return () => {
    generation++;
    clearInterval(poll);
    clearInterval(clock);
    stopActivation();
    if (pending != null) clearTimeout(pending);
    pending = null;
    events = [];
    incoming = [];
    overflowed = false;
    discovery = null;
    freshness = NO_SNAPSHOT;
    usage = new Map();
    usageNextAt = 0;
    lastEvent = null;
    feed = fresh();
  };
}

function retain(): () => void {
  readers++;
  if (readers === 1) stopRunning = start();
  return () => {
    readers--;
    if (readers === 0) {
      stopRunning?.();
      stopRunning = null;
    }
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => feed;

/** Runtime's live read: the tail buffer, discovery every 5s, usage every 15s, the derived rows and summary. Shared by every reader. */
export function useAtopFeed(): AtopFeed {
  useTailEvents(ingest);
  useEffect(() => retain(), []);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * One process's detail (its parent chain), read once when its drawer opens:
 * the slim list the table polls leaves chains empty.
 */
export async function readProcessDetail(
  process: { source: string; pid: number },
  signal?: AbortSignal,
): Promise<TailDiscoveredProcess | null> {
  const timeout = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const snap = await api<TailDiscoverySnapshot>(discoveryDetailPath(process.pid), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  return snap.processes.find((entry) => entry.pid === process.pid && entry.source === process.source) ?? null;
}
