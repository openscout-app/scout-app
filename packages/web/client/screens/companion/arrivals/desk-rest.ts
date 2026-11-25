import { useSyncExternalStore } from "react";

/*
 * What an attached agent shows at rest, on the desk: its name and state only
 * (the default), or its latest line too. Kept on this page, beside the
 * figures' other desk choices (desk-form.ts); the board's settings set it.
 */

const REST_LINE_KEY = "scout:companion:desk-rest-line";

const listeners = new Set<() => void>();
let restLine: boolean | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getDeskRestLine(): boolean {
  if (restLine === null) {
    try {
      restLine = window.localStorage.getItem(REST_LINE_KEY) === "1";
    } catch {
      restLine = false;
    }
  }
  return restLine;
}

export function setDeskRestLine(on: boolean): void {
  if (on === getDeskRestLine()) return;
  restLine = on;
  try {
    window.localStorage.setItem(REST_LINE_KEY, on ? "1" : "0");
  } catch { /* the choice still holds for this session */ }
  for (const listener of listeners) listener();
}

/** A strip at rest shows its latest line too. */
export function useDeskRestLine(): boolean {
  return useSyncExternalStore(subscribe, getDeskRestLine, getDeskRestLine);
}
