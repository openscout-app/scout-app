/**
 * The Scout session behind a Board task, inside the task's panel.
 *
 * Detail opens by engagement: the panel's Session line says who is on it and
 * for how long; while the turn runs it shows the live steps; a finished turn
 * folds to one "Worked for" line that opens to its runs; Open session goes to
 * the full trace. It reads the same flight and observe trace the chat thread
 * does, through the same SessionTurnWork, so the Board and the thread never
 * tell two stories about one turn.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../lib/api.ts";
import { routePath } from "../../lib/router.ts";
import { useBrokerEvents, type BrokerEvent } from "../../lib/sse.ts";
import type { AgentObservePayload, Flight } from "../../lib/types.ts";
import { SessionTurnWork } from "../chat/SessionView.tsx";
import { observeTurnSteps } from "../chat/turn-steps.ts";
import { resolveFlightSessionId } from "../sessions/flight-observe.ts";

const LIVE_TRACE_POLL_MS = 3_500;
const TERMINAL = new Set(["completed", "failed", "cancelled"]);

export function flightIsLive(flight: Pick<Flight, "state"> | null): boolean {
  return Boolean(flight && !TERMINAL.has(String(flight.state)));
}

/** The session a flight ran in: its newest traced session. */
export function flightSessionId(flight: Pick<Flight, "sessions">): string | null {
  return resolveFlightSessionId(flight.sessions ?? [], null);
}

function eventFlightId(event: BrokerEvent): string | null {
  const payload = (event as { payload?: { flight?: { id?: unknown }; flightId?: unknown } }).payload;
  const id = payload?.flight?.id ?? payload?.flightId;
  return typeof id === "string" ? id : null;
}

export function VercelBoardTaskSession({ flightId, harness }: { flightId: string; harness?: string | null }) {
  const [flight, setFlight] = useState<Flight | null>(null);
  const [missing, setMissing] = useState(false);
  const [observe, setObserve] = useState<AgentObservePayload | null>(null);

  const load = useCallback(async () => {
    try {
      const flights = await api<Flight[]>(`/api/flights?active=false&flightId=${encodeURIComponent(flightId)}`);
      setFlight(flights[0] ?? null);
      setMissing(flights.length === 0);
    } catch {
      // A runtime that cannot answer keeps what the panel already shows.
    }
  }, [flightId]);

  useEffect(() => {
    setFlight(null);
    setMissing(false);
    setObserve(null);
    void load();
  }, [load]);

  const live = flightIsLive(flight);
  // Only this flight's own events, and only while it runs, refresh it.
  useBrokerEvents((event) => {
    if (!live) return;
    const id = eventFlightId(event);
    if (id === null || id === flightId) void load();
  });

  const agentId = flight?.agentId ?? null;
  const sessionId = flight ? flightSessionId(flight) : null;

  // While the turn runs, follow the agent's observe trace for the live steps,
  // as the chat thread does.
  useEffect(() => {
    if (!live || !agentId) {
      setObserve(null);
      return;
    }
    let cancelled = false;
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    const poll = async () => {
      try {
        const payload = await api<AgentObservePayload>(`/api/agents/${encodeURIComponent(agentId)}/observe${query}`);
        if (!cancelled) setObserve(payload);
      } catch {
        // No trace on this host yet: the flight's own state still shows.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), LIVE_TRACE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [live, agentId, sessionId]);

  const steps = useMemo(() => observeTurnSteps({ observe, flight }), [observe, flight]);
  const href = routePath({ view: "sessions", flightId, ...(sessionId ? { sessionId } : {}) });

  if (missing) return null;
  return (
    <section className="vbt-session" aria-label="Session">
      <header className="vbt-session-head">
        <h4>Session</h4>
        <a className="vbt-session-open" href={href}>Open session</a>
      </header>
      {flight ? (
        <SessionTurnWork
          flight={flight}
          agentId={agentId}
          sessionId={sessionId}
          running={live}
          steps={steps}
          observe={observe}
          startedAt={flight.startedAt}
          endedAt={flight.completedAt ?? null}
          harness={harness ?? null}
          compact={!live}
        />
      ) : <p className="vbt-session-wait">Loading the session</p>}
    </section>
  );
}
