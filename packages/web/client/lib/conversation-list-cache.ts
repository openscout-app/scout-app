/**
 * Shared conversation list cache for chat expanded + collapsed rails.
 * Collapse/expand must not cold-fetch /api/conversations again.
 */
import { api } from "./api.ts";
import { loadPeerConversations } from "./host-conversations.ts";
import type { SessionEntry } from "./types.ts";

type Listener = () => void;

let cache: SessionEntry[] | null = null;
/** Chats on the operator's other hosts; kept apart so a local reload never drops them. */
let peerRows: SessionEntry[] = [];
let merged: SessionEntry[] | null = null;
let peersInflight: Promise<void> | null = null;
let peersLoadedAt = 0;
const PEER_REFRESH_MS = 45_000;
let inflight: Promise<SessionEntry[]> | null = null;
let lastError: string | null = null;
const listeners = new Set<Listener>();
const EMPTY_CONVERSATIONS: SessionEntry[] = [];

export function getCachedConversations(): SessionEntry[] | null {
  return cache;
}

/** React external-store snapshots must preserve identity until the store changes. */
export function getConversationListSnapshot(): SessionEntry[] {
  if (!cache) return EMPTY_CONVERSATIONS;
  if (peerRows.length === 0) return cache;
  if (!merged) merged = mergePeerRows(cache, peerRows);
  return merged;
}

/** Local rows win: a peer row the local runtime also holds is dropped. */
function mergePeerRows(local: SessionEntry[], peer: SessionEntry[]): SessionEntry[] {
  const known = new Set<string>();
  for (const row of local) {
    known.add(row.id);
    for (const id of row.equivalentConversationIds ?? []) known.add(id);
  }
  const extra = peer.filter((row) =>
    !known.has(row.id) && !(row.equivalentConversationIds ?? []).some((id) => known.has(id)));
  return extra.length ? [...local, ...extra] : local;
}

/** Ask the other hosts for their chats, at most once per refresh window. */
export function refreshPeerConversations(options: { force?: boolean } = {}): Promise<void> {
  if (peersInflight) return peersInflight;
  if (!options.force && Date.now() - peersLoadedAt < PEER_REFRESH_MS) return Promise.resolve();
  peersLoadedAt = Date.now();
  peersInflight = loadPeerConversations()
    .then((rows) => {
      peerRows = rows;
      merged = null;
      emit();
    })
    .catch(() => { /* Peers are additive; the local list stands alone. */ })
    .finally(() => {
      peersInflight = null;
    });
  return peersInflight;
}

export function getConversationListError(): string | null {
  return lastError;
}

export function subscribeConversationList(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

export async function loadConversationList(options: { force?: boolean } = {}): Promise<SessionEntry[]> {
  if (cache && !options.force) return cache;
  if (inflight) {
    // Coalesce: a forced reload during an active fetch queues exactly one
    // trailing refetch instead of racing a duplicate multi-MB request.
    if (options.force) pendingForce = true;
    return inflight;
  }

  const run = api<SessionEntry[]>("/api/conversations")
    .then((data) => {
      cache = data;
      merged = null;
      lastError = null;
      emit();
      void refreshPeerConversations();
      return data;
    })
    .catch((cause) => {
      lastError = cause instanceof Error ? cause.message : String(cause);
      emit();
      throw cause;
    })
    .finally(() => {
      inflight = null;
      if (pendingForce) {
        pendingForce = false;
        void loadConversationList({ force: true }).catch(() => null);
      }
    });

  inflight = run;
  return run;
}

const REFRESH_DEBOUNCE_MS = 250;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let pendingForce = false;

/**
 * Debounced forced refresh for broker-event storms: a burst of
 * message.posted events collapses into one refetch per debounce window.
 */
export function scheduleConversationListRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadConversationList({ force: true }).catch(() => null);
  }, REFRESH_DEBOUNCE_MS);
}

/** Test helper */
export function __resetConversationListCache() {
  cache = null;
  peerRows = [];
  merged = null;
  peersInflight = null;
  peersLoadedAt = 0;
  inflight = null;
  lastError = null;
  pendingForce = false;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}
