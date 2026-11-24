import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import {
  activeSessionRefLookupState,
  brokerEventMayAffectSessionRef,
  createSessionRefLookupCoordinator,
  sessionRefsMatch,
  type SessionRefLookupState,
} from "./session-ref-lookup-state.ts";
import type { ObserveData } from "../../lib/types.ts";

type SessionRefLookup =
  | { kind: "conversation"; refId: string; conversationId: string; session: { agentId?: string } }
  | { kind: "observe"; refId: string; session: { agentId?: string } | null;
      observe: { refId: string; agentId: string | null; sessionId: string | null; data: ObserveData } };

function normalizeSessionRef(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? "";
  const leaf = trimmed.split(/[\\/]/).filter(Boolean).at(-1) ?? trimmed;
  return leaf.endsWith(".jsonl") ? leaf.slice(0, -".jsonl".length) : leaf;
}

export function useSessionRefLookup(sessionRef: string, live?: boolean) {
  const [state, setState] = useState<SessionRefLookupState<SessionRefLookup>>(() => ({
    sessionRef,
    lookup: null,
    loading: true,
    error: null,
  }));
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coordinatorRef = useRef<ReturnType<typeof createSessionRefLookupCoordinator<SessionRefLookup>> | null>(null);

  if (!coordinatorRef.current) {
    coordinatorRef.current = createSessionRefLookupCoordinator(
      (ref) => api<SessionRefLookup>(`/api/session-ref/${encodeURIComponent(ref)}`),
      ({ sessionRef: completedRef, result }) => {
        if (result.ok) {
          setState({
            sessionRef: completedRef,
            lookup: result.lookup,
            loading: false,
            error: null,
          });
          return;
        }
        setState({
          sessionRef: completedRef,
          lookup: null,
          loading: false,
          error: result.error instanceof Error ? result.error.message : String(result.error),
        });
      },
    );
  }

  const load = useCallback(async () => {
    if (sessionRef) await coordinatorRef.current!.request(sessionRef);
  }, [sessionRef]);

  useEffect(() => {
    setState({
      sessionRef,
      lookup: null,
      loading: true,
      error: null,
    });
    void load();
    return () => {
      coordinatorRef.current?.invalidate();
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [load, sessionRef]);

  // Effects run after render. Guard by ref here so the previous session cannot
  // remain visible (or writable) for even one paint while the new lookup starts.
  const { lookup, loading, error } = activeSessionRefLookupState(state, sessionRef);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      void load();
    }, 1_000);
  }, [load]);

  useBrokerEvents((event) => {
    const refs = [
      sessionRef,
      lookup?.refId,
      lookup?.kind === "conversation" ? lookup.conversationId : null,
      lookup?.session?.agentId,
      lookup?.kind === "observe" ? lookup.observe.agentId : null,
      lookup?.kind === "observe" ? lookup.observe.sessionId : null,
    ];
    if (brokerEventMayAffectSessionRef(event, refs)) scheduleRefresh();
  }, live);

  useTailEvents((event) => {
    const eventRef = normalizeSessionRef(event.sessionId);
    const routeRef = normalizeSessionRef(sessionRef);
    const observeRef = lookup?.kind === "observe"
      ? normalizeSessionRef(lookup.observe.sessionId ?? lookup.observe.refId)
      : "";
    const externalRef = lookup?.kind === "observe"
      ? normalizeSessionRef(lookup.observe.data.metadata?.session?.externalSessionId)
      : "";
    if (
      !sessionRefsMatch(eventRef, routeRef)
      && (!observeRef || !sessionRefsMatch(eventRef, observeRef))
      && (!externalRef || !sessionRefsMatch(eventRef, externalRef))
    ) {
      return;
    }

    scheduleRefresh();
  }, live);

  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    };
  }, [live]);

  return { lookup, loading, error, refresh: load };
}
