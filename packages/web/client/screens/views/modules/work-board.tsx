import { boardSelection, updateBoardSelection, type BoardSelection, type BoardSelectionAction } from "../../work/board/board-selection-state.ts";
/**
 * Work board — the work lifecycle as columns, work items as cards.
 *
 * Shows:  one column per station of the lifecycle (its name, purpose and the
 *         first rule a move into it must pass), the cards placed there, and
 *         on each card its owner, priority, age, whether an agent is working
 *         on it, a review waiting on it, and whether the next move is yours.
 *         Views narrow the board to your moves, live work or the review
 *         queue; the same cards also lay out as swimlanes by owner or a list.
 * Moves:  drag a card onto a column, or open it and pick a station. While a
 *         card is held, every column shows the runtime's answer to a move
 *         there, asked as a dry run: moves, holds, asks a person, or refused,
 *         and why. The board never decides a move. A station whose rules ask
 *         for a reason or a blocker asks for it first.
 * Scope:  none; the board shows the default lifecycle, or the one picked in
 *         the panel head when the runtime has more than one. Layout, order,
 *         view and card properties stay with the panel.
 * Data:   GET /api/work/board and /api/work/moves on runtime work events and
 *         every 15s; POST /api/work/:id/move (dryRun while dragging);
 *         POST /api/work/:id/review.
 * Opens:  the work item (/work/:id).
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { NEW_TASK_ACTION_LABEL } from "../../../lib/new-chat-shortcut.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { openContent } from "../../../scout/slots/openContent.ts";
import {
  clearWorkAnswer, loadWorkBoard, moveWorkCard, pickWorkLifecycle, previewWorkMove, readWorkBoardState, reviewWorkMove, useWorkBoard,
} from "../../work/use-work-board.ts";
import { BoardDetail } from "../../work/board/BoardDetail.tsx";
import { BoardFacts, FailedRuns } from "../../work/board/BoardFacts.tsx";
import { boardFacts, isFailedRun, latestMoves } from "../../work/board/board-facts.ts";
import { api } from "../../../lib/api.ts";
import { Lanes, ListLayout } from "../../work/board/BoardLayouts.tsx";
import {
  ALL_PROPS, claimLifts, columnDefinition, defaultFolded, liveSessionRoute, isSettled, isWorking, isYourMove, laneFoldKey, lanesByOwner, OPERATOR_ID, ownerKey, ownerOptions, placeCards, PROP_LABEL,
  readDisplay, readFolded, refusalIsAsk, stationAsk, unreachable, verdictNote, VIEW_LABEL, visibleCards, writeFolded, writeProps,
  type BoardOrder, type BoardView, type CardProp,
} from "../../work/board/board-model.ts";
import { BoardHarnesses, CardView, CollapsedColumn, ColumnView, EmptyState, FilterChip, Icon, LayoutSwitch, SkeletonCard, Av } from "../../work/board/parts.tsx";
import { sessionOwnerLabel } from "./work-view-model.ts";
import type { WebWorkBoardCard, WebWorkMove, WebWorkMoveDecision, WebWorkMoveVerdict, WebWorkStation } from "../../../../shared/api/web.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";

import "../../work/board/board.css";

const DRAG_TYPE = "application/x-scout-work";
/** Cards a column draws before it offers the rest. */
const COLUMN_CAP = 40;
const VIEWS: readonly BoardView[] = ["all", "my-move", "working", "review"];
const ORDER_LABEL: Record<BoardOrder, string> = { manual: "Default", updated: "Updated", priority: "Priority" };

type Ask = { card: WebWorkBoardCard; to: WebWorkStation; kind: "note" | "waiting"; hint: string };
type Toast = { kind: WebWorkMoveVerdict | "error"; text: ReactNode; action?: { label: string; run: () => void } };
type Drag = { id: string; over: string | null };

/** The kind of answer a refusal asks for: the station's blocker or a note. */
function askKind(decision: WebWorkMoveDecision): Ask["kind"] {
  return decision.reasons.some((r) => r.outcome === "fail" && r.check === "has_waiting_on") ? "waiting" : "note";
}

function WorkBoard({ route, navigate, config, setConfig }: ModuleProps) {
  const { board, moves, error, readAt, answers, pending } = useWorkBoard();
  const { operatorName, agents, openContextCapture } = useScout();
  const display = readDisplay(config);
  const [owners, setOwners] = useState<string[]>([]);
  const [hideSettled, setHideSettled] = useState(false);
  const [query, setQuery] = useState("");
  const [pop, setPop] = useState<null | "filter" | "display">(null);
  const [localSelection, setLocalSelection] = useState<BoardSelection>({ item: null, full: false });
  const { item: selected, full } = boardSelection(route, localSelection);
  const changeSelection = (action: BoardSelectionAction) => {
    const next = updateBoardSelection(route, localSelection, action);
    if (next.route) navigate(next.route, { replace: action.type !== "expand" });
    else setLocalSelection((local) => updateBoardSelection(route, local, action).local);
  };
  const setSelected = (value: string | null | ((old: string | null) => string | null)) => changeSelection({ type: "select", value });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [verdicts, setVerdicts] = useState<Record<string, WebWorkMoveDecision | null>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askText, setAskText] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const dragToken = useRef(0);
  const barRef = useRef<HTMLDivElement>(null);

  const stations = board?.lifecycle.stations ?? [];
  const byId = useMemo(() => new Map(stations.map((s) => [s.id, s])), [stations]);
  // Each card in the column it stands in: Doing only while a live flight runs it (board-model.ts, placeStation).
  // Placement reads the clock (a quiet session goes stale), so it is redone each minute as well as on each read.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const cards = useMemo(() => (board ? placeCards(board.cards, board.lifecycle.stations, now) : []), [board, now]);
  const openSession = (card: WebWorkBoardCard) => {
    const target = liveSessionRoute(card.item);
    return target ? () => openContent(navigate, target, { returnTo: route }) : undefined;
  };
  // The harness of each agent, by either of its ids, for the coin a live card wears.
  const harnessOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) {
      if (!a.harness) continue;
      map.set(a.id, a.harness);
      if (a.definitionId) map.set(a.definitionId, a.harness);
    }
    return map;
  }, [agents]);
  const cardsById = useMemo(() => new Map(cards.map((c) => [c.item.id, c])), [cards]);
  const filters = { view: display.view, owners, hideSettled, query };
  const visible = useMemo(() => visibleCards(cards, byId, filters, display.order), [cards, byId, display.view, owners, hideSettled, query, display.order]);

  // Folded sections live in the panel config: stations (board columns and
  // list groups) under "fold", swimlanes under "lanefold".
  const foldBase = defaultFolded(stations);
  const folded = readFolded(config.fold, foldBase);
  const laneFolded = readFolded(config.lanefold, []);
  const toggleFold = (id: string) => {
    const next = new Set(folded);
    if (!next.delete(id)) next.add(id);
    setConfig({ fold: writeFolded(next, foldBase) });
  };
  const toggleLane = (key: string) => {
    const next = new Set(laneFolded);
    if (!next.delete(key)) next.add(key);
    setConfig({ lanefold: writeFolded(next, []) });
  };
  const foldAll = (shut: boolean) => {
    if (display.layout === "lanes") {
      setConfig({ lanefold: writeFolded(shut ? lanesByOwner(visible).map((l) => laneFoldKey(l.key)) : [], []) });
    } else {
      setConfig({ fold: writeFolded(shut ? stations.map((s) => s.id) : [], foldBase) });
    }
  };
  const owned = useMemo(() => ownerOptions(cards), [cards]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.sessionName || a.name);
    for (const c of cards) {
      if (c.item.ownerId && c.item.ownerName) map.set(c.item.ownerId, c.item.ownerName);
      if (c.item.nextMoveOwnerId && c.item.nextMoveOwnerName) map.set(c.item.nextMoveOwnerId, c.item.nextMoveOwnerName);
    }
    return map;
  }, [agents, cards]);
  const viewCounts = useMemo(() => ({
    all: cards.length,
    "my-move": cards.filter((c) => isYourMove(c, byId.get(c.station))).length,
    working: cards.filter(isWorking).length,
    review: cards.filter((c) => c.reviewPending).length,
  }), [cards, byId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.action ? 8000 : 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // A popover closes on a click anywhere outside the bar that holds it.
  useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => { if (!barRef.current?.contains(e.target as Node)) setPop(null); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [pop]);

  const sel = selected ? cardsById.get(selected) : undefined;
  const dragged = drag ? cardsById.get(drag.id) : undefined;
  const you = operatorName;
  const nameOf = (id: string) => (id === OPERATOR_ID ? you ?? "You" : names.get(id) ?? id);
  const stationName = (id: string) => byId.get(id)?.name ?? id;
  // The facts strip: counts and the latest moves, straight from the board read.
  const facts = useMemo(
    () => boardFacts(cards, stations, now, (id, name) => (id === OPERATOR_ID ? "you" : (id && names.get(id)) || name || id || "no one")),
    [cards, stations, now, names],
  );
  const recentMoves = useMemo(() => latestMoves(moves, (id) => cardsById.has(id)), [moves, cardsById]);
  const factsStrip = board && board.cards.length ? (
    <BoardFacts facts={facts} moves={recentMoves} titleOf={(id) => cardsById.get(id)?.item.title ?? id} stationName={stationName} nameOf={nameOf} />
  ) : null;

  // A failed run's two exits. Retry is a successor task for the same agent; the new run pulls the card to Doing.
  // Drop moves it to the first cancelled station with a note.
  const [exiting, setExiting] = useState<Record<string, true>>({});
  const exit = async (card: WebWorkBoardCard, run: () => Promise<void>) => {
    setExiting((x) => ({ ...x, [card.item.id]: true }));
    try { await run(); } finally {
      setExiting(({ [card.item.id]: _done, ...rest }) => rest);
    }
  };
  const retryRun = (card: WebWorkBoardCard) => exit(card, async () => {
    const flightId = card.item.failedRun?.flightId;
    if (!flightId) return;
    try {
      await api(`/api/work/${encodeURIComponent(card.item.id)}/continue`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "The last run failed. Try it again, picking up where it stopped.", requestId: `retry-${flightId}` }),
      });
      setToast({ kind: "allow", text: <><b>Retrying.</b> {card.item.title}</> });
    } catch (error) {
      setToast({ kind: "error", text: <><b>Not retried.</b> {error instanceof Error ? error.message : String(error)}</> });
    }
    await loadWorkBoard();
  });
  const dropStation = stations.find((s) => s.state === "cancelled");
  const dropRun = (card: WebWorkBoardCard) => exit(card, async () => {
    if (!dropStation) return;
    const answer = await moveWorkCard(card.item.id, dropStation.id, { note: "Dropped after its run failed." });
    if (!answer?.applied) setToast({ kind: "error", text: <><b>Not dropped.</b> {answer ? verdictNote(answer.decision) : "The runtime didn't answer."}</> });
  });

  /* ---------- Moves ---------- */

  const send = async (card: WebWorkBoardCard, to: WebWorkStation, extra: { note?: string; claim?: boolean; waitingOn?: { label: string } } = {}) => {
    const from = card.station;
    clearWorkAnswer(card.item.id);
    const answer = await moveWorkCard(card.item.id, to.id, extra);
    if (!answer) {
      setToast({ kind: "error", text: <><b>Not sent.</b> The runtime didn't answer, so the card stays in {stationName(from)}.</> });
      return;
    }
    const d = answer.decision;
    if (answer.applied && d.verdict === "allow") {
      const now = readWorkBoardState().board?.cards.find((c) => c.item.id === card.item.id);
      const back = byId.get(from);
      const canUndo = now && now.station === to.id && now.next.includes(from) && back && !stationAsk(back);
      setToast({
        kind: "allow",
        text: <>Moved <b>{card.item.title}</b> to {to.name}{d.review === "pending" ? ", waiting for review" : ""}</>,
        action: canUndo ? { label: "Undo", run: () => { setToast(null); void send(now, back); } } : undefined,
      });
      return;
    }
    if (d.verdict === "deny" && refusalIsAsk(d)) { openAsk(card, to, askKind(d), verdictNote(d)); return; }
    const note = verdictNote(d);
    if (d.verdict === "hold") {
      setToast({
        kind: "hold", text: <><b>Holds in {stationName(answer.applied ? to.id : from)}.</b> {note}</>,
        action: claimLifts(d) ? { label: "Claim and move", run: () => { setToast(null); void send(card, to, { ...extra, claim: true }); } } : undefined,
      });
    } else if (d.verdict === "consult") {
      setToast({ kind: "consult", text: <><b>Asks a person</b> before {card.item.title} moves to {to.name}. {note}</> });
    } else if (d.verdict === "deny") {
      setToast({ kind: "deny", text: <><b>Refused.</b> {note}</> });
    } else {
      setToast({ kind: "allow", text: <>{card.item.title} is in {stationName(answer.applied ? to.id : from)}.</> });
    }
  };

  const openAsk = (card: WebWorkBoardCard, to: WebWorkStation, kind: Ask["kind"], hint?: string) => {
    const rule = to.rules.find((r) => !r.shadow && (r.check === (kind === "waiting" ? "has_waiting_on" : "has_note")));
    setAskText("");
    setAsk({ card, to, kind, hint: hint || rule?.message || "" });
  };

  /** A move the operator asked for: by drop, or from the detail panel. */
  const attempt = (card: WebWorkBoardCard, toId: string, decision?: WebWorkMoveDecision | null) => {
    const to = byId.get(toId);
    if (!to || card.station === toId) return;
    if (!card.next.includes(toId)) {
      setToast({ kind: "deny", text: <><b>Refused.</b> {verdictNote(unreachable(byId.get(card.station), to))}</> });
      return;
    }
    const kind = stationAsk(to);
    if (kind) { openAsk(card, to, kind); return; }
    if (decision && decision.verdict === "deny") {
      if (refusalIsAsk(decision)) { openAsk(card, to, askKind(decision), verdictNote(decision)); return; }
      setToast({ kind: "deny", text: <><b>Refused.</b> {verdictNote(decision)}</> });
      return;
    }
    void send(card, to);
  };

  const submitAsk = (e: FormEvent) => {
    e.preventDefault();
    const text = askText.trim();
    if (!ask || !text) return;
    const { card, to, kind } = ask;
    setAsk(null);
    void send(card, to, kind === "waiting" ? { waitingOn: { label: text } } : { note: text });
  };

  const review = async (move: WebWorkMove, verdict: "confirm" | "reopen" | "consult", note?: string) => {
    await reviewWorkMove(move, verdict, note);
    const done = verdict === "confirm" ? "Confirmed" : verdict === "reopen" ? "Reopened" : "Asked a person about";
    setToast({ kind: verdict === "consult" ? "consult" : "allow", text: <>{done} <b>{cardsById.get(move.itemId)?.item.title ?? "the move"}</b>.</> });
  };

  /* ---------- Drag ---------- */

  const startDrag = (card: WebWorkBoardCard) => (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, card.item.id);
    e.dataTransfer.effectAllowed = "move";
    setPop(null);
    setDrag({ id: card.item.id, over: null });
    setVerdicts({});
    const token = ++dragToken.current;
    for (const to of card.next) {
      void previewWorkMove(card.item.id, to).then((d) => {
        if (dragToken.current === token) setVerdicts((v) => ({ ...v, [to]: d }));
      });
    }
  };
  const endDrag = () => { dragToken.current += 1; setDrag(null); };

  /** What a column shows while a card is held: the runtime's dry-run answer, or no path. */
  const decisionFor = (toId: string): WebWorkMoveDecision | "checking" | null => {
    if (!dragged || dragged.station === toId) return null;
    const to = byId.get(toId);
    if (!to) return null;
    if (!dragged.next.includes(toId)) return unreachable(byId.get(dragged.station), to);
    if (!(toId in verdicts)) return "checking";
    return verdicts[toId] ?? null;
  };
  const overFor = (toId: string) => {
    if (drag?.over !== toId) return null;
    const d = decisionFor(toId);
    return d && d !== "checking" ? d.verdict : null;
  };
  const dropProps = (toId: string) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (drag && drag.over !== toId) setDrag({ ...drag, over: toId });
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDrag((d) => (d && d.over === toId ? { ...d, over: null } : d));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      const card = cardsById.get(e.dataTransfer.getData(DRAG_TYPE));
      const d = decisionFor(toId);
      endDrag();
      if (card) attempt(card, toId, d === "checking" ? undefined : d);
    },
  });

  const renderCard = (card: WebWorkBoardCard) => (
    <CardView
      key={card.item.id} card={card} station={byId.get(card.station)} props={display.props} answer={answers[card.item.id]} you={you}
      liveHarness={card.item.ownerId && card.item.ownerId !== OPERATOR_ID ? harnessOf.get(card.item.ownerId) : undefined}
      flags={{ selected: card.item.id === selected, compact: display.compact, ghost: drag?.id === card.item.id, pending: Boolean(pending[card.item.id]) }}
      onOpen={() => setSelected((s) => (s === card.item.id ? null : card.item.id))}
      onOpenSession={openSession(card)}
      onDragStart={startDrag(card)} onDragEnd={endDrag}
    />
  );

  /* ---------- Bars ---------- */

  const setView = (view: BoardView) => { setConfig({ view: view === "all" ? "" : view }); setSelected(null); };
  const filtered = display.view !== "all" || owners.length > 0 || hideSettled || query.trim() !== "";
  const clearFilters = () => { setConfig({ view: "" }); setOwners([]); setHideSettled(false); setQuery(""); };
  const settledNames = stations.filter(isSettled).map((s) => s.name);
  const ownerName = (id: string) => {
    if (id === OPERATOR_ID) return "You";
    if (!id) return "No owner";
    return sessionOwnerLabel(owned.find((o) => o.id === id)?.name ?? id, harnessOf.get(id));
  };
  const toggleProp = (p: CardProp) => {
    const next = display.props.includes(p) ? display.props.filter((x) => x !== p) : [...display.props, p];
    setConfig({ props: writeProps(next) });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    if (ask) setAsk(null);
    else if (pop) setPop(null);
    else if (selected) setSelected(null);
  };

  const head = board ? (
    <ModuleHead>
      {board.lifecycles.length > 1 ? (
        <select className="wb-pick" value={board.lifecycle.id} onChange={(e) => pickWorkLifecycle(e.target.value)} aria-label="Lifecycle">
          {board.lifecycles.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      ) : null}
      <span className="hud-grid-count" title={`${board.cards.length} work items`}>{board.cards.length}</span>
    </ModuleHead>
  ) : null;

  const bar = (
    // One bar under the page head: the queues lead, then layout and filters;
    // search, Display and New chat sit at the end.
    <div className="wb-bar" ref={barRef}>
      <div className="wb-views" role="tablist" aria-label="Views">
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={display.view === v} className={display.view === v ? "on" : ""} onClick={() => setView(v)} disabled={!board}>
            {VIEW_LABEL[v]}{board ? <small>{viewCounts[v]}</small> : null}
          </button>
        ))}
      </div>
      <span className="wb-sep" />
      <LayoutSwitch value={display.layout} onChange={(l) => setConfig({ layout: l === "board" ? "" : l })} />
      <span className="wb-sep" />
      {owners.length ? (
        <FilterChip icon="user" dim="Owner" op={owners.length > 1 ? "is either of" : "is"} val={owners.map(ownerName).join(", ")} onRemove={() => setOwners([])} />
      ) : null}
      {hideSettled && settledNames.length ? (
        <FilterChip icon="board" dim="Station" op="is not" val={settledNames.join(", ")} onRemove={() => setHideSettled(false)} />
      ) : null}
      <span style={{ position: "relative" }}>
        <button type="button" className={`wb-btn ghost${pop === "filter" ? " on" : ""}`} aria-expanded={pop === "filter"} onClick={() => setPop(pop === "filter" ? null : "filter")} disabled={!board}>
          <Icon n="filter" s={13} />Filter
        </button>
        {pop === "filter" ? (
          <div className="wb-pop" style={{ top: 34, left: 0 }} role="dialog" aria-label="Filter">
            <h5>Owner</h5>
            {owned.map((o) => (
              <button
                key={o.id || "none"} type="button" className="item" aria-pressed={owners.includes(o.id)}
                onClick={() => setOwners((list) => (list.includes(o.id) ? list.filter((x) => x !== o.id) : [...list, o.id]))}
              >
                <span className="check">{owners.includes(o.id) ? <Icon n="check" s={14} /> : null}</span>
                <Av id={o.id || null} name={o.id === OPERATOR_ID ? you : o.name} s={18} />
                <span className="name">{ownerName(o.id)}</span>
                <small>{o.count}</small>
              </button>
            ))}
            {settledNames.length ? (
              <>
                <hr />
                <div className="row">
                  <span>Hide {settledNames.join(" and ")}</span>
                  <button type="button" className={`wb-switch${hideSettled ? " on" : ""}`} aria-pressed={hideSettled} onClick={() => setHideSettled(!hideSettled)} aria-label={`Hide ${settledNames.join(" and ")}`} />
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </span>
      <span className="sp" />
      <span style={{ position: "relative" }}>
        <button type="button" className={`wb-btn${pop === "display" ? " on" : ""}`} aria-expanded={pop === "display"} onClick={() => setPop(pop === "display" ? null : "display")}>
          <Icon n="display" s={13} />Display
        </button>
        {pop === "display" ? (
          <div className="wb-pop wide" style={{ top: 34, right: 0 }} role="dialog" aria-label="Display">
            <div className="row" style={{ paddingTop: 6 }}><LayoutSwitch value={display.layout} onChange={(l) => setConfig({ layout: l === "board" ? "" : l })} /></div>
            <hr />
            <div className="row"><span>Order</span>
              <div className="wb-seg">
                {(["manual", "updated", "priority"] as const).map((o) => (
                  <button key={o} type="button" className={display.order === o ? "on" : ""} aria-pressed={display.order === o} onClick={() => setConfig({ order: o === "manual" ? "" : o })}>{ORDER_LABEL[o]}</button>
                ))}
              </div>
            </div>
            <div className="row"><span>{display.layout === "lanes" ? "Lanes" : display.layout === "list" ? "Groups" : "Columns"}</span>
              <span className="acts">
                <button type="button" className="wb-btn ghost sm" onClick={() => foldAll(true)}>Collapse all</button>
                <button type="button" className="wb-btn ghost sm" onClick={() => foldAll(false)}>Expand all</button>
              </span>
            </div>
            <div className="row"><span>Show empty columns</span><button type="button" className={`wb-switch${display.showEmpty ? " on" : ""}`} aria-pressed={display.showEmpty} onClick={() => setConfig({ empty: display.showEmpty ? "0" : "" })} aria-label="Show empty columns" /></div>
            <div className="row"><span>Compact cards</span><button type="button" className={`wb-switch${display.compact ? " on" : ""}`} aria-pressed={display.compact} onClick={() => setConfig({ compact: display.compact ? "" : "1" })} aria-label="Compact cards" /></div>
            <hr />
            <h5>Card properties</h5>
            <div className="props">
              {ALL_PROPS.map((p) => <button key={p} type="button" className={display.props.includes(p) ? "on" : ""} aria-pressed={display.props.includes(p)} onClick={() => toggleProp(p)}>{PROP_LABEL[p]}</button>)}
            </div>
            <div className="foot">
              <button type="button" className="wb-btn ghost" onClick={() => setConfig({ layout: "", order: "", props: "", compact: "", empty: "", fold: "", lanefold: "" })}>Reset</button>
            </div>
          </div>
        ) : null}
      </span>
      <label className="wb-search">
        <Icon n="search" s={13} />
        <input placeholder="Search cards" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search cards" />
        {query ? <button type="button" className="wb-link" aria-label="Clear the search" onClick={() => setQuery("")}><Icon n="x" s={12} /></button> : null}
      </label>
      <button type="button" className="wb-btn primary" onClick={() => openContextCapture()}><Icon n="plus" s={13} />{NEW_TASK_ACTION_LABEL}</button>
    </div>
  );

  /* ---------- Body ---------- */

  let body: ReactNode;
  if (!board && error) {
    body = (
      <EmptyState icon="offline" title="Can't read the board" actions={<button type="button" className="wb-btn" onClick={() => void loadWorkBoard()}><Icon n="refresh" s={13} />Try again</button>}>
        The runtime didn't answer. {error}
      </EmptyState>
    );
  } else if (!board) {
    body = (
      <div className="wb-board" aria-busy="true" aria-label="Reading the board">
        {[3, 2, 3, 2].map((n, i) => (
          <div key={i} className="wb-col">
            <div className="wb-col-h"><div className="wb-skel" style={{ width: "40%", height: 12 }} /></div>
            <div className="wb-col-body">{Array.from({ length: n }, (_, j) => <SkeletonCard key={j} />)}</div>
          </div>
        ))}
      </div>
    );
  } else if (!cards.length) {
    body = (
      <EmptyState icon="board" title="No work on this host yet" actions={<button type="button" className="wb-btn primary" onClick={() => openContextCapture()}><Icon n="plus" s={13} />{NEW_TASK_ACTION_LABEL}</button>}>
        Work shows up here when you or an agent starts a task. Ask an agent from any session.
      </EmptyState>
    );
  } else if (!visible.length && filtered) {
    body = (
      <EmptyState icon="filter" title="Nothing matches" actions={<button type="button" className="wb-btn" onClick={clearFilters}>Clear filters</button>}>
        No card fits {display.view !== "all" ? `${VIEW_LABEL[display.view]}${owners.length || hideSettled || query.trim() ? " and these filters" : ""}` : "these filters"}.
      </EmptyState>
    );
  } else if (display.layout === "lanes") {
    body = <Lanes cards={visible} stations={stations} renderCard={renderCard} dropProps={dropProps} decisionFor={decisionFor} over={drag?.over ?? null} you={you} folded={laneFolded} onToggle={toggleLane} />;
  } else if (display.layout === "list") {
    body = <ListLayout cards={visible} stations={stations} selected={selected} onPick={(id) => setSelected(id)} you={you} folded={folded} onToggle={toggleFold} />;
  } else {
    body = (
      <div className="wb-board">
        {stations.map((s) => {
          const here = visible.filter((c) => c.station === s.id);
          // Failed runs stay out of Waiting's count and cards; they fold under it with their exits.
          const failedHere = s.state === "waiting" ? here.filter(isFailedRun) : [];
          const list = failedHere.length ? here.filter((c) => !isFailedRun(c)) : here;
          if (folded.has(s.id)) {
            return <CollapsedColumn key={s.id} station={s} count={list.length} over={overFor(s.id)} onOpen={() => toggleFold(s.id)} {...dropProps(s.id)} />;
          }
          if (!display.showEmpty && !list.length && !failedHere.length && !drag) return null;
          const shown = expanded[s.id] ? list : list.slice(0, COLUMN_CAP);
          const rest = list.length - shown.length;
          return (
            <ColumnView
              key={s.id} station={s} count={list.length} compact={display.compact} over={overFor(s.id)} decision={decisionFor(s.id)} {...dropProps(s.id)}
              definition={columnDefinition(s, stations)}
              onCollapse={() => toggleFold(s.id)}
              footer={rest > 0 ? <button type="button" className="wb-col-add" onClick={() => setExpanded((x) => ({ ...x, [s.id]: true }))}>Show {rest} more</button> : null}
            >
              {shown.map(renderCard)}
              <FailedRuns cards={failedHere} renderCard={renderCard} onRetry={(c) => void retryRun(c)} onDrop={(c) => void dropRun(c)} busy={(c) => Boolean(exiting[c.item.id])} />
            </ColumnView>
          );
        })}
      </div>
    );
  }

  return (
    <BoardHarnesses.Provider value={harnessOf}>
    <div className="wb" onKeyDown={onKey}>
      {head}
      {bar}
      {factsStrip}
      {board && error ? (
        <div className="wb-banner" role="status">
          <Icon n="offline" s={14} />
          <span>The runtime didn't answer{readAt ? `. Showing the board as of ${new Date(readAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}. {error}</span>
          <span className="sp" />
          <button type="button" className="wb-btn" onClick={() => void loadWorkBoard()}><Icon n="refresh" s={13} />Try again</button>
        </div>
      ) : null}
      <div className="wb-body">
        {(!full || !sel) && body}
        {sel ? (
          <BoardDetail
            key={sel.item.id} full={full} navigate={navigate} card={sel} stations={stations} moves={moves} you={you} nameOf={nameOf}
            onMove={(to, d) => attempt(sel, to, d)} onReview={(m, v, n) => void review(m, v, n)}
            onClose={() => setSelected(null)} onOpenSession={openSession(sel)}
            onCollapse={() => changeSelection({ type: "collapse" })} onOpenFull={() => changeSelection({ type: "expand" })}
          />
        ) : null}
      </div>

      {toast ? (
        <div className="wb-toast" role="status" aria-live="polite">
          <span className={`k${toast.kind === "consult" ? " amber" : toast.kind === "allow" ? " accent" : ""}`}>
            <Icon n={toast.kind === "allow" ? "check" : toast.kind === "hold" ? "clock" : toast.kind === "consult" ? "ask" : toast.kind === "error" ? "offline" : "deny"} s={14} />
          </span>
          <span>{toast.text}</span>
          {toast.action ? <button type="button" onClick={toast.action.run}>{toast.action.label}</button> : null}
          <button type="button" className="x" aria-label="Dismiss" onClick={() => setToast(null)}><Icon n="x" s={12} /></button>
        </div>
      ) : null}

      {ask ? (
        <div className="wb-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setAsk(null); }}>
          <form className="wb-modal" role="dialog" aria-label={`Move to ${ask.to.name}`} onSubmit={submitAsk}>
            <div className="mh">
              <h3>Move to {ask.to.name}</h3>
              <p>{ask.hint || (ask.kind === "waiting" ? "Say what it is waiting on." : `Say why it moves to ${ask.to.name}.`)}</p>
            </div>
            <div className="mb">
              <input
                className="wb-input" autoFocus value={askText} onChange={(e) => setAskText(e.target.value)}
                placeholder={ask.kind === "waiting" ? "Waiting on…" : "Note for the record"} aria-label={ask.kind === "waiting" ? "Waiting on" : "Note"}
              />
            </div>
            <div className="mf">
              <button type="button" className="wb-btn ghost" onClick={() => setAsk(null)}>Cancel</button>
              <button type="submit" className="wb-btn primary" disabled={!askText.trim()}>Move</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
    </BoardHarnesses.Provider>
  );
}

export const workBoardModule = defineModule({
  type: "work-board",
  title: "Board",
  blurb: "Work as columns of its lifecycle; the runtime checks every move",
  docs: {
    shows: "One column per lifecycle station with its purpose and first rule; cards with owner, priority, age, live work, review pending and your move; views for your moves, live work and the review queue; swimlane and list layouts; a detail panel with each station's verdict and the card's moves.",
    data: "GET /api/work/board and /api/work/moves on runtime work events and every 15s; POST /api/work/:id/move (dryRun while a card is held); POST /api/work/:id/review.",
    opens: "The work item (/work/:id).",
  },
  size: { w: 12, h: 28 },
  minSize: { w: 6, h: 12 },
  Component: WorkBoard,
});
