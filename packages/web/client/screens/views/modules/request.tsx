/**
 * Request — one request, whole, with the decisions its source backs.
 *
 * Shows:  the request card the Requests page draws: its kind, who asked and
 *         when the source last updated it, where it came from, what it asks
 *         (title, summary, detail), then its decisions: a question's own
 *         answers, a Permission request's Allow once, Allow always and
 *         Deny, a pairing approval's Approve and Deny, and the source's links
 *         (Open conversation, Open terminal). After a decision, the receipt;
 *         once the source drops the request, Dismiss receipt. A failed
 *         decision says why on the card. Head: "First open" when nothing is
 *         named, Clear on the page's own request, Open full off the page,
 *         Unpin when pinned.
 * Data:   the shared operator-requests read (useOperatorRequests(), as the
 *         Requests panels) and the shared receipts (request-receipts.ts); no
 *         reads of its own. Decisions POST /api/send (an answer),
 *         /api/operator-attention/permissions/decide (a Permission request)
 *         or /api/operator-attention/approvals/decide (a pairing approval),
 *         through the page's own useRequestActions.
 * Scope:  Request. "This page's request" follows ?request= on /requests (off
 *         that page: the pick of a Requests panel beside it); with nothing
 *         named, or unset, the first open request; or one request, pinned.
 * Opens:  the request's links: its conversation or terminal. Open full:
 *         /requests with it open. Clear: /requests (its first request).
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { RequestCard } from "../../requests/RequestCard.tsx";
import { heldFeedback, isSettled, requestReceipts, requestRevision } from "../../requests/request-receipts.ts";
import { useRequestClock, useRequestRows } from "../../requests/use-request-rows.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { FOLLOW_PAGE } from "./panel-scope.ts";
import { requestPicks } from "./request-picks.ts";
import {
  REQUEST_SCOPE_KEY,
  panelRequest,
  requestEmptyLine,
  requestOffersOpenFull,
  requestOptions,
  requestsRoute,
} from "./requests-view-model.ts";
import { Quiet } from "./shared.tsx";
import "./requests-panels.css";

function RequestPanel({ route, navigate, config, setConfig }: ModuleProps) {
  const { live, rows, held, read, error } = useRequestRows();
  const now = useRequestClock();
  const value = config[REQUEST_SCOPE_KEY];
  // following the page: say so to the Requests panels, so their picks open here and not under the row
  const follows = value === FOLLOW_PAGE;
  useEffect(() => (follows ? requestPicks.follow() : undefined), [follows]);
  const picked = useSyncExternalStore(requestPicks.subscribe, requestPicks.latest, requestPicks.latest);
  const shown = panelRequest(route, value, picked, rows);
  const item = shown.id ? rows.find((candidate) => candidate.id === shown.id) ?? null : null;
  const root = useRef<HTMLDivElement>(null);

  const head = (
    <ModuleHead>
      {shown.source === "first" && item && (
        <span className="vw-request-marker" title="Nothing picked: the first Inbox item">First open</span>
      )}
      {shown.own && (
        <button type="button" className="vw-chip" onClick={() => navigate(requestsRoute(), { replace: true })} title="Show the first Inbox item">
          Clear
        </button>
      )}
      {requestOffersOpenFull(route, shown) && (
        <button type="button" className="vw-chip" onClick={() => navigate(requestsRoute(shown.id))} title="Open this item in the Inbox">
          Open full
        </button>
      )}
      {shown.source === "pinned" && (
        <button type="button" className="vw-chip" onClick={() => setConfig({ [REQUEST_SCOPE_KEY]: "" })} title="Show the first Inbox item instead">
          Unpin
        </button>
      )}
    </ModuleHead>
  );

  if (!read) return <>{head}<Quiet>{error ? `Couldn't read the Inbox: ${error}` : "Reading the Inbox…"}</Quiet></>;
  if (!item) {
    const line = requestEmptyLine(shown.source, Boolean(shown.id));
    return <>{head}{line && <Quiet>{line}</Quiet>}</>;
  }
  return (
    <div ref={root} className="vw-request" tabIndex={-1}>
      {head}
      {error && <p className="vw-requests-stale">Couldn't refresh: {error}. Showing the last snapshot.</p>}
      <RequestCard
        key={requestRevision(item)}
        item={item}
        now={now}
        navigate={navigate}
        feedback={heldFeedback(held, item)}
        onFeedback={(next) => requestReceipts.record(item, next)}
        onDismiss={isSettled(live, item.id) ? () => {
          root.current?.focus();
          requestReceipts.dismiss(item.id);
          // the page named it: the page goes back to its first request
          if (shown.own) navigate(requestsRoute(), { replace: true });
        } : undefined}
      />
    </div>
  );
}

/** Request, by id: "This page's request" follows ?request= on /requests; unset is the first open request. */
const requestScope: ModuleScope = {
  key: REQUEST_SCOPE_KEY,
  allLabel: "First Inbox item",
  followsPage: "This page's item",
  useOptions: () => {
    const { live } = useRequestRows();
    return useMemo(() => requestOptions(live), [live]);
  },
};

export const requestModule = defineModule({
  type: "request",
  title: "Inbox item",
  blurb: "One Inbox item with its answers, or a Permission request's Allow and Deny",
  docs: {
    shows: "The item card: kind, who asked, last update, source, what it asks, then its answers, Allow and Deny, and links; the receipt after a decision.",
    data: "The shared operator-requests read and receipts; decisions POST /api/send or the operator-attention decide endpoints.",
    opens: "Its conversation or terminal; Open full: /inbox with it open; Clear: /inbox.",
  },
  size: { w: 6, h: 12 },
  // the card's head, the ask and a row of decisions still fit
  minSize: { w: 3, h: 7 },
  scopes: [requestScope],
  Component: RequestPanel,
});
