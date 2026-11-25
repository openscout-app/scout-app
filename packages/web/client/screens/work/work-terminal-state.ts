/*
 * Which work items show their run's terminal in place. The run card's
 * Terminal button and the work page head's copy of it both open the same
 * one, so the state is shared, keyed by work id. Kept for the page's life
 * only: a reload opens on the run, as the session thread does.
 */
import { useSyncExternalStore } from "react";

let open: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

export function isWorkTerminalOpen(workId: string): boolean {
  return open.has(workId);
}

export function setWorkTerminalOpen(workId: string, next: boolean): void {
  if (open.has(workId) === next) return;
  const copy = new Set(open);
  if (next) copy.add(workId);
  else copy.delete(workId);
  open = copy;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkTerminalOpen(workId: string): boolean {
  return useSyncExternalStore(subscribe, () => open.has(workId), () => false);
}
