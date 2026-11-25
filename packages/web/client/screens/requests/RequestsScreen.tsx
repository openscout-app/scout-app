/**
 * Requests extends Industrial II: one quiet column of stable request cards,
 * not a second dashboard. Source links and pairing approval decisions are real;
 * missing history, context and waiting-start data are never fabricated.
 *
 * The basic web app draws this page (its /embed/requests). The full app and
 * the Mac app draw the composed Inbox view instead (NativeAreaScreen.tsx).
 */
import { useRef } from "react";
import { Button } from "../../components/ui/button.tsx";
import type { Route } from "../../lib/types.ts";
import { refreshRequests } from "../../lib/operator-requests-store.ts";
import { getDestination } from "../../scout/nav-destinations.ts";
import { requestsCountState } from "./requests-model.ts";
import { RequestCard } from "./RequestCard.tsx";
import { RequestsCount } from "./RequestsCount.tsx";
import { heldFeedback, isSettled, requestReceipts, requestRevision } from "./request-receipts.ts";
import { useRequestClock, useRequestRows } from "./use-request-rows.ts";
import "./requests.css";

export function RequestsScreen({ navigate }: { navigate: (route: Route) => void; embedded?: boolean }) {
  // Cards and their receipts are shared with every Requests panel (request-receipts.ts): a card
  // keeps its place across the API's synchronous snapshot update until its receipt is dismissed.
  const { live, rows: items, held, read, error, loading } = useRequestRows();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const now = useRequestClock();
  const count = requestsCountState(live.length);
  return <section className="scout-requests" aria-label={getDestination("requests").label}>
    <header className="scout-requests-heading"><h1 ref={headingRef} tabIndex={-1}>{getDestination("requests").label}</h1><RequestsCount count={count.count} pending={loading && !read} /><Button variant="outline" size="sm" onClick={() => void refreshRequests()}>Refresh</Button></header>
    {error ? <p role="alert" className="scout-request-error">{error}{read ? " · Showing the last successful snapshot." : ""}</p> : null}
    {loading && !read ? <p role="status">Loading the Inbox…</p> : null}
    {!loading && read && items.length === 0 ? <div className="scout-requests-empty"><h2>No open requests</h2><p>Approvals, questions and permission requests from your agents show up here.</p></div> : null}
    <div className="scout-requests-list">{items.map((item) => <RequestCard key={requestRevision(item)} item={item} now={now} navigate={navigate}
      feedback={heldFeedback(held, item)} onFeedback={(feedback) => requestReceipts.record(item, feedback)}
      onDismiss={isSettled(live, item.id) ? () => {
        headingRef.current?.focus();
        requestReceipts.dismiss(item.id);
      } : undefined} />)}</div>
    {live.length > 0 ? <p className="scout-requests-source-note">The source supplies update times, not when waiting began. Request history is not available.</p> : null}
  </section>;
}
