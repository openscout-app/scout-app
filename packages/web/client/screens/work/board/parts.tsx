/**
 * The work board's pieces: icons, avatars, priority, verdicts, a card and a
 * column. They draw what they are given; the board decides what that is.
 */
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { HarnessCoin } from "../../../components/HarnessCoin.tsx";
import { timeAgo } from "../../../lib/time.ts";
import { sessionOwnerLabel } from "../../views/modules/work-view-model.ts";
import type { WebWorkBoardCard, WebWorkMoveDecision, WebWorkMoveResponse, WebWorkMoveVerdict, WebWorkStation } from "../../../../shared/api/web.ts";
import {
  answerBand, initials, isSettled, isYourMove, OPERATOR_ID, PRIORITY_LABEL, priorityRank, sessionPhase, tintOf, VERDICT_LABEL, verdictNote,
  type BoardLayout, type CardProp, type ColumnDefinition,
} from "./board-model.ts";

/* ---------------- Icons ---------------- */

const PATHS: Record<string, ReactNode> = {
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></>,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  display: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  down: <path d="m7 10 5 5 5-5" />,
  right: <path d="m10 7 5 5-5 5" />,
  fold: <><path d="M5 5v14" /><path d="M19 12H9m4-4-4 4 4 4" /></>,
  x: <path d="M7 7l10 10M17 7 7 17" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 2" /></>,
  pause: <><circle cx="12" cy="12" r="8" /><path d="M10 9.5v5M14 9.5v5" /></>,
  ask: <path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  deny: <><circle cx="12" cy="12" r="8" /><path d="M6.5 6.5l11 11" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  eye: <><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" /><circle cx="12" cy="12" r="2.5" /></>,
  sub: <><rect x="4" y="4.5" width="5" height="5" rx="1.2" /><path d="M5.5 7l1 1 1.5-1.5" /><rect x="4" y="14.5" width="5" height="5" rx="1.2" /><path d="M12 7h8M12 17h8" /></>,
  board: <><rect x="3.5" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="16.5" y="4" width="4" height="13" rx="1.5" /></>,
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  lanes: <><rect x="3.5" y="4" width="17" height="7" rx="1.5" /><rect x="3.5" y="13" width="17" height="7" rx="1.5" /></>,
  user: <><circle cx="12" cy="8.5" r="3.5" /><path d="M5 19.5c1.4-3.4 4-5 7-5s5.6 1.6 7 5" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  offline: <><path d="M4 4l16 16" /><path d="M8.6 16.2a5 5 0 0 1 5.8-.6M5.3 12.6a9.5 9.5 0 0 1 3.4-2.1M18.8 12.7a9.6 9.6 0 0 0-2.6-1.8M12 19.5h.01" /></>,
  layers: <><path d="m12 4 8 4-8 4-8-4z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></>,
  hand: <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V5a1.5 1.5 0 0 1 3 0v6m0-4.5a1.5 1.5 0 0 1 3 0V13c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L4 13.5a1.5 1.5 0 0 1 2.5-1.6L8 13.5" />,
  open: <path d="M14 5h5v5M19 5l-8 8M10 6H6.5A1.5 1.5 0 0 0 5 7.5v10A1.5 1.5 0 0 0 6.5 19h10a1.5 1.5 0 0 0 1.5-1.5V14" />,
  alert: <><path d="M12 4.5 20.5 19h-17z" /><path d="M12 10v4M12 16.5h.01" /></>,
};

export function Icon({ n, s = 14, style }: { n: string; s?: number; style?: CSSProperties }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      {PATHS[n] ?? null}
    </svg>
  );
}

export const VERDICT_ICON: Record<WebWorkMoveVerdict, string> = { allow: "arrow", hold: "clock", consult: "ask", deny: "deny" };

/* ---------------- Avatars and marks ---------------- */

/** The harness each agent runs on, by agent id. The board fills it from the roster. */
export const BoardHarnesses = createContext<ReadonlyMap<string, string>>(new Map());

/** An agent's name as the board shows it: a generated session name reads as its harness. */
function useAgentName(): (id: string | null | undefined, name: string | null | undefined) => string {
  const harnesses = useContext(BoardHarnesses);
  return (id, name) => sessionOwnerLabel(name ?? id ?? "", id ? harnesses.get(id) : null);
}

/** An owner's mark: the agent's harness mark, a circle for the operator, dashed when nobody owns it. */
export function Av({ id, name, s = 20, live }: { id?: string | null; name?: string | null; s?: number; live?: boolean }) {
  const harnesses = useContext(BoardHarnesses);
  const style = { "--s": `${s}px` } as CSSProperties;
  if (!id) return <span className="wb-av empty" style={style} title="No owner"><Icon n="user" s={Math.round(s * 0.6)} /></span>;
  if (id !== OPERATOR_ID) {
    // An agent wears its harness mark or nothing; initials would be a made-up face.
    const harness = harnesses.get(id);
    return harness ? <HarnessCoin harness={harness} size={s} className="wb-av-coin" /> : null;
  }
  return (
    <span className={`wb-av t${tintOf(id)}`} style={style} title="You">
      {initials(name || "You") || "?"}
      {live ? <i className="live" /> : null}
    </span>
  );
}

export function Who({ id, name, s = 18, you }: { id?: string | null; name?: string | null; s?: number; you?: string | null }) {
  const agentName = useAgentName();
  if (!id) return <span className="wb-who"><Av s={s} /><span className="wb-faint">Nobody</span></span>;
  const person = id === OPERATOR_ID;
  return (
    <span className="wb-who">
      <Av id={id} name={person ? you : name} s={s} />
      <b>{person ? (you ? `${you} (you)` : "You") : agentName(id, name)}</b>
    </span>
  );
}

export function Prio({ priority }: { priority: string | null }) {
  const p = priorityRank(priority);
  if (p === 4) return <span className="wb-prio urgent" title="Urgent">!</span>;
  return (
    <span className="wb-prio" title={PRIORITY_LABEL[p]}>
      <i className={p >= 1 ? "on" : ""} /><i className={p >= 2 ? "on" : ""} /><i className={p >= 3 ? "on" : ""} />
    </span>
  );
}

export function VerdictPill({ verdict }: { verdict: WebWorkMoveVerdict }) {
  const cls: Record<WebWorkMoveVerdict, string> = { allow: "accent", hold: "line", consult: "amber", deny: "ink" };
  return <span className={`wb-pill ${cls[verdict]}`}><Icon n={VERDICT_ICON[verdict]} s={12} />{VERDICT_LABEL[verdict]}</span>;
}

/* ---------------- Card ---------------- */

export type CardFlags = { selected?: boolean; ghost?: boolean; compact?: boolean; pending?: boolean };

/**
 * The agent running a card's session: its harness coin in the card's corner, with a thin arc turning around it while
 * the session is live. The card's latest line is the coin's tooltip; a click opens the session.
 */
export function LiveCoin({ harness, name, line, onOpen }: { harness: string; name: string | null; line: string | null; onOpen?: () => void }) {
  const label = [name, line].filter(Boolean).join(": ") || "A session is working on it";
  const face = (
    <>
      <svg className="orbit" viewBox="0 0 28 28" aria-hidden><circle cx="14" cy="14" r="13" /></svg>
      <HarnessCoin harness={harness} size={20} />
    </>
  );
  if (!onOpen) return <span className="wb-live-coin" title={label} aria-label={label} role="img">{face}</span>;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <button
      type="button" className="wb-live-coin" title={`${label}\nOpen session`} aria-label={`Open session. ${label}`}
      draggable={false} onMouseDown={stop} onKeyDown={stop} onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); onOpen(); }}
    >
      {face}
    </button>
  );
}

export function CardView({ card, station, props, flags = {}, answer, you, liveHarness, onOpen, onOpenSession, onDragStart, onDragEnd }: {
  card: WebWorkBoardCard;
  /** The owner's harness, when the flight's session trace does not name one. The working card wears its coin. */
  liveHarness?: string | null;
  /** Opens the live flight's session. */
  onOpenSession?: () => void;
  station: WebWorkStation | undefined;
  props: readonly CardProp[];
  flags?: CardFlags;
  answer?: WebWorkMoveResponse;
  you?: string | null;
  onOpen: () => void;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: () => void;
}) {
  const { item } = card;
  const agentName = useAgentName();
  const has = (p: CardProp) => props.includes(p);
  const settled = isSettled(station);
  const session = sessionPhase(item);
  const live = session === "working";
  const coinHarness = item.liveFlight?.harness ?? liveHarness;
  const yourMove = isYourMove(card, station) && !card.reviewPending;
  const band = answerBand(answer);
  const shownPhase = session === "stale"
    ? `Stale, quiet ${timeAgo(item.liveFlight?.lastActivityAt ?? item.lastMeaningfulAt)}`
    : item.currentPhase;
  const phase = shownPhase && station && shownPhase.toLowerCase() !== station.name.toLowerCase() && !settled ? shownPhase : null;
  const cls = [
    "wb-card", live && coinHarness && "has-coin", flags.selected && "selected", flags.ghost && "ghost", flags.compact && "compact", flags.pending && "pending",
    station?.state === "done" && "done", station?.state === "cancelled" && "dropped",
  ].filter(Boolean).join(" ");
  const onKey = (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } };
  // Most work is normal priority; the mark shows only when it says something.
  const rank = priorityRank(item.priority);
  const showPrio = has("priority") && rank > 0 && rank !== 2;
  const showMeta = has("owner") || has("age") || showPrio || (!flags.compact && item.activeChildWorkCount > 0);
  const status = has("status") && (phase || card.reviewPending || yourMove);

  return (
    <div
      className={cls} role="button" tabIndex={0} aria-pressed={flags.selected || undefined}
      draggable={Boolean(onDragStart)} onDragStart={onDragStart} onDragEnd={onDragEnd} onClick={onOpen} onKeyDown={onKey}
    >
      {live && coinHarness ? <LiveCoin harness={coinHarness} name={item.ownerName == null ? null : agentName(item.ownerId, item.ownerName)} line={item.lastMeaningfulSummary} onOpen={onOpenSession} /> : null}
      <div className="title">{item.title}</div>

      {showMeta ? (
        <div className="meta">
          {has("owner") ? <Av id={item.ownerId} name={item.ownerId === OPERATOR_ID ? you : item.ownerName} s={18} /> : null}
          {has("owner") && !flags.compact ? (
            <span className="wb-meta wb-ell">{item.ownerId === OPERATOR_ID ? "You" : item.ownerId || item.ownerName ? agentName(item.ownerId, item.ownerName) : "No owner"}</span>
          ) : null}
          {!flags.compact && item.activeChildWorkCount > 0 ? <span className="wb-meta" title="Open sub-items"><Icon n="sub" s={12} />{item.activeChildWorkCount} open</span> : null}
          <span className="sp" />
          {showPrio ? <Prio priority={item.priority} /> : null}
          {has("age") ? <span className="wb-meta">{timeAgo(item.lastMeaningfulAt)}</span> : null}
        </div>
      ) : null}

      {status ? (
        <div className="status">
          {phase ? <span className="muted"><Icon n="alert" s={13} />{phase}</span> : null}
          {card.reviewPending ? <span className="muted"><Icon n="eye" s={13} />Review pending</span> : null}
          {yourMove ? <span className="yours"><Icon n="hand" s={13} />Your move</span> : null}
        </div>
      ) : null}

      {has("status") && live ? (
        <div className="foot" title={item.lastMeaningfulSummary || undefined}>
          <span className="wb-dot" />
          <span>{item.lastMeaningfulSummary || "Working"}</span>
        </div>
      ) : null}

      {band ? (
        <div className={`band ${band.kind}`}>
          <Icon n={VERDICT_ICON[band.kind]} s={13} />
          <span><b>{band.kind === "hold" ? "Holds." : band.kind === "consult" ? "Asks a person." : "Refused."}</b> {band.text}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Column ---------------- */

export type OverState = WebWorkMoveVerdict | null;

/** The rule a column names under its purpose: the first enforced rule, or what a reviewer checks. */
function columnRule(station: WebWorkStation): { icon: string; text: string } | null {
  const rule = station.rules.find((r) => !r.shadow && r.effect !== "advise");
  if (rule) return { icon: rule.effect === "deny" ? "deny" : rule.effect === "consult" ? "ask" : "clock", text: rule.message };
  const judge = station.judges[0];
  return judge ? { icon: "eye", text: judge.criterion } : null;
}

/** A column's placement rule, laid out field by field. */
function DefinitionView({ definition }: { definition: ColumnDefinition }) {
  const list = (title: string, items: readonly string[], ordered = false) => items.length ? (
    <div className="part">
      <h4>{title}</h4>
      {ordered ? <ol>{items.map((t) => <li key={t}><Code text={t} /></li>)}</ol> : <ul>{items.map((t) => <li key={t}><Code text={t} /></li>)}</ul>}
    </div>
  ) : null;
  return (
    <>
      <p className="lead"><Code text={definition.rule} /></p>
      {list("Reads", definition.reads)}
      {list("Qualifies", definition.qualifies)}
      {list("Does not qualify", definition.excluded)}
      {definition.liveness ? <div className="part"><h4>Liveness</h4><p><Code text={definition.liveness} /></p></div> : null}
      {list("Precedence", definition.precedence, true)}
    </>
  );
}

/** Text with `backticked` spans set as code. */
function Code({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`)/).map((part, i) => part.startsWith("`") && part.endsWith("`") && part.length > 1 ? <code key={i}>{part.slice(1, -1)}</code> : part)}</>;
}

/** A column's name, which opens the rule that places cards in the column, in the board's popover. */
function ColumnName({ station, definition }: { station: WebWorkStation; definition?: ColumnDefinition }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!definition) return <span className="name" title={station.purpose || undefined}>{station.name}</span>;
  return (
    <span className="wb-col-def" ref={box}>
      <button type="button" className="name" aria-expanded={open} onClick={() => setOpen(!open)}>{station.name}</button>
      {open ? <div className="wb-pop def" role="dialog" aria-label={`What ${station.name} means`}><DefinitionView definition={definition} /></div> : null}
    </span>
  );
}

export function ColumnView({ station, count, children, over = null, decision, compact, definition, onDragOver, onDragLeave, onDrop, footer, onCollapse }: {
  station: WebWorkStation;
  /** The rule that places cards here, shown when the column's name is clicked. */
  definition?: ColumnDefinition;
  count: number;
  children?: ReactNode;
  over?: OverState;
  decision?: WebWorkMoveDecision | "checking" | null;
  compact?: boolean;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  footer?: ReactNode;
  onCollapse?: () => void;
}) {
  const rule = columnRule(station);
  return (
    <section
      className={`wb-col${compact ? " compact" : ""}${over ? ` over-${over}` : ""}`}
      aria-label={station.name} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    >
      <div className="wb-col-h">
        <div className="row">
          <ColumnName station={station} definition={definition} />
          <span className="n">{count}</span>
          {onCollapse ? (
            <button type="button" className="wb-fold" aria-label={`Collapse ${station.name}`} title={`Collapse ${station.name}`} onClick={onCollapse}>
              <Icon n="fold" s={13} />
            </button>
          ) : null}
        </div>
        {!compact && rule && !decision ? <div className="rule"><Icon n={rule.icon} s={12} /><span>{rule.text}</span></div> : null}
        {decision === "checking" ? (
          <div className="verdict checking"><Icon n="clock" s={13} /><span>Checking…</span></div>
        ) : decision ? (
          <div className={`verdict v-${decision.verdict}`}>
            <Icon n={VERDICT_ICON[decision.verdict]} s={13} />
            <span><b>{VERDICT_LABEL[decision.verdict]}.</b> {verdictNote(decision) === "Moves now." ? "" : verdictNote(decision)}</span>
          </div>
        ) : null}
      </div>
      <div className="wb-col-body">
        {children}
        {count === 0 ? <div className="wb-col-empty">Nothing here</div> : null}
        {footer}
      </div>
    </section>
  );
}

export function CollapsedColumn({ station, count, over, onOpen, onDragOver, onDragLeave, onDrop }: {
  station: WebWorkStation; count: number; over?: OverState; onOpen: () => void;
  onDragOver?: (e: DragEvent) => void; onDragLeave?: (e: DragEvent) => void; onDrop?: (e: DragEvent) => void;
}) {
  return (
    <button
      type="button" className={`wb-col collapsed${over ? ` over-${over}` : ""}`} title={`Show ${station.name}`} aria-label={`Show ${station.name}, ${count}`}
      onClick={onOpen} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
    >
      <Icon n="right" s={13} />
      <span className="n">{count}</span>
      <span className="vname">{station.name}</span>
    </button>
  );
}

/* ---------------- Toolbar pieces ---------------- */

export function LayoutSwitch({ value, onChange }: { value: BoardLayout; onChange: (l: BoardLayout) => void }) {
  const items: [BoardLayout, string, string][] = [["board", "board", "Columns"], ["lanes", "lanes", "Swimlanes"], ["list", "list", "List"]];
  return (
    <div className="wb-seg" role="group" aria-label="Layout">
      {items.map(([id, icon, label]) => (
        <button key={id} type="button" className={value === id ? "on" : ""} aria-pressed={value === id} onClick={() => onChange(id)}>
          <Icon n={icon} s={13} />{label}
        </button>
      ))}
    </div>
  );
}

export function FilterChip({ dim, op, val, icon, onRemove }: { dim: string; op: string; val: string; icon?: string; onRemove: () => void }) {
  return (
    <span className="wb-fchip">
      <span>{icon ? <Icon n={icon} s={12} /> : null}{dim}</span>
      <span className="op">{op}</span>
      <span className="val">{val}</span>
      <button type="button" aria-label={`Remove the ${dim} filter`} onClick={onRemove}><Icon n="x" s={11} /></button>
    </span>
  );
}

export function SkeletonCard() {
  return (
    <div className="wb-card skel" aria-hidden>
      <div className="wb-skel" style={{ width: "34%", height: 10 }} />
      <div className="wb-skel" style={{ width: "88%", height: 12 }} />
      <div className="wb-skel" style={{ width: "60%", height: 12 }} />
    </div>
  );
}

export function EmptyState({ icon, title, children, actions }: { icon: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="wb-empty">
      <div className="ic"><Icon n={icon} s={20} /></div>
      <h4>{title}</h4>
      <p>{children}</p>
      {actions ? <div className="acts">{actions}</div> : null}
    </div>
  );
}
