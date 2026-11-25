import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api.ts";
import { askSilence, lastWrites, sessionEnd, silentSessions, unlistedEnd, unlistedSessions, type AskSilence, type Hearing, type SessionEnd } from "../../lib/swarm-heard.ts";
import type { AgentRun, TailDiscoverySnapshot, TailEvent } from "../../lib/types.ts";

// The tail's discovery is cached server side; once a minute is enough to see fifteen minutes of silence.
const READ_MS = 60_000;

/**
 * What the tail says about the sessions working on the runtime's open asks:
 * when each one's log last moved, read every minute while any ask runs and at
 * once when the running asks change, and
 * how a silent one's log ended, read once per write. A session the tail no
 * longer lists is read by id, at most once per silence bound. Returns the
 * silenceOf that buildSwarms and findInitiatives take; null until the tail has
 * answered.
 */
export function useSwarmHearing(runs: ReadonlyMap<string, AgentRun>): ((run: AgentRun, startedAt: number) => AskSilence | null) | null {
  const [hearing, setHearing] = useState<Hearing | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const ends = useRef(new Map<string, SessionEnd>());
  const readById = useRef(new Map<string, number>());
  // The running asks, by id. The open asks arrive within seconds and the history
  // well after them, so an ask the history brings in is read again at once: on
  // 10-24 two lanes whose turns had long ended read as working for the first minute.
  const working = [...runs.values()].filter((run) => run.state === "running").map((run) => run.id).sort().join(",");

  useEffect(() => {
    if (!working) return;
    let cancelled = false;
    const read = async () => {
      try {
        const snapshot = await api<TailDiscoverySnapshot>("/api/tail/discover");
        const writes = lastWrites(snapshot);
        const readAt = Date.now();
        const recent = async (sessionId: string) => {
          const query = new URLSearchParams({ sessionId, limit: "6", transcripts: "true" });
          return (await api<{ events?: TailEvent[] }>(`/api/tail/recent?${query}`)).events ?? [];
        };
        const quiet = silentSessions(runsRef.current.values(), { readAt, writes, ends: ends.current });
        const unlisted = unlistedSessions(runsRef.current.values(), { readAt, writes, readById: readById.current });
        await Promise.all([
          ...quiet.map(async ({ sessionId, wroteAt }) => {
            const end = sessionEnd(await recent(sessionId), wroteAt);
            if (end) ends.current.set(sessionId, end);
          }),
          ...unlisted.map(async (sessionId) => {
            const end = unlistedEnd(await recent(sessionId));
            readById.current.set(sessionId, readAt);
            if (end) ends.current.set(sessionId, end);
          }),
        ].map((read) => read.catch(() => undefined)));
        if (!cancelled) setHearing({ readAt, writes, ends: new Map(ends.current) });
      } catch {
        // Without the tail, asks read as the runtime reports them.
      }
    };
    void read();
    const timer = window.setInterval(() => {
      if (!document.hidden) void read();
    }, READ_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [working]);

  const silenceOf = useCallback(
    (run: AgentRun, startedAt: number) => (hearing ? askSilence(run, startedAt, hearing) : null),
    [hearing],
  );
  return working && hearing ? silenceOf : null;
}
