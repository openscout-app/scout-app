/**
 * One request as a card: its kind, agent and age, where it came from, what
 * it asks, and the decisions its source backs (a question's own answers, a
 * Permission request's Allow and Deny, a pairing approval, the source's
 * links). The Requests page lists these; a Request panel and a Requests
 * panel's open row draw one. Nothing here is fabricated: no history, no
 * waiting-since, no decision the source did not declare.
 */
import { useEffect, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "../../components/ui/button.tsx";
import type { OperatorAttentionItem, Route } from "../../lib/types.ts";
import { TerminalScreen } from "../../components/TerminalScreen.tsx";
import { alwaysAllowLine, requestActionLabel, requestActionTitle, requestActions, requestKind, requestUpdatedAge, terminalScreen } from "./requests-model.ts";
import { useSessionReveal } from "./request-session.ts";
import { useRequestActions, type RequestActionFeedback } from "./use-request-actions.ts";
import { AskReply, AskWords } from "./AskParts.tsx";
import { askText } from "./ask-text.ts";
import { RequestProgress } from "./RequestProgress.tsx";
import "./requests.css";

export function RequestCard({ item, now, navigate, feedback, onFeedback, onDismiss }: {
  item: OperatorAttentionItem; now: number; navigate: (route: Route) => void;
  /** What a decision on this card left, from whichever surface sent it (request-receipts.ts). */
  feedback?: RequestActionFeedback; onFeedback: (feedback: RequestActionFeedback) => void;
  /** Offered once the source no longer lists the request: only its receipt is left. */
  onDismiss?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const actionsRef = useRef<HTMLDivElement>(null);
  const restoreReceiptFocus = useRef(false);
  const receiptRef = useRef<HTMLSpanElement>(null);
  const { busy: sending, stalled, error, sent, pendingLabel, delivery, answer, act, retry } = useRequestActions(item, (action) => navigate(action.route!), (next) => {
    if (next.phase === "sending") restoreReceiptFocus.current = !!actionsRef.current?.contains(document.activeElement);
    if (next.phase === "recorded" && document.activeElement !== document.body && !actionsRef.current?.contains(document.activeElement)) restoreReceiptFocus.current = false;
    onFeedback(next);
  });
  // A permission request's session, wherever it runs: its window, its tmux session, or `claude attach` for a background one.
  const terminal = useSessionReveal(item.permission?.requestId);
  // a decision another surface is sending for this card holds this one too
  const busy = sending || feedback?.phase === "sending";
  const receipt = feedback?.phase === "recorded" ? feedback.label : sent ? `Reply recorded: ${sent}` : null;
  const always = receipt ? null : alwaysAllowLine(item);
  // A prompt captured from a pane reads as the terminal drew it, in place of the text it came from.
  const summaryScreen = terminalScreen(item.summary);
  const detailScreen = summaryScreen ? null : terminalScreen(item.detail);
  // The title's first sentence heads the card and the rest reads under it, links as short chips (ask-text.ts).
  // The Inbox item keeps every word, the options' meanings too.
  const words = useMemo(() => askText(item.title), [item.title]);
  useEffect(() => {
    if (receipt && restoreReceiptFocus.current) { receiptRef.current?.focus(); restoreReceiptFocus.current = false; }
  }, [receipt]);
  return <motion.article layout={reduceMotion ? false : "position"} initial={false} transition={{ duration: .18 }} className="scout-request-card" aria-labelledby={`request-${encodeURIComponent(item.id)}`} aria-busy={busy}>
    <header>
      <span className="scout-request-kind">{requestKind(item)}</span>
      <strong>{item.agentName ?? item.agentId ?? "Agent not supplied"}</strong>
      <span className="scout-request-age">{requestUpdatedAge(item.updatedAt, now)}</span>
    </header>
    <div className="scout-request-meta">{item.sourceLabel}{item.approval ? ` · ${item.approval.sessionName}` : ""}</div>
    <h2 id={`request-${encodeURIComponent(item.id)}`}><AskWords parts={words.title} /></h2>
    {words.body.length ? <p className="scout-request-body"><AskWords parts={words.body} /></p> : null}
    {summaryScreen ? <TerminalScreen lines={summaryScreen} />
      : item.summary && item.summary !== item.title ? <p>{item.summary}</p> : null}
    {detailScreen ? <TerminalScreen lines={detailScreen} />
      : item.detail && item.detail !== item.summary ? <p className="scout-request-detail">{item.detail}</p> : null}
    <div className="scout-request-actions" ref={actionsRef}>
      {receipt ? <span ref={receiptRef} tabIndex={-1} className="scout-request-receipt" role="status">{receipt}</span>
        : item.answer?.options.map((option) => <Button key={`answer:${option}`} variant="outline" size="sm" disabled={busy} onClick={() => void answer(option)}>{option}{pendingLabel === option ? " · Sending…" : ""}</Button>)}
      {requestActions(item).filter((action) => !receipt || action.kind === "open").map((action, index) => <Button key={`${action.kind}:${index}`} variant="outline" size="sm" disabled={busy} title={requestActionTitle(item, action)} onClick={() => void act(action)}>{requestActionLabel(action)}{pendingLabel === action.label ? " · Sending…" : ""}</Button>)}
      {terminal.go ? <Button variant="outline" size="sm" className="scout-request-terminal" disabled={terminal.going} onClick={terminal.go}
        title="Bring the session's terminal forward, or open one attached to it">
        {terminal.going ? "Opening…" : "Open in terminal"}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 8 8 4M4.5 4H8v3.5" /></svg>
      </Button> : null}
      {onDismiss && receipt ? <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss receipt</Button> : null}
      {requestActions(item).length === 0 && !item.answer && !receipt ? <span className="scout-request-meta">No action link supplied by this source.</span> : null}
    </div>
    {item.answer && !receipt ? <AskReply label={`Reply to ${item.agentName ?? "the agent"}`} disabled={busy} onSend={(text) => answer(text)} /> : null}
    {always ? <p className="scout-request-meta scout-request-always">{always}</p> : null}
    {terminal.result ? <p className={terminal.result.ok ? "scout-request-meta" : "scout-request-error"} role="status">{terminal.result.line}</p> : null}
    {/* The receipt says when it landed; the progress line covers the wait, a stall and an unconfirmed send. */}
    {!receipt && delivery?.state !== "delivered" ? <RequestProgress delivery={delivery} busy={sending} stalled={stalled} onRetry={() => void retry()} /> : null}
    {error && delivery?.state !== "unconfirmed" ? <p className="scout-request-error" role="alert">{error}</p> : null}
  </motion.article>;
}
