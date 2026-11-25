/*
 * Turns the operator opened or steered from Home's "Back to you", so they
 * leave the placement at once. Keyed by turn ("post:…@<finishedAt>"): a newer
 * turn on the same thread has a new key and comes back.
 *
 * The runtime drops a turn by itself when the operator writes on it or a new
 * task starts on its thread. Opening leaves no record in the runtime, so this
 * is kept in the browser: a convenience for this viewer, never Scout state.
 * Without storage it still works for the page's life.
 */
import { useSyncExternalStore } from "react";

const KEY = "scout.home.back-to-you.seen";
/** Enough for weeks of turns; the oldest go first. */
export const SEEN_LIMIT = 300;

let seen: ReadonlySet<string> = read();
const listeners = new Set<() => void>();

function read(): ReadonlySet<string> {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

/** The kept keys after adding one, newest last, capped. Pure. */
export function withSeen(keys: Iterable<string>, key: string, limit = SEEN_LIMIT): string[] {
  const next = [...keys].filter((k) => k !== key);
  next.push(key);
  return next.slice(-limit);
}

export function markTurnSeen(turnKey: string): void {
  if (seen.has(turnKey)) return;
  const next = withSeen(seen, turnKey);
  seen = new Set(next);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(next)); } catch { /* kept for this page only */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const get = () => seen;

export function useSeenTurns(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, get, get);
}
