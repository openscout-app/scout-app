/*
 * Canvas: which agents the scene shows. One filter the scene reads (the project picked, then the agents the viewer
 * hid in the roster), so a later limit on what is on screen at once joins it here rather than in the layout.
 * Hidden agents are remembered per viewer in this browser; an agent not in the list, a new one too, is shown.
 * Pure but for the storage pair, so it can be tested without a page.
 */
import type { CanvasAgent, CanvasItem, CanvasState, CanvasWork } from "../../../shared/canvas.ts";

export type Visibility = {
  /** null: every project */
  project: string | null;
  /** agent ids the viewer hid */
  hidden: ReadonlySet<string>;
};

/** `agents` with each one the canvas leaves out set to null, so indexes into the list still hold. */
export function visibleAgents(agents: readonly CanvasAgent[], v: Visibility): (CanvasAgent | null)[] {
  return agents.map((a) => ((v.project === null || a.project === v.project) && !v.hidden.has(a.id) ? a : null));
}

/**
 * What the shown agents made: their cards, their files and the embeds they drive. A hidden agent's live views go
 * with it, so its sources stop being read until it is shown again. `agents` is `visibleAgents`' list.
 */
export function shownBy<T extends { agent: number }>(list: readonly T[], agents: readonly (CanvasAgent | null)[]): T[] {
  return list.filter((x) => agents[x.agent]);
}

/**
 * The agents the roster lists, hidden ones too: those in the project that would have an area (something to show,
 * files worked, or at work now; the scene's rule). By `rank` (asking first), then newest. Indexes into `agents`.
 */
export function rosterOf(
  agents: readonly CanvasAgent[], items: readonly CanvasItem[], work: readonly CanvasWork[], project: string | null, rank: Record<CanvasState, number>,
): number[] {
  const busy = new Set<number>();
  for (const it of items) busy.add(it.agent);
  for (const w of work) busy.add(w.agent);
  return agents
    .map((a, i) => ({ a, i }))
    .filter(({ a, i }) => (project === null || a.project === project) && (busy.has(i) || a.state !== "quiet"))
    .sort((x, y) => rank[x.a.state] - rank[y.a.state] || y.a.lastAt - x.a.lastAt)
    .map(({ i }) => i);
}

/** One agent shown or hidden. */
export function toggled(hidden: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** Every agent in `listed` hidden but `id`; agents outside the list keep what the viewer chose for them. */
export function onlyThis(hidden: ReadonlySet<string>, listed: readonly string[], id: string): Set<string> {
  const next = new Set(hidden);
  for (const x of listed) if (x !== id) next.add(x);
  next.delete(id);
  return next;
}

/** Every agent in `listed` shown again. */
export function showAll(hidden: ReadonlySet<string>, listed: readonly string[]): Set<string> {
  const next = new Set(hidden);
  for (const x of listed) next.delete(x);
  return next;
}

const HIDDEN_KEY = "scout-canvas:hidden";
/** the most hidden ids kept, newest last: sessions come and go, and the list should not grow without end */
const HIDDEN_KEPT = 200;

/** The agents this viewer hid; empty when nothing is stored or storage is out of reach. */
export function loadHidden(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveHidden(hidden: ReadonlySet<string>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden].slice(-HIDDEN_KEPT))); } catch { /* a convenience only */ }
}
