import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from "react";

import { focusCompanionInput } from "../../../lib/companion-host.ts";
import type { Agent } from "../../../lib/types.ts";
import type { ClearAll } from "../../requests/clear-requests.ts";
import { revealRequestSession } from "../../requests/request-session.ts";
import { leadApprove } from "../../requests/requests-model.ts";
import { useRequestActions } from "../../requests/use-request-actions.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { ClearAllRequests } from "./ClearAll.tsx";
import { figureMenuItems, stepMenu, type FigureMenuFacts, type FigureMenuItem, type FigureMenuKey } from "./figure-menu-model.ts";
import { plainLine } from "./TapText.tsx";
import { rowName } from "./arrivals-model.ts";
import { clearFigureFiles, figureFiles, holdingFigureFiles, removeFigureFile, sentEcho, subscribeFigureFiles, talkLines, type FigureFiles } from "./engage-model.ts";
import { askFromItem, sameText, terminalPlace, type TapInAsk } from "./tap-in-model.ts";
import { AskBlock, DemoAsk, jumpOf, Receipt, ReplyLine, useTapIn, type TapIn, type TapInReplyOutcome } from "./TapInPanel.tsx";

/*
 * Talking to an attached agent from where it stands (Studio
 * /studies/companion-desk). A click on a figure or a strip opens its engage
 * panel, just enough to get going: its open request with the request's own
 * actions on top, the last few turns (its and yours, newest at the bottom),
 * and a reply line that goes the way Tap in's does (into the live session,
 * else its thread), with a mic where Scout voice answers and the files
 * dropped on the figure as chips. A sent reply joins the lines and the answer
 * lands in place. Nothing here is a second path: the reads, the reply and
 * every action are Tap in's (useTapIn).
 *
 * The board's rows, chips and strip lines open the same body (TalkBody) in
 * the board's panel, on the panel's own reads.
 *
 * Everything else is its Details (the Tap in panel): what is going on, its
 * ways in, the actions that aren't quick and, on the desk, how it is drawn.
 * The panel's foot links there, as does ⌘I.
 *
 * A right-click opens the figure's menu (FigureMenu): only actions that are
 * backed, grouped as a native menu, ↑/↓ to move, Esc to close, and Details
 * always. The board's rows open the same menu, with Bring out.
 */

// ── drafts ───────────────────────────────────────────────────────────────

/** A reply typed on a figure outlives its card: closing keeps it, sending clears it. */
const drafts = new Map<string, string>();

export function figureDraft(id: string): string {
  return drafts.get(id) ?? "";
}

/** Text typed, or files dropped, waiting to go: the card stays open on them. */
export function hasFigureDraft(id: string): boolean {
  return Boolean(drafts.get(id)?.trim()) || figureFiles(id).files.length > 0 || figureFiles(id).attaching > 0;
}

/** Whether any figure has a reply or files waiting to go. */
export function hasAnyFigureDraft(): boolean {
  for (const text of drafts.values()) if (text.trim()) return true;
  return holdingFigureFiles();
}

/** The files dropped on a figure, as they change. */
export function useFigureFiles(id: string): FigureFiles {
  return useSyncExternalStore(subscribeFigureFiles, () => figureFiles(id), () => figureFiles(id));
}

function keepDraft(id: string, text: string): void {
  if (text) drafts.set(id, text);
  else drafts.delete(id);
}

/** The companion's own reply line keeps its draft in the same place, so the figure's card opens on it. */
export const keepFigureDraft = keepDraft;

/** A key typed on a hovered figure starts (or goes on with) its draft; the card opens on it. */
export function seedFigureDraft(id: string, text: string): void {
  keepDraft(id, figureDraft(id) + text);
}

// ── the talk card ────────────────────────────────────────────────────────

/** After a send, how often the card reads again for the answer, and for how long. */
export const TALK_POLL = { EVERY: 3_000, FOR: 120_000 };
/** What a demo row answers, after a beat; nothing is sent. */
const DEMO_ANSWER = { AFTER: 1_400, TEXT: "On it." };

/** A reply that went: what it said, when, what the agent had said before it, and whether the card stopped reading for the answer. */
type Sent = { text: string; at: number; before: string | null; gaveUp?: boolean };

export type FigureTalkProps = {
  t: CornerThread;
  /** The machine a native row runs on; this host when absent. */
  machineId?: string | null;
  demo?: boolean;
  /** The roster's agents: with them, Interrupt is offered where the runtime can stop the turn. */
  agents?: readonly Agent[] | null;
  /** The reply line holds a draft: the board should not fold. */
  onDraft?: (busy: boolean) => void;
  /** Focus the reply line again (the menu's Reply bumps it). */
  focusKey?: number;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  /** This agent's Details (the Tap in panel): the foot's link, and ⌘I. */
  onDetails?: () => void;
  onDemoAnswer?: (id: string) => void;
};

/** What the work raised (an output or a blocker), when there is one: a line of its own. */
function calloutOf(tap: TapIn): string | null {
  const v = tap.view;
  if (v?.kind !== "work" || !v.callout || (tap.receipt && v.callout.tone === "question")) return null;
  return v.callout.text;
}

/** The newest thing it said, to tell when an answer has come in. */
function saidOf(tap: TapIn): { text: string; at: number | null } | null {
  const callout = calloutOf(tap);
  return callout ? { text: callout, at: null } : tap.view?.last ?? null;
}

export function FigureTalk({ machineId, agents, onDemoAnswer, ...body }: FigureTalkProps) {
  const tap = useTapIn({ thread: body.t, machineId, demo: body.demo, agents, immediate: true, onDemoAnswer });
  return <TalkBody {...body} tap={tap} />;
}

export type TalkBodyProps = Omit<FigureTalkProps, "machineId" | "agents" | "onDemoAnswer"> & {
  /** The agent's reads and acts (useTapIn): the figure's own, or the board panel's. */
  tap: TapIn;
  /** Filled with Allow on the open request, for a ⌘↩ that comes from outside the card (the board). */
  allowRef?: { current: (() => boolean) | null };
  /** A layer on its way out (the board's cursor moved on): it leaves focus to the one coming in. */
  leaving?: boolean;
};

/** The engage panel's body: the open request on top, the last few turns, the reply line and the way to Details. */
export function TalkBody({ t, tap, demo = false, onDraft, focusKey = 0, inputRef, onDetails, allowRef: allowOut, leaving = false }: TalkBodyProps) {
  const { view, acts, reply, error, receipt, setReceipt, replySettlement, now, data, reload, demoAsk } = tap;
  const own = useRef<HTMLTextAreaElement | null>(null);
  const field = inputRef ?? own;
  const ownAllow = useRef<(() => boolean) | null>(null);
  const allowRef = allowOut ?? ownAllow;
  const [sent, setSent] = useState<Sent | null>(null);
  const [demoSaid, setDemoSaid] = useState<string | null>(null);
  const held = useFigureFiles(t.id);
  const said = saidOf(tap);
  const answered = sent !== null && said !== null && (
    (said.at !== null && said.at > sent.at) || (said.text !== sent.before && !sameText(said.text, sent.text))
  );

  // The answer lands in place: read again every few seconds until it does, or for two minutes.
  useEffect(() => {
    if (!sent || sent.gaveUp || answered || demo) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > TALK_POLL.FOR) {
        window.clearInterval(timer);
        setSent((x) => (x ? { ...x, gaveUp: true } : x));
        return;
      }
      reload();
    }, TALK_POLL.EVERY);
    return () => window.clearInterval(timer);
  }, [sent?.at, sent?.gaveUp, answered, demo, reload]);
  // A demo row answers after a beat; nothing was sent.
  useEffect(() => {
    if (!demo || !sent) return;
    setDemoSaid(null);
    const timer = window.setTimeout(() => setDemoSaid(DEMO_ANSWER.TEXT), DEMO_ANSWER.AFTER);
    return () => window.clearTimeout(timer);
  }, [demo, sent?.at]);

  // Opened (or asked to by the menu's Reply, or a drop): the line takes the keys, its caret after what was typed.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el || el.disabled || leaving) return;
    focusCompanionInput();
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, [focusKey, field, view?.reply.open, leaving]);

  const onSend = async (text: string): Promise<TapInReplyOutcome> => {
    const before = said?.text ?? null;
    const files = held.files;
    const outcome = await acts.reply(text, files);
    if (outcome === "sent") {
      setSent({ text: sentEcho(text, files), at: Date.now(), before });
      clearFigureFiles(t.id);
    }
    return outcome;
  };
  const jump = jumpOf(acts, view?.kind === "native" ? view.terminal : null, view?.header.lives ?? "");
  // ⌘↩ allows the open request, ⌘I opens its Details, ⌘O takes the way in, ⌘T the quick terminal, from anywhere in the card.
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (!e.metaKey || e.altKey || e.ctrlKey) return;
    const key = e.key.toLowerCase();
    if (key === "i" && onDetails) { e.preventDefault(); onDetails(); }
    else if (key === "o" && jump) { e.preventDefault(); void jump.go(); }
    else if (key === "t" && acts.quickTerminal) { e.preventDefault(); void acts.quickTerminal(); }
    else if (e.key === "Enter" && allowRef.current?.()) e.preventDefault();
  };

  const ask = view?.ask ?? null;
  const askSays = ask ? [ask.heading, ask.reason, ask.command, ask.detail] : demoAsk ? [demoAsk.heading] : [];
  const lines = talkLines({
    history: view?.history ?? [],
    callout: calloutOf(tap),
    sent: sent ? { text: sent.text, at: sent.at } : null,
    answer: demo ? demoSaid : null,
    hide: askSays,
  });
  const loading = Boolean(data?.loading);
  const waiting = sent && !sent.gaveUp && !answered && !(demo && demoSaid);
  const replyOpen = demo || Boolean(view?.reply.open);
  const replyLine = view?.reply ?? { open: true, placeholder: "Reply…" };
  const who = rowName(t);
  return (
    <div className="arv-talk" onKeyDown={keys}>
      {error && <p className="tap-err arv-talk__err" role="alert">{error}</p>}
      {ask && <AskBlock ask={ask} now={now} onFocus={view?.kind === "native" && ask.focusable ? acts.openTerminal ?? acts.openCodex ?? acts.focus : undefined} onOpenThread={acts.openThread} onAnswered={setReceipt} allowRef={allowRef} />}
      {!ask && demoAsk && <DemoAsk ask={demoAsk} now={now} allowRef={allowRef} />}
      {!ask && receipt && <Receipt label={receipt} />}
      {lines.length > 0
        ? (
          <ol className="arv-talk__lines" aria-label={`Recent turns with ${who}`}>
            {lines.map((l) => (
              <li key={l.id} className={l.you ? "is-you" : undefined} title={hoverText(l.text)}>
                <span className="arv-talk__who">{l.you ? "you" : who}</span>
                <span className="arv-talk__line">{plainLine(l.text)}</span>
              </li>
            ))}
          </ol>
        )
        : !ask && !demoAsk && <p className="tap-quiet">{loading ? "Reading…" : "Nothing said yet."}</p>}
      {waiting && <p className="tap-quiet arv-talk__wait" role="status">Waiting for its answer</p>}
      {held.note && <p className="tap-err arv-talk__err" role="status">{held.note}</p>}
      <div className="arv-talk__foot">
        {replyOpen
          ? (
            <ReplyLine
              key={t.id}
              reply={replyLine}
              delivery={reply}
              settlement={replySettlement}
              onSend={onSend}
              onDraft={onDraft}
              inputRef={field}
              initial={figureDraft(t.id)}
              onText={(text) => keepDraft(t.id, text)}
              files={held.files}
              attaching={held.attaching > 0}
              onRemoveFile={(id) => removeFigureFile(t.id, id)}
              mic
            />
          )
          : held.files.length > 0 && <p className="tap-quiet">No live session or thread to send these to.</p>}
        {onDetails && <button type="button" className="tap-open arv-talk__details" title="What it is doing, its ways in and everything else" onClick={onDetails}>Details <kbd>⌘I</kbd></button>}
      </div>
    </div>
  );
}

// ── the right-click menu ─────────────────────────────────────────────────

export type FigureMenuProps = {
  t: CornerThread;
  machineId?: string | null;
  demo?: boolean;
  /** The roster's agents: with them, Interrupt is offered where the runtime can stop the turn. */
  agents?: readonly Agent[] | null;
  name: string;
  width: number;
  /** Where it was asked for; it keeps itself on the screen. */
  at: { x: number; y: number };
  hitId: string;
  elRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  /** Reply or Show latest: open the talk card (and its line). */
  onTalk: () => void;
  /** Details: everything that isn't talking to it (the Tap in panel). */
  onDetails: () => void;
  /** Back to the board, for an agent on the desk. */
  onHome?: () => void;
  /** A board row: pin it and stand it on the desk. Rejects with the reason it could not. */
  onBringOut?: () => Promise<void>;
  /** Every open request the runtime can clear: Clear all requests, with its confirm. */
  clearAll?: ClearAll | null;
  onDemoAnswer?: (id: string) => void;
};

/** The facts the menu is built from (figureMenuItems), off Tap in's view and acts. */
export function figureMenuFacts(tap: TapIn, ask: TapInAsk | null, demo: boolean, own: Pick<FigureMenuFacts, "bringOut" | "home" | "clearAll"> = {}): FigureMenuFacts {
  const { view, acts, target } = tap;
  const askable = ask?.item ? ask : null;
  return {
    canReply: demo || Boolean(view?.reply.open),
    ask: tap.demoAsk
      ? { options: [], decisions: [{ label: "Allow once", go: true }, { label: "Deny", go: false }], dismiss: null, reveal: false }
      : askable
        ? {
          options: askable.item?.answer ? askable.options : [],
          // Every decision, Allow always among them; the one accent goes to Allow once.
          decisions: askable.decisions.map((d) => ({ label: d.label, go: d.action === leadApprove(askable.decisions.map((x) => x.action)) })),
          dismiss: askable.dismiss?.label ?? null,
          reveal: Boolean(askable.item?.permission),
        }
        : null,
    interrupt: Boolean(acts.interrupt),
    stop: acts.stop && view?.kind === "work" && view.stop ? view.stop.agent : null,
    openSession: Boolean(acts.openSession),
    focus: acts.focus ? acts.focusJump?.label ?? (view?.kind === "native" ? terminalPlace(view.terminal, view.header.lives)?.label : null) ?? "Go to the session" : null,
    quick: Boolean(acts.quickTerminal),
    copyAttach: Boolean(acts.copyAttach),
    openThread: Boolean(acts.openThread),
    openWork: Boolean(acts.openWork),
    pr: view?.kind === "native" && Boolean(view.pr),
    copyRef: demo ? null : target.kind === "native" ? "session" : target.workId ? "work" : null,
    ...own,
  };
}

/** How long a menu that just said "Copied" or "Sent" stays up to say it. */
const SAID_MS = 700;
/** The menu keeps this far from the screen's edges. */
const MENU_INSET = 8;

export function FigureMenu({ t, machineId, demo = false, agents, name, width, at, hitId, elRef, onClose, onTalk, onDetails, onHome, onBringOut, clearAll = null, onDemoAnswer }: FigureMenuProps) {
  const tap = useTapIn({ thread: t, machineId, demo, agents, immediate: true, onDemoAnswer });
  const { view, acts, target, error, setError } = tap;
  // The open request, as soon as the row carries one, before the reads land.
  const ask = view?.ask ?? (t.request ? askFromItem(t.request) : null);
  const groups = figureMenuItems(figureMenuFacts(tap, ask, demo, {
    bringOut: Boolean(onBringOut),
    home: Boolean(onHome),
    clearAll: clearAll?.count ?? 0,
  }));
  const [line, setLine] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closing.current), []);
  const sayThenClose = (text: string) => {
    setLine(text);
    closing.current = window.setTimeout(onClose, SAID_MS);
  };
  // Kept on the screen after every draw (its items arrive with the reads): near the right or the bottom, it opens left or up of the pointer.
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = at.x + r.width > window.innerWidth - MENU_INSET ? Math.max(MENU_INSET, at.x - r.width) : at.x;
    const top = at.y + r.height > window.innerHeight - MENU_INSET ? Math.max(MENU_INSET, at.y - r.height) : at.y;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  });
  // Opened: the first item takes the keys, as a native menu's does.
  useEffect(() => {
    focusCompanionInput();
    elRef.current?.querySelector<HTMLElement>("[role^='menuitem']")?.focus({ preventScroll: true });
  }, [elRef]);

  /** A way in: closes once it went through; stays open on its reason. */
  const go = (run?: () => Promise<boolean>) => {
    if (!run || pending) return;
    setLine(null);
    setPending(true);
    void run().then((ok) => { setPending(false); if (ok) onClose(); });
  };
  const copy = (text: string) => {
    setError(null);
    void navigator.clipboard.writeText(text).then(() => sayThenClose("Copied."), () => setLine("Couldn't copy."));
  };
  const run = (item: FigureMenuItem) => {
    const key: FigureMenuKey = item.key;
    switch (key) {
      case "reply": case "latest": onClose(); onTalk(); return;
      case "details": onClose(); onDetails(); return;
      case "home": onClose(); onHome?.(); return;
      case "bring-out":
        if (!onBringOut || pending) return;
        setLine(null);
        setPending(true);
        void onBringOut().then(
          () => { setPending(false); onClose(); },
          (cause) => { setPending(false); setLine(cause instanceof Error && cause.message ? cause.message : "Could not bring it out."); },
        );
        return;
      case "open-session": return go(acts.openSession);
      case "focus": return go(acts.focus);
      case "quick": return go(acts.quickTerminal);
      case "open-thread": return go(acts.openThread);
      case "open-work": return go(acts.openWork);
      case "interrupt": return go(acts.interrupt);
      case "stop":
        if (!armed) { setArmed(true); return; }
        setArmed(false);
        return go(acts.stop);
      case "copy-attach":
        if (acts.copyAttach) void acts.copyAttach().then((ok) => (ok ? sayThenClose("Copied.") : setLine("Couldn't copy.")));
        return;
      case "copy-ref": {
        const ref = target.kind === "native" ? target.sessionRef : target.workId;
        if (ref) copy(ref);
        return;
      }
      case "reveal": {
        const id = ask?.item?.permission?.requestId;
        if (!id) return;
        setPending(true);
        void revealRequestSession(id).then((r) => { setPending(false); if (r.ok) sayThenClose(r.line); else setLine(r.line); });
        return;
      }
      default:
        return;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = Array.from(elRef.current?.querySelectorAll<HTMLElement>("[role^='menuitem']:not(:disabled)") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : stepMenu(i, items.length, e.key === "ArrowDown" ? 1 : -1);
    items[next]?.focus({ preventScroll: true });
  };

  const pr = view?.kind === "native" ? view.pr : null;
  const item = (i: FigureMenuItem) => {
    if (i.key === "open-pr" && pr) {
      return <a key={i.key} role="menuitem" className="cw-menu__item" href={pr.url} target="_blank" rel="noreferrer" title={pr.url} onClick={() => onClose()}>{i.label}</a>;
    }
    if (i.key === "clear-all" && clearAll) {
      return <ClearAllRequests key={i.key} clear={clearAll} look="menu" onDone={(ok) => { if (ok) closing.current = window.setTimeout(onClose, SAID_MS); }} />;
    }
    if (i.key === "stop" && armed) {
      return (
        <span key={i.key} className="cw-menu__confirm" role="group" aria-label={i.label}>
          <p className="cw-menu__head">{i.confirm}</p>
          <button type="button" role="menuitem" className="cw-menu__item" onClick={() => run(i)}>Stop work</button>
          <button type="button" role="menuitem" className="cw-menu__item" onClick={() => setArmed(false)}>Keep</button>
        </span>
      );
    }
    return (
      <button key={i.key} type="button" role="menuitem" className={`cw-menu__item${i.go ? " is-go" : ""}`} disabled={pending} onClick={() => run(i)}>
        {i.label}
        {i.hint && <kbd className="cw-menu__key">{i.hint}</kbd>}
      </button>
    );
  };
  const requestItems = (items: FigureMenuItem[]) => tap.demoAsk
    ? <DemoRequestItems key="request" items={items} answer={tap.demoAsk.answer} onClose={onClose} />
    : ask?.item
      ? <RequestItems key="request" ask={ask} item={ask.item} items={items} onOpenThread={acts.openThread} onSettled={sayThenClose} onLine={setLine} />
      : null;

  return (
    <div
      ref={elRef}
      className="cw-menu is-figure"
      role="menu"
      aria-label={name}
      data-hit={hitId}
      style={{ left: at.x, top: at.y, width }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={onKeyDown}
    >
      <p className="cw-menu__title">{name}</p>
      {groups.map((g, gi) => {
        const requests = g.filter((i) => i.request);
        const first = requests[0]?.key;
        return (
          <div key={gi} role="group" className="cw-menu__group">
            {gi > 0 && <hr className="cw-menu__sep" />}
            {g.map((i) => (i.request ? (i.key === first ? requestItems(requests) : null) : item(i)))}
          </div>
        );
      })}
      {(line || error) && <p className="cw-menu__error" role="status">{line ?? error}</p>}
    </div>
  );
}

/** The request's own answers and decisions, through the same hook as the Requests page and Scoutbot. */
function RequestItems({ ask, item, items, onOpenThread, onSettled, onLine }: {
  ask: TapInAsk;
  item: NonNullable<TapInAsk["item"]>;
  items: FigureMenuItem[];
  onOpenThread?: () => void;
  onSettled: (line: string) => void;
  onLine: (line: string | null) => void;
}) {
  const { busy, delivery, answer, act } = useRequestActions(item, () => onOpenThread?.());
  // Keep the menu up until the runtime settles it; say why on a refusal.
  const said = useRef<string | null>(null);
  useEffect(() => {
    if (!delivery || delivery.state === "sending") return;
    const key = `${delivery.state}:${delivery.label}`;
    if (said.current === key) return;
    said.current = key;
    if (delivery.state === "delivered") onSettled(`Sent · ${delivery.label}`);
    else if (delivery.state === "unconfirmed") onLine("No reply from Scout. Check the session before deciding again.");
    else onLine(delivery.reason ?? "Refused.");
  }, [delivery, onSettled, onLine]);
  const pick = (i: FigureMenuItem) => {
    onLine(null);
    const [kind, n] = i.key.split(":");
    if (kind === "answer") void answer(ask.options[Number(n)]!);
    else if (kind === "decide") void act(ask.decisions[Number(n)]!.action);
    else if (i.key === "dismiss" && ask.dismiss) void act(ask.dismiss.action);
  };
  return (
    <>
      {items.map((i) => (
        <button key={i.key} type="button" role="menuitem" className={`cw-menu__item${i.go ? " is-go" : ""}`} disabled={busy} onClick={() => pick(i)}>
          {i.label}
        </button>
      ))}
    </>
  );
}

/** A demo row's ask: Allow once / Deny move the script on; nothing is sent. */
function DemoRequestItems({ items, answer, onClose }: { items: FigureMenuItem[]; answer: () => void; onClose: () => void }) {
  return (
    <>
      {items.map((i) => (
        <button key={i.key} type="button" role="menuitem" className={`cw-menu__item${i.go ? " is-go" : ""}`} onClick={() => { answer(); onClose(); }}>
          {i.label}
        </button>
      ))}
    </>
  );
}

/** A line's hover text: the whole of a short line, the start of a long one (the line itself is cut at two rows). */
export function hoverText(text: string, max = 280): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : t;
}
