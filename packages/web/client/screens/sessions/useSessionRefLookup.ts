import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import type { SessionRefLookup } from "./SessionRefScreen.tsx";
import {
  brokerEventMayAffectSessionRef,
  sessionRefRefreshDelayMs,
  sessionRefsMatch,
} from "./session-ref-lookup-state.ts";

const REFRESH_INTERVAL_MS = 60_000;
const EVENT_REFRESH_DEBOUNCE_MS = 1_000;
const EVENT_REFRESH_MIN_INTERVAL_MS = 10_000;

export type SessionRefLookupState = {
  lookup: SessionRefLookup | null;
  loading: boolean;
  error: string | null;
};

/**
 * Resolves a session reference through `/api/session-ref/:ref` and keeps it
 * fresh: on a slow interval, and soon after a runtime or tail event names it.
 * A new reference starts clean, so a host that switches sessions in place never
 * shows the previous session while the next one loads.
 */
export function useSessionRefLookup(ref: string): SessionRefLookupState {
  // Held with the reference it answers, so a stale answer is never shown for
  // the next reference, not even for the render before the reload starts.
  const [held, setHeld] = useState<SessionRefLookupState & { ref: string }>(() => ({
    ref,
    lookup: null,
    loading: Boolean(ref),
    error: null,
  }));
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAtRef = useRef<number | null>(null);
  const currentRefRef = useRef(ref);
  currentRefRef.current = ref;

  const load = useCallback(
    async (background = false) => {
      if (!ref) return;
      lastRefreshAtRef.current = Date.now();
      setHeld((prev) => (prev.ref === ref
        ? { ...prev, loading: background ? prev.loading : true, error: null }
        : { ref, lookup: null, loading: true, error: null }));
      try {
        const result = await api<SessionRefLookup>(
          `/api/session-ref/${encodeURIComponent(ref)}`,
        );
        if (currentRefRef.current !== ref) return;
        setHeld({ ref, lookup: result, loading: false, error: null });
      } catch (err) {
        if (currentRefRef.current !== ref) return;
        const message = err instanceof Error ? err.message : String(err);
        setHeld((prev) => ({
          ref,
          lookup: background && prev.ref === ref ? prev.lookup : null,
          loading: false,
          error: message,
        }));
      }
    },
    [ref],
  );

  useEffect(() => {
    lastRefreshAtRef.current = null;
    void load();
    const interval = window.setInterval(() => {
      void load(true);
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [load]);

  const current = held.ref === ref
    ? held
    : { ref, lookup: null, loading: Boolean(ref), error: null };
  const lookup = current.lookup;

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    const delayMs = sessionRefRefreshDelayMs({
      nowMs: Date.now(),
      lastRefreshAtMs: lastRefreshAtRef.current,
      debounceMs: EVENT_REFRESH_DEBOUNCE_MS,
      minimumIntervalMs: EVENT_REFRESH_MIN_INTERVAL_MS,
    });
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void load(true);
    }, delayMs);
  }, [load]);

  useBrokerEvents((event) => {
    const refs = [
      ref,
      lookup?.refId,
      lookup?.kind === "conversation" ? lookup.conversationId : null,
      lookup?.session?.agentId,
      lookup?.kind === "observe" ? lookup.observe.agentId : null,
      lookup?.kind === "observe" ? lookup.observe.sessionId : null,
    ];
    if (brokerEventMayAffectSessionRef(event, refs)) scheduleRefresh();
  });

  useTailEvents((event) => {
    const refs = [
      ref,
      lookup?.refId,
      lookup?.kind === "observe" ? lookup.observe.sessionId : null,
      lookup?.kind === "observe" ? lookup.observe.data.metadata?.session?.externalSessionId : null,
    ];
    if (refs.some((candidate) => sessionRefsMatch(event.sessionId, candidate))) {
      scheduleRefresh();
    }
  });

  return { lookup, loading: current.loading, error: current.error };
}
