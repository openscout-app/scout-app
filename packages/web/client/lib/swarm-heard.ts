/*
 * When the runtime last heard from the session working on an ask. The runtime
 * records which harness session took each ask (the flight's session trace);
 * the tail knows when that session's log last moved (GET /api/tail/discover)
 * and how it ended (GET /api/tail/recent). An ask the runtime still calls
 * running, on a session whose log has not moved for a long time, reads as
 * silent instead of working: on 10-22 a full disk stopped the runtime reading
 * three lanes for over an hour, two of them finished and one stuck mid-command,
 * and all three read as working.
 * The tail's discovery lists only logs that moved within its window, a day. A
 * log quiet for longer drops out of it, so the session working on such an ask
 * is read by id instead: on 10-24 two lanes whose turns had ended 31 hours
 * earlier, their replies lost, read as working because neither log was listed.
 * Pure; screens/swarm/useSwarmHearing.ts reads.
 */

import { asMeta, asString, flightMeta } from "./swarm-model.ts";
import type { AgentRun, TailDiscoverySnapshot, TailEvent } from "./types.ts";

/** A session whose log has not moved for this long, on an ask the runtime calls running, is silent. Long commands report back well within it. */
export const SILENT_AFTER_MS = 15 * 60_000;

/** What the session's log says about an ask the runtime still calls running. */
export type AskSilence = {
  /** When the log last moved, or when the session took the ask if that is later. */
  since: number;
  /** The log's last word ended a turn after the ask started: the work finished, and its reply never reached the runtime. */
  finished: boolean;
};

/** How a session's log ended when the tail read it, and the write that read describes. */
export type SessionEnd = { at: number; turnEnded: boolean; wroteAt: number };

/** What the tail said, and when it said it. */
export type Hearing = {
  readAt: number;
  /** When each harness session's log last moved, by its harness session id. */
  writes: ReadonlyMap<string, number>;
  /** How each silent session's log ended. */
  ends: ReadonlyMap<string, SessionEnd>;
};

/** The harness sessions the runtime recorded for an ask, the latest first. */
export function askSessionIds(run: AgentRun): string[] {
  const fm = flightMeta(run);
  const trace = Array.isArray(fm.sessionTrace) ? fm.sessionTrace : [];
  const ids = [...trace].reverse().map((entry) => asString(asMeta(entry)?.sessionId));
  ids.push(asString(asMeta(fm.dispatchAck)?.sessionId));
  return [...new Set(ids.filter((id): id is string => id !== null))];
}

/** When each session's log last moved, from the tail's discovery. */
export function lastWrites(snapshot: Pick<TailDiscoverySnapshot, "transcripts">): Map<string, number> {
  const writes = new Map<string, number>();
  for (const transcript of snapshot.transcripts ?? []) {
    if (!transcript.sessionId) continue;
    const at = Math.max(transcript.mtimeMs, transcript.lastEventAt ?? 0);
    writes.set(transcript.sessionId, Math.max(writes.get(transcript.sessionId) ?? 0, at));
  }
  return writes;
}

// Codex closes a turn with "task complete"; Claude Code with "turn duration · N ms".
const TURN_END = /^(?:task complete|turn duration\b)/u;

/** The log's last word: token counts and usage records say nothing either way, so the last other event decides. */
export function sessionEnd(events: readonly TailEvent[], wroteAt: number): SessionEnd | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.kind === "other") continue;
    return { at: event.ts, turnEnded: event.kind === "system" && TURN_END.test(event.summary), wroteAt };
  }
  return null;
}

/**
 * The sessions to read the end of: those of `runs` the runtime calls running
 * whose logs have been silent since before `SILENT_AFTER_MS`, and whose end
 * was not yet read for their latest write.
 */
export function silentSessions(runs: Iterable<AgentRun>, hearing: Pick<Hearing, "readAt" | "writes" | "ends">): Array<{ sessionId: string; wroteAt: number }> {
  const out = new Map<string, number>();
  for (const run of runs) {
    if (run.state !== "running") continue;
    const sessionId = askSessionIds(run).find((id) => hearing.writes.has(id));
    if (!sessionId) continue;
    const wroteAt = hearing.writes.get(sessionId)!;
    if (hearing.readAt - wroteAt < SILENT_AFTER_MS || hearing.ends.get(sessionId)?.wroteAt === wroteAt) continue;
    out.set(sessionId, wroteAt);
  }
  return [...out].map(([sessionId, wroteAt]) => ({ sessionId, wroteAt }));
}

/**
 * The sessions to read by id: for each ask the runtime calls running whose
 * sessions the tail's discovery does not list, its latest session, unless it
 * was read by id within `SILENT_AFTER_MS`. A log that moves again is read again.
 */
export function unlistedSessions(
  runs: Iterable<AgentRun>,
  { readAt, writes, readById }: { readAt: number; writes: ReadonlyMap<string, number>; readById: ReadonlyMap<string, number> },
): string[] {
  const out = new Set<string>();
  for (const run of runs) {
    if (run.state !== "running") continue;
    const ids = askSessionIds(run);
    if (ids.length === 0 || ids.some((id) => writes.has(id))) continue;
    const last = readById.get(ids[0]!);
    if (last !== undefined && readAt - last < SILENT_AFTER_MS) continue;
    out.add(ids[0]!);
  }
  return [...out];
}

/** How a log read by id ended. Without a listing, its latest event is its last write. */
export function unlistedEnd(events: readonly TailEvent[]): SessionEnd | null {
  return events.length === 0 ? null : sessionEnd(events, Math.max(...events.map((event) => event.ts)));
}

/**
 * Whether the session working on an ask has gone silent, as of when the tail
 * looked. Null while the session's log moved within `SILENT_AFTER_MS`, and
 * when the tail knows nothing of the session's log.
 */
export function askSilence(run: AgentRun, startedAt: number, hearing: Hearing): AskSilence | null {
  const ids = askSessionIds(run);
  const sessionId = ids.find((id) => hearing.writes.has(id));
  if (!sessionId) {
    // The log has not moved within the tail's window; its end, read by id, says when it last did.
    const unlisted = ids.find((id) => hearing.ends.has(id));
    if (!unlisted) return null;
    const end = hearing.ends.get(unlisted)!;
    const since = Math.max(end.wroteAt, startedAt);
    if (hearing.readAt - since < SILENT_AFTER_MS) return null;
    return { since, finished: end.turnEnded && end.at >= startedAt };
  }
  const wroteAt = hearing.writes.get(sessionId)!;
  const since = Math.max(wroteAt, startedAt);
  if (hearing.readAt - since < SILENT_AFTER_MS) return null;
  const end = hearing.ends.get(sessionId);
  // An end read for an earlier write, or a turn that ended before this ask began, says nothing about this ask.
  return { since, finished: end !== undefined && end.wroteAt === wroteAt && end.turnEnded && end.at >= startedAt };
}
