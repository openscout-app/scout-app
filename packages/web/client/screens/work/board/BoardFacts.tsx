/**
 * The Kanban's facts strip and its failed-run group. Both state what the
 * board read already says (board-facts.ts); nothing here is written by a model.
 */
import { useState, type ReactNode } from "react";
import type { WebWorkBoardCard, WebWorkMove } from "../../../../shared/api/web.ts";
import type { FactLine } from "./board-facts.ts";
import { Icon } from "./parts.tsx";

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function BoardFacts({ facts, moves, titleOf, stationName, nameOf }: {
  facts: readonly FactLine[];
  moves: readonly WebWorkMove[];
  titleOf: (itemId: string) => string;
  stationName: (id: string) => string;
  nameOf: (id: string) => string;
}) {
  return (
    <div className="wb-facts" aria-label="Board facts">
      <ul className="wb-fact-lines">
        {facts.map((f) => (
          <li key={f.key} className={f.count ? undefined : "zero"}>
            <b>{f.count}</b> {f.label}{f.detail ? <span className="wb-fact-detail">, {f.detail}</span> : null}
          </li>
        ))}
      </ul>
      {moves.length ? (
        <ol className="wb-fact-moves" aria-label="Latest moves">
          {moves.map((m) => (
            <li key={m.id}>
              <time dateTime={new Date(m.createdAt).toISOString()}>{clock(m.createdAt)}</time>
              <span className="wb-ell">{titleOf(m.itemId)}</span>
              <span className="wb-fact-to">to {stationName(m.to)}, by {nameOf(m.moverId)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Failed runs, folded under Waiting: each card keeps its two exits, Retry and Drop. */
export function FailedRuns({ cards, renderCard, onRetry, onDrop, busy }: {
  cards: readonly WebWorkBoardCard[];
  renderCard: (card: WebWorkBoardCard) => ReactNode;
  onRetry: (card: WebWorkBoardCard) => void;
  onDrop: (card: WebWorkBoardCard) => void;
  busy: (card: WebWorkBoardCard) => boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!cards.length) return null;
  return (
    <div className={`wb-failed${open ? " open" : ""}`}>
      <button type="button" className="wb-failed-h" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon n={open ? "down" : "right"} s={12} />
        Failed runs <span className="n">{cards.length}</span>
      </button>
      {open ? cards.map((card) => (
        <div key={card.item.id} className="wb-failed-card">
          {renderCard(card)}
          <div className="wb-failed-acts">
            <button type="button" className="wb-btn sm" disabled={busy(card)} onClick={() => onRetry(card)}><Icon n="refresh" s={12} />Retry</button>
            <button type="button" className="wb-btn ghost sm" disabled={busy(card)} onClick={() => onDrop(card)}>Drop</button>
          </div>
        </div>
      )) : null}
    </div>
  );
}
