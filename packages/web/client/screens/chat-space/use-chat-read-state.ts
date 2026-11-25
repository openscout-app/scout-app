import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatReadState, ChatAttentionPreferenceChange } from "@openscout/protocol";
import { ChatApiError, type ChatApi } from "./chat-api.ts";
import { usePoll } from "./use-poll.ts";

/**
 * Reads ids in batches with an optional pause between them, and stops before
 * the next batch once `current()` is false. A paced sweep can outlive the room
 * that started it: Slack's runs one channel every three seconds, and Rooms
 * unmounts that room when the operator moves to Scout or disconnects Slack.
 * Resolves false when it stopped early.
 */
export async function readInBatches(
  ids: readonly string[],
  batchSize: number,
  delayMs: number,
  current: () => boolean,
  read: (batch: string[]) => Promise<"continue" | "stop">,
): Promise<boolean> {
  const size = Math.max(1, batchSize);
  for (let start = 0; start < ids.length; start += size) {
    if (!current()) return false;
    if (await read(ids.slice(start, start + size)) === "stop") return true;
    if (delayMs > 0 && start + size < ids.length) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return current();
}

export function useChatReadState({ api, actorId, space, channelIds, enabled, activeChannelId, backgroundIntervalMs = 60_000, backgroundBatchSize = 4, backgroundBatchDelayMs = 0 }: {
  api: ChatApi;
  actorId: string | null;
  space: string;
  channelIds: string[];
  enabled: boolean;
  activeChannelId?: string | null;
  backgroundIntervalMs?: number;
  backgroundBatchSize?: number;
  backgroundBatchDelayMs?: number;
}) {
  const identity = JSON.stringify([actorId, space]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const [snapshot, setSnapshot] = useState<{ identity: string; states: Record<string, ChatReadState>; error: string | null }>({ identity, states: {}, error: null });
  const idsKey = JSON.stringify(channelIds);
  const ids = useMemo(() => JSON.parse(idsKey) as string[], [idsKey]);
  const pending = useRef(new Set<string>());
  const attentionWrite = useRef(false);
  const [attentionBusy, setAttentionBusy] = useState(false);
  const [attentionError, setAttentionError] = useState<{ identity: string; text: string } | null>(null);
  const readGenerations = useRef(new Map<string, number>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async (onlyChannel?: string) => {
    if (!enabled || !actorId || !api.readState) return;
    const updates: Record<string, ChatReadState> = {};
    const updateGenerations: Record<string, { key: string; generation: number }> = {};
    let failed = false;
    let retryAfterSeconds: number | undefined;
    const selected = onlyChannel ? [onlyChannel] : ids;
    const current = () => mounted.current && identityRef.current === identity;
    const completed = await readInBatches(selected, backgroundBatchSize, backgroundBatchDelayMs, current, async (batchIds) => {
      const reads = batchIds.map((id) => {
        const key = JSON.stringify([identity, id]);
        const generation = (readGenerations.current.get(key) ?? 0) + 1;
        readGenerations.current.set(key, generation);
        return { id, key, generation };
      });
      const batch = await Promise.allSettled(reads.map(({ id }) => api.readState!(id, space)));
      for (const [index, result] of batch.entries()) {
        const read = reads[index]!;
        if (readGenerations.current.get(read.key) !== read.generation) continue;
        if (result.status === "fulfilled" && result.value.actorId === actorId && result.value.channelId === read.id) {
          updates[read.id] = result.value;
          updateGenerations[read.id] = read;
        } else {
          failed = true;
          if (result.status === "rejected" && result.reason instanceof ChatApiError && result.reason.retryAfterSeconds) {
            retryAfterSeconds = Math.max(retryAfterSeconds ?? 0, result.reason.retryAfterSeconds);
          }
        }
      }
      return retryAfterSeconds ? "stop" : "continue";
    });
    if (!completed || !current()) return;
    for (const [id, read] of Object.entries(updateGenerations)) {
      if (readGenerations.current.get(read.key) !== read.generation) delete updates[id];
    }
    setSnapshot((previous) => ({
      identity,
      states: { ...(previous.identity === identity ? previous.states : {}), ...updates },
      error: failed ? "Unread activity could not be refreshed. Showing the last available reading." : null,
    }));
    return retryAfterSeconds;
  }, [actorId, api, enabled, identity, ids, space, backgroundBatchSize, backgroundBatchDelayMs]);

  useEffect(() => { void refresh(); }, [refresh]);
  usePoll(refresh, backgroundIntervalMs, enabled);
  const refreshActive = useCallback(() => activeChannelId ? refresh(activeChannelId) : Promise.resolve(), [activeChannelId, refresh]);
  useEffect(() => { void refreshActive(); }, [refreshActive]);
  usePoll(refreshActive, 15_000, enabled && !!activeChannelId);

  const markRead = useCallback(async (channelId: string, messageId: string, rootMessageId: string | null = null) => {
    if (!enabled || !api.markRead || !actorId) return;
    const key = JSON.stringify([identity, channelId, rootMessageId, messageId]);
    if (pending.current.has(key)) return;
    pending.current.add(key);
    try {
      await api.markRead(channelId, { messageId, rootMessageId, space });
      if (identityRef.current === identity) await refresh(channelId);
    } catch {
      if (identityRef.current === identity) setSnapshot((previous) => ({
        identity, states: previous.identity === identity ? previous.states : {},
        error: "Your read position could not be saved. It will be retried when you return to the conversation.",
      }));
    } finally { pending.current.delete(key); }
  }, [actorId, api, enabled, identity, refresh, space]);

  const updateAttention = useCallback(async (channelId: string, change: ChatAttentionPreferenceChange) => {
    if (!enabled || !actorId || !api.updateAttention || attentionWrite.current) return;
    attentionWrite.current = true;
    setAttentionBusy(true);
    setAttentionError(null);
    try {
      const result = await api.updateAttention(channelId, change, space);
      if (identityRef.current !== identity) return;
      const key = JSON.stringify([identity, channelId]);
      readGenerations.current.set(key, (readGenerations.current.get(key) ?? 0) + 1);
      setSnapshot(previous => previous.identity === identity && previous.states[channelId]
        ? { ...previous, states: { ...previous.states, [channelId]: { ...previous.states[channelId]!, preferences: result.preferences } } }
        : previous);
      await refresh(channelId);
    } catch {
      if (identityRef.current === identity) setAttentionError({ identity, text: "Your activity preference could not be saved. Try again." });
    } finally { attentionWrite.current = false; setAttentionBusy(false); }
  }, [actorId, api, enabled, identity, refresh, space]);

  const updatePins = useCallback(async (channelId: string, messageId: string, pinned: boolean) => {
    if (!enabled || !api.updatePins || attentionWrite.current) return;
    attentionWrite.current = true;
    setAttentionBusy(true);
    setAttentionError(null);
    try {
      const result = await api.updatePins(channelId, { messageId, pinned }, space);
      if (identityRef.current !== identity) return;
      const key = JSON.stringify([identity, channelId]);
      readGenerations.current.set(key, (readGenerations.current.get(key) ?? 0) + 1);
      setSnapshot(previous => previous.identity === identity && previous.states[channelId]
        ? { ...previous, states: { ...previous.states, [channelId]: { ...previous.states[channelId]!, pins: result.pins } } }
        : previous);
      await refresh(channelId);
    } catch {
      if (identityRef.current === identity) setAttentionError({ identity, text: "Channel pins could not be saved. Try again." });
    } finally { attentionWrite.current = false; setAttentionBusy(false); }
  }, [actorId, api, enabled, identity, refresh, space]);

  return {
    states: snapshot.identity === identity && enabled ? snapshot.states : {},
    error: snapshot.identity === identity && enabled ? snapshot.error : null,
    refresh,
    markRead,
    updateAttention,
    updatePins,
    attentionBusy,
    attentionError: attentionError?.identity === identity ? attentionError.text : null,
  };
}
