import { Minimize2 } from "lucide-react";
import { BoardDetailLayout } from "./BoardDetailLayout.tsx";
import type { Route } from "../../../lib/types.ts";
import { WorkDetailScreen, type WorkPanelPart } from "../WorkDetailScreen.tsx";
import { clampWidth, paneMax, readWidth, writeWidth, DEFAULT_WIDTH, MIN_WIDTH } from "./pane-width.ts";
/**
 * The board's detail panel: one card's owner, next move and lifecycle, every
 * station it could move to with the runtime's verdict, the review waiting on
 * it, and the moves that brought it here.
 */
import { useEffect, useMemo, useState, useRef } from "react";
import { timeAgo, timeAgoWithSuffix } from "../../../lib/time.ts";
import type { WebWorkBoardCard, WebWorkMove, WebWorkMoveDecision, WebWorkStation } from "../../../../shared/api/web.ts";
import { previewWorkMove } from "../use-work-board.ts";
import { isWorking, lifecyclePath, OPERATOR_ID, PRIORITY_LABEL, priorityRank, refusalIsAsk, unreachable, verdictNote } from "./board-model.ts";
import { Icon, Prio, VerdictPill, Who } from "./parts.tsx";

const REVIEW_LABEL: Record<string, string> = { confirmed: "Confirmed", reopened: "Reopened", consulted: "Asked a person", stale: "Review went stale", pending: "Review pending" };

export function BoardDetail({ card, stations, moves, you, nameOf, onMove, onReview, onClose, onOpenFull, onCollapse, onOpenSession, full, navigate }: {
  full: boolean;
  navigate: (route: Route) => void;
  card: WebWorkBoardCard;
  stations: readonly WebWorkStation[];
  moves: readonly WebWorkMove[];
  you: string | null;
  nameOf: (id: string) => string;
  onMove: (to: string, decision: WebWorkMoveDecision | null) => void;
  onReview: (move: WebWorkMove, verdict: "confirm" | "reopen" | "consult", note?: string) => void;
  onClose: () => void;
  onOpenFull: () => void;
  onCollapse: () => void;
  /** Opens the live flight's session in the session view. */
  onOpenSession?: () => void;
}) {
  const pane = useRef<HTMLElement>(null);
  const [boardWidth, setBoardWidth] = useState(1000);
  const [width, setWidth] = useState(() => readWidth());
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const parent = pane.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(() => setBoardWidth(parent.getBoundingClientRect().width));
    setBoardWidth(parent.getBoundingClientRect().width);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);
  const shown = clampWidth(width, boardWidth);
  const resize = (value: number) => { const next = clampWidth(value, boardWidth); setWidth(next); writeWidth(next); };
  const { item } = card;
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  const here = byId.get(card.station);
  const path = lifecyclePath(stations);
  const at = path.findIndex((s) => s.id === card.station);
  const [verdicts, setVerdicts] = useState<Record<string, WebWorkMoveDecision | null>>({});
  const [note, setNote] = useState("");

  // Ask the runtime what each reachable station would say; read again when the card moves.
  useEffect(() => {
    let live = true;
    setVerdicts({});
    for (const to of card.next) {
      void previewWorkMove(item.id, to).then((d) => { if (live) setVerdicts((v) => ({ ...v, [to]: d })); });
    }
    return () => { live = false; };
  }, [item.id, card.revision, card.station, card.next.join(",")]);

  const ledger = moves.filter((m) => m.itemId === item.id);
  const review = ledger.find((m) => m.review === "pending" || m.review === "consulted");
  const entered = ledger.find((m) => m.to === card.station);
  const who = (id: string) => (id === OPERATOR_ID ? "You" : nameOf(id));

  const heading = (
    <div className="head">
      <h3>{item.title}</h3>
      {item.summary ? <p>{item.summary}</p> : <p className="wb-faint">No summary yet. The owner writes one as the work moves.</p>}
    </div>
  );
  const facts = (
    <dl className="wb-props">
      {isWorking(card) ? (
        <>
          <dt>Now</dt>
          <dd className="wb-now" title={item.lastMeaningfulSummary || undefined}>
            <span className="wb-dot" />
            <span className="wb-ell">{item.lastMeaningfulSummary || `${item.ownerName ?? "The owner"} is working`}</span>
          </dd>
        </>
      ) : null}
      {full && <><dt>Station</dt><dd>{here?.name ?? card.station}</dd></>}
      <dt>Owner</dt><dd><Who id={item.ownerId} name={item.ownerName} you={you} /></dd>
      <dt>Next move</dt><dd><Who id={item.nextMoveOwnerId} name={item.nextMoveOwnerName} you={you} /></dd>
      <dt>Priority</dt><dd>{priorityRank(item.priority) > 0 ? <Prio priority={item.priority} /> : null}{PRIORITY_LABEL[priorityRank(item.priority)]}</dd>
      {item.currentPhase ? <><dt>Phase</dt><dd>{item.currentPhase}</dd></> : null}
      {item.parentTitle ? <><dt>Part of</dt><dd className="wb-ell">{item.parentTitle}</dd></> : null}
      {item.activeChildWorkCount > 0 ? <><dt>Sub-items</dt><dd>{item.activeChildWorkCount} open</dd></> : null}
      <dt>In station</dt><dd>{timeAgo(entered?.createdAt ?? item.updatedAt)}</dd>
      <dt>Created</dt><dd>{timeAgoWithSuffix(item.createdAt)}</dd>
    </dl>
  );
  const lifecycle = (
    <div className="wb-dsec">
      <h4>Lifecycle</h4>
      <div className="wb-path">
        {path.map((s, i) => (
          <span key={s.id} className="step">
            {i > 0 ? <Icon n="right" s={11} /> : null}
            <span className={s.id === card.station ? "now" : at >= 0 && i < at ? "past" : ""}>{s.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
  const reviewContent = (
    review ? (
      <div className="wb-dsec">
        <h4>Review</h4>
        <div className="wb-review">
          <p>{byId.get(review.from)?.name ?? review.from} to {byId.get(review.to)?.name ?? review.to}, moved by {who(review.moverId)} {timeAgoWithSuffix(review.createdAt)}.</p>
          {(byId.get(review.to)?.judges ?? []).map((j) => <p key={j.id} className="criterion"><Icon n="eye" s={12} />{j.criterion}</p>)}
          {review.review === "consulted" ? <p className="wb-amber-text">Asked a person{review.reviewNote ? `: ${review.reviewNote}` : "."}</p> : null}
          <input className="wb-input" placeholder="Note for the record" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Review note" />
          <div className="acts">
            <button type="button" className="wb-btn primary" onClick={() => onReview(review, "confirm", note.trim() || undefined)}><Icon n="check" s={13} />Confirm</button>
            <button type="button" className="wb-btn" onClick={() => onReview(review, "reopen", note.trim() || undefined)}>Reopen</button>
            {review.review !== "consulted" ? <button type="button" className="wb-btn ghost" onClick={() => onReview(review, "consult", note.trim() || undefined)}>Consult</button> : null}
          </div>
        </div>
      </div>
    ) : null
  );
  const moveTo = (
    <div className="wb-dsec">
      <h4>Move to</h4>
      <div className="wb-next">
        {stations.filter((s) => s.id !== card.station).map((s) => {
          const reachable = card.next.includes(s.id);
          const d = reachable ? verdicts[s.id] : unreachable(here, s);
          const note = d ? verdictNote(d) : "";
          const blocked = !reachable;
          return (
            <button key={s.id} type="button" disabled={blocked} onClick={() => onMove(s.id, d ?? null)}>
              <b>{s.name}</b>
              <span>{d === undefined ? "Checking…" : d === null ? "Couldn't check." : note === "Moves now." ? s.purpose ?? "" : note}</span>
              {!reachable || !d ? null
                : d.verdict === "deny" && refusalIsAsk(d) ? <span className="wb-pill line"><Icon n="ask" s={12} />Asks first</span>
                : <VerdictPill verdict={d.verdict} />}
            </button>
          );
        })}
      </div>
    </div>
  );
  const moveHistory = (
    <div className="wb-dsec">
      <h4>Moves</h4>
      {ledger.length ? (
        <ul className="wb-ledger">
          {ledger.map((m) => (
            <li key={m.id}>
              <span className="who">{who(m.moverId)}</span>
              <div>
                <div>moved it from {byId.get(m.from)?.name ?? m.from} to {byId.get(m.to)?.name ?? m.to}</div>
                {m.verdict !== "allow" || REVIEW_LABEL[m.review] ? (
                  <small>
                    {m.verdict !== "allow" ? `${m.verdict === "hold" ? "Held" : m.verdict === "consult" ? "Asked a person" : "Refused"}. ` : ""}
                    {REVIEW_LABEL[m.review] ?? ""}{m.reviewNote ? `: ${m.reviewNote}` : ""}
                  </small>
                ) : null}
                {m.note ? <small>{m.note}</small> : null}
              </div>
              <small>{timeAgo(m.createdAt)}</small>
            </li>
          ))}
        </ul>
      ) : <p className="wb-faint">No moves on the board yet.</p>}
    </div>
  );
  const casefile = (
    ([
      ["What was asked", ["request"]],
      ["Sessions", ["sessions"]],
      ["Timeline", ["timeline"]],
      ["Log", ["tail"]],
      ["Files and artifacts", ["files"]],
    ] as [string, WorkPanelPart[]][]).map(([title, parts]) => (
      <details key={title} className="wb-case-section" open>
        <summary>{title}</summary>
        <WorkDetailScreen workId={item.id} navigate={navigate} panel={{ parts, own: false, keyScope: () => pane.current }} />
      </details>
    ))
  );

  return (
    <aside ref={pane} style={{ width: full ? "100%" : shown }} className={full ? "wb-drawer wb-drawer-full" : "wb-drawer"} aria-label={`${item.title}, details`}>
      {!full && <div className="wb-resize" role="separator" tabIndex={0} aria-label="Resize details pane"
        aria-orientation="vertical" aria-valuemin={Math.min(MIN_WIDTH, paneMax(boardWidth))}
        aria-valuemax={paneMax(boardWidth)} aria-valuenow={shown}
        onDoubleClick={() => resize(DEFAULT_WIDTH)}
        onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, width: shown }; }}
        onPointerMove={(e) => { if (drag.current) resize(drag.current.width + drag.current.x - e.clientX); }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 64 : 16;
          const next = e.key === "ArrowLeft" ? shown + step : e.key === "ArrowRight" ? shown - step
            : e.key === "Home" ? MIN_WIDTH : e.key === "End" ? paneMax(boardWidth) : e.key === "Enter" ? DEFAULT_WIDTH : null;
          if (next === null) return;
          e.preventDefault(); e.stopPropagation(); resize(next);
        }} />}
      <div className="dh">
        {!full && <span className="wb-pill line">{here?.name ?? card.station}</span>}
        <span className="sp" />
        {onOpenSession ? <button type="button" className="wb-btn ghost" onClick={onOpenSession}><Icon n="arrow" s={13} />Open session</button> : null}
        <button type="button" className="wb-btn ghost" onClick={full ? onCollapse : onOpenFull}>{full ? <Minimize2 size={13} aria-hidden /> : <Icon n="open" s={13} />}{full ? "Collapse" : "Open"}</button>
        <button type="button" className="wb-btn ghost icon" aria-label="Close" onClick={onClose}><Icon n="x" s={14} /></button>
      </div>
      <div className="db">
        <BoardDetailLayout full={full} heading={heading} facts={facts} lifecycle={lifecycle}
          review={reviewContent} casefile={casefile} moveTo={moveTo} moves={moveHistory} />
      </div>
    </aside>
  );
}
