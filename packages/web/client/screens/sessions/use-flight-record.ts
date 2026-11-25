import { useCallback, useEffect, useSyncExternalStore } from "react";
import { api, peekApiGet } from "../../lib/api.ts";
import { isBrokerDataEvent, useBrokerEventsRefresh } from "../../lib/sse.ts";
import type { Flight } from "../../lib/types.ts";
import { createWorkStore, type WorkStore } from "../work/work-store.ts";
import { flightRecordState, type FlightRecordState } from "./flight-observe.ts";

/*
 * One flight's record, shared by everything on a flight page
 * (/flights/:id/observe): the slot screen, and the Session board and Session
 * thread panels. One read per flight however many draw it, warm from a read
 * under 30s old, read again once per burst of broker data events. The keyed,
 * counted store is Work's (screens/work/work-store.ts).
 */

const WARM_MS = 30_000;

export function flightRecordPath(flightId: string): string {
  return `/api/flights?active=false&flightId=${encodeURIComponent(flightId)}`;
}

let flights: WorkStore<Flight | null> | null = null;
function flightStore(): WorkStore<Flight | null> {
  flights ??= createWorkStore<Flight | null>({
    fetch: (flightId) => api<Flight[]>(flightRecordPath(flightId)).then((found) => found[0] ?? null),
    peek: (flightId) => peekApiGet<Flight[]>(flightRecordPath(flightId), WARM_MS)?.[0] ?? null,
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });
  return flights;
}

/** The flight a page names, or nothing to read (no flight id). */
export function useFlightRecord(flightId: string | undefined): FlightRecordState {
  const store = flightStore();
  const key = flightId ?? "";
  const read = useCallback(() => store.get(key), [store, key]);
  // subscribed before it mounts, so the mount's own read is seen
  const entry = useSyncExternalStore(store.subscribe, read, read);
  useEffect(() => store.mount(key), [store, key]);
  useBrokerEventsRefresh((event) => !!flightId && isBrokerDataEvent(event), () => store.scheduleRefresh(), 1_000);
  return flightRecordState(flightId, entry);
}
