import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, LoaderCircle, Maximize2, MessageSquare, Minimize2, Paperclip, Plus, RefreshCw, SendHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DictationMic } from "../../components/DictationMic.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";
import { RuntimePicker } from "../../components/MessageComposer/index.ts";
import { api } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { isRoutableMediaFile, uploadMediaFiles } from "../../lib/media-blobs.ts";
import { brokerAttemptTone } from "../../lib/status-tone.ts";
import { fullTimestamp, normalizeTimestampMs, timeAgo } from "../../lib/time.ts";
import type { BrokerRouteAttempt, DispatchFilter, Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import {
  createRuntimeCatalogLoader,
  RUNTIME_CAPABILITY_SEED,
  runtimeCatalogFromCapabilities,
  runtimeCatalogNotice,
  runtimeModelCatalogStatus,
  type RuntimeCapabilityCatalog,
} from "../../lib/runtime-capabilities.ts";
import { effortsFor, type RuntimeValue } from "../../lib/runtime-catalog.ts";

import {
  brokerAttemptErrorSummary,
  brokerAttemptIsFailure,
  brokerAttemptTargetAgent,
  brokerAttemptContextText,
  brokerMetadataJson,
} from "./broker-display.ts";
import { BrokerMetadataPanel } from "./BrokerMetadataPanel.tsx";
import { DispatchAftermath } from "./DispatchAftermath.tsx";
import { investigateDispatch } from "./dispatch-investigation.ts";
import {
  DispatchFocusBar,
  DispatchHarnessMark,
  DispatchNodeCard,
  DispatchRouteGraph,
  dispatchNodeKindLabel,
  dispatchNodeTitle,
} from "./DispatchFocus.tsx";
import {
  applyDispatchScope,
  dispatchGraph,
  dispatchNodeFacts,
  dispatchRecovery,
  dispatchRowModel,
  dispatchStateBadge,
  DISPATCH_WINDOWS,
  type DispatchRecovery,
  type DispatchRowModel,
  type DispatchScope,
} from "./dispatch-focus.ts";
import {
  EMPTY_DISPATCH_SCOPE,
  mergeScope,
  scopeFromRoute,
  scopeRoute,
  type DispatchRouteScope,
} from "./dispatch-scope.ts";
import { useBrokerLedgerKeyboard } from "./useBrokerLedgerKeyboard.ts";
import { useDispatchLedger, useDispatchRows, useMinuteClock } from "./use-dispatch-ledger.ts";
import { ShikiPane } from "../code/ShikiPane.tsx";
import { defineSurface } from "../../surfaces/types.ts";
import { useEmbedHeadline } from "../../surfaces/useEmbedHeadline.ts";
import { SlidePanel } from "../../components/SlidePanel/SlidePanel.tsx";
import { BASIC_WEB } from "../../basic/profile.ts";
import "../system-surfaces-redesign.css";
import "./dispatch-focus.css";

type BrokerTab = DispatchFilter;

const BROKER_TABS: BrokerTab[] = ["all", "failed", "delivered"];

const TAB_LABELS: Record<BrokerTab, string> = {
  all: "All",
  delivered: "Delivered",
  failed: "Failed",
};

const GRAPH_HIDDEN_STORAGE_KEY = "scout.dispatch.graphHidden";

function readGraphHidden(): boolean {
  try {
    return window.localStorage.getItem(GRAPH_HIDDEN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeGraphHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(GRAPH_HIDDEN_STORAGE_KEY, hidden ? "1" : "0");
  } catch {
    // Remembering the graph toggle is a convenience; losing it is harmless.
  }
}

function attemptKindLabel(kind: BrokerRouteAttempt["kind"]): string {
  switch (kind) {
    case "success":
      return "Success";
    case "failed_query":
      return "Query failure";
    case "failed_delivery":
      return "Delivery failure";
    default:
      return "Delivery attempt";
  }
}

function brokerAttemptReference(attempt: BrokerRouteAttempt): string {
  return attempt.messageId ?? attempt.deliveryId ?? attempt.invocationId ?? attempt.id;
}

/**
 * Dispatch status word. The ledger row no longer shows it — colour on the row
 * carries state for sighted operators — so this now feeds the row's accessible
 * name, the pending chip, and the inspector header beside the tone dot.
 */
function dispatchStateLabel(attempt: BrokerRouteAttempt): string {
  const tone = brokerAttemptTone(attempt.kind, attempt.status);
  switch (tone) {
    case "success":
      return "Delivered";
    case "danger":
      return "Needs attention";
    case "working":
      return "Pending";
    case "warning":
      return "Held";
    default:
      return attempt.status ? attempt.status.charAt(0).toUpperCase() + attempt.status.slice(1) : "Queued";
  }
}

/** Wall-clock stamp (e.g. "12:20 AM"); the day grouping supplies the date. */
function dispatchClock(ts: number): string {
  const ms = normalizeTimestampMs(ts) ?? 0;
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dispatchClockWithSeconds(ts: number | string | null | undefined): string {
  const ms = normalizeTimestampMs(ts);
  if (ms === null) return "—";
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function metadataLeaf(
  value: unknown,
  keys: readonly string[],
  depth = 0,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  for (const nested of Object.values(record)) {
    const result = metadataLeaf(nested, keys, depth + 1);
    if (result !== undefined) return result;
  }
  return undefined;
}

function metadataText(attempt: BrokerRouteAttempt, ...keys: string[]): string | null {
  const value = metadataLeaf(attempt.metadata, keys);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text || null;
}

function metadataTimestamp(attempt: BrokerRouteAttempt, ...keys: string[]): number | null {
  const value = metadataLeaf(attempt.metadata, keys);
  return typeof value === "number" || typeof value === "string"
    ? normalizeTimestampMs(value)
    : null;
}

function dispatchChannelLabel(route: string | null): string {
  switch (route) {
    case "dm":
      return "Direct · agent";
    case "channel":
      return "Channel";
    case "broadcast":
      return "Broadcast";
    case null:
      return "No route";
    default:
      return route.replaceAll("_", " ");
  }
}

function dispatchLatencyLabel(attempt: BrokerRouteAttempt): string {
  const rawDuration = metadataLeaf(attempt.metadata, ["latencyMs", "durationMs"]);
  if (typeof rawDuration === "number" && Number.isFinite(rawDuration) && rawDuration >= 0) {
    if (rawDuration < 1_000) return `${Math.round(rawDuration)}ms`;
    return `${(rawDuration / 1_000).toFixed(rawDuration < 10_000 ? 1 : 0)}s`;
  }
  const sentAt = metadataTimestamp(attempt, "sentAt", "createdAt") ?? normalizeTimestampMs(attempt.ts);
  const deliveredAt = metadataTimestamp(attempt, "deliveredAt", "completedAt");
  if (sentAt === null || deliveredAt === null || deliveredAt < sentAt) return "—";
  const duration = deliveredAt - sentAt;
  return duration < 1_000 ? `${duration}ms` : `${(duration / 1_000).toFixed(duration < 10_000 ? 1 : 0)}s`;
}

function dispatchDayKey(ts: number): string {
  const timestamp = normalizeTimestampMs(ts) ?? 0;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dispatchDayLabel(ts: number, nowMs = Date.now()): string {
  const timestamp = normalizeTimestampMs(ts) ?? 0;
  const date = new Date(timestamp);
  const today = new Date(nowMs);
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dispatchDayKey(ts) === dispatchDayKey(today.getTime())) return "Today";
  if (dispatchDayKey(ts) === dispatchDayKey(yesterday.getTime())) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/**
 * The Dispatch screen drawn as a view panel (screens/views/modules/dispatches.tsx).
 * The panel draws the detail beside the ledger, or over it when narrow, and
 * leaves the route graph to the Routes panel. Its keys bind only inside the
 * panel, or on /dispatch also while nothing else holds focus.
 */
export type DispatchPanelControl = {
  /** On /dispatch itself: the URL holds scope and selection, as on the full screen. */
  own: boolean;
  /** The panel element, for its keys. */
  keyScope: () => HTMLElement | null;
  /** The search box: on /dispatch, one query every Dispatch panel reads. */
  query: string;
  onQuery: (query: string) => void;
  /** Off /dispatch: the panel's own scope, kept in its settings. */
  scope?: DispatchRouteScope;
  onScope?: (patch: Partial<DispatchRouteScope>) => void;
  /** Off /dispatch: the open dispatch changed, for the panel to keep. */
  onSelect?: (attemptId: string | null) => void;
};

export function BrokerScreen({
  navigate,
  embedded = false,
  basic = false,
  initialAttemptId,
  panel,
}: {
  navigate: (r: Route) => void;
  embedded?: boolean;
  basic?: boolean;
  /** Embed deep link (`/embed/dispatch?attempt=…`); the shell uses the route. */
  initialAttemptId?: string;
  panel?: DispatchPanelControl;
}) {
  useEmbedHeadline("Sent", embedded);
  const { route, selectedBrokerAttempt, inspectBrokerAttempt, clearBrokerAttempt } = useScout();
  // One read of /api/broker, shared with every Dispatch panel on the page:
  // warm from the last page on remount, refreshed on broker traffic, paged
  // back by Load older (use-dispatch-ledger.ts).
  const { broker, loading, refreshing, loadingOlder, error, load, loadOlder } = useDispatchLedger();
  const { feedRows, rowModels, nodeCatalog } = useDispatchRows(broker);

  // One scope drives everything below: the ledger, the graph and the tab
  // counts all read from the same matching set. Focus, window and outcome live
  // in the route so a view can be linked; the search box is local. A panel
  // off /dispatch keeps the four in its settings instead.
  const heldScope = panel && !panel.own ? panel.scope ?? EMPTY_DISPATCH_SCOPE : null;
  const viewScope = useMemo(() => heldScope ?? scopeFromRoute(route), [heldScope, route]);
  const focusNodes = viewScope.focus;
  const focusBetween = viewScope.between;
  const timeWindow = viewScope.window;
  const activeTab: BrokerTab = viewScope.filter;
  const [localQuery, setLocalQuery] = useState("");
  const searchQuery = panel ? panel.query : localQuery;
  const setSearchQuery = panel ? panel.onQuery : setLocalQuery;
  const [graphHidden, setGraphHidden] = useState(readGraphHidden);
  const [inspectedNodeKey, setInspectedNodeKey] = useState<string | null>(null);
  // The window is relative to now; re-reading the clock each minute keeps
  // "Last hour" honest on a page left open.
  const nowMs = useMinuteClock();
  const scope = useMemo<DispatchScope>(() => ({
    nodes: focusNodes,
    between: focusBetween,
    window: timeWindow,
    query: searchQuery,
    outcome: activeTab,
  }), [activeTab, focusBetween, focusNodes, searchQuery, timeWindow]);
  const scopeResult = useMemo(
    () => applyDispatchScope(rowModels, scope, nowMs),
    [nowMs, rowModels, scope],
  );
  const matchingRows = scopeResult.matching;
  const activeRows = useMemo(() => matchingRows.map((row) => row.attempt), [matchingRows]);
  const activeHasMore = broker?.ledger.hasMore.attempts ?? false;
  const tabCounts = scopeResult.counts;
  const graph = useMemo(
    () => dispatchGraph(matchingRows, focusNodes, nodeCatalog),
    [focusNodes, matchingRows, nodeCatalog],
  );
  const inspectedNode = inspectedNodeKey ? nodeCatalog.get(inspectedNodeKey) ?? null : null;
  const inspectedNodeTraffic = useMemo(() => {
    if (!inspectedNodeKey) return { sent: 0, received: 0 };
    let sent = 0;
    let received = 0;
    for (const row of matchingRows) {
      if (row.from.key === inspectedNodeKey) sent += 1;
      if (row.to.key === inspectedNodeKey) received += 1;
    }
    return { sent, received };
  }, [inspectedNodeKey, matchingRows]);
  const scopeActive = focusNodes.length > 0
    || timeWindow !== "all"
    || activeTab !== "all"
    || searchQuery.trim().length > 0;

  const navigateScope = useCallback((next: Partial<DispatchRouteScope>) => {
    if (heldScope) {
      panel?.onScope?.(next);
      return;
    }
    navigate(scopeRoute(mergeScope(viewScope, next), route.view === "broker" ? route.attemptId : undefined));
  }, [heldScope, navigate, panel, route, viewScope]);

  const addFocusNode = useCallback((key: string) => {
    if (focusNodes.includes(key)) return;
    navigateScope({ focus: [...focusNodes, key] });
  }, [focusNodes, navigateScope]);
  const removeFocusNode = useCallback((key: string) => {
    navigateScope({ focus: focusNodes.filter((candidate) => candidate !== key) });
  }, [focusNodes, navigateScope]);
  const resetScope = useCallback(() => {
    setSearchQuery("");
    setInspectedNodeKey(null);
    navigateScope({ focus: [], between: false, window: "all", filter: "all" });
  }, [navigateScope, setSearchQuery]);
  const toggleGraph = useCallback(() => {
    setGraphHidden((hidden) => {
      writeGraphHidden(!hidden);
      return !hidden;
    });
  }, []);

  const selectedAttempt = useMemo(() => {
    const requestedAttemptId = route.view === "broker" ? route.attemptId : undefined;
    if (!broker || !requestedAttemptId) return null;
    return feedRows.find((attempt) => attempt.id === requestedAttemptId)
      ?? broker.attempts.find((attempt) => attempt.id === requestedAttemptId)
      ?? broker.failedQueries.find((attempt) => attempt.id === requestedAttemptId)
      ?? broker.failedDeliveries.find((attempt) => attempt.id === requestedAttemptId)
      ?? null;
  }, [broker, feedRows, route]);

  // Every background refresh rebuilds the feed from JSON, so the selected row
  // is a fresh object each poll even when nothing about it changed. Comparing
  // by identity re-cached it into context on every poll and re-rendered the
  // whole surface — including the inspector the operator is typing into. Only
  // a real change (a different row, or new state/timing on the same row) is
  // worth pushing through.
  const selectedAttemptSignature = selectedAttempt
    ? `${selectedAttempt.id}\0${selectedAttempt.status}\0${selectedAttempt.ts}`
    : null;
  const cachedAttemptSignature = selectedBrokerAttempt
    ? `${selectedBrokerAttempt.id}\0${selectedBrokerAttempt.status}\0${selectedBrokerAttempt.ts}`
    : null;

  useEffect(() => {
    if (selectedAttempt && selectedAttemptSignature !== cachedAttemptSignature) {
      inspectBrokerAttempt(selectedAttempt);
    }
  }, [cachedAttemptSignature, inspectBrokerAttempt, selectedAttempt, selectedAttemptSignature]);

  // Selection is the shell's to hold only when there is a shell. An embed's
  // location is `/embed/dispatch`, which never parses to a `broker` route, so
  // the provider's cached attempt stays null there no matter what is clicked —
  // and routing through it would also rewrite the WebView's URL to the shell
  // path. The embed therefore keeps its own selection.
  // Basic web has no shell rail either: it keeps the same local selection and
  // shows the detail in a sheet over the page. A panel off /dispatch must not
  // move the page, so it keeps its own too, and tells the panel to save it.
  const localSelection = embedded || basic || Boolean(heldScope);
  const [embeddedSelection, setEmbeddedSelection] = useState<BrokerRouteAttempt | null>(null);
  /** Set once the deep-link seed has fired, or the operator has taken over. */
  const seedConsumedRef = useRef(false);
  const selectAttempt = useCallback((attempt: BrokerRouteAttempt) => {
    if (localSelection) {
      // Any deliberate selection retires the deep-link seed (see below).
      seedConsumedRef.current = true;
      setEmbeddedSelection(attempt);
      panel?.onSelect?.(attempt.id);
      return;
    }
    inspectBrokerAttempt(attempt);
  }, [localSelection, inspectBrokerAttempt, panel]);
  const clearSelection = useCallback(() => {
    if (localSelection) {
      seedConsumedRef.current = true;
      setEmbeddedSelection(null);
      panel?.onSelect?.(null);
      return;
    }
    clearBrokerAttempt();
  }, [clearBrokerAttempt, localSelection, panel]);

  const openRow = useCallback((attempt: BrokerRouteAttempt) => {
    selectAttempt(attempt);
    // The shell's rail widens for the detail. A panel draws the detail itself,
    // and must not open or resize a rail its view has put away.
    if (panel) return;
    window.dispatchEvent(new CustomEvent("scout:set-inspector-width", {
      detail: { width: 520 },
    }));
  }, [panel, selectAttempt]);

  const activateLedgerRow = useCallback((index: number) => {
    const attempt = activeRows[index];
    if (attempt) openRow(attempt);
  }, [activeRows, openRow]);

  // The web shell mounts the inspector in its right rail. An embed has no rail
  // — the native host owns that chrome — so selecting a row used to update
  // context nothing rendered. The embed therefore carries its own detail pane
  // instead of the host trying to reproduce a web-side inspector natively. A
  // panel carries one too: on /dispatch the URL's dispatch, else its own.
  const inspectorAttempt = localSelection ? embeddedSelection : panel ? selectedBrokerAttempt : null;

  const panelKeyScope = panel?.keyScope;
  const panelOwn = panel?.own ?? false;
  const ledgerKeyScope = useMemo(
    () => (panelKeyScope ? { element: panelKeyScope, idle: panelOwn } : undefined),
    [panelKeyScope, panelOwn],
  );
  const { getRowFocusProps, setFocusedIndex } = useBrokerLedgerKeyboard({
    enabled: Boolean(broker) && activeRows.length > 0,
    rowCount: activeRows.length,
    onActivateRow: activateLedgerRow,
    // In a panel Esc closes an open dispatch and is otherwise left alone, so
    // it still leaves the panel's full view.
    onClearSelection: panel && !inspectorAttempt ? undefined : clearSelection,
    scope: ledgerKeyScope,
  });

  // The ledger reloads every few seconds and rebuilds every row object. A
  // selection captured at click time would keep rendering the status the row
  // had *then* — so a dispatch that later failed would show Delivered in the
  // pane while the ledger beside it shows Failed. Re-read the live row.
  const embeddedSelectionId = embeddedSelection?.id ?? null;
  const embeddedSelectionSignature = embeddedSelection
    ? `${embeddedSelection.id} ${embeddedSelection.status} ${embeddedSelection.ts}`
    : null;
  useEffect(() => {
    if (!localSelection || !embeddedSelectionId) return;
    const fresh = feedRows.find((row) => row.id === embeddedSelectionId);
    if (!fresh) return;
    if (`${fresh.id} ${fresh.status} ${fresh.ts}` === embeddedSelectionSignature) return;
    setEmbeddedSelection(fresh);
  }, [localSelection, embeddedSelectionId, embeddedSelectionSignature, feedRows]);

  // An embed deep link carries only an id, which the ledger may not hold yet —
  // an older attempt only appears after "Load older". So the seed stays armed
  // rather than firing once, but it is disarmed the moment the operator takes
  // over: a late seed must never yank a selection they made, and must never
  // resurrect one they dismissed. Failed queries and deliveries are searched
  // too; those ids never appear in the message feed.
  useEffect(() => {
    if (!localSelection || !initialAttemptId || !broker) return;
    if (seedConsumedRef.current || embeddedSelection) return;
    const match = feedRows.find((row) => row.id === initialAttemptId)
      ?? broker.attempts.find((row) => row.id === initialAttemptId)
      ?? broker.failedQueries.find((row) => row.id === initialAttemptId)
      ?? broker.failedDeliveries.find((row) => row.id === initialAttemptId);
    if (!match) return;
    seedConsumedRef.current = true;
    setEmbeddedSelection(match);
  }, [broker, localSelection, embeddedSelection, feedRows, initialAttemptId]);

  useEffect(() => {
    const requestedAttemptId = route.view === "broker" ? route.attemptId : undefined;
    if (!requestedAttemptId) return;
    const index = activeRows.findIndex((row) => row.id === requestedAttemptId);
    if (index >= 0) setFocusedIndex(index);
  }, [activeRows, activeTab, route, setFocusedIndex]);

  const cycleBrokerTab = useCallback((delta: number) => {
    const current = BROKER_TABS.indexOf(activeTab);
    const next = (current + delta + BROKER_TABS.length) % BROKER_TABS.length;
    navigateScope({ filter: BROKER_TABS[next]! });
  }, [activeTab, navigateScope]);

  // SCO-083: Dispatch is its own primary area — do not render OpsSubnav here.
  return (
    <div className={`s-ops${embedded ? " s-ops--embedded" : ""}${panel ? " s-ops--panel" : ""}${(embedded || panel) && inspectorAttempt ? " s-ops--split" : ""}`}>
      <div className="s-ops-body">
        <div className="sys-surface-page sys-surface-page-wide sys-surface-page-fluid sys-broker-page">
          {broker && !basic && (
            <DispatchFocusBar
              catalog={nodeCatalog}
              focused={focusNodes}
              between={focusBetween}
              window={timeWindow}
              query={searchQuery}
              graphHidden={graphHidden}
              canReset={scopeActive}
              onAddNode={addFocusNode}
              onRemoveNode={removeFocusNode}
              onBetween={(between) => navigateScope({ between })}
              onWindow={(window) => navigateScope({ window })}
              onQuery={setSearchQuery}
              // a panel leaves the graph to the Routes panel
              onToggleGraph={panel ? undefined : toggleGraph}
              onReset={resetScope}
            />
          )}
          {broker && !basic && !panel && !graphHidden && (
            <DispatchRouteGraph
              id="dsp-graph"
              graph={graph}
              inspectedKey={inspectedNodeKey}
              onInspect={(key) => setInspectedNodeKey((current) => (current === key ? null : key))}
              title={focusNodes.length === 0
                ? "All routes"
                : `${focusBetween ? "Between" : "Involving"} ${focusNodes.map((key) => nodeCatalog.get(key)?.label ?? key).join(focusBetween ? " and " : ", ")}`}
              meta={`${matchingRows.length} ${matchingRows.length === 1 ? "request" : "requests"} · ${DISPATCH_WINDOWS.find((entry) => entry.value === timeWindow)?.label ?? "All loaded"}`}
            />
          )}
          {broker && !panel && inspectedNode && (
            <DispatchNodeCard
              node={inspectedNode}
              sent={inspectedNodeTraffic.sent}
              received={inspectedNodeTraffic.received}
              focused={focusNodes.includes(inspectedNode.key)}
              onFocus={() => addFocusNode(inspectedNode.key)}
              onUnfocus={() => removeFocusNode(inspectedNode.key)}
              onClose={() => setInspectedNodeKey(null)}
              copyButton={(value, subject) => <CopyIconButton value={value} subject={subject} />}
            />
          )}
          <div className="sys-ledger-toolbar" aria-label="Dispatch controls">
            {broker ? (
              <div
                className="sys-tab-row sys-tab-row--toolbar"
                role="tablist"
                aria-label="Dispatch message filters"
                onKeyDown={(event) => {
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    cycleBrokerTab(1);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    cycleBrokerTab(-1);
                  }
                }}
              >
                {BROKER_TABS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`sys-tab${activeTab === tab ? " sys-tab-active" : ""}`}
                    onClick={() => navigateScope({ filter: tab })}
                  >
                    <span>{TAB_LABELS[tab]}</span>
                    <span className="sys-tab-count">{tabCounts[tab]}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="sys-ledger-kicker">Dispatch ledger</div>
            )}
            <div className="sys-page-actions sys-ledger-actions">
              <div className="sys-sync-note">
                {loading
                  ? "Loading dispatch ledger..."
                  : broker
                    ? `Updated ${timeAgo(broker.generatedAt)}${broker.source?.latestMessageAt ? ` · latest message ${timeAgo(broker.source.latestMessageAt)}` : ""}`
                    : "Waiting for dispatch data"}
              </div>
              <button
                type="button"
                className="s-btn"
                disabled={loading || refreshing}
                onClick={() => void load("manual")}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {basic && broker && (
            <p className="dsp-view-note dsp-view-note--lead">
              Delivered means the message reached its recipient, not that the work is complete.
            </p>
          )}

          {error && (
            <div className="sys-banner sys-banner-warning">
              <strong>Refresh failed.</strong>
              <span>{error}</span>
            </div>
          )}

          {refreshing && broker && (
            <div
              className="sys-broker-source-note"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle className="sys-broker-source-spinner" size={12} aria-hidden="true" />
              <strong>Updating dispatches…</strong>
            </div>
          )}

          {!refreshing
            && broker?.source?.mode === "sqlite_projection"
            && broker.source.status === "degraded"
            && broker.source.detail && (
            <div
              className="sys-broker-source-note sys-broker-source-note--warning"
              role="status"
              aria-label={broker.source.detail}
              title={broker.source.detail}
            >
              <span className="sys-broker-source-dot" aria-hidden="true" />
              <strong>
                {broker.source.brokerReachable
                  ? "Dispatch history is loading"
                  : "Dispatch may be out of date"}
              </strong>
              <span>
                {broker.source.brokerReachable
                  ? "Broker online; showing saved dispatch history while live messages load."
                  : "Live broker unavailable; showing saved dispatch history."}
              </span>
            </div>
          )}

          {loading && !broker && (
            <div className="sys-broker-empty-wrap">
              <EmptyState
                className="sys-state-card-centered"
                icon={<LoaderCircle className="sys-broker-source-spinner" size={24} aria-hidden="true" />}
                title="Loading dispatch"
                body="Reading the dispatch database snapshot."
              />
            </div>
          )}

          {!loading && !broker && !error && (
            <div className="sys-broker-empty-wrap">
              <EmptyState
                className="sys-state-card-centered"
                title="No dispatch data"
                body="No dispatch rows are available yet."
              />
            </div>
          )}

          {broker && (
            <>
              <BrokerAttemptList
                rows={matchingRows}
                filtered={scopeActive}
                onReset={resetScope}
                // Clicking a row inspects without navigating, so the deep-link
                // id alone left every click unhighlighted. The inspected row is
                // the selection; the route id only seeds it.
                selectedAttemptId={localSelection
                  ? embeddedSelection?.id ?? null
                  : selectedBrokerAttempt?.id
                    ?? (route.view === "broker" ? route.attemptId ?? null : null)}
                onInspect={openRow}
                getRowFocusProps={getRowFocusProps}
              />
              <div className="dsp-ledger-foot">
                <span>
                  Showing {matchingRows.length} of {feedRows.length}
                  {activeHasMore ? "+" : ""} loaded {feedRows.length === 1 ? "request" : "requests"}
                </span>
                {activeHasMore && (
                  <button
                    type="button"
                    className="s-btn"
                    disabled={loadingOlder}
                    onClick={() => void loadOlder()}
                  >
                    {loadingOlder ? "Loading older..." : "Load older"}
                  </button>
                )}
              </div>
              {!basic && (
                <p className="dsp-view-note">
                  Focus and filters change this view only. Connections and permissions stay as they are.
                </p>
              )}
            </>
          )}
        </div>

        {basic && inspectorAttempt && (
          <SlidePanel
            open
            onClose={clearSelection}
            side="right"
            owner="openscout.dispatch"
            resizable
            defaultSize={520}
            minSize={360}
            maxSize={860}
            ariaLabel="Delivery detail"
          >
      {(dismiss) => <>
            <BrokerAttemptInspector
              attempt={inspectorAttempt}
              navigate={navigate}
              onClose={dismiss}
            />
            </>}
    </SlidePanel>
        )}
        {(embedded || panel) && inspectorAttempt && (
          <div className="s-broker-embed-detail">
            <BrokerAttemptInspector
              attempt={inspectorAttempt}
              navigate={navigate}
              onClose={clearSelection}
            />
          </div>
        )}
      </div>
    </div>
  );
}

type BrokerRowFocusProps = ReturnType<typeof useBrokerLedgerKeyboard>["getRowFocusProps"];

const DELIVERY_LABELS: Record<DispatchRowModel["delivery"], string> = {
  attention: "Needs attention",
  delivered: "Delivered",
  pending: "Pending",
};

function DispatchRouteLine({ row }: { row: DispatchRowModel }) {
  return (
    <span className="dsp-row-route" title={`${dispatchNodeTitle(row.from)} → ${dispatchNodeTitle(row.to)}`}>
      <DispatchHarnessMark node={row.from} size={10} className="dsp-row-harness" />
      <span className="dsp-row-from">{row.from.label}</span>
      <ArrowRight size={10} aria-hidden="true" />
      <DispatchHarnessMark node={row.to} size={10} className="dsp-row-harness" />
      <span className="dsp-row-to">{row.to.label}</span>
    </span>
  );
}

function BrokerAttemptList({
  rows,
  filtered,
  onReset,
  selectedAttemptId,
  onInspect,
  getRowFocusProps,
}: {
  rows: DispatchRowModel[];
  filtered: boolean;
  onReset: () => void;
  selectedAttemptId: string | null;
  onInspect: (attempt: BrokerRouteAttempt) => void;
  getRowFocusProps: BrokerRowFocusProps;
}) {
  if (rows.length === 0) {
    return (
      <div className="sys-broker-empty-wrap">
        <EmptyState
          className="sys-state-card-centered"
          title={filtered ? "No matching requests" : "No requests yet"}
          body={filtered
            ? "Change the filters or reset focus. Older dispatches may need Load older."
            : "No dispatch rows are available yet."}
          action={filtered ? (
            <button type="button" className="s-btn" onClick={onReset}>Reset view</button>
          ) : undefined}
        />
      </div>
    );
  }

  const groups = rows.reduce<Array<{
    key: string;
    label: string;
    rows: Array<{ row: DispatchRowModel; index: number }>;
  }>>((result, row, index) => {
    const key = dispatchDayKey(row.attempt.ts);
    const current = result[result.length - 1];
    if (current?.key === key) {
      current.rows.push({ row, index });
    } else {
      result.push({ key, label: dispatchDayLabel(row.attempt.ts), rows: [{ row, index }] });
    }
    return result;
  }, []);

  return (
    <div className="dsp-ledger" aria-label="Dispatch ledger">
      <div className="dsp-ledger-head" aria-hidden="true">
        <span>Request / route</span>
        <span>Delivery</span>
        <span>Time</span>
      </div>
      {groups.map((group) => (
        <section className="dsp-day" key={group.key} aria-labelledby={`dispatch-day-${group.key}`}>
          <header className="dsp-day-head">
            <h2 id={`dispatch-day-${group.key}`}>{group.label}</h2>
            <span>{group.rows.length} {group.rows.length === 1 ? "request" : "requests"}</span>
          </header>
          <div role="list">
            {group.rows.map(({ row, index }) => {
              const { attempt } = row;
              const inspect = () => onInspect(attempt);
              const selected = selectedAttemptId === attempt.id;
              return (
                <div
                  key={attempt.id}
                  role="listitem"
                  className={`dsp-row dsp-row--${row.delivery}${selected ? " dsp-row--selected" : ""}`}
                  aria-label={`${DELIVERY_LABELS[row.delivery]}. ${row.title}. From ${row.from.label} to ${row.to.label}.`}
                  aria-current={selected ? "true" : undefined}
                  onClick={inspect}
                  {...getRowFocusProps(index)}
                >
                  <div className="dsp-row-main">
                    <span
                      className={`dsp-row-title${row.request ? "" : " dsp-row-title--unrecorded"}`}
                      title={row.request ? attempt.detail : `${row.title} — request text not recorded`}
                    >
                      {row.title}
                    </span>
                    <DispatchRouteLine row={row} />
                  </div>
                  <span className={`dsp-status dsp-status--${row.delivery}`}>
                    {row.delivery === "delivered" && <Check size={11} aria-hidden="true" />}
                    {row.delivery === "attention" && <span className="dsp-status-mark" aria-hidden="true">!</span>}
                    {DELIVERY_LABELS[row.delivery]}
                  </span>
                  <time
                    className="dsp-row-time"
                    title={`${timeAgo(attempt.ts)} · ${fullTimestamp(attempt.ts)}`}
                  >
                    {dispatchClock(attempt.ts)}
                  </time>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function brokerInspectorRows(attempt: BrokerRouteAttempt): Array<{ label: string; value: string }> {
  const reference = brokerAttemptReference(attempt);
  return [
    { label: "Kind", value: attemptKindLabel(attempt.kind) },
    { label: "Time", value: fullTimestamp(attempt.ts) },
    { label: "Actor", value: attempt.actorName },
    { label: "Target", value: attempt.target },
    { label: "Route", value: attempt.route },
    { label: "Conversation", value: attempt.conversationId },
    { label: "Reference", value: reference },
    { label: "Message", value: attempt.messageId === reference ? null : attempt.messageId },
    { label: "Delivery", value: attempt.deliveryId === reference ? null : attempt.deliveryId },
    { label: "Invocation", value: attempt.invocationId === reference ? null : attempt.invocationId },
  ].filter((row): row is { label: string; value: string } => Boolean(row.value));
}

export function CopyIconButton({ value, subject, className }: { value: string; subject: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStatus("idle");
  }, [value]);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const copyValue = useCallback(async () => {
    const copied = await copyTextToClipboard(value);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    setStatus(copied ? "copied" : "failed");
    resetTimerRef.current = setTimeout(() => {
      setStatus("idle");
      resetTimerRef.current = null;
    }, 1500);
  }, [value]);

  const copied = status === "copied";
  const failed = status === "failed";

  return (
    <button
      type="button"
      className={`sys-copy-btn${className ? ` ${className}` : ""}${copied ? " sys-copy-btn--copied" : ""}${failed ? " sys-copy-btn--failed" : ""}`}
      onClick={() => void copyValue()}
      title={copied ? `Copied ${subject}` : failed ? "Copy failed" : `Copy ${subject}`}
      aria-label={copied ? `Copied ${subject}` : failed ? `Copy ${subject} failed` : `Copy ${subject}`}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

type DispatchAskResponse = {
  conversationId?: string | null;
  flightId?: string | null;
  flight?: { id?: string | null } | null;
  targetAgentId?: string | null;
};

type DispatchActionStatus = "idle" | "sending" | "sent" | "failed";

function dispatchPayloadSource(payload: string): {
  code: string;
  path: "payload.json" | "payload.md";
  language: "JSON" | "Text · Markdown";
} {
  const trimmed = payload.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return {
        code: JSON.stringify(JSON.parse(trimmed), null, 2),
        path: "payload.json",
        language: "JSON",
      };
    } catch {
      // A prose payload can legitimately begin with a bracket. Preserve it.
    }
  }
  return { code: payload, path: "payload.md", language: "Text · Markdown" };
}

function DispatchPayloadViewer({ payload }: { payload: string }) {
  const source = useMemo(() => dispatchPayloadSource(payload), [payload]);
  const [expanded, setExpanded] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lineCount = source.code.split("\n").length;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !expanded || dialog.open) return;
    dialog.showModal();
  }, [expanded]);

  useEffect(() => {
    setExpanded(false);
  }, [payload]);

  const code = (
    <div
      className="sys-broker-payload-code"
      data-language={source.path === "payload.json" ? "json" : "markdown"}
      role="region"
      aria-label={`Dispatch payload, ${source.language}`}
      tabIndex={0}
    >
      <ShikiPane code={source.code} path={source.path} />
    </div>
  );

  return (
    <>
      <div className="sys-broker-payload-head">
        <span className="sys-detail-label">Payload</span>
        <span className="sys-broker-payload-meta">{source.language} · {lineCount} {lineCount === 1 ? "line" : "lines"}</span>
        <CopyIconButton value={payload} subject="payload" />
        <button
          type="button"
          className="sys-copy-btn sys-broker-payload-expand"
          onClick={() => setExpanded(true)}
          title="Expand payload"
          aria-label="Expand payload"
        >
          <Maximize2 size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="sys-broker-payload-resizer">{code}</div>

      {expanded && createPortal(
        <dialog
          ref={dialogRef}
          className="sys-broker-payload-dialog"
          aria-label="Expanded dispatch payload"
          onCancel={(event) => {
            event.preventDefault();
            setExpanded(false);
          }}
          onClose={() => setExpanded(false)}
        >
          <header className="sys-broker-payload-dialog-head">
            <div>
              <span className="sys-detail-label">Dispatch payload</span>
              <span className="sys-broker-payload-meta">{source.language} · {lineCount} {lineCount === 1 ? "line" : "lines"}</span>
            </div>
            <CopyIconButton value={payload} subject="payload" />
            <button
              type="button"
              className="sys-copy-btn"
              onClick={() => setExpanded(false)}
              title="Return payload to inspector"
              aria-label="Return payload to inspector"
            >
              <Minimize2 size={14} aria-hidden="true" />
            </button>
          </header>
          <div className="sys-broker-payload-dialog-body">{code}</div>
        </dialog>,
        document.body,
      )}
    </>
  );
}

/**
 * Where the dispatch got to, in three steps. It describes delivery only — a
 * delivered dispatch still says nothing about whether the work finished.
 */
function DispatchDeliveryPath({ recovery }: { recovery: DispatchRecovery }) {
  const steps: Array<{ label: string; state: "done" | "stopped" | "waiting" }> = (() => {
    switch (recovery.stage) {
      case "routing-stopped":
        return [
          { label: "Sent", state: "done" },
          { label: "Routing", state: "done" },
          { label: "Stopped", state: "stopped" },
        ];
      case "delivery-failed":
        return [
          { label: "Sent", state: "done" },
          { label: "Routed", state: "done" },
          { label: "Delivery failed", state: "stopped" },
        ];
      case "pending":
        return [
          { label: "Sent", state: "done" },
          { label: "Routed", state: "done" },
          { label: "Awaiting delivery", state: "waiting" },
        ];
      default:
        return [
          { label: "Sent", state: "done" },
          { label: "Routed", state: "done" },
          { label: "Delivered", state: "done" },
        ];
    }
  })();
  return (
    <ol className="dsp-path" aria-label="Delivery path">
      {steps.map((step, index) => (
        <li key={step.label} className={`dsp-path-step dsp-path-step--${step.state}`}>
          {index > 0 && <i aria-hidden="true" />}
          <span>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function BrokerAttemptInspector({
  attempt,
  navigate,
  onClose,
}: {
  attempt: BrokerRouteAttempt;
  navigate: (r: Route) => void;
  onClose: () => void;
}) {
  const { route, agents, scoutbotAgentId, operatorName } = useScout();
  const rows = brokerInspectorRows(attempt);
  const recovery = useMemo(() => dispatchRecovery(attempt), [attempt]);
  const rowModel = useMemo(
    () => dispatchRowModel(attempt, agents, operatorName),
    [agents, attempt, operatorName],
  );
  const metadata = brokerMetadataJson(attempt.metadata);
  const isFailure = brokerAttemptIsFailure(attempt);
  const errorSummary = brokerAttemptErrorSummary(attempt);
  const tone = brokerAttemptTone(attempt.kind, attempt.status);
  const sentAt = metadataTimestamp(attempt, "sentAt", "createdAt") ?? normalizeTimestampMs(attempt.ts);
  const deliveredAt = metadataTimestamp(attempt, "deliveredAt", "completedAt")
    ?? normalizeTimestampMs(attempt.ts);
  const reference = brokerAttemptReference(attempt);
  const [investigateStatus, setInvestigateStatus] = useState<DispatchActionStatus>("idle");
  const [investigateMessage, setInvestigateMessage] = useState<string | null>(null);
  const [investigateConversationId, setInvestigateConversationId] = useState<string | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [messageDraft, setMessageDraft] = useState("");
  const [redispatchAgentId, setRedispatchAgentId] = useState("");
  const [redispatchStatus, setRedispatchStatus] = useState<DispatchActionStatus>("idle");
  const [redispatchMessage, setRedispatchMessage] = useState<string | null>(null);
  const [forwardAgentId, setForwardAgentId] = useState("");
  const [forwardProjectPath, setForwardProjectPath] = useState("");
  const [forwardHarness, setForwardHarness] = useState("");
  const [forwardModel, setForwardModel] = useState("");
  const [forwardEffort, setForwardEffort] = useState("medium");
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<RuntimeCapabilityCatalog | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [modelRefreshError, setModelRefreshError] = useState<string | null>(null);
  const runtimeCatalogLoaderRef = useRef(createRuntimeCatalogLoader<RuntimeCapabilityCatalog>());
  const [forwardFiles, setForwardFiles] = useState<File[]>([]);
  const [forwardStatus, setForwardStatus] = useState<DispatchActionStatus>("idle");
  const [forwardMessage, setForwardMessage] = useState<string | null>(null);
  const retryHarness = metadataText(attempt, "harness");
  const retryModel = metadataText(attempt, "model");
  const retryEffort = metadataText(attempt, "reasoningEffort", "effort");
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const forwardFileInputRef = useRef<HTMLInputElement>(null);
  const contextText = useMemo(() => brokerAttemptContextText(attempt), [attempt]);
  const routableAgents = useMemo(
    () => agents
      .filter((agent) => !agent.retiredFromFleet && !agent.staleLocalRegistration)
      .slice()
      .sort((left, right) => {
        if (left.id === scoutbotAgentId) return -1;
        if (right.id === scoutbotAgentId) return 1;
        return (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.name.localeCompare(right.name);
      }),
    [agents, scoutbotAgentId],
  );
  const originalTargetAgentId = useMemo(
    () => brokerAttemptTargetAgent(attempt, routableAgents)?.id ?? "",
    [attempt, routableAgents],
  );
  // Forward's default target skips Scout — Scout already has its own intent
  // (Investigate), so the draft points at a working agent when one exists.
  const defaultForwardAgentId = routableAgents.find((agent) => agent.id !== scoutbotAgentId)?.id
    ?? routableAgents[0]?.id ?? "";
  const firstRoutableAgentId = routableAgents[0]?.id ?? "";
  const defaultForwardAgent = routableAgents.find((agent) => agent.id === defaultForwardAgentId) ?? null;
  const projectOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const agent of routableAgents) {
      const path = agent.projectRoot?.trim() || agent.cwd?.trim();
      if (!path) continue;
      const fallback = path.split("/").filter(Boolean).at(-1) ?? path;
      options.set(path, agent.project?.trim() || fallback);
    }
    return [...options.entries()].map(([path, label]) => ({ path, label }));
  }, [routableAgents]);

  // Everything the composer is seeded from is derived from the fleet snapshot,
  // and that snapshot churns constantly: `routableAgents` is re-sorted by
  // `updatedAt` on every agents poll, so `firstRoutableAgentId` and friends
  // change identity whenever any agent does anything. Those values are read
  // through a ref so a *reset* can be driven by one thing only — the operator
  // selecting a different dispatch. Depending on them directly meant a busy
  // fleet wiped the half-typed request and re-pointed the recipient mid-compose.
  const composerDefaultsRef = useRef({
    originalTargetAgentId,
    firstRoutableAgentId,
    defaultForwardAgentId,
    defaultForwardAgent,
    effort: "medium",
  });
  composerDefaultsRef.current = {
    originalTargetAgentId,
    firstRoutableAgentId,
    defaultForwardAgentId,
    defaultForwardAgent,
    effort: metadataText(attempt, "reasoningEffort", "effort") || "medium",
  };
  // Set as soon as the operator picks a route themselves, so later seeding can
  // never re-fill a field they deliberately changed (including back to "any").
  const routingTouchedRef = useRef(false);

  useEffect(() => {
    const defaults = composerDefaultsRef.current;
    routingTouchedRef.current = false;
    setInvestigateStatus("idle");
    setInvestigateMessage(null);
    setInvestigateConversationId(null);
    setForwardOpen(false);
    setAdjustOpen(false);
    setMessageDraft("");
    setRedispatchAgentId(defaults.originalTargetAgentId || defaults.firstRoutableAgentId);
    setRedispatchStatus("idle");
    setRedispatchMessage(null);
    setForwardAgentId(defaults.defaultForwardAgentId);
    setForwardProjectPath(
      defaults.defaultForwardAgent?.projectRoot?.trim() || defaults.defaultForwardAgent?.cwd?.trim() || "",
    );
    setForwardHarness(defaults.defaultForwardAgent?.harness?.trim() || "");
    setForwardModel(defaults.defaultForwardAgent?.model?.trim() || "");
    setForwardEffort(defaults.effort);
    setForwardFiles([]);
    setForwardStatus("idle");
    setForwardMessage(null);
    // Deliberately keyed on the selected dispatch alone — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt.id]);

  // The fleet snapshot can land (or repopulate) after this panel mounts, so
  // routing fields that are still empty get filled in. Values that are already
  // set are left alone: seeding must never overwrite an operator's choice.
  useEffect(() => {
    if (routingTouchedRef.current) return;
    setRedispatchAgentId((current) => current || originalTargetAgentId || firstRoutableAgentId);
    setForwardAgentId((current) => current || defaultForwardAgentId);
    setForwardProjectPath((current) => current
      || defaultForwardAgent?.projectRoot?.trim()
      || defaultForwardAgent?.cwd?.trim()
      || "");
    setForwardHarness((current) => current || defaultForwardAgent?.harness?.trim() || "");
    setForwardModel((current) => current || defaultForwardAgent?.model?.trim() || "");
  }, [defaultForwardAgent, defaultForwardAgentId, firstRoutableAgentId, originalTargetAgentId]);

  const refreshRuntimeModels = async () => {
    const query = new URLSearchParams({ scope: "global+project", force: "true" });
    const projectRoot = forwardProjectPath;
    if (projectRoot) query.set("projectRoot", projectRoot);
    setRefreshingModels(true);
    setModelRefreshError(null);
    await runtimeCatalogLoaderRef.current.load(
      () => api<RuntimeCapabilityCatalog>(`/api/runner/options?${query}`),
      {
        publish: setRuntimeCapabilities,
        failed: () => setModelRefreshError("Model refresh is unavailable. Your draft and saved choices are kept."),
        finished: () => setRefreshingModels(false),
      },
    );
  };

  useEffect(() => {
    const query = new URLSearchParams({ scope: "global+project" });
    if (forwardProjectPath) query.set("projectRoot", forwardProjectPath);
    const loader = runtimeCatalogLoaderRef.current;
    setRefreshingModels(false);
    setModelRefreshError(null);
    void loader.load(() => api<RuntimeCapabilityCatalog>(`/api/runner/options?${query}`), {
      publish: (options) => {
        if (options.schemaVersion === "openscout.runtime-capabilities.v1") setRuntimeCapabilities(options);
      },
    });
    return () => { loader.invalidate(); };
  }, [forwardProjectPath]);

  const openForwardDraft = useCallback(() => {
    setForwardOpen(true);
    window.requestAnimationFrame(() => messageInputRef.current?.focus());
  }, []);

  const discardForwardDraft = useCallback(() => {
    setForwardOpen(false);
    setAdjustOpen(false);
    setMessageDraft("");
    setForwardFiles([]);
    setForwardStatus("idle");
    setForwardMessage(null);
  }, []);

  const redispatch = useCallback(async () => {
    const target = routableAgents.find((agent) => agent.id === redispatchAgentId);
    if (!target || redispatchStatus === "sending") return;
    setRedispatchStatus("sending");
    setRedispatchMessage(null);
    try {
      const result = await api<DispatchAskResponse>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          body: attempt.detail,
          targetAgentId: target.id,
          targetLabel: target.name,
          ...((retryHarness || retryModel || retryEffort) ? {
            execution: {
              ...(retryHarness ? { harness: retryHarness } : {}),
              ...(retryModel ? { model: retryModel } : {}),
              ...(retryEffort ? { reasoningEffort: retryEffort } : {}),
              session: "new",
            },
          } : {}),
          metadata: {
            source: "scout-dispatch-redispatch",
            originalDispatchId: attempt.id,
            ...(attempt.messageId ? { originalMessageId: attempt.messageId } : {}),
            ...(attempt.conversationId ? { originalConversationId: attempt.conversationId } : {}),
          },
        }),
      });
      const flightId = result.flightId ?? result.flight?.id;
      setRedispatchStatus("sent");
      setRedispatchMessage(`New dispatch sent to ${target.name}${flightId ? ` · ${flightId}` : ""}`);
    } catch (error) {
      setRedispatchStatus("failed");
      setRedispatchMessage(`Retry failed. ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [attempt, redispatchAgentId, redispatchStatus, retryEffort, retryHarness, retryModel, routableAgents]);

  const forwardDispatch = useCallback(async () => {
    const note = messageDraft.trim();
    const target = routableAgents.find((agent) => agent.id === forwardAgentId);
    if (!note || !target || forwardStatus === "sending") return;
    setForwardStatus("sending");
    setForwardMessage(forwardFiles.length > 0 ? `Uploading ${forwardFiles.length} ${forwardFiles.length === 1 ? "attachment" : "attachments"}…` : null);
    try {
      const attachments = forwardFiles.length > 0 ? await uploadMediaFiles(forwardFiles) : [];
      const result = await api<DispatchAskResponse>("/api/ask", {
        method: "POST",
        body: JSON.stringify({
          body: `${note}\n\nAttached dispatch context:\n${contextText}`,
          targetAgentId: target.id,
          targetLabel: target.name,
          ...(attachments.length > 0 ? { attachments } : {}),
          execution: {
            ...(forwardHarness ? { harness: forwardHarness } : {}),
            ...(forwardModel ? { model: forwardModel } : {}),
            ...(forwardEffort ? { reasoningEffort: forwardEffort } : {}),
          },
          metadata: {
            source: "scout-dispatch-forward",
            originalDispatchId: attempt.id,
            ...(forwardProjectPath ? { targetProjectPath: forwardProjectPath } : {}),
            ...(attempt.messageId ? { originalMessageId: attempt.messageId } : {}),
            ...(attempt.conversationId ? { originalConversationId: attempt.conversationId } : {}),
          },
        }),
      });
      const flightId = result.flightId ?? result.flight?.id;
      setForwardStatus("sent");
      setForwardMessage(`Request sent to ${target.name}${flightId ? ` · ${flightId}` : ""}`);
      setMessageDraft("");
      setForwardFiles([]);
    } catch (error) {
      setForwardStatus("failed");
      setForwardMessage(`Request wasn't sent. ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [attempt, contextText, forwardAgentId, forwardEffort, forwardFiles, forwardHarness, forwardModel, forwardProjectPath, forwardStatus, messageDraft, routableAgents]);

  const addForwardFiles = useCallback((files: File[]) => {
    const accepted = files.filter(isRoutableMediaFile);
    const rejected = files.length - accepted.length;
    if (accepted.length > 0) {
      setForwardFiles((current) => [...current, ...accepted]);
      setForwardStatus("idle");
      setForwardMessage(null);
    }
    if (rejected > 0) {
      setForwardStatus("failed");
      setForwardMessage("Attach markdown, code, an image, or a video clip.");
    }
  }, []);

  const redispatchAgent = routableAgents.find((agent) => agent.id === redispatchAgentId) ?? null;
  const forwardAgent = routableAgents.find((agent) => agent.id === forwardAgentId) ?? null;
  const forwardProjectAgents = routableAgents.filter((agent) => {
    if (!forwardProjectPath) return true;
    return (agent.projectRoot?.trim() || agent.cwd?.trim()) === forwardProjectPath;
  });
  const effectiveCapabilities = runtimeCapabilities ?? RUNTIME_CAPABILITY_SEED;
  // The picker runs on a nested catalog. Models observed on live agents but
  // missing from the capability snapshot stay selectable as "observed" rows,
  // and "" keeps its meaning: no override — the broker picks the runtime.
  const forwardCatalog = useMemo(() => {
    const base = runtimeCatalogFromCapabilities(effectiveCapabilities);
    const observed = [
      forwardModel,
      forwardAgent?.harness === forwardHarness ? forwardAgent.model : null,
      ...forwardProjectAgents
        .filter((agent) => agent.harness === forwardHarness)
        .map((agent) => agent.model),
    ]
      .map((model) => model?.trim())
      .filter((model): model is string => Boolean(model));
    let harnesses = base.harnesses;
    if (!harnesses.some((entry) => entry.value === forwardHarness)) {
      harnesses = [
        { value: forwardHarness, label: forwardHarness || "default", models: [] },
        ...harnesses,
      ];
    }
    harnesses = harnesses.map((entry) => {
      if (entry.value !== forwardHarness) return entry;
      const withDefault = entry.models.some((model) => model.value === "")
        ? entry.models
        : [{ value: "", label: "Default", note: "harness setting" }, ...entry.models];
      const known = new Set(withDefault.map((model) => model.value));
      const extras = observed
        .filter((model) => !known.has(model))
        .map((model) => ({ value: model, label: model, note: "observed" }));
      return extras.length === 0 && withDefault === entry.models
        ? entry
        : { ...entry, models: [...withDefault, ...extras] };
    });
    return { ...base, harnesses };
  }, [effectiveCapabilities, forwardAgent, forwardHarness, forwardModel, forwardProjectAgents]);

  // Outside user interaction (capabilities arriving, target switching) the
  // picker never sees a change event, so the effort clamp lives here.
  useEffect(() => {
    const efforts = effortsFor(forwardCatalog, forwardHarness);
    if (!efforts || efforts.some((candidate) => candidate.value === forwardEffort)) return;
    setForwardEffort(efforts.find((candidate) => candidate.value === "medium")?.value
      ?? efforts[0]?.value
      ?? "");
  }, [forwardCatalog, forwardHarness, forwardEffort]);

  // When resending can't help — there is no recorded request, or the evidence
  // says the same route would refuse again — handing the work to another agent
  // is the real next step, so Forward leads instead of Retry.
  const handOffFirst = isFailure && recovery.retry !== "available";

  // The one automated intent: a stock prompt plus the dispatch context to
  // Scoutbot (read-only, so sending without composing is safe). On a failure
  // it doubles as the failure report — recovery framing instead of a summary.
  const investigate = useCallback(async () => {
    if (investigateStatus === "sending") return;
    if (investigateConversationId) {
      openContent(navigate, { view: "conversation", conversationId: investigateConversationId }, { returnTo: route });
      return;
    }
    setInvestigateStatus("sending");
    setInvestigateMessage(null);
    try {
      const result = await investigateDispatch(attempt);
      setInvestigateStatus("sent");
      setInvestigateConversationId(result.conversationId);
      setInvestigateMessage("Investigation started. Open it to follow along.");
    } catch (error) {
      setInvestigateStatus("failed");
      setInvestigateMessage(`Investigation wasn't sent. ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [attempt, investigateConversationId, investigateStatus, navigate, route]);

  // One paste-able record: the delivery grid plus every technical row.
  const recordJson = useMemo(() => {
    const record: Record<string, string> = {
      state: dispatchStateLabel(attempt),
      reference,
      channel: dispatchChannelLabel(attempt.route),
      latency: dispatchLatencyLabel(attempt),
      sent: dispatchClockWithSeconds(sentAt),
      [isFailure ? "failed" : "delivered"]: dispatchClockWithSeconds(deliveredAt),
    };
    for (const row of rows) record[row.label.toLowerCase()] = row.value;
    return JSON.stringify(record, null, 2);
  }, [attempt, deliveredAt, isFailure, reference, rows, sentAt]);

  const retryAction = (
    <div className="sys-broker-action-row">
      <div className="sys-broker-action-line">
        <span className="sys-broker-action-label" id="dispatch-redispatch-title">Retry</span>
        <div className="sys-broker-redispatch-controls">
          <select
            aria-label="Retry destination"
            value={redispatchAgentId}
            disabled={redispatchStatus === "sending" || routableAgents.length === 0}
            onChange={(event) => {
              setRedispatchAgentId(event.target.value);
              setRedispatchStatus("idle");
              setRedispatchMessage(null);
            }}
          >
            {routableAgents.length === 0 ? (
              <option value="">No agents available</option>
            ) : (
              <>
                {!redispatchAgentId && <option value="">Original destination unavailable</option>}
                {routableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.id === scoutbotAgentId ? "Scout" : agent.name}
                    {agent.project ? ` · ${agent.project}` : ""}
                  </option>
                ))}
              </>
            )}
          </select>
          <button
            type="button"
            className="sys-broker-redispatch-send"
            disabled={!redispatchAgent || redispatchStatus === "sending"}
            onClick={() => void redispatch()}
          >
            {redispatchStatus === "sending" ? <LoaderCircle size={13} className="sys-broker-action-spinner" aria-hidden="true" /> : <RefreshCw size={13} aria-hidden="true" />}
            {redispatchStatus === "sending" ? "Retrying…" : "Retry dispatch"}
          </button>
        </div>
      </div>
      {redispatchAgent && (
        <div className="sys-broker-action-target-meta">
          {redispatchAgent.harness && <span>{redispatchAgent.harness}</span>}
          {redispatchAgent.model && <span>{redispatchAgent.model}</span>}
          {(redispatchAgent.cwd ?? redispatchAgent.projectRoot) && <code>{redispatchAgent.cwd ?? redispatchAgent.projectRoot}</code>}
        </div>
      )}
      {redispatchMessage && (
        <div className={`sys-broker-action-status sys-broker-action-status--${redispatchStatus}`} role="status">
          {redispatchMessage}
        </div>
      )}
    </div>
  );

  return (
    <aside className="sys-panel sys-broker-inspector" aria-label="Dispatch route inspector">
      <header className="sys-broker-inspector-head">
        <div className="sys-broker-inspector-status">
          <span className={`sys-broker-dot sys-broker-dot--${tone}`} aria-hidden="true" />
          <strong className={`sys-broker-state sys-broker-state--${tone}`}>{dispatchStateLabel(attempt)}</strong>
          <code title={reference}>{reference}</code>
          <CopyIconButton
            value={contextText}
            subject="dispatch context"
            className="sys-broker-inspector-copy"
          />
          <button
            type="button"
            className="sys-copy-btn sys-broker-inspector-close"
            onClick={onClose}
            title="Close inspector"
            aria-label="Close inspector"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="sys-broker-inspector-body">
        <section className={`dsp-outcome dsp-outcome--${rowModel.delivery}`} aria-labelledby="dispatch-outcome-headline">
          <span className="dsp-caption">Selected dispatch</span>
          <span className={`dsp-badge dsp-badge--${rowModel.delivery}`}>{dispatchStateBadge(rowModel, recovery)}</span>
          <h2 id="dispatch-outcome-headline">{recovery.headline}</h2>
          {recovery.body && <p>{recovery.body}</p>}
          <DispatchDeliveryPath recovery={recovery} />
        </section>

        <dl className="dsp-facts">
          <div>
            <dt>Request</dt>
            <dd className={rowModel.request ? undefined : "dsp-facts-muted"}>
              {rowModel.request ?? "Not recorded with this routing failure"}
            </dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>
              <span className="dsp-facts-route">
                <DispatchHarnessMark node={rowModel.from} size={11} className="dsp-row-harness" />
                <span title={dispatchNodeTitle(rowModel.from)}>{rowModel.from.label}</span>
                <ArrowRight size={11} aria-hidden="true" />
                <DispatchHarnessMark node={rowModel.to} size={11} className="dsp-row-harness" />
                <span title={dispatchNodeTitle(rowModel.to)}>{rowModel.to.label}</span>
                <span className="dsp-facts-kind">
                  · {rowModel.to.where
                    ? dispatchNodeFacts(rowModel.to).join(" · ")
                    : dispatchNodeKindLabel(rowModel.to).toLowerCase()}
                </span>
              </span>
              {attempt.conversationId && (
                <button
                  type="button"
                  className="sys-broker-route-button"
                  onClick={() => openContent(navigate, { view: "conversation", conversationId: attempt.conversationId! }, { returnTo: route })}
                >
                  <ExternalLink size={11} aria-hidden="true" />
                  Conversation
                </button>
              )}
            </dd>
          </div>
        </dl>

        {recovery.requestRecorded && (
          <section className="sys-broker-payload">
            <DispatchPayloadViewer payload={attempt.detail} />
            {isFailure && errorSummary && errorSummary !== recovery.body && (
              <div className="sys-broker-inspector-error" role="status">
                <span className="sys-broker-inspector-error-label">Error</span>
                <p>{errorSummary}</p>
              </div>
            )}
          </section>
        )}

        {/* The payload is only the ask. Routing succeeded is not an outcome, so
            the aftermath sits directly under it rather than behind an action. */}
        <DispatchAftermath
          attempt={attempt}
          targetAgentId={originalTargetAgentId || null}
          navigate={navigate}
          returnTo={route}
        />

        <section className="sys-broker-actions" aria-label="Dispatch actions">
          {recovery.guidance && <p className="dsp-guidance">{recovery.guidance}</p>}
          {isFailure && recovery.retry === "available" && retryAction}
          <div className={`sys-broker-intents${handOffFirst ? " dsp-intents--handoff" : ""}`}>
            <button
              type="button"
              className={`sys-broker-intent${!isFailure ? " sys-broker-intent--primary" : ""}`}
              disabled={investigateStatus === "sending"}
              onClick={() => void investigate()}
            >
              {investigateStatus === "sending"
                ? <LoaderCircle size={13} className="sys-broker-action-spinner" aria-hidden="true" />
                : investigateConversationId
                  ? <ExternalLink size={13} aria-hidden="true" />
                  : <MessageSquare size={13} aria-hidden="true" />}
              {investigateStatus === "sending"
                ? "Asking Scout…"
                : investigateConversationId
                  ? "Open investigation"
                  : "Investigate with Scout"}
            </button>
            <button
              type="button"
              className={`sys-broker-intent${handOffFirst ? " sys-broker-intent--primary" : ""}`}
              aria-expanded={forwardOpen}
              onClick={() => (forwardOpen ? discardForwardDraft() : openForwardDraft())}
            >
              <ArrowRight size={13} aria-hidden="true" />
              Forward to agent…
            </button>
          </div>
          {isFailure && recovery.retryNote && (
            <p className="dsp-action-note">{recovery.retryNote}</p>
          )}
          {investigateMessage && (
            <div className={`sys-broker-action-status sys-broker-action-status--${investigateStatus}`} role="status">
              {investigateMessage}
            </div>
          )}
          {forwardOpen && (
            <div className="sys-broker-forward-draft">
              <div className="sys-broker-forward-draft-head">
                <span className="sys-broker-action-label">Forward to agent</span>
                <button type="button" className="sys-broker-forward-discard" onClick={discardForwardDraft}>
                  Discard
                </button>
              </div>
              <form
                className="sys-broker-message-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void forwardDispatch();
                }}
              >
                <textarea
                  ref={messageInputRef}
                  id="dispatch-message-input"
                  aria-label="Forward message"
                  value={messageDraft}
                  rows={3}
                  placeholder={`What should ${forwardAgent?.id === scoutbotAgentId ? "Scout" : forwardAgent?.name ?? "this agent"} investigate or do?`}
                  disabled={forwardStatus === "sending"}
                  onChange={(event) => {
                    setMessageDraft(event.target.value);
                    if (forwardStatus !== "idle") {
                      setForwardStatus("idle");
                      setForwardMessage(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void forwardDispatch();
                    }
                  }}
                />
                {forwardFiles.length > 0 && (
                  <div className="sys-broker-composer-attachments" aria-label="Attachments">
                    {forwardFiles.map((file, index) => (
                      <span key={`${file.name}:${file.size}:${index}`}>
                        <Paperclip size={10} aria-hidden="true" />
                        <span title={file.name}>{file.name}</span>
                        <button
                          type="button"
                          onClick={() => setForwardFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                          aria-label={`Remove ${file.name}`}
                        >
                          <X size={10} aria-hidden="true" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <footer>
                  <div className="sys-broker-composer-left">
                    <input
                      ref={forwardFileInputRef}
                      type="file"
                      multiple
                      hidden
                      disabled={forwardStatus === "sending"}
                      onChange={(event) => {
                        addForwardFiles([...(event.target.files ?? [])]);
                        event.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="sys-broker-composer-attach"
                      disabled={forwardStatus === "sending"}
                      onClick={() => forwardFileInputRef.current?.click()}
                      aria-label="Attach files"
                      title="Attach files"
                    >
                      <Plus size={16} aria-hidden="true" />
                    </button>
                    <span className="sys-broker-message-attachment" title={reference}>Context + payload attached</span>
                  </div>

                  <div className="sys-broker-composer-targets">
                    <span className="sys-broker-composer-route-label">To</span>
                    <label title="Forward target">
                      <span>Agent</span>
                      <select
                        aria-label="Forward target"
                        value={forwardAgentId}
                        disabled={forwardStatus === "sending" || forwardProjectAgents.length === 0}
                        onChange={(event) => {
                          const nextAgent = routableAgents.find((agent) => agent.id === event.target.value) ?? null;
                          routingTouchedRef.current = true;
                          setForwardAgentId(event.target.value);
                          if (nextAgent) {
                            setForwardProjectPath(nextAgent.projectRoot?.trim() || nextAgent.cwd?.trim() || "");
                            setForwardHarness(nextAgent.harness?.trim() || "");
                            setForwardModel(nextAgent.model?.trim() || "");
                          }
                          setForwardStatus("idle");
                          setForwardMessage(null);
                        }}
                      >
                        {forwardProjectAgents.length === 0 ? (
                          <option value="">No agents</option>
                        ) : forwardProjectAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.id === scoutbotAgentId ? "Scout" : agent.name}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="sys-broker-forward-adjust-toggle"
                      aria-expanded={adjustOpen}
                      onClick={() => setAdjustOpen((open) => !open)}
                    >
                      Adjust
                      <ChevronDown size={11} aria-hidden="true" />
                    </button>
                    {!BASIC_WEB && (
                      <DictationMic
                        className="sys-broker-composer-mic"
                        disabled={forwardStatus === "sending"}
                        onAppend={(text) => setMessageDraft((current) => current.trim() ? `${current.trimEnd()} ${text}` : text)}
                        onError={(message) => {
                          setForwardStatus("failed");
                          setForwardMessage(message);
                        }}
                      />
                    )}
                  </div>
                  <button
                    type="submit"
                    className="sys-broker-composer-send"
                    disabled={!messageDraft.trim() || !forwardAgent || forwardStatus === "sending"}
                    aria-label={`Ask ${forwardAgent?.name ?? "recipient"} about this dispatch`}
                  >
                    {forwardStatus === "sending" ? <LoaderCircle size={14} className="sys-broker-action-spinner" aria-hidden="true" /> : <SendHorizontal size={14} aria-hidden="true" />}
                  </button>
                </footer>
                {adjustOpen && (
                  <div className="sys-broker-composer-targets sys-broker-forward-adjust">
                    <label title="Project target">
                      <span>Project</span>
                      <select
                        aria-label="Project target"
                        value={forwardProjectPath}
                        disabled={forwardStatus === "sending"}
                        onChange={(event) => {
                          const projectPath = event.target.value;
                          const nextAgent = routableAgents.find((agent) => (
                            !projectPath || (agent.projectRoot?.trim() || agent.cwd?.trim()) === projectPath
                          )) ?? null;
                          routingTouchedRef.current = true;
                          setForwardProjectPath(projectPath);
                          if (nextAgent) {
                            setForwardAgentId(nextAgent.id);
                            setForwardHarness(nextAgent.harness?.trim() || "");
                            setForwardModel(nextAgent.model?.trim() || "");
                          }
                        }}
                      >
                        <option value="">Any project</option>
                        {projectOptions.map((project) => (
                          <option key={project.path} value={project.path}>{project.label}</option>
                        ))}
                      </select>
                    </label>
                    <RuntimePicker
                      catalog={forwardCatalog}
                      onRefreshModels={() => { void refreshRuntimeModels(); }}
                      refreshingModels={refreshingModels}
                      catalogStatus={runtimeModelCatalogStatus(runtimeCapabilities)}
                      catalogWarning={runtimeCatalogNotice(runtimeCapabilities, modelRefreshError)}
                      value={{ harness: forwardHarness, model: forwardModel, effort: forwardEffort }}
                      onChange={(next: RuntimeValue) => {
                        routingTouchedRef.current = true;
                        setForwardHarness(next.harness);
                        setForwardModel(next.model);
                        setForwardEffort(next.effort);
                      }}
                      disabled={forwardStatus === "sending"}
                    />
                  </div>
                )}
              </form>
              {forwardMessage && (
                <div className={`sys-broker-action-status sys-broker-action-status--${forwardStatus}`} role="status">
                  {forwardMessage}
                </div>
              )}
            </div>
          )}
        </section>

        <details className="sys-broker-technical">
          <summary>
            <span>Technical details</span>
            <ChevronDown size={13} aria-hidden="true" />
          </summary>
          <dl className="sys-broker-delivery-grid">
            <div>
              <dt>Channel</dt>
              <dd>{dispatchChannelLabel(attempt.route)}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd className="sys-broker-delivery-accent">{dispatchLatencyLabel(attempt)}</dd>
            </div>
            <div>
              <dt>Sent</dt>
              <dd>{dispatchClockWithSeconds(sentAt)}</dd>
            </div>
            <div>
              <dt>{isFailure ? "Failed" : "Delivered"}</dt>
              <dd>{dispatchClockWithSeconds(deliveredAt)}</dd>
            </div>
          </dl>
          {(recovery.evidence.length > 0 || !recovery.requestRecorded) && (
            <div className="sys-broker-inspector-rows dsp-evidence">
              {!recovery.requestRecorded && (
                <div className="sys-broker-inspector-row">
                  <span className="sys-detail-label">Broker said</span>
                  <code className="sys-detail-value">{attempt.detail}</code>
                  <CopyIconButton value={attempt.detail} subject="broker detail" />
                </div>
              )}
              {recovery.evidence.map((item) => (
                <div key={item.label} className="sys-broker-inspector-row">
                  <span className="sys-detail-label">{item.label}</span>
                  <code className="sys-detail-value">{item.value}</code>
                  <CopyIconButton value={item.value} subject={item.label.toLowerCase()} />
                </div>
              ))}
            </div>
          )}
          <div className="sys-broker-record-head">
            <span className="sys-detail-label">Record</span>
            <CopyIconButton value={recordJson} subject="record as JSON" className="sys-broker-metadata-copy" />
          </div>
          <div className="sys-broker-inspector-rows">
            {rows.map((row) => (
              <div key={row.label} className="sys-broker-inspector-row">
                <span className="sys-detail-label">{row.label}</span>
                <code className="sys-detail-value">{row.value}</code>
                <CopyIconButton value={row.value} subject={row.label.toLowerCase()} />
              </div>
            ))}
          </div>
          <div className="sys-broker-metadata">
            <div className="sys-broker-metadata-head">
              <span className="sys-detail-label">Metadata</span>
              <CopyIconButton value={metadata} subject="metadata" className="sys-broker-metadata-copy" />
            </div>
            <BrokerMetadataPanel metadata={attempt.metadata} rawJson={metadata} />
          </div>
          {!isFailure && recovery.retry === "available" && retryAction}
        </details>
        {isFailure && (
          <p className="dsp-action-note dsp-action-note--foot">
            Needs attention reflects this dispatch's own result. Scout doesn't track whether a later dispatch recovered it.
          </p>
        )}
      </div>
    </aside>
  );
}

export const scoutSurface = defineSurface({
  id: "dispatch",
  // Literal, not getDestination(): BrokerScreen ships in the basic client, and
  // importing nav-destinations drags every full-app label into that bundle.
  label: "Sent",
  route: { view: "broker" },
  webPath: "/dispatch",
  screen: "BrokerScreen",
  embed: {
    path: "/embed/dispatch",
    profile: "macos.dispatch",
    rootClassName: "s-broker-embed",
    chrome: { showSecondaryNav: false, showPageStatusBar: false },
    // Filter tabs and row selection are `view: "broker"` routes; the host has
    // nowhere else to put them, so the embed keeps them.
    ownsInternalRoutes: true,
    resolveEmbedProps: (params) => {
      const attempt = params.get("attempt")?.trim();
      return attempt ? { initialAttemptId: attempt } : {};
    },
    hosts: { macos: true },
  },
});
