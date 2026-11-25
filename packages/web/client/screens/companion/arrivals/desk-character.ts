import { useMemo, useSyncExternalStore } from "react";

import {
  adoptHandlePicks,
  DEFAULT_DESK_CHARACTER,
  parseDeskCharacterDefault,
  parseDeskCharacters,
  sameHandout,
  validPick,
  withDeskCharacter,
  type DeskCharacterChoice,
  type DeskCharacterDefault,
  type DeskCharacters,
} from "./desk-character-model.ts";
import { emptyScope, keepScopedAgents, parseScopeValues, type ScopeValues, type ScopeWho } from "./figure-scope-model.ts";

export * from "./desk-character-model.ts";

/*
 * Who draws each attached agent (desk-character-model.ts). This page's
 * storage, like the desk form: picks per agent and per project, the old
 * picks by handle until they are adopted or dropped, and the default for agents with no
 * character. Storage can be missing or full; the choice still holds for this
 * session.
 */

const PICKS_KEY = "scout:companion:desk-character-picks";
/** The old picks, by handle; emptied as their agents are seen (adoptHandlePicks). They draw no one. */
const HANDLE_PICKS_KEY = "scout:companion:desk-characters";
const DEFAULT_KEY = "scout:companion:desk-character-default";
const listeners = new Set<() => void>();

let picks: ScopeValues<string> | null = null;
let legacy: DeskCharacters | null = null;
let fallback: DeskCharacterDefault | null = null;
/** The crew members the desk hands out now (crewHandout); the desk keeps it, nothing stores it. */
let handout: ReadonlyMap<string, string> = new Map();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch { /* the choice still holds for this session */ }
}

export function getDeskCharacterPicks(): ScopeValues<string> {
  if (picks === null) {
    try {
      picks = parseScopeValues(window.localStorage.getItem(PICKS_KEY), validPick);
    } catch {
      picks = emptyScope();
    }
  }
  return picks;
}

export function getHandlePicks(): DeskCharacters {
  if (legacy === null) {
    try {
      legacy = parseDeskCharacters(window.localStorage.getItem(HANDLE_PICKS_KEY));
    } catch {
      legacy = {};
    }
  }
  return legacy;
}

export function getDeskCharacterDefault(): DeskCharacterDefault {
  if (fallback === null) {
    try {
      fallback = parseDeskCharacterDefault(window.localStorage.getItem(DEFAULT_KEY));
    } catch {
      fallback = DEFAULT_DESK_CHARACTER;
    }
  }
  return fallback;
}

function writePicks(next: ScopeValues<string>): void {
  if (next === getDeskCharacterPicks()) return;
  picks = next;
  write(PICKS_KEY, next);
  emit();
}

/** One agent's (by pin id) or one project's pick; null follows the next level again. */
export function setDeskCharacter(level: "agent" | "project", key: string, pick: string | null): void {
  writePicks(withDeskCharacter(getDeskCharacterPicks(), level, key, pick));
}

/** Forget agent picks for pins the host no longer has; project picks stay. */
export function pruneDeskCharacters(pinIds: Iterable<string>): void {
  writePicks(keepScopedAgents(getDeskCharacterPicks(), pinIds));
}

/** The desk's hand-out of crew members, so Details says the member a figure shows. */
export function setDeskHandout(next: ReadonlyMap<string, string>): void {
  if (sameHandout(handout, next)) return;
  handout = next;
  emit();
}

function getDeskHandout(): ReadonlyMap<string, string> {
  return handout;
}

/** Old handle picks whose agent is in sight become its own, or are dropped when several agents share the handle (adoptHandlePicks). */
export function adoptDeskCharacters(seen: readonly (ScopeWho & { handle: string })[]): void {
  const old = getHandlePicks();
  if (!Object.keys(old).length) return;
  const moved = adoptHandlePicks(getDeskCharacterPicks(), old, seen);
  if (!moved) return;
  picks = moved.picks;
  legacy = moved.legacy;
  write(PICKS_KEY, moved.picks);
  write(HANDLE_PICKS_KEY, moved.legacy);
  emit();
}

export function setDeskCharacterDefault(value: DeskCharacterDefault): void {
  if (value === getDeskCharacterDefault()) return;
  fallback = value;
  try {
    window.localStorage.setItem(DEFAULT_KEY, value);
  } catch { /* the choice still holds for this session */ }
  emit();
}

export function useDeskCharacterDefault(): DeskCharacterDefault {
  return useSyncExternalStore(subscribe, getDeskCharacterDefault, getDeskCharacterDefault);
}

/** The picks, the old handle picks and the default together, as the figures resolve their character. */
export function useDeskCharacterChoice(): DeskCharacterChoice {
  const current = useSyncExternalStore(subscribe, getDeskCharacterPicks, getDeskCharacterPicks);
  const old = useSyncExternalStore(subscribe, getHandlePicks, getHandlePicks);
  const value = useDeskCharacterDefault();
  const given = useSyncExternalStore(subscribe, getDeskHandout, getDeskHandout);
  return useMemo(() => ({ picks: current, legacy: old, fallback: value, handout: given }), [current, old, value, given]);
}
