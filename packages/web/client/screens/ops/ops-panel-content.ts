import type { PanelContent } from "../../components/hud-grid/hud-grid-fold.ts";
import type { FleetAsk, FleetAttentionItem } from "../../lib/types.ts";

/**
 * What the Ops rail's panels report to the grid that hosts them (usePanelContent):
 * empty, they fold to their head row; `mark` is the newest arrival's time, so a
 * panel folded by hand can show that something came in. A time that goes back
 * (the newest item left) is not news (hud-grid-fold.ts).
 */

const newest = (times: readonly (number | null | undefined)[]): string | undefined => {
  const max = Math.max(0, ...times.map((t) => t ?? 0));
  return max > 0 ? String(max) : undefined;
};

/** Inbox · Active: empty when nothing waits on the operator and no ask is out. */
export function queueContent(needs: readonly FleetAttentionItem[], active: readonly FleetAsk[]): PanelContent {
  // the figure reads with the word beside it: how many wait, else how many are out
  const [state, count]: [string, number] = needs.length > 0 ? ["waiting", needs.length] : active.length > 0 ? ["active", active.length] : ["all clear", 0];
  return {
    empty: count === 0,
    count,
    state,
    mark: newest([...needs.map((n) => n.updatedAt), ...active.map((a) => a.startedAt ?? a.updatedAt)]),
  };
}

/**
 * Ops summary: empty when nothing waits, no ask is out, no agent is working
 * and no Tail pick is held. Its Recent activity list alone is not news.
 */
export function summaryContent(input: {
  needs: readonly FleetAttentionItem[];
  active: readonly FleetAsk[];
  working: number;
  picked: boolean;
}): PanelContent {
  const { needs, active, working, picked } = input;
  const empty = needs.length === 0 && active.length === 0 && working === 0 && !picked;
  const [state, count]: [string, number | undefined] = empty
    ? ["quiet", undefined]
    : needs.length > 0 ? ["waiting", needs.length] : working > 0 ? ["working", working] : active.length > 0 ? ["active", active.length] : ["picked", undefined];
  return {
    empty,
    count,
    state,
    mark: newest([...needs.map((n) => n.updatedAt), ...active.map((a) => a.startedAt ?? a.updatedAt)]),
  };
}
