import { useMemo, useSyncExternalStore } from "react";

import { emptyScope, keepScopedAgents, parseScopeValues, scopedValue, withScoped, type ScopeLevel, type ScopeValues, type ScopeWho } from "../arrivals/figure-scope-model.ts";
import { DEFAULT_FIGURE_LOOK, FIGURE_LOOKS, parseFigureLook, type FigureLook } from "./figure-look-model.ts";

export * from "./figure-look-model.ts";

/*
 * How figures look: the default for every figure (the board's settings, and
 * the old edge's menu), and over it a look per agent and per project
 * (figure-scope-model.ts), the most specific winning.
 */

const KEY = "scout:companion:figure-look";
const SCOPED_KEY = "scout:companion:figure-looks";
const listeners = new Set<() => void>();
const NO_LOOKS = emptyScope<FigureLook>();

function read(): FigureLook {
  try {
    return parseFigureLook(window.localStorage.getItem(KEY));
  } catch {
    return DEFAULT_FIGURE_LOOK;
  }
}

let current: FigureLook | null = null;
let scoped: ScopeValues<FigureLook> | null = null;

function emit(): void {
  for (const listener of listeners) listener();
}

/** The look for every figure. */
export function getFigureLook(): FigureLook {
  current ??= read();
  return current;
}

export function setFigureLook(look: FigureLook): void {
  current = look;
  try { window.localStorage.setItem(KEY, look); } catch { /* the choice still holds for this session */ }
  emit();
}

const isLook = (value: unknown): value is FigureLook => FIGURE_LOOKS.includes(value as FigureLook);

export function getFigureLooks(): ScopeValues<FigureLook> {
  if (scoped === null) {
    try {
      scoped = parseScopeValues(window.localStorage.getItem(SCOPED_KEY), isLook);
    } catch {
      scoped = NO_LOOKS;
    }
  }
  return scoped;
}

function writeLooks(next: ScopeValues<FigureLook>): void {
  if (next === getFigureLooks()) return;
  scoped = next;
  try { window.localStorage.setItem(SCOPED_KEY, JSON.stringify(next)); } catch { /* the choice still holds for this session */ }
  emit();
}

/** One agent's (by pin id) or one project's look; null follows the next level again. */
export function setScopedFigureLook(level: "agent" | "project", key: string, look: FigureLook | null): void {
  writeLooks(withScoped(getFigureLooks(), level, key, look));
}

/** Forget agent looks for pins the host no longer has; project looks stay. */
export function pruneFigureLooks(pinIds: Iterable<string>): void {
  writeLooks(keepScopedAgents(getFigureLooks(), pinIds));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The look for every figure. */
export function useFigureLook(): FigureLook {
  return useSyncExternalStore(subscribe, getFigureLook, () => DEFAULT_FIGURE_LOOK);
}

export type FigureLookChoice = { scoped: ScopeValues<FigureLook>; fallback: FigureLook };

/** The looks per agent and per project, and the default, as the desk resolves each figure's. */
export function useFigureLookChoice(): FigureLookChoice {
  const looks = useSyncExternalStore(subscribe, getFigureLooks, () => NO_LOOKS);
  const fallback = useFigureLook();
  return useMemo(() => ({ scoped: looks, fallback }), [looks, fallback]);
}

/** One figure's look and the level it comes from. */
export function figureLookOf(choice: FigureLookChoice, who: ScopeWho): { look: FigureLook; from: ScopeLevel } {
  const set = scopedValue(choice.scoped, who);
  return set ? { look: set.value, from: set.from } : { look: choice.fallback, from: "default" };
}
