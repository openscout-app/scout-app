import type { RequestDelivery } from "./request-delivery.ts";
import "./request-progress.css";

/** What a decision did, in the past tense, for the line that shows it went through. */
const DONE: Record<string, string> = {
  "Allow once": "Allowed once",
  "Allow always": "Allowed always",
  Allow: "Allowed",
  Always: "Allowed always",
  Approve: "Approved",
  Deny: "Denied",
  Dismiss: "Dismissed",
  Dismissed: "Dismissed",
};

export function doneWord(label: string): string {
  return DONE[label] ?? `${label} · sent`;
}

/**
 * The line under a request while the operator's decision is on its way
 * (useRequestActions): it moves from the click, says so when the session is
 * slow to take it, and offers Retry then and when Scout never answered. Once
 * the decision lands it says what it did, while the row stays to show it.
 * Refusals and ended requests keep the surface's own wording.
 */
export function RequestProgress({ delivery, busy, stalled, onRetry, className }: {
  delivery: RequestDelivery | null;
  busy: boolean;
  stalled: boolean;
  onRetry: () => void;
  className?: string;
}) {
  if (!delivery) return null;
  const extra = className ? ` ${className}` : "";
  if (busy || delivery.state === "sending") {
    return (
      <p className={`rq-progress is-sending${stalled ? " is-stalled" : ""}${extra}`} role="status" aria-live="polite">
        <span className="rq-progress__track" aria-hidden="true" />
        <b>{delivery.label}</b>
        <span>{stalled ? "Still waiting on the session" : "Sending to the session"}</span>
        {stalled ? <button type="button" className="rq-progress__retry" onClick={onRetry}>Retry</button> : null}
      </p>
    );
  }
  if (delivery.state === "delivered") {
    return (
      <p className={`rq-progress is-done${extra}`} role="status">
        <span className="rq-progress__track" aria-hidden="true" />
        <b>{doneWord(delivery.label)}</b>
      </p>
    );
  }
  if (delivery.state === "unconfirmed") {
    return (
      <p className={`rq-progress is-unconfirmed${extra}`} role="alert">
        <span className="rq-progress__track" aria-hidden="true" />
        <b>{delivery.label}</b>
        <span>No reply from Scout. It may still have landed.</span>
        <button type="button" className="rq-progress__retry" onClick={onRetry}>Retry</button>
      </p>
    );
  }
  return null;
}
