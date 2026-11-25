import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

import { DictationMic, type MicStatus } from "../../../components/DictationMic.tsx";
import { VoiceWaveform } from "../../../components/MessageComposer/VoiceWaveform.tsx";
import { PaneView } from "../../../components/PaneView.tsx";
import { TerminalScreen } from "../../../components/TerminalScreen.tsx";
import { focusCompanionInput } from "../../../lib/companion-host.ts";
import type { Agent } from "../../../lib/types.ts";
import type { ClearAll } from "../../requests/clear-requests.ts";
import { failedDelivery } from "../../requests/request-delivery.ts";
import { leadApprove, requestActionTitle } from "../../requests/requests-model.ts";
import { useRequestActions, type RequestDelivery } from "../../requests/use-request-actions.ts";
import { OPENED_HERE, useSessionReveal } from "../../requests/request-session.ts";
import { replyToEndedSession, sessionInterruptAgent } from "../../sessions/session-delivery.ts";
import { ageLabel } from "../companion-model.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { sinceClock } from "./arrivals-model.ts";
import { prefersReducedMotion } from "./board-motion.ts";
import { ClearAllRequests } from "./ClearAll.tsx";
import { LabelTag, Marks } from "./Ident.tsx";
import type { FigureLabel } from "./figure-labels.ts";
import { TapText, plainLine } from "./TapText.tsx";
import {
  canOpenTapInSession,
  cancelWorkAsk,
  setTaskNotify,
  interruptSession,
  openTapInSession,
  openTapInThread,
  openTapInWork,
  openQuickTerminal,
  answerSessionPrompt,
  revealPath,
  sendNativeReply,
  sessionPageUrl,
  sendWorkReply,
  terminalGo,
  useTapInData,
  type TapInData,
} from "./tap-in-data.ts";
import {
  TAP_IN,
  TAP_IN_HIT_ID,
  TAP_IN_SIZE,
  TAP_IN_VARS,
  QUICK_PLACE,
  nativeView,
  remarkTone,
  sameText,
  tapInRemark,
  tapInTarget,
  tilde,
  workView,
  type TapInAsk,
  type TapInDecision,
  type TapInHeader,
  type TapInInPlace,
  type TapInNotch,
  type TapInNativeView,
  type TapInPlacement,
  type TapInRemark,
  type TapInReply,
  type TapInTailRow,
  type TapInTarget,
  type TapInTranscript,
  type TapInWorkView,
  type TapInPlace,
  type TapInTerminal,
  tapInPlaces,
  terminalPlace,
} from "./tap-in-model.ts";
import { clearFigureFiles, engageRoute, figureFiles, removeFigureFile, subscribeFigureFiles, type EngageFile } from "./engage-model.ts";
import { TalkBody } from "./FigureTalk.tsx";
import { useQuickTerminalShown } from "./QuickTerminal.tsx";
import "./tap-in.css";

/*
 * Tap in (Studio: /studies/companion-board-rewrites, Tap in; light, Studio
 * /studies/companion-board-light). The board holds still; a panel opens
 * beside it (above it in stack mode) for the tapped row: who and its remark,
 * the title, where it is; then what it said last, whole, and only what helps
 * act on it (a request, its steps while it works, the files it changed, one
 * way in, and a reply line that types into the live process in place).
 *
 * On the board it opens first as the engage panel (level "engage"): who and
 * its remark, then the engage body a figure's card shows (TalkBody: its open
 * request, the last few turns, the reply line), as tall as that and at the
 * tapped row. Details is a step on (level "details"), and Esc steps back.
 *
 * Details is everywhere they are asked for (a row's menu, a figure's menu,
 * ⌘I, the engage panel's link): under the said line, the
 * facts of what is going on (host, harness, model, folder, branch, session,
 * state), how its figure is drawn when it stands on the desk, and the
 * actions that aren't quick (Interrupt, Stop work, copy its ref, Back to the
 * board, Clear all requests).
 * Another row crossfades the content in place; the panel itself does not
 * move, and beside the board it may grow to fit the new row but never
 * shrinks while it is open. Closing folds it back to the board.
 */

// ── what the board drives ────────────────────────────────────────────────

/** What the board's keys reach in the panel. */
export type TapInHandle = {
  /** ⌘O: the primary place (Open session, else Open thread, else Open work). */
  primary(): void;
  /** ⌘T: the quick terminal; false when the row has no pane to show. */
  quick(): boolean;
  /** ⌘↩: Allow on a backed permission request; false when there is nothing to allow. */
  allow(): boolean;
  /** Typing anywhere: focus the reply line; false when it is closed. */
  focusReply(): boolean;
};

export type TapInPanelProps = {
  /** The tapped row, as the board has it this pass. */
  thread: CornerThread;
  /** Where it sits (tapInPlacement); the box is in viewport pixels (the panel is position: fixed). */
  placement: TapInPlacement;
  /** Folding back toward the board; `onClosed` fires once it has (TAP_IN.FOLD, at once under Reduce Motion). */
  closing?: boolean;
  /** The fold finished: unmount the panel now. */
  onClosed?: () => void;
  /**
   * The board's pass clock; ages read against it, so nothing in the panel
   * ages between passes. A native session's ages also move when a new step
   * lands in its Tail (the newest step the panel has heard).
   */
  now?: number;
  /** The board's pass counter: everything but the Tail re-reads when it changes. */
  pass?: number;
  /** The row's remark as the board shows it (word, remarkAt, hhAt, mmAt, since); the row's state word when absent. */
  remark?: Partial<TapInRemark> | null;
  /** The server lane's transcript fields (title, attention), when the board has them. */
  transcript?: TapInTranscript | null;
  /** The machine a native row runs on; this Mac when absent. */
  machineId?: string | null;
  /** Demo rows: nothing is read or sent. */
  demo?: boolean;
  /** Filled while open, for the board's keys. */
  handle?: { current: TapInHandle | null };
  /** The panel's hit region id in edge mode (`data-hit`). */
  hitId?: string;
  className?: string;
  onClose: () => void;
  /** The reply line holds a draft: the board should not fold. */
  onDraft?: (busy: boolean) => void;
  /** Demo rows: an asking row's Allow once / Deny move the scripted row on (as the board's strip does); nothing is sent. */
  onDemoAnswer?: (id: string) => void;
  /** The roster's agents: with them, Interrupt is offered where the runtime can stop the turn. */
  agents?: readonly Agent[] | null;
  /** On the desk: how its figure is drawn (FigureSettings), and the way back to the board. */
  figure?: ReactNode;
  /** Its roster label (figure-labels.ts): the one its figure wears. */
  label?: FigureLabel;
  onHome?: () => void;
  /** Every open request the runtime can clear. */
  clearAll?: ClearAll | null;
  /** The engage panel (its request, last turns and reply line) or Details (everything). Details when absent. */
  level?: "engage" | "details";
  /** From the engage panel: this agent's Details (its link, ⌘I). */
  onDetails?: () => void;
};

/** The panel's notch pointing at the tapped row (tapInTether); nothing in stack mode. */
export function TapInTether({ box, closing = false }: { box: TapInNotch | null; closing?: boolean }) {
  if (!box) return null;
  const { point, near, ...at } = box;
  const cls = `tap-tether is-${point}${near === "bottom" ? " is-low" : ""}${closing ? " is-closing" : ""}`;
  return <i className={cls} style={{ ...TAP_IN_VARS, ...at } as CSSProperties} aria-hidden />;
}

export function TapInPanel(props: TapInPanelProps) {
  const { thread, placement, closing = false, hitId = TAP_IN_HIT_ID, className, onClose, onClosed, level = "details" } = props;
  const reduced = prefersReducedMotion();
  const closed = useRef(onClosed);
  closed.current = onClosed;
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => closed.current?.(), reduced ? 0 : TAP_IN.FOLD);
    return () => window.clearTimeout(timer);
  }, [closing, reduced]);
  const [leaving, setLeaving] = useState<{ thread: CornerThread; n: number } | null>(null);
  const prev = useRef(thread);
  /** The row the panel opened on is read at once; rows ↑/↓ move to wait for the selection to rest. */
  const openedOn = useRef(thread.id);
  const swaps = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  // Another row: the old content fades out over the new one; the panel holds still.
  useLayoutEffect(() => {
    const before = prev.current;
    prev.current = thread;
    if (before.id === thread.id || reduced || closing) return;
    const n = ++swaps.current;
    setLeaving({ thread: before, n });
    timers.current.push(window.setTimeout(() => setLeaving((l) => (l?.n === n ? null : l)), TAP_IN.SWAP));
  }, [thread, reduced, closing]);

  // Details: the tallest it has stood this open, so a shorter row never shrinks it and the panel holds still across a swap.
  // The engage panel is as tall as what it holds, so it starts over at each level.
  const panel = useRef<HTMLElement | null>(null);
  const [tallest, setTallest] = useState(0);
  const fitted = Boolean(placement.fit) && level === "details";
  useEffect(() => {
    const el = panel.current;
    setTallest(0);
    if (!fitted || !el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setTallest((h) => Math.max(h, el.offsetHeight)));
    watch.observe(el);
    return () => watch.disconnect();
  }, [fitted]);

  const out = leaving && leaving.thread.id !== thread.id && !closing ? leaving.thread : null;
  const { box, fit } = placement;
  // Fitted, it hangs from the box's top or stands on its bottom (translated up by its own height),
  // never shorter than the board or the tallest it has stood this open, never past the box.
  const style = (fit
    ? { ...TAP_IN_VARS, left: box.left, top: fit.grow === "down" ? box.top : box.top + box.height, width: box.width, minHeight: Math.min(Math.max(fit.min, tallest), box.height), maxHeight: box.height, transform: fit.grow === "up" ? "translateY(-100%)" : undefined }
    : { ...TAP_IN_VARS, left: box.left, top: box.top, width: box.width, height: box.height }) as CSSProperties;
  return (
    <aside
      ref={panel}
      className={`tap-panel is-${placement.mode} from-${placement.from}${fit ? " is-fit" : ""}${closing ? " is-closing" : ""} is-${level}${className ? ` ${className}` : ""}`}
      style={style}
      data-hit={hitId}
      aria-label={`Tapped: ${thread.task}`}
    >
      <button type="button" className="tap-x" aria-label="Close the panel" title="Close · esc" onClick={onClose}>
        <CloseMark />
      </button>
      {out && <TapInLayer key={`${level}:${out.id}`} {...props} thread={out} phase="leaving" immediate={false} />}
      <TapInLayer key={`${level}:${thread.id}`} {...props} thread={thread} phase={out ? "entering" : "still"} immediate={thread.id === openedOn.current} />
    </aside>
  );
}

// ── one row's content ────────────────────────────────────────────────────

function TapInLayer(props: TapInPanelProps & { phase: "still" | "entering" | "leaving"; immediate: boolean }) {
  const { thread, phase, machineId, demo = false, pass, transcript, handle, onDraft, immediate, onDemoAnswer, agents, figure, label, onHome, clearAll, level = "details", onDetails } = props;
  const leaving = phase === "leaving";
  const tapIn = useTapIn({
    thread, machineId, demo, pass, frozen: leaving, immediate, transcript, remark: props.remark, now: props.now, onDemoAnswer, agents,
  });
  const { target, data, view, acts, reply, error, setError, receipt, setReceipt, replySettlement, now, remark, demoAsk } = tapIn;
  // A native session's ref copies from its Session fact; work keeps its own copy.
  const ref = demo || target.kind === "native" ? null : target.workId ? { label: "Copy work id", value: target.workId } : null;
  const allowRef = useRef<(() => boolean) | null>(null);
  const replyRef = useRef<HTMLTextAreaElement | null>(null);
  // The files dropped on this agent's figure (the card's own store): the reply line here sends them too.
  const held = useSyncExternalStore(subscribeFigureFiles, () => figureFiles(thread.id), () => figureFiles(thread.id));
  const replyFiles = useMemo(() => ({
    files: held.files, attaching: held.attaching > 0,
    remove: (id: string) => removeFigureFile(thread.id, id), clear: () => clearFigureFiles(thread.id),
  }), [held, thread.id]);

  // The board's keys reach the layer you are looking at, not one on its way out.
  useEffect(() => {
    if (leaving || !handle) return;
    const h: TapInHandle = {
      primary: () => { void (view ? jumpOfView(acts, view) : null)?.go(); },
      quick: () => {
        if (!acts.quickTerminal) return false;
        void acts.quickTerminal();
        return true;
      },
      allow: () => allowRef.current?.() ?? false,
      focusReply: () => {
        const el = replyRef.current;
        if (!el || el.disabled) return false;
        el.focus({ preventScroll: true });
        return true;
      },
    };
    handle.current = h;
    return () => {
      if (handle.current === h) handle.current = null;
    };
  });

  const layerClass = `tap-layer${phase === "entering" ? " is-entering" : phase === "leaving" ? " is-leaving" : ""}`;
  if (level === "engage") {
    return (
      <div className={layerClass} aria-hidden={leaving || undefined}>
        {view && <Head header={view.header} label={label} remark={remark} now={now} asking={Boolean(view.ask || demoAsk)} lean />}
        <div className="tap-body tap-engage">
          <TalkBody
            t={thread}
            tap={tapIn}
            demo={demo}
            onDraft={leaving ? undefined : onDraft}
            inputRef={replyRef}
            allowRef={leaving ? undefined : allowRef}
            onDetails={leaving ? undefined : onDetails}
            leaving={leaving}
          />
        </div>
      </div>
    );
  }
  return (
    <div className={layerClass} aria-hidden={leaving || undefined}>
      {view && (
        <TapInBody
          view={view}
          remark={remark}
          now={now}
          loading={Boolean(data?.loading)}
          rollAt={data?.rollAt ?? -Infinity}
          acts={acts}
          reply={reply}
          error={error}
          receipt={receipt}
          replySettlement={replySettlement}
          onAnswered={setReceipt}
          allowRef={leaving ? undefined : allowRef}
          replyRef={replyRef}
          onDraft={leaving ? undefined : onDraft}
          demoAsk={demoAsk}
          label={label}
          replyFiles={leaving ? undefined : replyFiles}
          more={leaving ? null : (
            <TapInMore
              facts={view.facts}
              figure={figure}
              interrupt={acts.interrupt}
              copyRef={ref}
              onHome={onHome}
              clearAll={clearAll}
              onError={setError}
            />
          )}
        />
      )}
    </div>
  );
}

/**
 * The Details under what it said: the facts of what is going on, how its
 * figure is drawn (on the desk), and the actions that aren't quick. Stop
 * work, the pull request and the way in stay in the foot with the reply.
 */
function TapInMore({ facts, figure, interrupt, copyRef, onHome, clearAll, onError }: {
  facts: ReadonlyArray<readonly [string, string]>;
  figure?: ReactNode;
  interrupt?: () => Promise<boolean>;
  copyRef: { label: string; value: string } | null;
  onHome?: () => void;
  clearAll?: ClearAll | null;
  onError: (error: string | null) => void;
}) {
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(null), 2000);
    return () => clearTimeout(t);
  }, [said]);
  const acts = Boolean(interrupt || copyRef || onHome);
  if (!facts.length && !figure && !acts && !clearAll) return null;
  return (
    <section className="tap-more" aria-label="Details">
      {facts.length > 0 && (
        <dl className="tap-facts">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              {k === "Session"
                ? <dd><CopyRef value={v} onError={onError} /></dd>
                : <dd title={v}>{v}</dd>}
            </div>
          ))}
        </dl>
      )}
      {figure && <div className="tap-more__figure" role="group" aria-label="Figure"><p className="tap-more__label">Figure</p>{figure}</div>}
      {acts && (
        <nav className="tap-more__acts" aria-label="More">
          {interrupt && (
            <Act title="Stop its current turn" onClick={() => {
              if (busy) return;
              setBusy(true);
              void interrupt().then((ok) => { setBusy(false); if (ok) setSaid("Interrupted"); });
            }}>Interrupt</Act>
          )}
          {copyRef && (
            <Act title={copyRef.value} onClick={() => {
              onError(null);
              void navigator.clipboard.writeText(copyRef.value).then(() => setSaid("Copied"), () => onError("Couldn't copy."));
            }}>{copyRef.label}</Act>
          )}
          {onHome && <Act title="Take it off the desk" onClick={onHome}>Back to the board</Act>}
          {said && <span className="tap-more__said" role="status">{said}</span>}
        </nav>
      )}
      {clearAll && <ClearAllRequests clear={clearAll} look="line" />}
    </section>
  );
}

/** A session ref by its short id (the last segment, 8 characters); the title holds it whole, a click copies it. */
export function shortRef(ref: string): string {
  return (ref.split(":").filter(Boolean).at(-1) ?? ref).slice(0, 8);
}

function CopyRef({ value, onError }: { value: string; onError: (error: string | null) => void }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button type="button" className="tap-ref" title={`Copy ${value}`} aria-label={`Copy session ref ${value}`} onClick={() => {
      onError(null);
      void navigator.clipboard.writeText(value).then(() => setCopied(true), () => onError("Couldn't copy."));
    }}>{shortRef(value)} <span aria-hidden="true">{copied ? "Copied" : "⧉"}</span></button>
  );
}

// ── one row's reads and actions, for the panel and the desk ──────────────

export type UseTapInOptions = {
  thread: CornerThread;
  /** The machine a native row runs on; this host when absent. */
  machineId?: string | null;
  /** Demo rows: nothing is read or sent. */
  demo?: boolean;
  pass?: number;
  /** Reads hold still (a layer on its way out). */
  frozen?: boolean;
  /** Read at once instead of waiting for the selection to rest. */
  immediate?: boolean;
  transcript?: TapInTranscript | null;
  remark?: Partial<TapInRemark> | null;
  now?: number;
  onDemoAnswer?: (id: string) => void;
  /** The roster's agents: with them, Interrupt is offered where the runtime can stop the turn (sessionInterruptAgent). */
  agents?: readonly Agent[] | null;
};

export type TapIn = {
  target: TapInTarget;
  data: TapInData | null;
  reload: () => void;
  view: TapInNativeView | TapInWorkView | null;
  acts: TapInActs;
  /** The reply line's last send. */
  reply: RequestDelivery | null;
  error: string | null;
  setError: (error: string | null) => void;
  receipt: string | null;
  replySettlement?: number;
  setReceipt: (label: string | null) => void;
  now: number;
  remark: TapInRemark;
  demoAsk: TapInBodyProps["demoAsk"];
};

/**
 * One row's reads and what can be done with it: the view model, the reply
 * path and every way in. The panel draws it whole; the desk's figures draw
 * the same reads and acts as a talk card and a right-click menu, so a reply,
 * an Allow or a jump goes the one way whichever surface it starts from.
 */
export function useTapIn(o: UseTapInOptions): TapIn {
  const { thread, machineId, demo = false, pass, frozen = false, immediate = false, transcript, onDemoAnswer, agents } = o;
  const target = useMemo(() => tapInTarget(thread, { machineId }), [thread, machineId]);
  const active = thread.state === "working" || thread.state === "asking";
  const { data, reload } = useTapInData(target, { pass, demo, frozen, immediate, active });
  const quickShown = useQuickTerminalShown();
  const [reply, setReply] = useState<RequestDelivery | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [replySettlement, setReplySettlement] = useState(0);
  // The pass clock; a native session's Tail also moves it when a new step lands (never past the wall clock).
  const heard = target.kind === "native" ? Math.min(Date.now(), (data?.tail ?? []).reduce((m, e) => Math.max(m, e.ts), 0)) : 0;
  const now = Math.max(o.now ?? Date.now(), heard);
  const remark = tapInRemark(thread, o.remark);

  const view = useMemo((): TapInNativeView | TapInWorkView | null => {
    if (!data) return null;
    if (target.kind === "native") {
      return nativeView({
        target, thread, lookup: data.lookup, touched: data.touched, steer: data.steer, tail: data.tail, aiTitle: data.aiTitle, prUrl: data.prUrl,
        transcript, localNodeId: data.localNodeId, now, remark: remark.word, observeTurns: data.observeTurns,
        messages: data.messages,
      });
    }
    return workView({ target, thread, detail: data.detail, messages: data.messages, tail: data.tail, now, remark: remark.word });
  }, [target, thread, data, transcript, now, remark.word]);

  const signalAsk = view?.kind === "native" && view.ask && !view.ask.item ? view.ask.heading : null;
  const askedBefore = useRef<{ key: string; heading: string | null }>({ key: target.key, heading: null });
  useEffect(() => {
    if (!view) return;
    if (askedBefore.current.key === target.key && askedBefore.current.heading && !signalAsk) {
      setReceipt("Answered · the prompt closed");
      setReplySettlement((generation) => generation + 1);
      setReply((r) => r && r.state !== "refused" ? null : r);
    }
    askedBefore.current = { key: target.key, heading: signalAsk };
  }, [view, signalAsk, target.key]);

  /** Says what failed, in one line; resolves false so a caller can stay open on it. */
  const fail = (fallback: string) => (cause: unknown) => {
    setError(cause instanceof Error && cause.message ? cause.message : fallback);
    return false;
  };
  const done = () => true;
  // A native session's own place is the session; its thread is offered for a request that came with one,
  // or for a session Scout started in a conversation (the board's Conversation link before Tap in).
  const conversationId = target.kind === "native"
    ? target.request?.conversationId ?? target.conversationId ?? null
    : target.conversationId ?? target.request?.conversationId ?? data?.detail?.conversationId ?? null;
  const acts: TapInActs = {
    reveal: (path, by) => {
      setError(null);
      revealPath({ path, ...by }).catch(fail("Could not reveal that file."));
    },
    reply: async (text, files = []) => {
      setError(null);
      const label = view?.kind === "native" ? `into ${view.header.lives || "the session"}` : `to ${view?.kind === "work" ? view.owner : "the thread"}`;
      if (demo) {
        setReply({ state: "delivered", label: `${label} · demo` });
        return "sent";
      }
      const local = target.kind !== "native" || !target.machineId || target.machineId === data?.localNodeId;
      const resume = view?.kind === "native" && view.reply.resume === true;
      const route = engageRoute({ kind: view?.kind === "native" ? "native" : "work", local, conversationId, resume }, text, files);
      if (route.via === "none") {
        setReply({ state: "refused", label, reason: route.reason });
        return "kept";
      }
      let via = route.via === "thread" && view?.kind === "native" ? "to its thread" : route.via === "resume" ? "resuming the session" : label;
      setReply({ state: "sending", label: via });
      if (route.via === "resume" && view?.kind === "native") {
        // Nothing holds the session (nativeReply): the reply route types it in where it is open, else resumes it.
        const sent = await replyToEndedSession(view.delivery!, route.text, crypto.randomUUID());
        if (!sent.ok) {
          setReply({ state: "refused", label: via, reason: sent.reason });
          return "kept";
        }
        if (sent.inPlace) via = `into ${sent.location || "the session"}`;
      } else if (route.via === "session" && view?.kind === "native") {
        // The line is open only once the session resolves (nativeReply).
        const sent = await sendNativeReply(view.delivery!, route.text);
        if (sent.state === "refused") {
          setReply({ state: "refused", label: via, reason: sent.reason });
          return "kept";
        }
        if (sent.state === "unconfirmed") {
          setReply({ state: "unconfirmed", label: via });
          return "held";
        }
      } else if (route.via === "thread") {
        try {
          await sendWorkReply(route.conversationId, route.text, route.attachments);
        } catch (cause) {
          const settled = failedDelivery(via, cause, "Not sent.");
          setReply(settled);
          return settled.state === "refused" ? "kept" : "held";
        }
      }
      setReply({ state: "delivered", label: `${via} · ${sinceClock(Date.now())}` });
      reload();
      return "sent";
    },
  };
  if (target.kind === "native") {
    // Only inside the Scout app (its host opens the session); a demo row shows where it would be.
    if (canOpenTapInSession() || demo) {
      acts.openSession = async () => {
        setError(null);
        if (demo) { setError("A demo row has no session to open."); return false; }
        const opened = await openTapInSession(target).catch(() => false);
        if (!opened) setError("This Scout app can't open sessions yet.");
        return opened;
      };
    }
    const terminal = view?.kind === "native" ? view.terminal : null;
    // A background session opens in the companion's own pop-up when the page draws one.
    const quickContext = view?.kind === "native" && quickShown && !demo
      ? { who: view.header.speaker, title: view.header.title, at: Number.isFinite(thread.at) ? thread.at : null }
      : undefined;
    const go = terminalGo(terminal, quickContext);
    if (go) {
      const run = async () => {
        setError(null);
        const result = await go.run().catch((cause: unknown) => ({ ok: false as const, reason: cause instanceof Error ? cause.message : "Could not open the session." }));
        if (!result.ok) setError(result.reason);
        else if ("app" in result && result.app) setReceipt(`Opened in ${result.app}`);
        return result.ok;
      };
      // The talk card/menu use this same generic live action; the panel also names its destination.
      acts.focus = run;
      const place = terminalPlace(terminal, view?.kind === "native" ? view.header.lives : "");
      if (place) acts.focusJump = { label: place.label, title: place.title };
      if (go.to === "open-terminal") acts.openTerminal = run;
      else if (go.to === "codex") acts.openCodex = run;
    }
    // Its tmux pane in the companion's own pop-up, where the page draws one: no terminal app, no new process.
    const pane = view?.kind === "native" ? view.pane : null;
    if (pane && quickShown && !demo && view?.kind === "native") {
      const context = { who: view.header.speaker, title: view.header.title, at: Number.isFinite(thread.at) ? thread.at : null };
      acts.quickTerminal = async () => {
        setError(null);
        const shown = await openQuickTerminal(pane, context);
        if (shown.ok) return true;
        // The pane moved or went: a detached tmux still has its terminal app way in.
        if (go?.to === "open-terminal" && terminal?.via === "attach") return acts.openTerminal!();
        setError(shown.reason);
        return false;
      };
    }
    if (terminal?.via === "attach") {
      const command = terminal.command;
      acts.copyAttach = () => navigator.clipboard.writeText(command).then(() => true, () => false);
    }
    if (!demo) {
      const url = sessionPageUrl(target);
      acts.openPage = async () => { window.open(url, "_blank", "noopener,noreferrer"); return true; };
    }
    // Interrupt: only where the runtime's route can stop this very turn (a tmux agent in a turn, here).
    const delivery = view?.kind === "native" ? view.delivery : null;
    const agent = delivery && agents ? sessionInterruptAgent(delivery, agents.find((a) => a.id === delivery.agentId)) : null;
    if (agent && delivery && !demo) {
      acts.interrupt = () => {
        setError(null);
        return interruptSession(agent.id, delivery.sessionId).then(() => { reload(); return true; }, fail("Could not interrupt it."));
      };
    }
  }
  if (conversationId) {
    acts.openThread = () => {
      setError(null);
      return openTapInThread({ workId: target.kind === "work" ? target.workId : null, conversationId }).then(done, fail("Could not open the thread."));
    };
  }
  if (target.kind === "work" && target.workId) {
    const workId = target.workId;
    acts.openWork = () => {
      setError(null);
      return openTapInWork(workId).then(done, fail("Could not open the work."));
    };
  }
  const stop = view?.kind === "work" ? view.stop : null;
  if (stop && !demo) {
    acts.stop = () => {
      setError(null);
      return cancelWorkAsk(stop).then(() => { reload(); return true; }, fail("Could not stop the work."));
    };
  }
  const notify = view?.kind === "work" ? view.notify : null;
  if (notify && !demo) {
    acts.notify = (on) => setTaskNotify(notify.flightId, on).then((held) => { reload(); return held; });
  }
  // A demo ask: Allow once / Deny move the scripted row on, as the board's strip does.
  const demoAsk = demo && onDemoAnswer && thread.state === "asking" && !view?.ask
    ? { heading: thread.now, at: thread.at, answer: () => onDemoAnswer(thread.id) }
    : null;

  return { target, data, reload, view, acts, reply, error, setError, receipt, setReceipt, replySettlement, now, remark, demoAsk };
}

// ── the content, from the view model ─────────────────────────────────────

/**
 * What the panel's controls do. An action left out is not offered. Each one
 * resolves true once it went through, or false once it said why not (`error`),
 * so a menu can stay open on the reason.
 */
export type TapInActs = {
  openSession?: () => Promise<boolean>;
  openThread?: () => Promise<boolean>;
  openWork?: () => Promise<boolean>;
  /** Jump to the live terminal (terminalOf): any host on a server with the focus route, else a herdr pane. */
  focus?: () => Promise<boolean>;
  /** The band's words for that jump, named for the app it opens. */
  focusJump?: { label: string; title: string };
  /** A tmux nobody is attached to: copy its attach command instead. Resolves false when the copy failed. */
  copyAttach?: () => Promise<boolean>;
  /** A session no window shows: open a terminal app on its attach command (claude attach, tmux attach). */
  openTerminal?: () => Promise<boolean>;
  /** Its tmux pane in the companion's quick terminal pop-up (⌘T); only where the page draws one. */
  quickTerminal?: () => Promise<boolean>;
  /** A Codex thread the ChatGPT app holds: open it there. */
  openCodex?: () => Promise<boolean>;
  /** Its page in Scout on the web. */
  openPage?: () => Promise<boolean>;
  /** Cancel the operator's ask while the work runs. */
  stop?: () => Promise<boolean>;
  /** Hear, or stop hearing, when the running work is done (core Ready). Resolves to the mark the runtime holds. */
  notify?: (on: boolean) => Promise<boolean>;
  /** Stop the agent's current turn (a tmux agent in a turn); only with the roster's agents. */
  interrupt?: () => Promise<boolean>;
  reveal: (path: string, by?: { basePath?: string | null; agentId?: string | null; sessionId?: string | null }) => void;
  /**
   * How the reply settled, for the line: "sent" clears it; "kept" (refused,
   * nothing typed) puts the text back; "held" (unconfirmed, it may have been
   * typed) puts it back but will not send it again until it is edited.
   */
  reply: (text: string, files?: readonly EngageFile[]) => Promise<TapInReplyOutcome>;
};

export type TapInReplyOutcome = "sent" | "kept" | "held";

export type TapInBodyProps = {
  view: TapInNativeView | TapInWorkView;
  remark: TapInRemark;
  now: number;
  /** Its roster label (figure-labels.ts). */
  label?: FigureLabel;
  /** The row's first read is in flight: empty sections say "Reading…", not that there is nothing. */
  loading?: boolean;
  /** Date.now() when the newest tail step arrived live. */
  rollAt: number;
  acts: TapInActs;
  /** The reply line's last send. */
  reply: RequestDelivery | null;
  /** An action that failed, in one line. */
  error: string | null;
  /** The last answer delivered from here, said once its request has gone. */
  receipt?: string | null;
  replySettlement?: number;
  onAnswered?: (label: string) => void;
  allowRef?: { current: (() => boolean) | null };
  replyRef?: { current: HTMLTextAreaElement | null };
  onDraft?: (busy: boolean) => void;
  /** A demo row's ask: shown with Allow once / Deny that move the script on; nothing is sent. */
  demoAsk?: { heading: string; at: number; answer: () => void } | null;
  /** The Details under the said line (TapInMore). */
  more?: ReactNode;
  /** Files dropped on this agent's figure: they go with the reply, and sending clears them. */
  replyFiles?: { files: readonly EngageFile[]; attaching: boolean; remove: (id: string) => void; clear: () => void };
};

/**
 * One anatomy for both kinds (Studio /studies/companion-board-light): who and
 * its remark, the title, where it is; your prompt when the title isn't it;
 * then what it said last, whole. Below that only what helps act on it: a
 * request, its steps while it works, the files it changed, one way in, and
 * the reply line when there is a live process to type into.
 */
export function TapInBody({ view: v, remark, now, loading = false, rollAt, acts, reply, error, receipt, replySettlement = 0, onAnswered, allowRef, replyRef, onDraft, demoAsk, more = null, label, replyFiles }: TapInBodyProps) {
  const jump = jumpOfView(acts, v);
  const native = v.kind === "native" ? v : null;
  // The terminal ways in, as one Go to: tmux (its pane in the pop-up here, ⌘T) or the window or pane it lives in (⌘O).
  const popUp = useQuickTerminalShown();
  const goWord = jump ? goToWord(jump.to, native?.terminal ?? null, native?.header.lives ?? "", popUp) : null;
  const quickWay = acts.quickTerminal && jump?.to !== "quick" ? acts.quickTerminal : undefined;
  const work = v.kind === "work" ? v : null;
  // Live in a terminal: where it lives is a link to it, unless the way in already goes there.
  const toTerminal = native && acts.focus && jump?.to !== "terminal" ? acts.focus : undefined;
  const asked = native ? native.asked : work?.asked && !sameText(work.asked.task, v.header.title) ? work.asked.task : null;
  const ask = v.ask;
  // An output or a blocker says it; a question once answered here steps back to what it said last.
  const callout = work?.callout && !(receipt && work.callout.tone === "question") ? work.callout : null;
  const last = callout ? callout.text : v.last?.text ?? null;
  // An open request already says what it wants: its words are not said twice.
  const askSays = ask ? [ask.heading, ask.reason, ask.command, ask.detail] : demoAsk ? [demoAsk.heading] : [];
  // (the same line, or it cut short; never a longer message that merely opens the same way)
  const echoed = last !== null && askSays.some((t) => t && sameText(last, t) && last.trim().length <= t.trim().length + 1);
  const said = echoed ? null : last;
  // A blocker Scout observed is not the agent's own words: its label says so, plainly, above them.
  const observed = said && callout?.tone === "blocker" ? callout.label : null;
  const steps = v.live ? v.tail.slice(0, TAP_IN_SIZE.STEPS) : [];
  // Its latest update: the newest step or the line it said, whichever came last.
  const latestAt = Math.max(v.tail[0]?.ts ?? -Infinity, v.last?.at ?? -Infinity);
  const stop = acts.stop && work?.stop ? { agent: work.stop.agent, onStop: acts.stop } : null;
  const notify = acts.notify && work?.notify ? { on: work.notify.on, flightId: work.notify.flightId, onSet: acts.notify } : null;
  const foot = Boolean(jump || native?.pr || stop || notify || v.reply.open);
  // The files it changed (or made) open in Finder. They are reference, not the quick read: folded under the details.
  const hasFiles = Boolean((native?.touched && native.touched.files.length > 0) || (work && work.made.length > 0));
  const filesFold = hasFiles ? (
    <details className="tap-files-fold">
      <summary>{work ? "Files it made" : "Files it changed"}</summary>
            {native?.touched && native.touched.files.length > 0 && (
              <p className="tap-files">
                {native.touched.files.map((f) => (
                  <button key={f.path} type="button" className="tap-file" title={`Reveal in Finder · ${tilde(f.path)}`} onClick={() => acts.reveal(f.path, native.revealBy)}>
                    {f.name}
                  </button>
                ))}
                {native.touched.more > 0 && <i>+{native.touched.more} more</i>}
              </p>
            )}
            {work && work.made.length > 0 && (
              <p className="tap-files">
                {work.made.map((l) => {
                  const name = l.display.split("/").pop() || l.display;
                  // Reveal goes by who wrote it: a file with no agent or session to vouch for it is named, not linked.
                  if (!l.material.agentId && !l.material.sessionId) return <span key={l.material.id} className="tap-file is-named" title={`${l.label} · ${l.material.path}`}>{name}</span>;
                  return (
                    <button
                      key={l.material.id}
                      type="button"
                      className="tap-file"
                      title={`${l.label} · Reveal in Finder · ${l.material.path}`}
                      onClick={() => acts.reveal(l.material.path, { basePath: l.material.worktreeRoot, agentId: l.material.agentId, sessionId: l.material.sessionId })}
                    >
                      {name}
                    </button>
                  );
                })}
              </p>
            )}
    </details>
  ) : null;
  return (
    <>
      <Head
        header={v.header}
        label={label}
        remark={remark}
        now={now}
        asking={Boolean(ask || demoAsk)}
        onLives={toTerminal}
        copyAttach={acts.copyAttach}
        attach={native?.terminal?.via === "attach" ? native.terminal.command : null}
      />
      {error && <p className="tap-err" role="alert">{error}</p>}

      <div className="tap-body">
        {asked && <p className="tap-you"><span>you</span>{plainLine(asked)}</p>}
        {ask && <AskBlock ask={ask} now={now} onFocus={native && ask.focusable ? liveGo(acts) : undefined} onOpenThread={acts.openThread} onAnswered={onAnswered} allowRef={allowRef} />}
        {ask && !ask.item && receipt && <Receipt label={receipt} />}
        {!ask && demoAsk && <DemoAsk ask={demoAsk} now={now} allowRef={allowRef} />}
        {!ask && receipt && <Receipt label={receipt} />}

        {said && Number.isFinite(latestAt) && <p className="tap-latest">Latest <Since at={latestAt} now={now} /></p>}
        {observed && <p className="tap-quiet">{observed}</p>}
        {said
          ? <div className="tap-said tap-md"><TapText text={said} /></div>
          : !echoed && <p className="tap-quiet">{loading ? "Reading…" : "Nothing said yet."}</p>}

        {steps.length > 0 && <Steps rows={steps} rollAt={rollAt} />}

        {more}
        {filesFold}
      </div>

      {foot && (
        <footer className="tap-foot">
          {(jump || native?.pr || stop || notify) && (
            <nav className="tap-ways" aria-label="Actions">
              {(goWord || quickWay) && (
                <span className="tap-goto" role="group" aria-label="Go to">
                  <span className="tap-goto__lead" aria-hidden="true">Go to</span>
                  {quickWay && <button type="button" className="tap-way" title={QUICK_PLACE.title} aria-label="Go to tmux" onClick={quickWay}>tmux <kbd>⌘T</kbd></button>}
                  {jump && goWord && <button type="button" className="tap-way" title={jump.title} aria-label={`Go to ${goWord}`} onClick={jump.go}>{goWord} <kbd>⌘O</kbd></button>}
                </span>
              )}
              {jump && !goWord && <button type="button" className="tap-way" title={jump.title} onClick={jump.go}>{jump.label} <kbd>⌘O</kbd></button>}
              {native?.pr && (
                <a className="tap-pr" href={native.pr.url} target="_blank" rel="noreferrer" title={`${native.pr.url} · opens in the browser`}>
                  {native.pr.label} <Arrow />
                </a>
              )}
              {notify && <NotifyToggle key={notify.flightId} on={notify.on} onSet={notify.onSet} />}
              {stop && <StopWork agent={stop.agent} onStop={stop.onStop} />}
            </nav>
          )}
          {/* Replies type into the live process only; with none to reach there is no line. */}
          {v.reply.open && (
            <ReplyLine
              reply={v.reply}
              delivery={reply}
              settlement={replySettlement}
              onSend={async (text) => {
                const outcome = await acts.reply(text, replyFiles?.files ?? []);
                if (outcome === "sent") replyFiles?.clear();
                return outcome;
              }}
              onDraft={onDraft}
              inputRef={replyRef}
              files={replyFiles?.files}
              attaching={replyFiles?.attaching}
              onRemoveFile={replyFiles?.remove}
              mic
            />
          )}
        </footer>
      )}
    </>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────

/**
 * A terminal way in, named for where it lands under Go to: "tmux" (its pane
 * in the companion's pop-up), "pane" or "window" (where it already lives),
 * "new window" (a terminal app opened on it), "ChatGPT". Null for a way in
 * that is not a terminal (a page, a thread), which keeps its own label.
 */
export function goToWord(to: TapInPlace["to"], terminal: TapInTerminal | null, lives: string, popUp: boolean): string | null {
  switch (to) {
    case "quick": return "tmux";
    case "terminal": return terminal?.via === "herdr" || /\b(tmux|herdr|orca)\b/iu.test(lives) ? "pane" : "window";
    case "open-terminal": return terminal?.via === "job" && popUp ? "tmux" : "new window";
    case "codex": return "ChatGPT";
    default: return null;
  }
}

/** The live place's action: its terminal, a terminal opened on it, or the ChatGPT app. */
function liveGo(acts: TapInActs): (() => Promise<boolean>) | undefined {
  return acts.focus ?? acts.openTerminal ?? acts.openCodex;
}

function jumpOfView(acts: TapInActs, v: TapInNativeView | TapInWorkView) {
  return v.kind === "native" ? jumpOf(acts, v.terminal, v.header.lives) : jumpOf(acts, null, "");
}

/** The one way in: the first of tapInPlaces, where the session itself is, and ⌘O. */
export function jumpOf(acts: TapInActs, terminal: TapInTerminal | null = null, lives: string = ""): (TapInPlace & { go: () => Promise<boolean> }) | null {
  const go: Record<TapInPlace["to"], (() => Promise<boolean>) | undefined> = {
    terminal: acts.focus, quick: acts.quickTerminal, "open-terminal": acts.openTerminal, codex: acts.openCodex,
    page: acts.openPage, window: acts.openSession, thread: acts.openThread, work: acts.openWork,
  };
  const places = tapInPlaces({
    terminal: liveGo(acts) ? terminal : null, lives, quick: Boolean(acts.quickTerminal),
    page: Boolean(acts.openPage), window: Boolean(acts.openSession), thread: Boolean(acts.openThread), work: Boolean(acts.openWork),
  });
  for (const place of places) {
    const run = go[place.to];
    if (run) return { ...place, go: run };
  }
  return null;
}

/** Who (as on its row) and its remark, the title, and where it is; lean (the engage panel), who and its remark only. */
function Head({ header, label, remark, now, asking, onLives, copyAttach, attach, lean = false }: {
  header: TapInHeader; remark: TapInRemark; now: number; asking: boolean; lean?: boolean;
  /** Its roster label, beside who it is. */
  label?: FigureLabel;
  /** Jump to the live terminal it lives in. */
  onLives?: () => void;
  /** No terminal attached to its tmux: copy the attach command (`attach`) instead. */
  copyAttach?: () => Promise<boolean>; attach?: string | null;
}) {
  const lives = header.lives;
  return (
    <header className="tap-head">
      <div className="tap-who">
        <Marks project={header.project} harness={header.harness} agent={header.speaker} />
        <b className="tap-speaker">{header.speaker}</b>
        <LabelTag label={label} />
        <StateClock word={remark.word} at={remark.at} now={now} tone={remarkTone(remark, asking)} />
      </div>
      {!lean && <h3 title={header.titleHint ?? undefined}>{header.title}</h3>}
      {!lean && (header.where || lives) && (
        <p className="tap-place">
          <span className="tap-place__where">{header.where}</span>
          {lives && (onLives
            ? <button type="button" className="tap-link tap-lives is-live" title={`Jump to it: ${lives}`} onClick={onLives}>{lives} <Arrow /></button>
            : <span className="tap-lives">{lives}{copyAttach && attach && <CopyAttach command={attach} copy={copyAttach} />}</span>)}
        </p>
      )}
    </header>
  );
}

/**
 * How long it has been in its state. While it works or asks, a running timer
 * to the tenth of a second; once settled, a plain duration. Only this span
 * re-renders as it ticks.
 */
function StateClock({ word, at, now: base, tone }: { word: string; at: number; now: number; tone?: "accent" | "dim" }) {
  const live = word === "WORKING" || word === "ASKING";
  const now = useTick(base, live ? 100 : 15_000);
  const known = Number.isFinite(at);
  return (
    <span className="tap-clock" data-tone={tone} title={known ? `Since ${sinceClock(at)}` : undefined}>
      <span className="tap-clock__word">{word.charAt(0) + word.slice(1).toLowerCase()}</span>
      {known && <time className="tap-clock__time">{live ? runningTime(now - at) : shortSpan(now - at)}</time>}
    </span>
  );
}

/** "8s ago", kept current. */
function Since({ at, now: base }: { at: number; now: number }) {
  const now = useTick(base, 1000);
  return <time title={sinceClock(at)}>{shortSpan(now - at)} ago</time>;
}

/** The panel's `now`, carried forward by real elapsed time every `ms`. A
 * frozen `now` (a demo, a test) renders as given on the first frame. */
function useTick(base: number, ms: number): number {
  const [now, setNow] = useState(base);
  useEffect(() => {
    const start = Date.now();
    setNow(base);
    const id = setInterval(() => setNow(base + Date.now() - start), ms);
    return () => clearInterval(id);
  }, [base, ms]);
  return now;
}

/** 4:12.3, or 1:04:12.3 past the hour. */
export function runningTime(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const s = Math.floor(tenths / 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(s / 3600);
  const m = Math.floor(s / 60) % 60;
  return `${h ? `${h}:${pad(m)}` : m}:${pad(s % 60)}.${tenths % 10}`;
}

/** 8s, 12m, 3h, 2d. */
export function shortSpan(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** A detached tmux: one quiet link that copies its attach command, then says whether it did. */
function CopyAttach({ command, copy }: { command: string; copy: () => Promise<boolean> }) {
  const [said, setSaid] = useState<string | null>(null);
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(null), 2000);
    return () => clearTimeout(t);
  }, [said]);
  return (
    <button type="button" className="tap-link is-quiet tap-attach" title={`Copy: ${command}`}
      onClick={() => void copy().then((ok) => setSaid(ok ? "copied" : "couldn't copy"))}>
      {said ?? "copy attach"}
    </button>
  );
}

/** A quiet action: a link-styled button. */
function Act({ children, title, onClick }: { children: ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" className="tap-act" title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * Notify when done: the runtime marks the task Ready when it finishes, so it comes back to you with Continue and
 * Hold. A toggle on the running flight; a refusal (it already finished) says why and leaves the mark as it was.
 */
export function NotifyToggle({ on: held, onSet }: { on: boolean; onSet: (on: boolean) => Promise<boolean> }) {
  const [on, setOn] = useState(held);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setOn(held); }, [held]);
  const flip = () => {
    if (busy) return;
    const next = !on;
    setBusy(true); setError(null); setOn(next);
    onSet(next).then(
      (now) => setOn(now),
      (cause) => { setOn(!next); setError(cause instanceof Error && cause.message ? cause.message : "Not changed."); },
    ).finally(() => setBusy(false));
  };
  const title = error ?? (on ? "It comes back to you as Ready when it is done. Click to stop." : "Mark it Ready when it is done, so it comes back to you.");
  return (
    <button type="button" className={`tap-act tap-notify${on ? " is-on" : ""}${error ? " is-error" : ""}`} aria-pressed={on} disabled={busy} title={title} onClick={flip}>
      {on ? "Notify on" : "Notify when done"}
    </button>
  );
}

/** Stop work cancels the work's ask (its own flight); it asks once before it does. */
function StopWork({ agent, onStop }: { agent: string; onStop: () => void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <Act title={`Cancels the ask to ${agent}`} onClick={() => setArmed(true)}>Stop work</Act>;
  return (
    <span className="tap-confirm" role="group" aria-label="Stop work">
      Cancel the ask to {agent}?
      <button type="button" className="tap-act" onClick={() => { setArmed(false); onStop(); }}>Stop work</button>
      <button type="button" className="tap-act" onClick={() => setArmed(false)}>Keep</button>
    </span>
  );
}

/** Its newest steps while it works, newest on top; a step that just arrived rolls in. */
export function Steps({ rows, rollAt }: { rows: TapInTailRow[]; rollAt: number }) {
  const rolling = Date.now() - rollAt < TAP_IN.ROLL;
  const top = rows[0]!;
  return (
    <ol className={`tap-steps${rolling ? " is-rolling" : ""}`} key={rolling ? `${top.id}:${top.repeat}` : "still"} aria-label="Steps">
      {rows.map((r) => (
        <li key={r.id} data-status={r.running ? "working" : r.status}>
          <b>{r.tool}</b>
          <span title={r.title}>{r.text}{r.repeat > 1 ? <em> ×{r.repeat}</em> : null}</span>
        </li>
      ))}
    </ol>
  );
}

// ── the request block (ScoutbotRequest, on the board's material) ─────────

export function AskBlock({ ask, now, onFocus, onOpenThread, onAnswered, allowRef }: {
  ask: TapInAsk;
  now: number;
  onFocus?: () => void;
  onOpenThread?: () => void;
  onAnswered?: (label: string) => void;
  allowRef?: { current: (() => boolean) | null };
}) {
  if (ask.item) return <RequestAsk ask={ask} item={ask.item} now={now} onFocus={onFocus} onOpenThread={onOpenThread} onAnswered={onAnswered} allowRef={allowRef} />;
  if (ask.inPlace) return <BackgroundAsk ask={ask} inPlace={ask.inPlace} now={now} onFocus={onFocus} onAnswered={onAnswered} allowRef={allowRef} />;
  return <AskView ask={ask} now={now} delivery={null} busy={false} onFocus={onFocus} />;
}

/**
 * A background session's permission prompt, answered here: the server
 * attaches, checks its screen shows this same call, presses the key and
 * hangs up. A refusal sends nothing and leaves Open in a terminal as the way;
 * once a key may have gone out, the answers go so it is never pressed twice.
 */
function BackgroundAsk({ ask, inPlace, now, onFocus, onAnswered, allowRef }: {
  ask: TapInAsk;
  inPlace: TapInInPlace;
  now: number;
  onFocus?: () => void;
  onAnswered?: (label: string) => void;
  allowRef?: { current: (() => boolean) | null };
}) {
  const [state, setState] = useState<{ busy: boolean; delivery: RequestDelivery | null; line: string | null; sent: boolean }>({ busy: false, delivery: null, line: null, sent: false });
  // A new call on the same card starts over.
  useEffect(() => { setState({ busy: false, delivery: null, line: null, sent: false }); }, [inPlace.toolUseId]);
  const answer = async (choice: TapInInPlace["answers"][number]) => {
    setState({ busy: true, delivery: { state: "sending", label: choice.label }, line: "Attaching and checking the screen…", sent: false });
    const result = await answerSessionPrompt(inPlace, choice.decision);
    if (result.ok) {
      setState({ busy: false, delivery: { state: "delivered", label: result.answer ?? choice.label }, line: null, sent: true });
      onAnswered?.(`Answered ${result.answer ?? choice.label}`);
    } else {
      setState({ busy: false, delivery: null, line: result.reason, sent: result.sent });
    }
  };
  const lead = inPlace.answers.find((a) => a.decision === "approve");
  const open = !state.sent && !state.busy;
  useEffect(() => {
    if (!allowRef) return;
    allowRef.current = lead && open ? () => { void answer(lead); return true; } : null;
    return () => {
      allowRef.current = null;
    };
  });
  return (
    <AskView
      ask={ask}
      now={now}
      delivery={state.delivery}
      busy={state.busy}
      onFocus={onFocus}
      inPlace={{ answers: state.sent ? [] : inPlace.answers, lead, busy: state.busy, onAnswer: (choice) => { void answer(choice); }, line: state.line }}
    />
  );
}

/** A served request: answered through the same hook as the Requests page and Scoutbot. */
function RequestAsk({ ask, item, now, onFocus, onOpenThread, onAnswered, allowRef }: {
  ask: TapInAsk;
  item: NonNullable<TapInAsk["item"]>;
  now: number;
  onFocus?: () => void;
  onOpenThread?: () => void;
  onAnswered?: (label: string) => void;
  allowRef?: { current: (() => boolean) | null };
}) {
  const { busy, delivery, answer, act } = useRequestActions(item, () => onOpenThread?.());
  // A permission's session, in the companion's terminal pop-up (else a terminal app). A pane already shown here needs none.
  const reveal = useSessionReveal(ask.pane ? null : item.permission?.requestId);
  const terminal = reveal.go
    ? { go: reveal.go, going: reveal.going, line: reveal.result && reveal.result.line !== OPENED_HERE ? reveal.result.line : null }
    : undefined;
  // ⌘↩ allows once: it never keeps a rule, whatever order the harness listed its options in.
  const approve = ask.decisions.find((d) => d === leadDecision(ask.decisions));
  // A dismissal carries nothing on: the runtime ended the request, so nothing reaches the thread or the session.
  const dismissing = useRef(false);
  const settled = delivery?.state === "delivered";
  // Ended: the runtime closed the request, so nothing is left to decide.
  const closed = settled || delivery?.state === "ended";
  const answered = settled ? (dismissing.current ? delivery.label : [delivery.label, ask.carries].filter(Boolean).join(" · ")) : null;
  useEffect(() => {
    if (answered) onAnswered?.(ask.ready ? answered : `Answered ${answered}`);
  }, [answered, onAnswered, ask.ready]);
  useEffect(() => {
    if (!allowRef) return;
    allowRef.current = approve && !busy && !closed ? () => { void act(approve.action); return true; } : null;
    return () => {
      allowRef.current = null;
    };
  });
  return (
    <AskView
      ask={ask}
      now={now}
      delivery={delivery}
      busy={busy}
      onAnswer={(option) => { dismissing.current = false; void answer(option); }}
      onDecide={(d) => { dismissing.current = d.kind === "dismiss"; void act(d.action); }}
      onFocus={onFocus}
      terminal={terminal}
    />
  );
}

/** The decision Tap in leads with (its accent and ⌘↩): Allow once, never Allow always. */
function leadDecision(decisions: readonly TapInDecision[]): TapInDecision | undefined {
  const lead = leadApprove(decisions.map((d) => d.action));
  return decisions.find((d) => d.action === lead);
}

const DELIVERY_WORD: Record<RequestDelivery["state"], string> = { sending: "Sending", delivered: "Sent", refused: "Refused", ended: "Ended", unconfirmed: "Unconfirmed" };

function AskView({ ask, now, delivery, busy, onAnswer, onDecide, onFocus, terminal, inPlace }: {
  ask: TapInAsk;
  now: number;
  delivery: RequestDelivery | null;
  busy: boolean;
  onAnswer?: (option: string) => void;
  onDecide?: (decision: TapInDecision) => void;
  onFocus?: () => void;
  /** A permission's session: Open terminal, and its line when it didn't open in the pop-up. */
  terminal?: { go: () => void; going: boolean; line: string | null };
  /** A background session's prompt answered here (BackgroundAsk): its answers, and what came of the last one. */
  inPlace?: { answers: TapInInPlace["answers"]; lead: TapInInPlace["answers"][number] | undefined; busy: boolean; onAnswer: (choice: TapInInPlace["answers"][number]) => void; line: string | null };
}) {
  const settled = delivery?.state === "delivered" || delivery?.state === "ended";
  const chips = !settled && (ask.options.length > 0 || ask.decisions.length > 0 || ask.note || ask.dismiss || Boolean(inPlace?.answers.length));
  const lead = leadDecision(ask.decisions);
  return (
    <section className={`tap-ask${ask.ready ? " is-ready" : ""}`} aria-label={ask.kindLabel} aria-busy={busy || undefined}>
      <header>
        <span className="tap-ask__kind">{ask.kindLabel}</span>
        <span>{ageLabel(ask.at, now)} ago</span>
      </header>
      <h3>{ask.heading}</h3>
      {ask.reason && <p>{ask.reason}</p>}
      {/* A tmux pane, live; a Herdr pane has no live view here, so its capture stands, with Yes / No under it. */}
      {ask.pane?.backend === "tmux" ? <PaneView pane={ask.pane} who={ask.item?.agentName ?? null} fallback={ask.screen} lead={!ask.pane.prompt?.answerable} />
        : ask.screen && <TerminalScreen lines={ask.screen} />}
      {ask.command && <pre className="tap-ask__cmd" tabIndex={0} aria-label="Command to approve"><code>{ask.command}</code></pre>}
      {ask.target && <p className="tap-ask__target">{tilde(ask.target)}</p>}
      {ask.questions?.map((q, i) => (
        <div key={`q:${i}`} className="tap-ask__question">
          {q.header && <span className="tap-ask__qhead">{q.header}</span>}
          <p>{q.question}</p>
          {q.options.length > 0 && (
            <ul>
              {q.options.map((o, j) => <li key={`o:${j}`}><span>{o.label}</span>{o.description && <small>{o.description}</small>}</li>)}
            </ul>
          )}
        </div>
      ))}
      {ask.fields && (
        <dl className="tap-ask__fields">
          {ask.fields.map((f, i) => <div key={`f:${i}`}><dt>{f.key}</dt><dd>{f.value}</dd></div>)}
        </dl>
      )}
      {ask.cwd && <p className="tap-ask__folder"><span>Working folder</span>{tilde(ask.cwd)}</p>}
      {ask.detail && <p>{ask.detail}</p>}
      {chips && (
        <div className="tap-ask__acts">
          {onAnswer && ask.options.map((o) => (
            <button key={`answer:${o}`} type="button" className="tap-chip" disabled={busy} onClick={() => onAnswer(o)}>{o}</button>
          ))}
          {onDecide && ask.decisions.map((d, i) => (
            <button key={`${d.kind}:${i}`} type="button" className={`tap-chip${d === lead ? " is-go" : d.kind === "continue" ? " is-go is-ready" : ""}`} disabled={busy} onClick={() => onDecide(d)}
              title={ask.item ? requestActionTitle(ask.item, d.action) : undefined}>
              {d.label}
              {d === lead && <kbd>⌘↩</kbd>}
            </button>
          ))}
          {inPlace?.answers.map((a) => (
            <button key={`in-place:${a.decision}`} type="button" className={`tap-chip${a === inPlace.lead ? " is-go" : ""}`} disabled={inPlace.busy}
              title={a.decision === "approve" ? "Press the prompt's plain Yes, once. Never \"always allow\"." : "Press the prompt's No."}
              onClick={() => inPlace.onAnswer(a)}>
              {a.label}
              {a === inPlace.lead && <kbd>⌘↩</kbd>}
            </button>
          ))}
          {onFocus && ask.go && (
            <button type="button" className={`tap-chip${inPlace?.answers.length ? "" : " is-go"}`} title={ask.go.title} onClick={onFocus}>{ask.go.label}</button>
          )}
          {ask.note && (
            <span className="tap-ask__note">
              {ask.note}
              {onFocus && !ask.go && <>{" "}<button type="button" className="tap-act is-inline" onClick={onFocus}>Focus the pane</button></>}
            </span>
          )}
          {terminal && (
            <button type="button" className="tap-chip" disabled={terminal.going} title="Its session's terminal, watching until you jump in. Closing it leaves the session running." onClick={terminal.go}>Open terminal</button>
          )}
          {onDecide && ask.dismiss && (
            <button type="button" className="tap-chip" disabled={busy} onClick={() => onDecide(ask.dismiss!)}>{ask.dismiss.label}</button>
          )}
        </div>
      )}
      {terminal?.line && <p className="tap-ask__note" role="status">{terminal.line}</p>}
      {inPlace?.line && <p className="tap-ask__note" role="status">{inPlace.line}</p>}
      {(ask.technical || ask.techFoot) && (
        <details className="tap-ask__tech">
          <summary>Request details</summary>
          {ask.technical && <pre tabIndex={0} aria-label="Full permission request">{ask.technical}</pre>}
          {ask.techFoot && <p>{ask.techFoot}</p>}
        </details>
      )}
      {delivery && <DeliveryLine delivery={delivery} carries={ask.carries} />}
    </section>
  );
}

/** A demo row's ask (it carries no request): Allow once / Deny move the script on, ⌘↩ allows; nothing reaches the broker. */
export function DemoAsk({ ask, now, allowRef }: { ask: NonNullable<TapInBodyProps["demoAsk"]>; now: number; allowRef?: { current: (() => boolean) | null } }) {
  useEffect(() => {
    if (!allowRef) return;
    allowRef.current = () => { ask.answer(); return true; };
    return () => {
      allowRef.current = null;
    };
  });
  return (
    <section className="tap-ask" aria-label="Permission request">
      <header>
        <span className="tap-ask__kind">Permission request</span>
        <span>{ageLabel(ask.at, now)} ago</span>
      </header>
      <h3>{ask.heading}</h3>
      <div className="tap-ask__acts">
        <button type="button" className="tap-chip is-go" onClick={ask.answer}>Allow once<kbd>⌘↩</kbd></button>
        <button type="button" className="tap-chip" onClick={ask.answer}>Deny</button>
        <span className="tap-ask__note">Demo · nothing is sent.</span>
      </div>
    </section>
  );
}

/** What the last act did, once, its verb first and in bold: "Answered Allow once", "Opened in Ghostty". */
export function Receipt({ label }: { label: string }) {
  const space = label.indexOf(" ");
  const verb = space > 0 ? label.slice(0, space) : label;
  const rest = space > 0 ? label.slice(space + 1) : "";
  return (
    <p className="tap-delivery is-delivered tap-receipt" role="status">
      <b>{verb}</b>
      {rest && <span>{rest}</span>}
    </p>
  );
}

function DeliveryLine({ delivery, carries }: { delivery: RequestDelivery; carries: string }) {
  const note = delivery.state === "delivered" ? carries
    : delivery.state === "refused" || delivery.state === "ended" ? delivery.reason
      : delivery.state === "unconfirmed" ? "no reply from Scout. Check the session before deciding again."
        : null;
  return (
    <p className={`tap-delivery is-${delivery.state}`} role={delivery.state === "refused" || delivery.state === "unconfirmed" ? "alert" : "status"}>
      <b>{DELIVERY_WORD[delivery.state]}</b>
      {delivery.label && <span>{delivery.label}</span>}
      {note && <em>{note}</em>}
    </p>
  );
}

// ── the reply line ───────────────────────────────────────────────────────

/** Shared by both card and figure reply lines; settlement preserves later edits. */
export function useReplyDraft(initial: string, onText: ((text: string) => void) | undefined, settlement: number) {
  const [draft, setDraftState] = useState(initial);
  const text = useRef(onText);
  text.current = onText;
  const setDraft = (next: string | ((d: string) => string)) => setDraftState((d) => {
    const value = typeof next === "function" ? next(d) : next;
    text.current?.(value);
    return value;
  });
  const [pending, setPending] = useState<{ text: string; generation: number } | null>(null);
  const setHeld = (value: string | null, generation = settlement) => setPending(value === null ? null : { text: value, generation });
  useEffect(() => {
    if (!pending || pending.generation === settlement) return;
    setDraft((d) => (d.trim() === pending.text ? "" : d));
    setPending(null);
  }, [settlement, pending]);
  return { draft, setDraft, held: pending?.text ?? null, setHeld };

}

/** The reply field's tallest: four lines, then it scrolls. */
const REPLY_MAX_LINES = 4;

export function ReplyLine({ reply, delivery, settlement = 0, onSend, onDraft, inputRef, initial = "", onText, onKeyDown, autoFocus = false, files = [], attaching = false, onRemoveFile, mic = false }: {
  reply: TapInReply;
  delivery: RequestDelivery | null;
  /** The prompt it answered has closed: text held as unconfirmed is no longer in doubt. */
  settlement?: number;
  onSend: (text: string) => Promise<TapInReplyOutcome>;
  onDraft?: (busy: boolean) => void;
  inputRef?: { current: HTMLTextAreaElement | null };
  /** A draft kept from before (the desk keeps one per figure). */
  initial?: string;
  /** Every edit, so the draft can outlive the line. */
  onText?: (text: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
  /** Files going with the reply, as chips before the text; with one, the line sends without text. */
  files?: readonly EngageFile[];
  /** A drop is uploading. */
  attaching?: boolean;
  onRemoveFile?: (id: string) => void;
  /** Offer dictation. The mic shows its own state when voice is unavailable or needs permission. */
  mic?: boolean;
}) {
  const { draft, setDraft, held, setHeld } = useReplyDraft(initial, onText, settlement);
  const [micNote, setMicNote] = useState<string | null>(null);
  // The take in progress: its levels draw the waveform, its partial shows what has been heard so far.
  const [take, setTake] = useState<MicStatus | null>(null);
  const listening = take !== null && (take.state === "starting" || take.state === "recording" || take.state === "processing");
  const own = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const busy = Boolean(draft.trim()) || files.length > 0;
  useEffect(() => { onDraft?.(busy); }, [busy, onDraft]);
  useEffect(() => () => onDraft?.(false), [onDraft]);
  // The field grows with what is typed, a line at a time, up to four; past that it scrolls.
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    el.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 18;
    el.style.height = `${Math.min(el.scrollHeight, Math.ceil(line * REPLY_MAX_LINES))}px`;
  }, [draft]);
  const holding = held !== null && draft.trim() === held;
  const sending = delivery?.state === "sending";
  const ready = busy && !attaching && !sending && !holding;
  const hint = holding ? "Unconfirmed · it may have landed. Check the live session; edit to send again."
    : micNote && !listening ? micNote
      : delivery?.state === "unconfirmed" ? `Unconfirmed · ${delivery.label}. Check the live session before trying again.`
        : delivery ? `${DELIVERY_WORD[delivery.state]} · ${delivery.state === "refused" || delivery.state === "ended" ? delivery.reason : delivery.label}`
          : null;
  return (
    <form
      ref={formRef}
      className={`tap-reply${files.length || attaching ? " has-files" : ""}${ready ? " is-ready" : ""}${listening ? " is-listening" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        const text = draft.trim();
        if ((!text && !files.length) || attaching || sending || (text && text === held)) return;
        setDraft("");
        setHeld(null);
        const sentAt = settlement;
        void onSend(text).then((outcome) => {
          if (outcome === "sent") return;
          setDraft((d) => d || text);
          if (outcome === "held") setHeld(text, sentAt);
        });
      }}
    >
      <div className="tap-reply__box">
        {listening && take && (
          <span className="tap-reply__voice" role="status" aria-live="polite">
            <VoiceWaveform className="tap-reply__wave" samples={take.levels} active={take.state === "recording"} processing={take.state === "processing"} />
            <span className="tap-reply__heard">{heardLine(take)}</span>
          </span>
        )}
        {(files.length > 0 || attaching) && (
          <span className="tap-reply__files">
            {files.map((f) => (
              <button key={f.id} type="button" className="tap-file" title={`${f.fileName ?? "file"} · remove`} aria-label={`Remove ${f.fileName ?? "file"}`} onClick={() => onRemoveFile?.(f.id)}>
                <span>{f.fileName ?? "file"}</span><CloseMark />
              </button>
            ))}
            {attaching && <span className="tap-file is-busy" role="status">attaching…</span>}
          </span>
        )}
        <textarea
          ref={(el) => { own.current = el; if (inputRef) inputRef.current = el; }}
          className="tap-reply__field"
          rows={1}
          value={draft}
          placeholder={files.length ? "Add a line, or just send" : reply.placeholder}
          aria-label={reply.placeholder}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            // Return sends; Shift-Return starts a new line. A Return that ends an IME composition belongs to it.
            if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
          // The companion panel is not key until asked: typing lands only once the host makes it key.
          onFocus={focusCompanionInput}
          autoFocus={autoFocus}
          spellCheck={false}
        />
        <span className="tap-reply__tools">
          {mic && (
            <DictationMic
              className="tap-reply__mic"
              disabled={sending}
              onAppend={(said) => setDraft((d) => (d.trim() ? `${d.trimEnd()} ${said}` : said))}
              onError={(message) => setMicNote(message)}
              onStatus={(status: MicStatus) => { setMicNote(status.message); setTake(status); }}
            />
          )}
          <button type="submit" className="tap-reply__send" aria-label="Send" title="Send · Return" disabled={!ready}>
            <SendMark />
          </button>
        </span>
      </div>
      {hint && <span className={`tap-reply__hint${delivery && !micNote ? ` is-${delivery.state}` : ""}`} title={hint} role="status">{hint}</span>}
    </form>
  );
}

// ── marks ────────────────────────────────────────────────────────────────

function Arrow() {
  return (
    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8 8 4M4.5 4H8v3.5" />
    </svg>
  );
}

/** What the band in the reply box says during a take: the words so far (their tail, when long), else what it is doing. */
function heardLine(take: MicStatus): string {
  const said = take.partial.trim();
  if (said) return said.length > 90 ? `…${said.slice(-90)}` : said;
  return take.state === "processing" ? "Finishing the transcript…" : take.state === "starting" ? "Starting…" : "Listening…";
}

/** Send: an arrow up, out of the box. */
function SendMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 10V2.5M2.75 5.5 6 2.25 9.25 5.5" />
    </svg>
  );
}

export function CloseMark() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M2 2l6 6M8 2 2 8" />
    </svg>
  );
}
