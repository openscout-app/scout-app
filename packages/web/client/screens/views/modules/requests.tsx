/**
 * Requests — approvals, questions and Permission requests waiting on the operator.
 *
 * Shows:  one row per open request, in the page's stable order: its kind
 *         (Approval, Permission request, Ask), what it asks, who asked, and
 *         when the source last updated it. A request just answered stays,
 *         marked Sending or Recorded, until its receipt is dismissed. The
 *         pick is marked; it opens in the Request panel beside it, or under
 *         its row (with its answers, Allow and Deny) when there is none or
 *         this panel is in full view. States: reading, unavailable, a failed
 *         refresh over the last snapshot, no open requests, none of this
 *         kind. Head: the open count, Refresh, and Open full off /requests.
 *         On /requests, the page's note on update times under the rows.
 * Data:   useOperatorRequests(), the one read every Requests surface shares
 *         (lib/operator-requests-store.ts): /api/operator-attention on first
 *         use, every 15s while Scout is in front, on return, after each
 *         decision, and on Refresh. Receipts from request-receipts.ts. No
 *         reads of its own.
 * Scope:  Kind (Approvals, Permission requests, Asks). follow = "@route": on
 *         /requests the URL's ?request= is the selection, written with
 *         replace. Otherwise the pick is kept in settings (request, state);
 *         on /requests it is written to the URL too.
 * Opens:  a request: the Request panel beside it, or the request under its
 *         row. Its links (a conversation, a terminal) from the card. Open
 *         full: /requests with the pick open.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { useGridFullView } from "../../../components/hud-grid/HudGrid.tsx";
import { refreshRequests } from "../../../lib/operator-requests-store.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";
import { RequestCard } from "../../requests/RequestCard.tsx";
import { heldFeedback, isSettled, requestReceipts, requestRevision } from "../../requests/request-receipts.ts";
import { requestKindTag, requestsCountState } from "../../requests/requests-model.ts";
import { useRequestClock, useRequestRows } from "../../requests/use-request-rows.ts";
import type { RequestActionFeedback } from "../../requests/use-request-actions.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { requestPicks } from "./request-picks.ts";
import {
  REQUEST_KIND_OPTIONS,
  REQUEST_UPDATE_NOTE,
  REQUESTS_KIND_KEY,
  REQUESTS_PICK_KEY,
  listClick,
  listMarked,
  listSelection,
  offersOpenFull,
  onRequestsPage,
  pageRequestId,
  pickOpens,
  requestsPanelMode,
  requestsRoute,
  rowAge,
  rowsOfKind,
} from "./requests-view-model.ts";
import { Quiet } from "./shared.tsx";
import "./requests-panels.css";

const kindScope: ModuleScope = { key: REQUESTS_KIND_KEY, allLabel: "Every kind", useOptions: () => REQUEST_KIND_OPTIONS };

/** A row just answered says so in place of its kind. */
function rowMark(feedback: RequestActionFeedback | undefined): string | null {
  if (feedback?.phase === "sending") return "Sending";
  if (feedback?.phase === "recorded") return "Recorded";
  return null;
}

/** ↑ and ↓ move between rows while a row has focus; nothing else in the panel answers to them. */
function onRowArrows(e: KeyboardEvent<HTMLUListElement>) {
  if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const row = (e.target as HTMLElement).closest?.(".vw-row--req");
  if (!row) return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>(".vw-row--req")];
  const next = rows[rows.indexOf(row as HTMLElement) + (e.key === "ArrowDown" ? 1 : -1)];
  if (!next) return;
  e.preventDefault();
  next.focus();
}

function Requests({ instanceId, route, navigate, config, setConfig }: ModuleProps) {
  const { live, rows: all, held, read, error, loading } = useRequestRows();
  const now = useRequestClock();
  const kind = config[REQUESTS_KIND_KEY] ?? "";
  const rows = rowsOfKind(all, kind);
  const open = rowsOfKind(live, kind).length;
  const onPage = onRequestsPage(route);
  const mode = requestsPanelMode(config, route);
  const selection = listSelection(config, route);
  const followed = useSyncExternalStore(requestPicks.subscribe, requestPicks.followed, requestPicks.followed);
  // lifted over the grid, the Request panel beside it is out of sight: the pick opens here
  const opens = pickOpens({ followed, full: useGridFullView() === "self" });
  const marked = opens === "beside" ? listMarked(selection, followed, all) : selection;
  const root = useRef<HTMLDivElement>(null);
  const [refreshing, setRefreshing] = useState(false);

  const setConfigRef = useRef(setConfig);
  setConfigRef.current = setConfig;

  // An own pick, restored from settings while the request is still listed: the Request panel
  // beside this one shows it. On /requests the URL is the page's pick as well.
  const ownPick = mode === "own" && all.some((item) => item.id === selection) ? selection : "";
  useEffect(() => {
    requestPicks.publish(instanceId, ownPick);
  }, [instanceId, ownPick]);
  // removed, replaced, or the view closed: the Request panel stops showing this panel's pick
  useEffect(() => () => requestPicks.withdraw(instanceId), [instanceId]);

  // a selection that arrives from elsewhere (a link with ?request=, a reload) scrolls into view
  const pickedHere = useRef<string | null>(null);
  const found = Boolean(selection) && rows.some((item) => item.id === selection);
  useEffect(() => {
    if (!found || pickedHere.current === selection) return;
    const row = root.current?.querySelector<HTMLElement>(`[data-request-id="${CSS.escape(selection)}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [found, selection]);

  const onPick = (id: string) => {
    const { url, pick } = listClick(route, mode, id, selection, opens);
    pickedHere.current = (pick ?? id) || null;
    if (pick !== null) {
      setConfigRef.current({ [REQUESTS_PICK_KEY]: pick });
      requestPicks.publish(instanceId, pick, true);
    }
    // the page's selection: replace, so picking never piles up history
    if (url) navigate(url, { replace: true });
  };

  const clearSelection = useCallback((id: string) => {
    if (mode === "own") setConfigRef.current({ [REQUESTS_PICK_KEY]: "" });
    if (onPage && pageRequestId(route) === id) navigate(requestsRoute(), { replace: true });
  }, [mode, navigate, onPage, route]);

  const refresh = () => {
    setRefreshing(true);
    void refreshRequests().finally(() => setRefreshing(false));
  };

  const head = (
    <ModuleHead>
      {read && (
        // only a positive real count gets signal, as on the page (RequestsCount)
        <span
          className="hud-grid-count"
          data-attention={requestsCountState(open).attention ? "true" : "false"}
          title={`${open} waiting on you`}
        >
          {open}
        </span>
      )}
      <button type="button" className="vw-chip" disabled={refreshing || (loading && !read)} onClick={refresh} title="Read the Inbox again">
        {refreshing ? "Reading..." : "Refresh"}
      </button>
      {offersOpenFull(route) && (
        <button type="button" className="vw-chip" onClick={() => navigate(requestsRoute(selection || null))} title="Open the Inbox">
          Open full
        </button>
      )}
    </ModuleHead>
  );

  if (!read) return <>{head}<Quiet>{error ? `Couldn't read the Inbox: ${error}` : "Reading the Inbox…"}</Quiet></>;
  if (rows.length === 0) {
    const label = REQUEST_KIND_OPTIONS.find((option) => option.value === kind)?.label.toLowerCase();
    return (
      <>
        {head}
        {error && <p className="vw-requests-stale">Couldn't refresh: {error}. Showing the last snapshot.</p>}
        <Quiet>{label ? `No open ${label}.` : "No open requests. Approvals, questions and permission requests from your agents show up here."}</Quiet>
      </>
    );
  }
  return (
    <div ref={root} className="vw-requests" tabIndex={-1}>
      {head}
      {error && <p className="vw-requests-stale" role="alert">Couldn't refresh: {error}. Showing the last snapshot.</p>}
      <ul className="vw-rows" aria-label="Inbox" onKeyDown={onRowArrows}>
        {rows.map((item) => (
          <RequestRow
            key={item.id}
            item={item}
            now={now}
            feedback={heldFeedback(held, item)}
            settled={isSettled(live, item.id)}
            marked={marked === item.id}
            inline={opens === "inline" ? selection === item.id : null}
            navigate={navigate}
            onPick={() => onPick(item.id)}
            onDismiss={() => {
              root.current?.focus();
              requestReceipts.dismiss(item.id);
              clearSelection(item.id);
            }}
          />
        ))}
      </ul>
      {onPage && live.length > 0 && <p className="vw-requests-note">{REQUEST_UPDATE_NOTE}</p>}
    </div>
  );
}

function RequestRow({ item, now, feedback, settled, marked, inline, navigate, onPick, onDismiss }: {
  item: OperatorAttentionItem;
  now: number;
  feedback: RequestActionFeedback | undefined;
  /** The source no longer lists it: only its receipt is left. */
  settled: boolean;
  marked: boolean;
  /** Open under the row (true), closed (false), or picks open beside it (null). */
  inline: boolean | null;
  navigate: ModuleProps["navigate"];
  onPick: () => void;
  onDismiss: () => void;
}) {
  const mark = rowMark(feedback);
  const age = rowAge(item.updatedAt, now);
  return (
    <li>
      <button
        type="button"
        className="vw-row vw-row--req"
        data-request-id={item.id}
        data-settled={settled || undefined}
        aria-current={marked ? "true" : undefined}
        aria-expanded={inline ?? undefined}
        onClick={onPick}
      >
        <span className={mark ? "vw-dim vw-ell" : "vw-kind vw-ell"}>{mark ?? requestKindTag(item)}</span>
        <span className="vw-strong vw-ell">{item.title}</span>
        <span className="vw-dim vw-ell">{item.agentName ?? item.agentId ?? ""}</span>
        <span className="vw-dim vw-num" title={age.title}>
          {age.label}
        </span>
      </button>
      {inline && (
        <div className="vw-request-open">
          <RequestCard
            key={requestRevision(item)}
            item={item}
            now={now}
            navigate={navigate}
            feedback={feedback}
            onFeedback={(next) => requestReceipts.record(item, next)}
            onDismiss={settled ? onDismiss : undefined}
          />
        </div>
      )}
    </li>
  );
}

export const requestsModule = defineModule({
  type: "requests",
  title: "Inbox",
  blurb: "Approvals, questions and permission requests waiting on you",
  docs: {
    shows: "Open items in a stable order: kind, what it asks, who asked, last update; answered ones marked until dismissed. A pick opens in the Inbox item panel, or under its row.",
    data: "useOperatorRequests(), one read for every Inbox surface: on first use, every 15s while Scout is in front, after each decision, and on Refresh.",
    opens: "An item: the Inbox item panel beside it, or the item under its row; its conversation or terminal from there. Open full: /inbox with the pick open.",
  },
  size: { w: 5, h: 7 },
  // the head and three rows still fit
  minSize: { w: 3, h: 4 },
  scopes: [kindScope],
  // off /requests, the row it last opened: kept so a reload opens it again
  state: [REQUESTS_PICK_KEY],
  Component: Requests,
});
