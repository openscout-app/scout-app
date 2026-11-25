import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { focusCompanionInput } from "../../../lib/companion-host.ts";

import type { Agent } from "../../../lib/types.ts";
import type { ClearAll } from "../../requests/clear-requests.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { rowSpeaker, sinceClock, sinceOf } from "./arrivals-model.ts";
import type { SheetPlacement } from "./board-sheet.ts";
import { ClearAllRequests } from "./ClearAll.tsx";
import { changeOf, stepChoice, type CompanionChoice } from "./companion-choices.ts";
import { stepMenu } from "./figure-menu-model.ts";
import { FigureTalk, figureDraft, keepFigureDraft } from "./FigureTalk.tsx";
import { askFromItem, TAP_IN_VARS } from "./tap-in-model.ts";
import { AskBlock, CloseMark, DemoAsk, jumpOf, Receipt, ReplyLine, useTapIn, type TapInReplyOutcome } from "./TapInPanel.tsx";
import { plainLine } from "./TapText.tsx";

/*
 * A click on the companion: a few things to do now (companion-choices.ts),
 * beside the board where a sheet sits. Each one runs through Tap in's reads
 * and acts, the same calls the details panel and the desk's figures use:
 * the ask's own answers, the reply line, the way in. Everything opens the
 * board as it was; Clear all requests clears every open one at the runtime.
 *
 * An agent's name opens its engage panel in the card (FigureTalk, as a click
 * on its figure does): its ask, its last few turns, the reply line and mic,
 * and a link to its Details. Back, or Esc, returns to the choices.
 *
 * It is a peek: it takes the keyboard only when the operator clicks into it.
 */

/** The card is narrower than a sheet: a few lines, not a form. */
export const CHOICES_WIDTH = 320;

export type CompanionChoicesProps = {
  choices: readonly CompanionChoice[];
  placement: SheetPlacement;
  hitId: string;
  demo: boolean;
  now: number;
  /** The machine a native row runs on; this host when absent. */
  machineOf: (t: CornerThread) => string | null;
  agents: readonly Agent[];
  clearAll: ClearAll | null;
  /** Everything: the board as it opens without the choices. */
  everything: { label: string; go: () => void };
  /** Open a row's Details beside the board. */
  onDetails: (id: string) => void;
  onNew: (project: string | null) => void;
  onClose: () => void;
  /** The reply line holds a draft: a click outside does not close the card. */
  onDraft: (busy: boolean) => void;
  onDemoAnswer?: (id: string) => void;
};

export function CompanionChoices({ choices, placement, hitId, demo, now, machineOf, agents, clearAll, everything, onDetails, onNew, onClose, onDraft, onDemoAnswer }: CompanionChoicesProps) {
  const ref = useRef<HTMLElement>(null);
  /** The agent whose engage panel the card shows in place of the choices. */
  const [engaged, setEngaged] = useState<CornerThread | null>(null);
  const engage = (t: CornerThread) => setEngaged(t);
  const talkInput = useRef<HTMLTextAreaElement | null>(null);
  const style = {
    ...TAP_IN_VARS,
    left: placement.left,
    width: placement.width,
    top: placement.top ?? undefined,
    bottom: placement.bottom ?? undefined,
    maxHeight: placement.maxHeight,
  } as CSSProperties;
  // ↑ and ↓ walk the card's controls; a reply line keeps its own keys otherwise.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Engaged, Esc steps back to the choices; a line holding a draft lets go of the keys first.
    if (e.key === "Escape" && engaged) {
      e.preventDefault();
      e.stopPropagation();
      const line = talkInput.current;
      if (line && document.activeElement === line && line.value.trim()) line.blur();
      else setEngaged(null);
      return;
    }
    if (engaged) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? [])
      .filter((el) => !el.closest(".cw-choices__head"));
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[stepChoice(i, items.length, e.key === "ArrowDown" ? 1 : -1)]?.focus({ preventScroll: true });
  };
  return (
    <aside ref={ref} className={`tap-panel arv-sheet cw-choices from-${placement.from}${placement.notch ? " is-notch" : ""}`} style={style} data-hit={hitId} role="dialog" aria-label="Scout" onKeyDown={onKeyDown}>
      <header className="cw-choices__head">
        {engaged
          ? <button type="button" className="cw-choices__back" title="Back to the choices · esc" onClick={() => setEngaged(null)}>&larr; <b>{rowSpeaker(engaged)}</b></button>
          : <span>Scout</span>}
        <button type="button" className="tap-x" aria-label="Close" title="Close" onClick={onClose}><CloseMark /></button>
      </header>
      {engaged && (
        <div className="cw-choices__body is-engaged">
          <FigureTalk
            key={engaged.id}
            t={engaged}
            machineId={machineOf(engaged)}
            demo={demo}
            agents={agents}
            onDraft={onDraft}
            inputRef={talkInput}
            onDetails={() => onDetails(engaged.id)}
            onDemoAnswer={onDemoAnswer}
          />
        </div>
      )}
      <div className="cw-choices__body" hidden={Boolean(engaged)}>
        {choices.map((c) => {
          switch (c.kind) {
            case "answer": return <AnswerChoice key={`answer:${c.t.id}`} t={c.t} more={c.more} demo={demo} now={now} machineId={machineOf(c.t)} onMore={everything.go} onEngage={engage} onDemoAnswer={onDemoAnswer} />;
            case "reply": return <ReplyChoice key={`reply:${c.t.id}`} t={c.t} demo={demo} machineId={machineOf(c.t)} agents={agents} onDraft={onDraft} onEngage={engage} onDemoAnswer={onDemoAnswer} />;
            case "catch-up": return <CatchUp key="catch-up" since={c.since} rows={c.rows} more={c.more} onEngage={engage} onMore={everything.go} />;
            case "jump": return <JumpChoice key={`jump:${c.t.id}`} t={c.t} demo={demo} machineId={machineOf(c.t)} onDone={onClose} />;
            case "new": return (
              <section key="new" className="cw-choice">
                <button type="button" className="cw-choice__go" onClick={() => onNew(c.project)}>
                  New ask{c.project && <span className="cw-choice__dim"> in {c.project}</span>}
                </button>
              </section>
            );
          }
        })}
        {choices.length === 0 && <p className="tap-quiet cw-choice">Nothing to do right now.</p>}
      </div>
      <footer className="cw-choices__foot" hidden={Boolean(engaged)}>
        {clearAll && <ClearAllRequests clear={clearAll} look="line" />}
        <button type="button" className="cw-choice__quiet cw-choices__all" onClick={everything.go}>{everything.label}</button>
      </footer>
    </aside>
  );
}

/** The oldest open ask, with its own answers or Allow / Deny, and its Dismiss when the runtime offers one. */
function AnswerChoice({ t, more, demo, now, machineId, onMore, onEngage, onDemoAnswer }: {
  t: CornerThread; more: number; demo: boolean; now: number; machineId: string | null; onMore: () => void; onEngage: (t: CornerThread) => void; onDemoAnswer?: (id: string) => void;
}) {
  const { view, acts, receipt, setReceipt, demoAsk } = useTapIn({ thread: t, machineId, demo, immediate: true, onDemoAnswer });
  const ask = view?.ask ?? (t.request ? askFromItem(t.request) : null);
  return (
    <section className="cw-choice is-answer" aria-label={`${rowSpeaker(t)} asks`}>
      <p className="cw-choice__who"><Name t={t} onEngage={onEngage} /> asks</p>
      {ask
        ? <AskBlock ask={ask} now={now} onFocus={view?.kind === "native" && ask.focusable ? acts.focus : undefined} onOpenThread={acts.openThread} onAnswered={setReceipt} />
        : demoAsk ? <DemoAsk ask={demoAsk} now={now} /> : !receipt && <p className="tap-quiet">Reading…</p>}
      {!ask && receipt && <Receipt label={receipt} />}
      {more > 0 && <button type="button" className="cw-choice__quiet" onClick={onMore}>{more} more asking</button>}
    </section>
  );
}

/** A reply line to the agent that spoke last, the way Tap in sends one (into its live session, else its thread). */
function ReplyChoice({ t, demo, machineId, agents, onDraft, onEngage, onDemoAnswer }: {
  t: CornerThread; demo: boolean; machineId: string | null; agents: readonly Agent[]; onDraft: (busy: boolean) => void; onEngage: (t: CornerThread) => void; onDemoAnswer?: (id: string) => void;
}) {
  const { view, acts, reply, error, data } = useTapIn({ thread: t, machineId, demo, agents, immediate: true, onDemoAnswer });
  // Read, and it takes no reply: there is nothing to offer here.
  if (!demo && view && !view.reply.open) return null;
  const said = view?.last?.text ? plainLine(view.last.text) : plainLine(t.now);
  const onSend = (text: string): Promise<TapInReplyOutcome> => acts.reply(text);
  return (
    <section className="cw-choice is-reply" aria-label={`Reply to ${rowSpeaker(t)}`}>
      <p className="cw-choice__who">Reply to <Name t={t} onEngage={onEngage} /></p>
      {said && <p className="cw-choice__said" title={said}>{said}</p>}
      {error && <p className="tap-err" role="alert">{error}</p>}
      {view || demo
        ? <ReplyLine key={t.id} reply={view?.reply ?? { open: true, placeholder: "Reply…" }} delivery={reply} onSend={onSend} onDraft={onDraft} initial={figureDraft(t.id)} onText={(text) => keepFigureDraft(t.id, text)} />
        : <p className="tap-quiet">{data?.loading === false ? "Nothing to reply to." : "Reading…"}</p>}
    </section>
  );
}

/** An agent's name: a click opens its engage panel in the card. */
function Name({ t, onEngage }: { t: CornerThread; onEngage: (t: CornerThread) => void }) {
  return <button type="button" className="cw-choice__name" title={`Talk to ${rowSpeaker(t)}: recent turns, reply, mic`} onClick={() => onEngage(t)}>{rowSpeaker(t)}</button>;
}

/** What changed since the operator last looked: a row each, opening its engage panel. */
function CatchUp({ since, rows, more, onEngage, onMore }: { since: number | null; rows: readonly CornerThread[]; more: number; onEngage: (t: CornerThread) => void; onMore: () => void }) {
  return (
    <section className="cw-choice is-catch-up" aria-label="What changed">
      <p className="cw-choice__who">{since === null ? "Lately" : `Since ${sinceClock(since)}`}</p>
      {rows.map((t) => {
        const line = plainLine(t.now);
        return (
          <button key={t.id} type="button" className="cw-choice__line" onClick={() => onEngage(t)} title={line || t.task}>
            <span><b>{rowSpeaker(t)}</b> {changeOf(t)}<span className="cw-choice__dim"> · {sinceClock(sinceOf(t))}</span></span>
            {line && <span className="cw-choice__said">{line}</span>}
          </button>
        );
      })}
      {more > 0 && <button type="button" className="cw-choice__quiet" onClick={onMore}>{more} more on the board</button>}
    </section>
  );
}

/** The most recent active session's way in: its Scout window, its thread, or its terminal. */
function JumpChoice({ t, demo, machineId, onDone }: { t: CornerThread; demo: boolean; machineId: string | null; onDone: () => void }) {
  const { acts, error, data } = useTapIn({ thread: t, machineId, demo, immediate: true });
  const jump = jumpOf(acts);
  if (!jump) return data?.loading === false || demo ? null : <section className="cw-choice"><p className="tap-quiet">Reading…</p></section>;
  return (
    <section className="cw-choice">
      <button type="button" className="cw-choice__go" title={jump.title} onClick={() => void jump.go().then((ok) => { if (ok) onDone(); })}>
        {jump.label}<span className="cw-choice__dim"> · {rowSpeaker(t)}</span>
      </button>
      {error && <p className="tap-err" role="alert">{error}</p>}
    </section>
  );
}

// ── the mark's right-click menu ──────────────────────────────────────────

/** The menu keeps this far from the screen's edges. */
const MENU_INSET = 8;
/** It closes this long after it said that everything cleared. */
const SAID_MS = 700;

export type MarkMenuAgent = { id: string; name: string; bring: () => Promise<void> };

/**
 * A right-click on the companion: what to do now (the choices, now that a
 * click on the mark opens Scoutbot), bring an agent out onto the desk (one
 * click, no drag; the host pins it and stands it beside the board), clear
 * every open request, or open everything. Only what is backed is listed.
 */
export function MarkMenu({ at, hitId, choices, agents, clearAll, everything, onClose }: {
  at: { x: number; y: number };
  hitId: string;
  /** Opens the companion's choices. */
  choices?: () => void;
  agents: readonly MarkMenuAgent[];
  clearAll: ClearAll | null;
  everything: { label: string; go: () => void };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closing.current), []);
  // On the screen after every draw: near the right or the bottom, it opens left or up of the pointer.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = at.x + r.width > window.innerWidth - MENU_INSET ? Math.max(MENU_INSET, at.x - r.width) : at.x;
    const top = at.y + r.height > window.innerHeight - MENU_INSET ? Math.max(MENU_INSET, at.y - r.height) : at.y;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  });
  useEffect(() => {
    focusCompanionInput();
    ref.current?.querySelector<HTMLElement>("[role^='menuitem']")?.focus({ preventScroll: true });
  }, []);
  const bring = (a: MarkMenuAgent) => {
    if (pending) return;
    setLine(null);
    setPending(true);
    void a.bring().then(
      () => { setPending(false); onClose(); },
      (cause) => { setPending(false); setLine(cause instanceof Error && cause.message ? cause.message : "Could not bring it out."); },
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[stepMenu(i, items.length, e.key === "ArrowDown" ? 1 : -1)]?.focus({ preventScroll: true });
  };
  return (
    <div ref={ref} className="cw-menu is-figure" role="menu" aria-label="Scout" data-hit={hitId} style={{ left: at.x, top: at.y, width: 240 }}
      onContextMenu={(e) => e.preventDefault()} onKeyDown={onKeyDown}>
      <p className="cw-menu__title">Scout</p>
      {choices && (
        <div role="group" className="cw-menu__group">
          <button type="button" role="menuitem" className="cw-menu__item" onClick={() => { onClose(); choices(); }}>What to do now</button>
        </div>
      )}
      {agents.length > 0 && (
        <div role="group" className="cw-menu__group">
          {choices && <hr className="cw-menu__sep" />}
          {agents.map((a) => (
            <button key={a.id} type="button" role="menuitem" className="cw-menu__item" disabled={pending} onClick={() => bring(a)} title={`Bring ${a.name} out onto the desk`}>
              Bring out <span className="cw-menu__dim">{a.name}</span>
            </button>
          ))}
        </div>
      )}
      {clearAll && (
        <div role="group" className="cw-menu__group">
          {(choices || agents.length > 0) && <hr className="cw-menu__sep" />}
          <ClearAllRequests clear={clearAll} look="menu" onDone={(ok) => { if (ok) closing.current = window.setTimeout(onClose, SAID_MS); }} />
        </div>
      )}
      <div role="group" className="cw-menu__group">
        {(choices || agents.length > 0 || clearAll) && <hr className="cw-menu__sep" />}
        <button type="button" role="menuitem" className="cw-menu__item" onClick={() => { onClose(); everything.go(); }}>{everything.label}</button>
      </div>
      {line && <p className="cw-menu__error" role="status">{line}</p>}
    </div>
  );
}
