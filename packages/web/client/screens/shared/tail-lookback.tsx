import "./tail-lookback.css";

import {
  type Dispatch,
  Fragment,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "../../lib/api.ts";
import type { TailEvent } from "../../lib/types.ts";
import {
  formatLookbackWindow,
  measureTailLookback,
  mergeTailLookbackEvents,
  nextTailLookbackSteps,
  oldestTailTs,
  tailLookbackEarlierLead,
  tailLookbackLead,
  tailLookbackPath,
  tailLookbackStepLabel,
  tailLookbackStepTitle,
  type TailLookbackOrigin,
  type TailLookbackOutcome,
  type TailLookbackStep,
} from "./tail-lookback.ts";

export type TailLookback = {
  steps: TailLookbackStep[];
  last: TailLookbackOutcome | null;
  pending: TailLookbackStep | null;
  failed: boolean;
  lookBack: (step: TailLookbackStep) => void;
  /** The tail's first load reports what it read; no step is offered before. */
  noteFirstLoad: (origin: TailLookbackOrigin) => void;
};

/**
 * Look-back state for one tail. Each step reads older history and merges it
 * into `events` in time order (tail-lookback.ts). What the first load read and
 * what the view holds decide which steps are still worth offering. A new
 * session scope starts over and drops any read still in flight.
 */
export function useTailLookback(
  sessionId: string | undefined,
  events: TailEvent[],
  setEvents: Dispatch<SetStateAction<TailEvent[]>>,
  bufferLimit: number,
): TailLookback {
  const [origin, setOrigin] = useState<TailLookbackOrigin | null>(null);
  const [last, setLast] = useState<TailLookbackOutcome | null>(null);
  const [pending, setPending] = useState<TailLookbackStep | null>(null);
  const [failed, setFailed] = useState(false);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const sequenceRef = useRef(0);

  useEffect(() => {
    sequenceRef.current += 1;
    setOrigin(null);
    setLast(null);
    setPending(null);
    setFailed(false);
    return () => {
      sequenceRef.current += 1;
    };
  }, [sessionId]);

  const lookBack = useCallback((step: TailLookbackStep) => {
    const sequence = ++sequenceRef.current;
    setPending(step);
    setFailed(false);
    void api<{ events?: TailEvent[] }>(tailLookbackPath(step, sessionId))
      .then((result) => {
        if (sequence !== sequenceRef.current) return;
        const older = result.events ?? [];
        const { added, movedBack } = measureTailLookback(eventsRef.current, older, bufferLimit);
        setEvents((held) => mergeTailLookbackEvents(held, older, bufferLimit));
        setLast({ step, count: older.length, added, movedBack });
      })
      .catch(() => {
        if (sequence === sequenceRef.current) setFailed(true);
      })
      .finally(() => {
        if (sequence === sequenceRef.current) setPending(null);
      });
  }, [bufferLimit, sessionId, setEvents]);

  const oldestHeldTs = useMemo(() => oldestTailTs(events), [events]);
  const steps = nextTailLookbackSteps({ origin, last, bufferLimit, held: events.length, oldestHeldTs });

  return { steps, last, pending, failed, lookBack, noteFirstLoad: setOrigin };
}

function StepButton({ step, label, onLookBack }: {
  step: TailLookbackStep;
  label?: string;
  onLookBack: (step: TailLookbackStep) => void;
}) {
  const title = tailLookbackStepTitle(step);
  return (
    <button
      type="button"
      className="s-tail-lookback-step"
      title={title}
      aria-label={title}
      onClick={() => onLookBack(step)}
    >
      {label ?? tailLookbackStepLabel(step)}
    </button>
  );
}

/**
 * The line itself. Above the oldest row of a list (`earlier`) it is a single
 * "Earlier" taking the next step; after a step that found nothing it says so
 * ("Nothing earlier.", or "Nothing more in the last 1h. Look back 6h"). Under
 * an empty tail it reads "Look back 1h · 6h · 24h", then "Nothing in the last
 * 6h. Look back 24h". It disappears when there is nothing to offer or report.
 */
export function TailLookbackLine({ lookback, earlier = false }: {
  lookback: TailLookback;
  earlier?: boolean;
}) {
  const { steps, last, pending, failed, lookBack } = lookback;

  if (pending) {
    const what = pending.kind === "window"
      ? `the last ${formatLookbackWindow(pending.windowMs)}`
      : `${pending.limit.toLocaleString("en-US")} lines`;
    return (
      <div className={`s-tail-lookback${earlier ? " s-tail-lookback--earlier" : ""}`} role="status">
        Looking back over {what}…
      </div>
    );
  }

  if (earlier) {
    const next = steps[0];
    const lead = failed ? "Could not look back." : tailLookbackEarlierLead(last);
    if (!next && !lead) return null;
    let label = "Earlier";
    if (failed) label = "Retry";
    else if (lead && next) label = next.kind === "window" ? `Look back ${formatLookbackWindow(next.windowMs)}` : "Older";
    return (
      <div className="s-tail-lookback s-tail-lookback--earlier" role={lead ? "status" : undefined}>
        {lead}
        {lead && next ? <>&nbsp;</> : null}
        {next && <StepButton step={next} label={label} onLookBack={lookBack} />}
      </div>
    );
  }

  const lead = failed ? "Could not look back." : tailLookbackLead(last);
  if (!lead && steps.length === 0) return null;
  const windows = steps.length > 0 && steps.every((step) => step.kind === "window");
  return (
    <div className="s-tail-lookback">
      {lead}
      {lead && steps.length > 0 ? " " : null}
      {windows ? "Look back " : null}
      {steps.map((step, index) => (
        <Fragment key={tailLookbackStepLabel(step)}>
          {index > 0 && <span className="s-tail-lookback-sep" aria-hidden="true"> · </span>}
          <StepButton step={step} label={!windows && !lead ? "Earlier" : undefined} onLookBack={lookBack} />
        </Fragment>
      ))}
    </div>
  );
}
