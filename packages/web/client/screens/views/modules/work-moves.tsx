/**
 * Moves — the board's ledger: every move the runtime recorded, newest first,
 * with the moves still waiting for review on top.
 *
 * Shows:  for a pending review, the item, the move, the station's review
 *         criteria and Confirm, Reopen and Consult. Below, each recorded move:
 *         from and to, who moved it, the runtime's verdict when it was not
 *         allowed, the review outcome, when.
 * Scope:  none; every move the runtime recorded.
 * Data:   GET /api/work/moves with the board (use-work-board.ts);
 *         POST /api/work/:id/review.
 * Opens:  the work item (/work/:id).
 */
import { useMemo, useState } from "react";
import { timeAgo } from "../../../lib/time.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { reviewWorkMove, useWorkBoard } from "../../work/use-work-board.ts";
import type { WebWorkMove } from "../../../../shared/api/web.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { Quiet } from "./shared.tsx";
import { workRoute } from "./work-view-model.ts";
import "./work-board.css";

const VERDICT_LABEL: Record<string, string> = { hold: "Held", deny: "Denied", consult: "Needs a decision" };
const REVIEW_LABEL: Record<string, string> = { confirmed: "Confirmed", reopened: "Reopened", consulted: "Asked a person", stale: "Stale review" };

function WorkMoves({ navigate }: ModuleProps) {
  const { board, moves, error } = useWorkBoard();
  const { agents } = useScout();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const names = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
  const stations = useMemo(() => new Map((board?.lifecycle.stations ?? []).map((s) => [s.id, s])), [board]);
  const titles = useMemo(() => new Map((board?.cards ?? []).map((c) => [c.item.id, c.item.title])), [board]);
  const station = (id: string) => stations.get(id)?.name ?? id;
  const who = (id: string) => (id === "operator" ? "You" : names.get(id) ?? id);

  if (!board) return <Quiet>{error ? "Couldn't read moves." : "Reading moves…"}</Quiet>;
  const waiting = moves.filter((m) => m.review === "pending" || m.review === "consulted");
  const rest = moves.filter((m) => !waiting.includes(m));
  if (!moves.length) return <Quiet>No moves yet. Moves on the board land here.</Quiet>;

  const review = (move: WebWorkMove, verdict: "confirm" | "reopen" | "consult") => void reviewWorkMove(move, verdict, notes[move.id]?.trim() || undefined);

  return (
    <>
      <ModuleHead>
        <span className="hud-grid-count" title={`${moves.length} moves`}>{moves.length}</span>
      </ModuleHead>
      <div className="vw-moves">
        {waiting.length ? <div className="vw-work-sub">Review</div> : null}
        {waiting.map((move) => (
          <article key={move.id} className="vw-moves-review">
            <button type="button" className="vw-moves-title" onClick={() => navigate(workRoute(move.itemId))}>{titles.get(move.itemId) ?? move.itemId}</button>
            <p className="vw-moves-line">{station(move.from)} to {station(move.to)}, by {who(move.moverId)}, {timeAgo(move.createdAt)}</p>
            {(stations.get(move.to)?.judges ?? []).map((j) => <p key={j.id} className="vw-moves-criterion">{j.criterion}</p>)}
            {move.review === "consulted" ? <p className="vw-moves-line">Asked a person{move.reviewNote ? `: ${move.reviewNote}` : "."}</p> : null}
            <input
              className="vw-moves-note"
              placeholder="Note"
              value={notes[move.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [move.id]: e.target.value }))}
              aria-label="Review note"
            />
            <div className="vw-board-actions">
              <button type="button" className="vw-board-step" onClick={() => review(move, "confirm")}>Confirm</button>
              <button type="button" className="vw-board-step" onClick={() => review(move, "reopen")}>Reopen</button>
              {move.review !== "consulted" ? <button type="button" className="vw-board-step vw-board-step--open" onClick={() => review(move, "consult")}>Consult</button> : null}
            </div>
          </article>
        ))}
        {rest.length ? <div className="vw-work-sub">Recent</div> : null}
        <ul className="vw-rows">
          {rest.map((move) => (
            <li key={move.id}>
              <button type="button" className="vw-row vw-row--move" onClick={() => navigate(workRoute(move.itemId))}>
                <span className="vw-strong vw-ell">{titles.get(move.itemId) ?? move.itemId}</span>
                <span className="vw-dim vw-num">{timeAgo(move.createdAt)}</span>
                <span className="vw-dim vw-ell vw-moves-detail">
                  {station(move.from)} to {station(move.to)}
                  {move.verdict !== "allow" ? <span className="vw-kind vw-moves-verdict">{VERDICT_LABEL[move.verdict]}</span> : null}
                  {REVIEW_LABEL[move.review] ? <span className="vw-kind vw-moves-review-mark">{REVIEW_LABEL[move.review]}</span> : null}
                  <span className="vw-moves-who">{who(move.moverId)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export const workMovesModule = defineModule({
  type: "work-moves",
  title: "Moves",
  blurb: "The board's ledger: recorded moves, reviews on top",
  docs: {
    shows: "Moves waiting for review with the station's criteria and Confirm, Reopen, Consult; then each recorded move with its verdict and review outcome.",
    data: "GET /api/work/moves with the board; POST /api/work/:id/review.",
    opens: "The work item (/work/:id).",
  },
  size: { w: 4, h: 24 },
  minSize: { w: 3, h: 10 },
  Component: WorkMoves,
});
