import type { Route } from "../../lib/types.ts";
import { uniqueFlightSessions, type FlightRecordState } from "./flight-observe.ts";

type SessionsRoute = Extract<Route, { view: "sessions" }>;

/**
 * A flight page's bar (/flights/:id/observe): the flight and its state, which
 * of its sessions is open (?session=) and which one it is compared with
 * (?compare=), and why there is nothing to show yet. Picking writes the URL,
 * so Back returns to the session before.
 */
export function SessionsFlightBar({ route, flight, requested, navigate }: {
  route: SessionsRoute & { flightId: string };
  flight: FlightRecordState;
  /** The session the page shows: ?session= when the flight has it, else the flight's latest. */
  requested: string | null;
  navigate: (route: Route) => void;
}) {
  const sessions = uniqueFlightSessions(flight.flight?.sessions ?? []);
  return <div className="s-slots-flight">
    <span>Flight {route.flightId} · {flight.flight?.state ?? (flight.loading ? "Loading" : "Unavailable")}</span>
    {sessions.length > 0 && <label>Session<select value={requested ?? ""} onChange={(e) => navigate({ ...route, sessionId: e.target.value })}>
      {sessions.map((s) => <option key={s.sessionId} value={s.sessionId}>{s.harness} · {s.sessionId}</option>)}
    </select></label>}
    {sessions.length > 1 && <label>Compare<select value={route.compareSessionId ?? ""} onChange={(e) => navigate({ ...route, compareSessionId: e.target.value || undefined })}>
      <option value="">No comparison</option>{sessions.filter((s) => s.sessionId !== requested).map((s) => <option key={s.sessionId} value={s.sessionId}>{s.sessionId}</option>)}
    </select></label>}
    {flight.error && <span role="status">{flight.error}</span>}
    {!flight.loading && !flight.error && !sessions.length && <span>Waiting for the flight to report a session.</span>}
  </div>;
}
