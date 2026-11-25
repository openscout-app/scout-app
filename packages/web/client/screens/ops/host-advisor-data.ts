import { useEffect, useSyncExternalStore } from "react";
import { api } from "../../lib/api.ts";
import { isBrokerDataEvent, useBrokerEventsRefresh } from "../../lib/sse.ts";
import type { PairingState, SessionEntry, TailDiscoverySnapshot } from "../../lib/types.ts";
import {
  EMPTY_HOST_ADVISOR_DATA,
  type BuildInfo,
  type HostAdvisorData,
  type HostInfo,
  type KnowledgeStatus,
  type ServiceQuotaGauge,
  type TerminalSessionSummary,
} from "./host-advisor-model.ts";

/*
 * One read of everything Host Advisor shows, shared by the page and every
 * advisor panel on a view: five panels mounting together, or answering the
 * same broker event, make one read, not five. A read keeps what the last good
 * one held for any source that fails, as the page always did.
 */

export type HostAdvisorSnapshot = {
  data: HostAdvisorData;
  /** The first read is out: nothing to show yet. */
  loading: boolean;
  /** A later read is out (Refresh, or a broker event): the page says "Scanning...". */
  refreshing: boolean;
  readAt: number | null;
};

let snapshot: HostAdvisorSnapshot = { data: EMPTY_HOST_ADVISOR_DATA, loading: true, refreshing: false, readAt: null };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const set = (next: HostAdvisorSnapshot) => {
  snapshot = next;
  for (const listener of [...listeners]) listener();
};

/** Read every source again. A read already out is the answer: callers share it. */
export function refreshHostAdvisor(): Promise<void> {
  if (inFlight) return inFlight;
  const first = snapshot.readAt == null;
  set({ ...snapshot, loading: first, refreshing: !first });
  inFlight = Promise.allSettled([
    api<HostInfo>("/.host-info"),
    api<BuildInfo>("/api/build"),
    api<{ gauges: ServiceQuotaGauge[] }>("/api/service-budgets"),
    api<TailDiscoverySnapshot>("/api/tail/discover"),
    api<KnowledgeStatus>("/api/knowledge/status"),
    api<PairingState>("/api/pairing-state"),
    api<{ sessions: TerminalSessionSummary[] }>("/api/terminal-sessions"),
    api<SessionEntry[]>("/api/sessions"),
  ])
    .then(([hostRes, buildRes, quotaRes, tailRes, knowledgeRes, pairingRes, terminalRes, sessionsRes]) => {
      const prev = snapshot.data;
      const data: HostAdvisorData = {
        hostInfo: hostRes.status === "fulfilled" ? hostRes.value : prev.hostInfo,
        buildInfo: buildRes.status === "fulfilled" ? buildRes.value : prev.buildInfo,
        // a failed budgets read reads as "none configured", as the page always did
        quotas: quotaRes.status === "fulfilled" ? quotaRes.value?.gauges ?? [] : [],
        tailDiscovery: tailRes.status === "fulfilled" ? tailRes.value : prev.tailDiscovery,
        knowledgeStatus: knowledgeRes.status === "fulfilled" ? knowledgeRes.value : prev.knowledgeStatus,
        pairingState: pairingRes.status === "fulfilled" ? pairingRes.value : prev.pairingState,
        terminalSessions:
          terminalRes.status === "fulfilled" && terminalRes.value?.sessions ? terminalRes.value.sessions : prev.terminalSessions,
        sessions: sessionsRes.status === "fulfilled" && Array.isArray(sessionsRes.value) ? sessionsRes.value : prev.sessions,
      };
      set({ data, loading: false, refreshing: false, readAt: Date.now() });
    })
    .finally(() => {
      inFlight = null;
      if (snapshot.loading || snapshot.refreshing) set({ ...snapshot, loading: false, refreshing: false });
    });
  return inFlight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const read = () => snapshot;

/** The shared read: reads on mount and on every broker data event (debounced; one read per burst across panels). */
export function useHostAdvisorData(): HostAdvisorSnapshot {
  const snap = useSyncExternalStore(subscribe, read, read);
  useEffect(() => {
    void refreshHostAdvisor();
  }, []);
  useBrokerEventsRefresh(isBrokerDataEvent, () => {
    void refreshHostAdvisor();
  });
  return snap;
}
