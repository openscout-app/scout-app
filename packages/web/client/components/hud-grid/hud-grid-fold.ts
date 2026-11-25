/**
 * Folding a panel to its head row. A panel folds on its own while its content
 * says it is empty and opens again when content arrives. The operator can fold
 * or open one by hand, and that choice holds: a panel folded by hand stays
 * folded when content arrives and marks the arrival instead, so nothing moves
 * under the operator's hands. Pure rules here; HudGrid draws them.
 */

/** What a panel's content reports about itself (usePanelContent). */
export type PanelContent = {
  /** Nothing to show: the panel folds on its own. */
  empty: boolean;
  /**
   * Changes when new content arrives (an id, a latest time). A panel folded by
   * hand marks a change. A numeric mark (a time) is news only when it grows: the
   * newest item leaving is not an arrival.
   */
  mark?: string;
  /** A figure for the folded row. */
  count?: number;
  /** A word or two for the folded row: what the content is doing ("all clear", "working"). */
  state?: string;
};

/** A hand-set fold: only kept while it differs from what the content alone would do. */
export type FoldHold = { held: "folded" | "open"; seen?: string };
export type FoldHolds = Readonly<Record<string, FoldHold>>;

export type PanelFold = {
  folded: boolean;
  /** Folded or opened by hand, against what the content alone would do. */
  manual: boolean;
  /** Folded by hand, and content arrived since. */
  fresh: boolean;
};

function isNews(mark: string, seen: string): boolean {
  if (mark === seen) return false;
  const now = Number(mark);
  const then = Number(seen);
  return mark.trim() !== "" && seen.trim() !== "" && Number.isFinite(now) && Number.isFinite(then) ? now > then : true;
}

export function panelFold(content: PanelContent | undefined, hold: FoldHold | undefined): PanelFold {
  const auto = content?.empty === true;
  if (hold?.held === "folded") {
    const fresh = !auto && content?.mark != null && hold.seen != null && isNews(content.mark, hold.seen);
    return { folded: true, manual: true, fresh };
  }
  if (hold?.held === "open") return { folded: false, manual: true, fresh: false };
  return { folded: auto, manual: false, fresh: false };
}

/**
 * The operator folds or opens a panel. A choice that matches what the content
 * alone would do clears the hold, so the panel goes back to following its
 * content; anything else is held, and a hand fold notes what it has seen.
 */
export function toggleFold(holds: FoldHolds, id: string, content: PanelContent | undefined): FoldHolds {
  const want = !panelFold(content, holds[id]).folded;
  const auto = content?.empty === true;
  const { [id]: _drop, ...rest } = holds;
  if (want === auto) return rest;
  return { ...rest, [id]: want ? { held: "folded", seen: content?.mark } : { held: "open" } };
}

/** A hand fold made before the content first reported notes the first mark it reports, so that is not news. */
export function noteSeen(holds: FoldHolds, id: string, content: PanelContent | undefined): FoldHolds {
  const hold = holds[id];
  if (hold?.held !== "folded" || hold.seen != null || content?.mark == null) return holds;
  return { ...holds, [id]: { ...hold, seen: content.mark } };
}

/** The word a folded row reads: news first, then the content's own word, then "empty". */
export function foldWord(fold: PanelFold, content: PanelContent | undefined): string | null {
  if (!fold.folded) return null;
  if (fold.fresh) return "new";
  if (content?.state) return content.state;
  return content?.empty ? "empty" : null;
}

/** Holds read back from storage anyone can edit: known shapes only, or nothing. */
export function parseFoldHolds(raw: unknown): FoldHolds {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, FoldHold> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== "object") continue;
    const { held, seen } = value as Record<string, unknown>;
    if (held === "open") out[id] = { held };
    else if (held === "folded") out[id] = typeof seen === "string" ? { held, seen } : { held };
  }
  return out;
}
