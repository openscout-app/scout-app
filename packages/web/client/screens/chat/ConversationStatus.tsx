import { useEffect, useCallback } from "react";
import { AlertTriangle, Check, CornerDownLeft, ShieldAlert, X } from "lucide-react";
import { compactAgentId } from "../../lib/agent-labels.ts";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import type { Agent, Flight, OperatorAttentionItem } from "../../lib/types.ts";
import { isDeclaredApproval } from "../../lib/declared-requests.ts";
import { type ConversationPresence } from "./conversation-model.ts";

export function PinnedAskCard({
  request,
  onAnswer,
  onApprove,
  onReject,
  onSteer,
  onDismiss,
  approveLabel,
  rejectLabel,
  onApproveAlways,
  approveAlwaysLabel,
  approveAlwaysTitle,
  onOpenTerminal,
  terminalPending = false,
  terminalLine = null,
  busy = false,
  pending = null,
  error = null,
  receipt = null,
  enableKeyboard = true,
}: {
  /** A DECLARED request addressed to the operator (need, question, approval). */
  request: OperatorAttentionItem;
  onAnswer: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onSteer?: () => void;
  /** Ends the request without answering anyone. The runtime refuses it while a session still waits, and says so. */
  onDismiss?: () => void;
  /** The request's own words for its decisions ("Allow once", "Deny"). */
  approveLabel?: string;
  rejectLabel?: string;
  /** The request's "don't ask again" decision, when its harness offers one. */
  onApproveAlways?: () => void;
  approveAlwaysLabel?: string;
  /** What Allow always keeps, as hover text. */
  approveAlwaysTitle?: string;
  /** Takes the operator to the session that asked: its window, its tmux session, or a background session's attach. */
  onOpenTerminal?: () => void;
  terminalPending?: boolean;
  /** Where Open in terminal landed, or why it didn't. */
  terminalLine?: string | null;
  /** A decision is out: the buttons hold still until it comes back. */
  busy?: boolean;
  /** The decision being sent, by its label. */
  pending?: string | null;
  /** Why the last decision didn't land, in the runtime's words. */
  error?: string | null;
  /** What the last decision left: "Denial recorded", "Dismissed", or why the request ended. */
  receipt?: string | null;
  enableKeyboard?: boolean;
}) {
  // The headline is the agent's own declared question. Context (a blocked
  // reason) sits under it. Approval vs ask comes from the declaration — its
  // kind or declared permission source — never from the wording.
  const headline = request.title.trim();
  const context = request.summary?.trim() || null;
  const isApproval = isDeclaredApproval(request);
  // "Approve" only when a real approval decision is wired; otherwise the
  // primary action is answering in the thread.
  const canApprove = isApproval && Boolean(onApprove);
  const agentId = request.agentId ?? request.id;
  const agentDisplayName =
    request.agentName ?? (request.agentId ? compactAgentId(request.agentId) : null) ?? "Agent";
  // The eyebrow names who is asking and what kind of answer they want. It is
  // the only place the card says either.
  const eyebrow = isApproval
    ? `${agentDisplayName} · Permission request`
    : `${agentDisplayName} asks`;

  const handleApproveOrAnswer = useCallback(() => {
    if (canApprove && onApprove) {
      onApprove();
    } else {
      onAnswer();
    }
  }, [canApprove, onApprove, onAnswer]);

  const handleSteer = useCallback(() => {
    if (onSteer) {
      onSteer();
    } else {
      onAnswer();
    }
  }, [onSteer, onAnswer]);

  useEffect(() => {
    if (!enableKeyboard) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't intercept when user is typing in form fields or has modifier keys
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl instanceof HTMLElement && activeEl.isContentEditable);

      if (isInput) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (busy || receipt) return;

      if (event.key === "y" || event.key === "Y") {
        event.preventDefault();
        handleApproveOrAnswer();
      } else if ((event.key === "r" || event.key === "R") && canApprove) {
        event.preventDefault();
        handleSteer();
      } else if ((event.key === "n" || event.key === "N") && onReject) {
        event.preventDefault();
        onReject();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, canApprove, enableKeyboard, handleApproveOrAnswer, handleSteer, onReject, receipt]);

  const sending = (label: string | undefined) => (pending && label && pending === label ? "Sending…" : null);
  const approveText = canApprove ? approveLabel ?? "Approve" : "Answer";
  const rejectText = rejectLabel ?? "Reject";

  return (
    <div
      className={`s-thread-pinned-ask surface-card ${
        isApproval ? "s-thread-pinned-ask--approval" : "s-thread-pinned-ask--question"
      }`}
      role="alert"
      aria-live="assertive"
    >
      {/* The ring says needs, the eyes say attention — so the card itself
          keeps quiet: no beacon, no "Operator Attention Required". */}
      <AgentAvatar
        agent={{
          id: agentId,
          name: agentDisplayName,
          state: "needs",
        }}
        size={44}
        placement="row"
        presence
        gaze="up"
        className="s-thread-pinned-ask-coin"
      />

      <div className="s-thread-pinned-ask-body">
        <span className="s-thread-pinned-ask-eyebrow">{eyebrow}</span>
        <p className="s-thread-pinned-ask-text">{headline}</p>
        {context && (
          <p className="s-thread-pinned-ask-context">{context}</p>
        )}
        {terminalLine ? <p className="s-thread-pinned-ask-context" role="status">{terminalLine}</p> : null}
        {receipt ? (
          <p className="s-thread-pinned-ask-receipt" role="status">{receipt}</p>
        ) : error ? (
          <p className="s-thread-pinned-ask-error" role="alert">{error}</p>
        ) : null}
      </div>

      {!receipt && (
      <div className="s-thread-pinned-ask-actions">
        <button
          type="button"
          className="btn btn--primary s-thread-pinned-ask-btn"
          onClick={handleApproveOrAnswer}
          disabled={busy}
          title={canApprove ? `${approveText} [Y]` : "Answer this question [Y]"}
        >
          <kbd className="s-kbd">[Y]</kbd>
          {canApprove ? <Check size={13} strokeWidth={2.2} /> : <CornerDownLeft size={13} />}
          <span>{sending(approveLabel) ?? approveText}</span>
        </button>

        {canApprove && onApproveAlways ? (
          <button
            type="button"
            className="btn btn--ghost s-thread-pinned-ask-btn"
            onClick={onApproveAlways}
            disabled={busy}
            title={approveAlwaysTitle ?? approveAlwaysLabel ?? "Allow always"}
          >
            <Check size={13} strokeWidth={2.2} />
            <span>{sending(approveAlwaysLabel) ?? approveAlwaysLabel ?? "Allow always"}</span>
          </button>
        ) : null}

        {/* Beside Approve, Reply is the way to write back instead. A question
            is already answered by writing, so it gets one button, not two. */}
        {canApprove ? (
          <button
            type="button"
            className="btn btn--ghost s-thread-pinned-ask-btn"
            onClick={handleSteer}
            title="Write to the agent [R]"
          >
            <kbd className="s-kbd">[R]</kbd>
            <CornerDownLeft size={13} />
            <span>Reply</span>
          </button>
        ) : null}

        {onReject && (
          <button
            type="button"
            className="btn btn--ghost s-thread-pinned-ask-btn"
            onClick={onReject}
            disabled={busy}
            title={`${rejectText} [N]`}
          >
            <kbd className="s-kbd">[N]</kbd>
            <X size={13} strokeWidth={2.2} />
            <span>{sending(rejectLabel) ?? rejectText}</span>
          </button>
        )}

        {onOpenTerminal && (
          <button
            type="button"
            className="btn btn--ghost s-thread-pinned-ask-btn"
            onClick={onOpenTerminal}
            disabled={terminalPending}
            title="Bring the session's terminal forward, or open one attached to it"
          >
            <span>{terminalPending ? "Opening…" : "Open in terminal"}</span>
          </button>
        )}

        {onDismiss && (
          <button
            type="button"
            className="btn btn--ghost s-thread-pinned-ask-btn"
            onClick={onDismiss}
            disabled={busy}
            title="Stop waiting on this request without answering it"
          >
            <span>{sending("Dismiss") ?? "Dismiss"}</span>
          </button>
        )}
      </div>
      )}
    </div>
  );
}

export function ApprovalGateCard({
  title,
  description,
  diff,
  command,
  risk = "medium",
  onApprove,
  onReject,
  onSteer,
}: {
  title: string;
  description?: string | null;
  diff?: string | null;
  command?: string | null;
  risk?: "low" | "medium" | "high" | null;
  onApprove: () => void;
  onReject: () => void;
  onSteer?: () => void;
}) {
  return (
    <div className="s-thread-approval-gate surface-card" role="alert">
      <div className="s-thread-approval-gate-head">
        <div className="s-thread-approval-gate-title-wrap">
          <ShieldAlert size={16} className="text-amber" aria-hidden="true" />
          <span className="label-sm text-amber">Execution Approval Gate</span>
          {risk && (
            <span
              className="chip chip--sm chip--mono chip--neutral"
            >
              {risk.toUpperCase()} RISK
            </span>
          )}
        </div>
        <h3 className="s-thread-approval-gate-title">{title}</h3>
        {description && <p className="s-thread-approval-gate-desc">{description}</p>}
      </div>

      {command && (
        <div className="s-thread-approval-gate-command surface-card surface-card--inset">
          <span className="label-xs text-muted">Command</span>
          <code className="s-thread-approval-gate-code">{command}</code>
        </div>
      )}

      {diff && (
        <div className="s-thread-approval-gate-diff surface-card surface-card--inset">
          <span className="label-xs text-muted">Diff Preview</span>
          <pre className="s-thread-approval-gate-diff-pre">
            <code>{diff}</code>
          </pre>
        </div>
      )}

      <div className="s-thread-approval-gate-actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={onApprove}
        >
          <kbd className="s-kbd">[Y]</kbd>
          <Check size={13} />
          <span>Approve Action</span>
        </button>

        <button
          type="button"
          className="btn btn--danger"
          onClick={onReject}
        >
          <kbd className="s-kbd">[N]</kbd>
          <X size={13} />
          <span>Reject</span>
        </button>

        {onSteer && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onSteer}
          >
            <kbd className="s-kbd">[R]</kbd>
            <span>Reply</span>
          </button>
        )}
      </div>
    </div>
  );
}

export function ConversationStatusStrip({
  presence,
}: {
  presence: ConversationPresence;
  agent: Agent | null;
}) {
  if (!presence.showStrip) return null;
  const isWorking = presence.tone === "working";

  return (
    <div
      className={`s-thread-status s-thread-status--${presence.tone}`}
      aria-live="polite"
    >
      <span className="s-thread-status-dot-wrap" aria-hidden="true">
        <span
          className={`dot dot--sm ${
            isWorking ? "dot--working dot--pulse" : "dot--neutral"
          }`}
        />
      </span>
      <div className="s-thread-status-copy">
        <span className="s-thread-status-label label-xs">{presence.label}</span>
        <span className="s-thread-status-detail">{presence.detail}</span>
      </div>
    </div>
  );
}

function flightOutcomeHeading(state: string): string {
  switch (state) {
    case "completed":
      return "Invocation completed";
    case "failed":
      return "Invocation failed";
    case "cancelled":
      return "Invocation cancelled";
    case "queued":
      return "Invocation queued";
    case "waking":
      return "Invocation waking";
    case "waiting":
      return "Invocation waiting";
    case "running":
      return "Invocation running";
    default:
      return `Invocation ${state.replace(/_/g, " ")}`;
  }
}

function flightOutcomeTone(state: string): string {
  switch (state) {
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    default:
      return "active";
  }
}

export function ConversationFlightOutcome({
  flight,
  onOpenSession,
}: {
  flight: Flight;
  onOpenSession?: () => void;
}) {
  const tone = flightOutcomeTone(flight.state);
  const summary = flight.summary?.trim() || null;
  const Icon = tone === "failed"
    ? AlertTriangle
    : tone === "cancelled"
      ? X
      : Check;

  return (
    <div
      className={`s-thread-flight-outcome s-thread-flight-outcome--${tone}`}
      role="status"
      aria-live="polite"
    >
      <div className="s-thread-flight-outcome-head">
        <span className="s-thread-flight-outcome-mark" aria-hidden="true">
          <Icon size={12} strokeWidth={2.2} />
        </span>
        <span className="label-sm s-thread-flight-outcome-title">
          {flightOutcomeHeading(flight.state)}
        </span>
      </div>
      {summary && (
        <p className="s-thread-flight-outcome-summary">{summary}</p>
      )}
      {onOpenSession && (
        <div className="s-thread-flight-outcome-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onOpenSession}
          >
            <span>Open session</span>
          </button>
        </div>
      )}
    </div>
  );
}
