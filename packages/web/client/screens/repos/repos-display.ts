import { useSyncExternalStore } from "react";
import type { Tone } from "../../scout/repo-watch/ui.ts";

/*
 * The Repos display: the console tone and the list's view (table or drift).
 * One per viewer, shared by every Repos surface on the page so the list, its
 * context pane and its pull requests wear the same tone. Mirrored to
 * localStorage under the Repos screen's keys; a stale or unreadable value
 * falls back, never wedges.
 */

export type ReposView = "table" | "drift";
export const TONES: readonly Tone[] = ["warm", "cool", "mono"];
export const VIEWS: readonly ReposView[] = ["table", "drift"];
const TONE_KEY = "openscout.repos.tone";
const VIEW_KEY = "openscout.repos.view";

type Display = { tone: Tone; view: ReposView };
const SERVER: Display = { tone: "warm", view: "table" };

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key) as T | null;
    return stored && allowed.includes(stored) ? stored : fallback;
  } catch {
    return fallback;
  }
}

let display: Display | null = null;
const listeners = new Set<() => void>();

function current(): Display {
  display ??= { tone: readStored(TONE_KEY, TONES, "warm"), view: readStored(VIEW_KEY, VIEWS, "table") };
  return display;
}

function write(key: string, patch: Partial<Display>, value: string) {
  display = { ...current(), ...patch };
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode or full: the choice lasts this visit */
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const setTone = (tone: Tone) => write(TONE_KEY, { tone }, tone);
const setView = (view: ReposView) => write(VIEW_KEY, { view }, view);

export function useReposDisplay(): Display & { setTone: (tone: Tone) => void; setView: (view: ReposView) => void } {
  const value = useSyncExternalStore(subscribe, current, () => SERVER);
  return { ...value, setTone, setView };
}
