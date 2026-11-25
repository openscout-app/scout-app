import { X } from "lucide-react";

import type { OperatorAttentionItem } from "../lib/types.ts";

/**
 * What is next, at the top of Scoutbot's sheet: one row per thing waiting on
 * the operator, each with one verb. Scoutbot leads with these and keeps the
 * conversation under them.
 *
 * A row is the one shape every offered action takes: who or what it is about,
 * what it is, and the verb. Today the rows are the runtime's open requests and
 * each opens its request in the Inbox. Follow-ups, replies and hand-offs join
 * the same stack as their signals reach Scoutbot. With nothing waiting it
 * draws nothing: no placeholder, no count.
 *
 * Not now sets a row aside here. The request itself is untouched and stays in
 * the Inbox.
 */

/** The most rows offered at once; the rest are in the Inbox. */
export const SCOUTBOT_NEXT_LIMIT = 3;

export function scoutbotNextWho(item: OperatorAttentionItem): string {
  return item.agentName ?? item.agentId ?? item.sourceLabel;
}

/** What the operator does about a request, as one word. */
export function scoutbotNextVerb(item: OperatorAttentionItem): string {
  switch (item.kind) {
    case "approval":
      return "Review";
    case "question":
      return "Answer";
    case "ask":
      return "Reply";
    case "configuration":
      return "Set up";
    default:
      return "Open";
  }
}

export function ScoutbotNextStack({
  items,
  onOpen,
  onOpenAll,
  isHeld,
  onHold,
}: {
  /** Every open request, most pressing first. */
  items: readonly OperatorAttentionItem[];
  onOpen: (item: OperatorAttentionItem) => void;
  onOpenAll: () => void;
  /** Whether the operator set this row aside with Not now. */
  isHeld?: (item: OperatorAttentionItem) => boolean;
  /** Sets a row aside. Without it the rows offer no Not now. */
  onHold?: (item: OperatorAttentionItem) => void;
}) {
  const waiting = isHeld ? items.filter((item) => !isHeld(item)) : items;
  if (waiting.length === 0) return null;
  const shown = waiting.slice(0, SCOUTBOT_NEXT_LIMIT);
  return (
    <ul className="sbd-next" aria-label="Next">
      {shown.map((item) => (
        <li key={item.id} className="sbd-next__item">
          <button type="button" className="sbd-next__row" title="Open in Inbox" onClick={() => onOpen(item)}>
            <span className="sbd-next__who" title={scoutbotNextWho(item)}>{scoutbotNextWho(item)}</span>
            <span className="sbd-next__title">{item.title}</span>
            <span className="sbd-next__verb">{scoutbotNextVerb(item)}</span>
          </button>
          {onHold ? (
            <button
              type="button"
              className="sbd-next__hold"
              title="Not now"
              aria-label={`Not now: ${item.title}`}
              onClick={() => onHold(item)}
            >
              <X size={11} aria-hidden="true" />
            </button>
          ) : null}
        </li>
      ))}
      {items.length > shown.length ? (
        <li>
          <button type="button" className="sbd-next__row sbd-next__row--more" onClick={onOpenAll}>
            <span className="sbd-next__title">More in Inbox</span>
          </button>
        </li>
      ) : null}
    </ul>
  );
}
