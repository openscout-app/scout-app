import { useMemo } from "react";
import type { Route, WorkDetail } from "../../lib/types.ts";
import { RequestCard } from "../requests/RequestCard.tsx";
import { heldFeedback, isSettled, requestReceipts, requestRevision } from "../requests/request-receipts.ts";
import { useRequestClock, useRequestRows } from "../requests/use-request-rows.ts";
import { selectWorkRequests } from "./work-requests.ts";

/**
 * The requests this work item's run and its subagents wait on, answered here
 * the way the Inbox answers them. Nothing draws while none are open.
 */
export function WorkRequests({ detail, navigate }: { detail: WorkDetail; navigate: (route: Route) => void }) {
  const { live, rows, held } = useRequestRows();
  const now = useRequestClock();
  const items = useMemo(() => selectWorkRequests(rows, detail), [rows, detail]);
  if (items.length === 0) return null;
  return (
    <section className="s-wc-requests" aria-label="Requests for this work">
      <span className="s-wc-label">Requests</span>
      {items.map((item) => (
        <RequestCard
          key={requestRevision(item)}
          item={item}
          now={now}
          navigate={navigate}
          feedback={heldFeedback(held, item)}
          onFeedback={(feedback) => requestReceipts.record(item, feedback)}
          onDismiss={isSettled(live, item.id) ? () => requestReceipts.dismiss(item.id) : undefined}
        />
      ))}
    </section>
  );
}
