import {
  foldWord,
  noteSeen,
  panelFold,
  parseFoldHolds,
  toggleFold,
  type FoldHolds,
  type PanelContent,
  type PanelFold,
} from "../../components/hud-grid/hud-grid-fold.ts";
import { isAgentBusy } from "../../lib/agent-state.ts";
import { filterObserveEventsForHorizon, observeEventWallMs } from "../../lib/lane-observe.ts";
import { isSubstantiveObserveEvent, type AgentLane } from "./agent-lanes-model.ts";

/**
 * Folding a lane on the deck, with the panels' rules (hud-grid-fold.ts): a lane
 * with nothing in its trace folds on its own (a one-line row in the grid, a
 * narrow column in lanes) and opens when its trace gets something. A lane the
 * operator folds by hand stays folded and marks what arrives; one opened by
 * hand stays open. Hand folds are kept per lane, per deck.
 */

/** A lane folded on the deck: its fold, and what its folded row reads. */
export type LaneFold = PanelFold & { word: string | null; count: number | undefined };

export const OPEN_LANE: LaneFold = { folded: false, manual: false, fresh: false, word: null, count: undefined };

/**
 * What a lane holds. Empty: no trace, or nothing in it past the placeholders
 * ("transcript discovered", a warm-up boot), and its agent not in a turn: a
 * working agent's lane stays open while it thinks. `count` is what its trace
 * shows in the window; `mark` is its newest event's time.
 */
export function laneFoldContent(lane: AgentLane, nowMs: number, windowMs: number): PanelContent {
  const events = (lane.observe?.events ?? []).filter(isSubstantiveObserveEvent);
  const busy = isAgentBusy(lane.agent.state ?? null, lane.agent);
  const empty = events.length === 0 && !busy;
  const start = lane.observe?.metadata?.session?.sessionStart;
  const last = events.at(-1);
  const lastAt = last ? observeEventWallMs(last, start) : null;
  const inWindow = windowMs > 0 ? filterObserveEventsForHorizon(events, start, nowMs, windowMs).length : events.length;
  return {
    empty,
    count: inWindow > 0 ? inWindow : undefined,
    state: empty ? (lane.observe ? "quiet" : "no trace") : busy ? "working" : "idle",
    mark: last ? String(lastAt ?? lane.lastActiveAt) : undefined,
  };
}

export function laneFold(content: PanelContent | undefined, holds: FoldHolds, laneId: string): LaneFold {
  const fold = panelFold(content, holds[laneId]);
  return { ...fold, word: foldWord(fold, content), count: fold.folded ? content?.count : undefined };
}

/** Hand folds per deck, newest last; the oldest go past this many lanes. */
export const LANE_FOLD_LIMIT = 100;

export const laneFoldsKey = (profileId: string) => `openscout:agent-lanes-folds:${profileId}`;

export function readLaneFolds(storage: Pick<Storage, "getItem"> | null | undefined, profileId: string): FoldHolds {
  try {
    const raw = storage?.getItem(laneFoldsKey(profileId));
    return raw ? parseFoldHolds(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Keeps the newest holds: a hold re-set moves to the end. */
export function capLaneFolds(holds: FoldHolds, limit = LANE_FOLD_LIMIT): FoldHolds {
  const entries = Object.entries(holds);
  return entries.length > limit ? Object.fromEntries(entries.slice(-limit)) : holds;
}

export function writeLaneFolds(storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined, profileId: string, holds: FoldHolds): void {
  try {
    if (Object.keys(holds).length) storage?.setItem(laneFoldsKey(profileId), JSON.stringify(capLaneFolds(holds)));
    else storage?.removeItem(laneFoldsKey(profileId));
  } catch {
    /* storage unavailable: the folds last for this visit */
  }
}

/** The operator folds or opens a lane; a re-set hold moves to the newest end. */
export function toggleLaneFold(holds: FoldHolds, laneId: string, content: PanelContent | undefined): FoldHolds {
  return capLaneFolds(toggleFold(holds, laneId, content));
}

/** Hand folds made before a lane's trace arrived note its first mark, so that is not news. */
export function noteLanesSeen(holds: FoldHolds, contents: ReadonlyMap<string, PanelContent>): FoldHolds {
  let next = holds;
  for (const id of Object.keys(holds)) next = noteSeen(next, id, contents.get(id));
  return next;
}
