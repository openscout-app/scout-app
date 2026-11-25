import { api } from "./api.ts";
import type { OperatorAttentionItem, OperatorAttentionState } from "./types.ts";
import { isDeclaredRequest, stableRequestItems } from "../screens/requests/requests-model.ts";
import { isScoutSurfaceVisible, onScoutSurfaceActivated } from "./surface-activity.ts";
import { createBrokerRefreshController, type BrokerRefreshPolicy } from "./broker-refresh-controller.ts";
import { isBrokerEventStreamLive, isBrokerReconcileEvent, subscribeBrokerEvents, type BrokerEvent } from "./sse.ts";
import { readRequestEvent } from "./request-events.ts";

export type RequestsSnapshot = { state: OperatorAttentionState | null; error: string | null; loading: boolean };
let snapshot: RequestsSnapshot = { state: null, error: null, loading: true };
const listeners = new Set<() => void>();
let stopLive: (() => void) | null = null;
let inFlight: Promise<void> | null = null;
let freshQueued = false;
let revision = 0;
const emit = () => { for (const listener of listeners) listener(); };
export const getRequestsSnapshot = () => snapshot;

/**
 * Requests the runtime settled, by list id. A read that began before the
 * settlement, or a server cache that has not caught up, cannot bring one
 * back. Records never reopen: a new request gets a new id.
 */
const settled = new Map<string, number>();
const SETTLED_KEEP_MS = 2 * 60_000;

/**
 * Requests the operator just acted on, by list id. Each stays on screen, as it
 * was, until its card has shown how the decision went (useRequestActions),
 * whatever a settle event or a read says meanwhile; a decision that never
 * resolves lets go after HOLD_MAX_MS.
 */
const held = new Map<string, { item: OperatorAttentionItem; until: number }>();
export const HOLD_MAX_MS = 60_000;
/** The list as the server last read it, before settled and held rows are applied. */
let serverItems: OperatorAttentionItem[] = [];

function shownItems(now = Date.now()): OperatorAttentionItem[] {
  for (const [id, until] of settled) if (until <= now) settled.delete(id);
  for (const [id, hold] of held) if (hold.until <= now) held.delete(id);
  const shown = serverItems.filter((item) => held.has(item.id) || !settled.has(item.id));
  const ids = new Set(shown.map((item) => item.id));
  for (const [id, hold] of held) if (!ids.has(id)) shown.push(hold.item);
  return stableRequestItems(snapshot.state?.items ?? [], shown);
}

function reshow(now = Date.now()): boolean {
  if (!snapshot.state) return false;
  const items = shownItems(now);
  const before = snapshot.state.items;
  if (items.length === before.length && items.every((item, index) => item === before[index])) return false;
  snapshot = { ...snapshot, state: { ...snapshot.state, items } };
  return true;
}

export function receiveRequests(state: OperatorAttentionState): void {
  revision++;
  serverItems = state.items.filter(isDeclaredRequest);
  snapshot = { state: { ...state, items: shownItems() }, error: null, loading: false };
  emit();
}

/** The runtime settled these requests: drop them now, before any read. */
export function settleRequests(ids: readonly string[], now = Date.now()): void {
  if (ids.length === 0) return;
  for (const id of ids) settled.set(id, now + SETTLED_KEEP_MS);
  if (!reshow(now)) return;
  // Newer than any read in flight.
  revision++;
  emit();
}

/** Keep this request on screen while the operator's decision on it resolves. */
export function holdRequest(item: OperatorAttentionItem, now = Date.now()): void {
  held.set(item.id, { item, until: now + HOLD_MAX_MS });
}

/** Its card has shown the outcome: the request goes if the runtime settled it or the last read left it out. */
export function releaseRequest(id: string, now = Date.now()): void {
  if (!held.delete(id)) return;
  if (reshow(now)) emit();
}

/**
 * `fresh` asks the server to read past its caches, after an event said the
 * runtime changed a request. A fresh read wanted while another read is in
 * flight runs once that one ends.
 */
export function refreshRequests(options: { fresh?: boolean } = {}): Promise<void> {
  if (inFlight) {
    if (options.fresh) freshQueued = true;
    return inFlight;
  }
  const startedAtRevision = revision;
  const path = options.fresh ? "/api/operator-attention?fresh=1" : "/api/operator-attention";
  inFlight = api<OperatorAttentionState>(path).then((state) => {
    // A decision response is newer than a GET that started before the decision.
    if (revision === startedAtRevision) receiveRequests(state);
  }).catch((cause) => {
    if (revision !== startedAtRevision) return;
    snapshot = { ...snapshot, error: cause instanceof Error ? cause.message : "Requests could not be loaded", loading: false };
    emit();
  }).finally(() => {
    inFlight = null;
    if (freshQueued) {
      freshQueued = false;
      void refreshRequests({ fresh: true });
    }
  });
  return inFlight;
}

/**
 * Runtime events are the primary signal; the timer is a net for what no event
 * describes (a prompt seen only in a terminal pane, a pairing approval). It
 * runs while the list is on screen, focused or not: the HUD companion panel
 * never becomes the key window.
 */
const POLICY: BrokerRefreshPolicy = {
  matches: (event) => readRequestEvent(event) !== null,
  fallbackPollMs: 15_000,
  livePollMs: 15_000,
  activeWhen: "visible",
};

function startLive(): () => void {
  let freshWanted = false;
  const controller = createBrokerRefreshController({
    refresh: () => {
      const fresh = freshWanted;
      freshWanted = false;
      void refreshRequests({ fresh });
    },
    policy: () => POLICY,
    isActive: () => isScoutSurfaceVisible(),
    isLive: isBrokerEventStreamLive,
    scheduler: {
      now: () => Date.now(),
      setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  });
  const onEvent = (event: BrokerEvent) => {
    const request = readRequestEvent(event);
    if (request) {
      settleRequests(request.settled);
      freshWanted = true;
    } else if (isBrokerReconcileEvent(event)) {
      // Events in the gap before the stream (re)started are gone.
      freshWanted = true;
    }
    controller.onEvent(event);
  };
  const stopEvents = subscribeBrokerEvents(onEvent);
  const interval = globalThis.setInterval(() => controller.onTick(), POLICY.fallbackPollMs);
  const stopActivation = onScoutSurfaceActivated(() => controller.onActivated());
  return () => {
    stopEvents();
    globalThis.clearInterval(interval);
    stopActivation();
    controller.dispose();
  };
}

export function subscribeRequests(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    void refreshRequests();
    stopLive = startLive();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { stopLive?.(); stopLive = null; }
  };
}
