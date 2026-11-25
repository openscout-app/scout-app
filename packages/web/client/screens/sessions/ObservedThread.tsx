import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { buildLaneAskDisplay, laneAskContextTagLabel } from "../../lib/lane-ask-display.ts";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import type { ObserveData, ObserveEvent } from "../../lib/types.ts";
import { readTurnBeats } from "../chat/turn-beats.ts";
import { TurnArtifacts } from "../chat/TurnBeats.tsx";
import {
  formatTurnDuration,
  sessionClockTime,
  SessionTurnActivity,
  useTraceConcise,
} from "../chat/SessionView.tsx";
import { observedSessionTurns, splitObservedTurn, type ObservedSessionTurn } from "./session-turns.ts";
import "../chat/conversation-screen.css";
import "../chat/session-view.css";
import "./observed-thread.css";
import { isVisualReply, SessionVisualReply } from "./SessionVisualReply.tsx";

/**
 * A session's transcript as a thread: each prompt, the work it set off folded
 * to one line, then the answer and what the turn made. A thread read from the
 * transcript and a Scout chat share this grammar and these blocks, so where a
 * session started does not change how it reads.
 */
export function ObservedThread({ data, working, timestamped, sessionStartMs, followEnd = false, modeToggle = true, onQuote, visuals = false }: {
  data: ObserveData;
  onQuote?: (text: string) => void;
  visuals?: boolean;
  working: boolean;
  /** The trace carries real times, so a turn can say how long it took. */
  timestamped: boolean;
  sessionStartMs?: number;
  /** Keep the newest turn in view as it grows. */
  followEnd?: boolean;
  /** Each turn draws Concise and Details; false when the thread draws one switch for all of them. */
  modeToggle?: boolean;
}) {
  // The start row is session setup, not work: the conversation leaves it to the trace.
  const turns = useMemo(
    () => observedSessionTurns({ ...data, events: data.events.filter((event) => event.kind !== "boot") }, working),
    [data, working],
  );
  const endRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!followEnd) return;
    const end = endRef.current;
    const scroller = end?.closest(".s-observe-main") as HTMLElement | null;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    else end?.scrollIntoView({ block: "end" });
  }, [followEnd, data.events.length]);

  // A stretch of trace with no prompt, no answer and no calls (notes, system lines) has nothing
  // to read: it would draw a lone "Observed work" fold. The details rail still shows the trace.
  const shown = useMemo(() => turns.filter(readableTurn), [turns]);

  return <div className="s-session-view s-observed-thread">
    {shown.length === 0 && <p className="s-observed-empty">Nothing in this session's transcript yet.</p>}
    {shown.map((turn, index) => <ObservedTurn key={turn.id} turn={turn} startOpen={index === shown.length - 1} timestamped={timestamped} sessionStartMs={sessionStartMs} modeToggle={modeToggle} onQuote={onQuote} visuals={visuals} />)}
    <div ref={endRef} aria-hidden="true" />
  </div>;
}

/** Whether a turn has anything the thread can show: words either way, or work. */
export function readableTurn(turn: Pick<ObservedSessionTurn, "working" | "prompt" | "work">): boolean {
  if (turn.working || turn.prompt.length > 0) return true;
  return turn.work.some((event) => event.kind === "message" || event.kind === "ask" || event.kind === "tool" || event.kind === "think");
}

function ObservedTurn({ turn, timestamped, sessionStartMs, modeToggle, onQuote, visuals, startOpen }: {
  startOpen: boolean;
  turn: ObservedSessionTurn;
  timestamped: boolean;
  sessionStartMs?: number;
  modeToggle: boolean;
  onQuote?: (text: string) => void;
  visuals: boolean;
}) {
  const [concise] = useTraceConcise();
  const { trace, answer } = useMemo(() => splitObservedTurn(turn), [turn]);
  // Nothing spins in a finished turn: a call that never returned stays the last call.
  const settled = useMemo(
    () => (turn.working ? trace : trace.map((event) => (event.live ? { ...event, live: false } : event))),
    [trace, turn.working],
  );
  const view = useMemo(
    () => (!turn.working && settled.length > 0 ? readTurnBeats(settled, { running: false }) : null),
    [settled, turn.working],
  );
  // A window with no prompt of its own is context from before the trace began.
  const lead = turn.boundary === "window" || !timestamped
    ? turn.working ? "Working" : "Observed work"
    : turn.working ? "Working" : `Worked for ${formatTurnDuration(turn.end - turn.start)}`;

  return <section className="s-observed-turn">
    {turn.prompt.map((event) => <ObservedPrompt key={event.id} event={event} />)}
    {(turn.working || settled.length > 0 || answer.length > 0) && <article className="s-thread-msg">
      <div className="s-thread-msg-card"><div className="s-thread-msg-card-content">
        {(settled.length > 0 || turn.working) && <SessionTurnActivity working={turn.working} lead={lead} events={settled} modeToggle={modeToggle} startOpen={startOpen && !turn.working && answer.length === 0} />}
        {answer.map((event) => <ObservedAnswer key={event.id} event={event} onQuote={onQuote} visuals={visuals && !turn.working} />)}
        {view && view.artifacts.length > 0 && <TurnArtifacts artifacts={view.artifacts} compact={concise} />}
      </div></div>
    </article>}
  </section>;
}

/**
 * The operator's words as a row. A turn the harness wrote on its own (a
 * reminder, a page of context, a task finishing) is a quiet line instead.
 */
function ObservedPrompt({ event }: { event: ObserveEvent }) {
  const display = useMemo(() => buildLaneAskDisplay(event), [event]);
  const words = display.operatorWords;
  if (!words) {
    const line = display.contextTags.map((tag) => tag.label ?? laneAskContextTagLabel(tag.name)).join(", ") || event.text;
    return <p className="s-observed-harness-turn">{line}</p>;
  }
  return <article className="s-thread-msg s-thread-msg--you" data-session-prompt={event.id}>
    <div className="s-thread-msg-card"><div className="s-thread-msg-card-content">
      <div className="s-thread-msg-body"><MessageMarkup text={words} /></div>
    </div></div>
    {event.at != null && <time className="s-session-you-time" dateTime={new Date(event.at).toISOString()}>{sessionClockTime(event.at)}</time>}
  </article>;
}

/** A question the agent put to the operator reads with its answer under it. */
function answerText(event: ObserveEvent): string {
  if (event.kind === "ask" && event.to) return `Question: ${event.text}${event.answer ? `\n\nAnswer: ${event.answer}` : ""}`;
  return event.text;
}

/** Selection stays local to one answer; clicking never submits the draft. */
function ObservedAnswer({ event, onQuote, visuals }: { event: ObserveEvent; onQuote?: (text: string) => void; visuals: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState("");
  const readSelection = () => {
    const selected = window.getSelection();
    setSelection(selected && body.current?.contains(selected.anchorNode) && body.current.contains(selected.focusNode) ? selected.toString().trim() : "");
  };
  return <div className="s-thread-msg-body s-session-answer" onMouseUp={onQuote ? readSelection : undefined} onKeyUp={onQuote ? readSelection : undefined}>
    <div ref={body}><MessageMarkup text={answerText(event)} renderCode={visuals ? (block, key) => isVisualReply(block)
      ? <SessionVisualReply key={key} block={block} /> : <pre key={key} className="s-message-markup-code"><code>{block.text}</code></pre> : undefined} /></div>
    {onQuote && selection && <button type="button" className="s-session-quote" title="Add the selected text to your draft" onMouseDown={(event) => event.preventDefault()} onClick={() => { onQuote(selection); setSelection(""); window.getSelection()?.removeAllRanges(); }}>Reply to selection</button>}
  </div>;
}
