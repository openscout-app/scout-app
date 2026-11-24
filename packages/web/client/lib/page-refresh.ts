/*
 * A page's own Refresh: every read on the page that registers here is read
 * again together, and the page learns when it last was. Events and the
 * fallback poll (broker-refresh.ts) keep doing the routine work; this is the
 * operator asking for it now.
 *
 * A read registers with usePageRefresh(load) beside its useBrokerRefresh. A
 * read that fails keeps what is shown, as it does on its own clock.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

type Load = () => unknown;

const loads = new Set<{ current: Load }>();
let state: { busy: boolean; at: number | null } = { busy: false, at: null };
const listeners = new Set<() => void>();

function set(next: Partial<typeof state>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Register a read for the page's Refresh. The latest `load` is the one called. */
export function usePageRefresh(load: Load): void {
  const ref = useRef(load);
  ref.current = load;
  useEffect(() => {
    const entry = { current: () => ref.current() };
    loads.add(entry);
    return () => { loads.delete(entry); };
  }, []);
}

/** Note a read the page drew from, so "updated" counts from it. */
export function notePageRead(at = Date.now()): void {
  if (state.at === null || at > state.at) set({ at });
}

/** Read everything registered again, together. A second press while busy joins the first. */
let going: Promise<void> | null = null;
export function refreshPage(): Promise<void> {
  if (going) return going;
  set({ busy: true });
  const all = [...loads].map((entry) => Promise.resolve().then(() => entry.current()));
  going = Promise.allSettled(all).then(() => {
    going = null;
    set({ busy: false, at: Date.now() });
  });
  return going;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const get = () => state;

export function usePageFreshness(): { busy: boolean; at: number | null } {
  return useSyncExternalStore(subscribe, get, get);
}

/** "updated just now", "updated 2m ago", "updated 1h ago"; null before the first read. */
export function freshnessLabel(at: number | null, nowMs: number): string | null {
  if (at === null) return null;
  const s = Math.max(0, Math.round((nowMs - at) / 1000));
  if (s < 45) return "Updated just now";
  const m = Math.round(s / 60);
  if (m < 60) return `Updated ${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `Updated ${h}h ago` : `Updated ${Math.round(h / 24)}d ago`;
}
