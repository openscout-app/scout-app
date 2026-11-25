import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { friendlyApiError } from "./api-errors.ts";
import {
  getCachedConversations,
  getConversationListError,
  getConversationListSnapshot,
  loadConversationList,
  refreshPeerConversations,
  scheduleConversationListRefresh,
  subscribeConversationList,
} from "./conversation-list-cache.ts";
import { useBrokerEvents } from "./sse.ts";

/**
 * Shared conversation list for ChatLeft + collapsed chip strip.
 * First subscriber loads; collapse/expand reuses the warm cache.
 */
export function useConversationList() {
  const sessions = useSyncExternalStore(
    subscribeConversationList,
    getConversationListSnapshot,
    getConversationListSnapshot,
  );
  const [loading, setLoading] = useState(() => getCachedConversations() == null);
  const [loadError, setLoadError] = useState<string | null>(() => getConversationListError());

  const reload = useCallback(async (force = false) => {
    const hadCache = getCachedConversations() != null;
    if (!hadCache) setLoading(true);
    try {
      await loadConversationList({ force });
      setLoadError(null);
    } catch (cause) {
      setLoadError(friendlyApiError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload(false);
  }, [reload]);

  // Other hosts' runtime events do not reach this one; ask them again now and then.
  useEffect(() => {
    const timer = setInterval(() => void refreshPeerConversations(), 60_000);
    return () => clearInterval(timer);
  }, []);

  useBrokerEvents((event) => {
    if (event.kind === "message.posted" || event.kind === "conversation.upserted") {
      scheduleConversationListRefresh();
    }
  });

  return { sessions, loading, loadError, reload };
}
