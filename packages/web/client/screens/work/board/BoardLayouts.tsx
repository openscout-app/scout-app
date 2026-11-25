/**
 * The board's other two layouts over the same cards: swimlanes, one row per
 * owner across the stations, and a list grouped by station.
 */
import { useState, type DragEvent, type ReactNode } from "react";
import { timeAgo } from "../../../lib/time.ts";
import type { WebWorkBoardCard, WebWorkMoveDecision, WebWorkStation } from "../../../../shared/api/web.ts";
import { isWorking, isYourMove, laneFoldKey, lanesByOwner, OPERATOR_ID } from "./board-model.ts";
import { Av, Icon, Prio, VerdictPill, Who } from "./parts.tsx";

/** Cards a lane shows per station before it folds the rest behind "Show N more". */
const LANE_CAP = 6;

type DropProps = (to: string) => { onDragOver: (e: DragEvent) => void; onDragLeave: (e: DragEvent) => void; onDrop: (e: DragEvent) => void };

export function Lanes({ cards, stations, renderCard, dropProps, decisionFor, over, you, folded, onToggle }: {
  cards: readonly WebWorkBoardCard[];
  stations: readonly WebWorkStation[];
  renderCard: (card: WebWorkBoardCard) => ReactNode;
  dropProps: DropProps;
  decisionFor: (to: string) => WebWorkMoveDecision | "checking" | null;
  over: string | null;
  you: string | null;
  folded: ReadonlySet<string>;
  onToggle: (laneKey: string) => void;
}) {
  const lanes = lanesByOwner(cards);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const dragging = stations.some((s) => decisionFor(s.id) !== null);
  return (
    <div className={`wb-lanes${dragging ? " dragging" : ""}`}>
      <div className="wb-lane-heads">
        {stations.map((s) => {
          const d = decisionFor(s.id);
          return (
            <div key={s.id}>
              {s.name}<small>{cards.filter((c) => c.station === s.id).length}</small>
              {d && d !== "checking" ? <VerdictPill verdict={d.verdict} /> : null}
            </div>
          );
        })}
      </div>
      {lanes.map((lane) => {
        const shut = folded.has(laneFoldKey(lane.key));
        return (
        <div key={lane.key || "none"} className={`wb-lane${shut ? " shut" : ""}`}>
          <button type="button" className="wb-lane-h" aria-expanded={!shut} onClick={() => onToggle(laneFoldKey(lane.key))}>
            <Icon n={shut ? "right" : "down"} s={13} />
            {lane.key ? <Who id={lane.key} name={lane.key === OPERATOR_ID ? you : lane.name} you={you} /> : <span className="wb-who"><Av s={18} /><b>No owner</b></span>}
            <small>{lane.cards.length}</small>
          </button>
          {shut ? null : (
          <div className="wb-lane-row">
            {stations.map((s) => {
              const here = lane.cards.filter((c) => c.station === s.id);
              const key = `${lane.key}:${s.id}`;
              const shown = open.has(key) ? here : here.slice(0, LANE_CAP);
              const rest = here.length - shown.length;
              return (
                <div key={s.id} className={`wb-lane-cell${here.length ? "" : " empty"}${over === s.id ? " over" : ""}`} {...dropProps(s.id)}>
                  {shown.map(renderCard)}
                  {rest > 0 ? <button type="button" className="wb-col-add" onClick={() => setOpen((o) => new Set(o).add(key))}>Show {rest} more</button> : null}
                </div>
              );
            })}
          </div>
          )}
        </div>
        );
      })}
    </div>
  );
}

export function ListLayout({ cards, stations, selected, onPick, you, folded, onToggle }: {
  cards: readonly WebWorkBoardCard[];
  stations: readonly WebWorkStation[];
  selected: string | null;
  onPick: (id: string) => void;
  you: string | null;
  folded: ReadonlySet<string>;
  onToggle: (stationId: string) => void;
}) {
  return (
    <div className="wb-listwrap">
      <table className="wb-table">
        <thead>
          <tr><th>Title</th><th>Owner</th><th>Next move</th><th>Priority</th><th className="r">Updated</th></tr>
        </thead>
        <tbody>
          {stations.map((s) => {
            const rows = cards.filter((c) => c.station === s.id);
            if (!rows.length) return null;
            const shut = folded.has(s.id);
            return [
              <tr key={s.id} className="grp">
                <td colSpan={5}>
                  <button type="button" aria-expanded={!shut} onClick={() => onToggle(s.id)}>
                    <Icon n={shut ? "right" : "down"} s={12} />{s.name}<small>{rows.length}</small>
                  </button>
                </td>
              </tr>,
              ...(shut ? [] : rows).map((c) => (
                <tr
                  key={c.item.id} className={c.item.id === selected ? "on" : undefined} tabIndex={0}
                  onClick={() => onPick(c.item.id)} onKeyDown={(e) => { if (e.key === "Enter") onPick(c.item.id); }}
                >
                  <td className="t">
                    <span className="wb-ell">{c.item.title}</span>
                    {isWorking(c) ? <span className="wb-pill line sm wb-working"><span className="wb-dot" />Working</span> : null}
                    {c.reviewPending ? <span className="wb-pill line sm"><Icon n="eye" s={11} />Review</span> : null}
                  </td>
                  <td><Who id={c.item.ownerId} name={c.item.ownerName} you={you} /></td>
                  <td>
                    {isYourMove(c, s)
                      ? <span className="yours"><Icon n="hand" s={12} />You</span>
                      : c.item.nextMoveOwnerId ? <Av id={c.item.nextMoveOwnerId} name={c.item.nextMoveOwnerId === OPERATOR_ID ? you : c.item.nextMoveOwnerName} s={18} /> : null}
                  </td>
                  <td><Prio priority={c.item.priority} /></td>
                  <td className="r wb-faint">{timeAgo(c.item.lastMeaningfulAt)}</td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
