import type { Flight, FlightSessionTrace } from "../../lib/types.ts";

export function uniqueFlightSessions(trace: FlightSessionTrace[]): FlightSessionTrace[] {
  const bySession = new Map<string, FlightSessionTrace>();
  for (const entry of trace) {
    // Reinsert an existing session so iteration order reflects its most recent
    // span. A flight can return to a previously-used session after switching
    // elsewhere, and the active/default selection must follow the trace tail.
    bySession.delete(entry.sessionId);
    bySession.set(entry.sessionId, entry);
  }
  return [...bySession.values()];
}

/**
 * Preserve a concrete session deep link when its broker flight record has
 * already aged out; otherwise keep the trace-tail selection semantics.
 */
export function resolveFlightSessionId(
  trace: FlightSessionTrace[],
  requestedSessionId?: string | null,
): string | null {
  const sessions = uniqueFlightSessions(trace);
  const requested = requestedSessionId?.trim() || null;
  return sessions.find((session) => session.sessionId === requested)?.sessionId
    ?? sessions.at(-1)?.sessionId
    ?? requested;
}

export const FLIGHT_RECORD_MISSING = "Flight record unavailable. A concrete session link can still be opened.";

export type FlightRecordState = { flight: Flight | null; loading: boolean; error: string | null };

/**
 * What a flight page shows of its flight, from the shared read of it: still
 * reading, the record, or why there is none. A read that found no record says
 * so; a failed read keeps the record it last had and says why.
 */
export function flightRecordState(
  flightId: string | undefined,
  entry: { value: Flight | null; error: string | null; loaded: boolean },
): FlightRecordState {
  if (!flightId) return { flight: null, loading: false, error: null };
  return {
    flight: entry.value,
    loading: !entry.loaded,
    error: entry.error ?? (entry.loaded && !entry.value ? FLIGHT_RECORD_MISSING : null),
  };
}
