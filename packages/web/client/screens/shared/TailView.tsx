import "../ops/ops-tail.css";

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";
import { SlidePanel } from "../../components/SlidePanel/SlidePanel.tsx";
import { HarnessMark, harnessLabel } from "../../components/HarnessMark.tsx";
import { api, peekApiGet } from "../../lib/api.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { RECENT_REPLAY_PATH } from "../../lib/tail-recent-replay.ts";
import { tailSelectionRange } from "../../lib/tail-selection.ts";
import {
  formatClockTimestamp,
  normalizeTimestampMs,
} from "../../lib/time.ts";
import {
  collapseTailDisplayRows,
  isTailNoiseEvent,
  shortTailSession,
  TAIL_KIND_GLYPH as KIND_GLYPH,
  TAIL_KIND_LABEL as KIND_LABEL,
  type TailDisplayMode,
} from "../../lib/tail-display.ts";
import { classifyTailIssue, isBookkeepingTailEvent, type IssueSeverity } from "../../lib/tail-issues.ts";
import { useTailEvents } from "../../lib/tail-events.ts";
import { mergeHydratedTailEvents } from "../../lib/tail-event-merge.ts";
import { openContent } from "../../scout/slots/openContent.ts";
import { useScout } from "../../scout/Provider.tsx";
import { TailLookbackLine, useTailLookback } from "./tail-lookback.tsx";
import type {
  Route,
  TailDiscoverySnapshot,
  TailEvent,
  TailEventKind,
} from "../../lib/types.ts";

const BUFFER_LIMIT = 5_000;
/** Rows in the DOM. The buffer keeps 5,000 for filtering; drawing them all
    on every event is what pinned a core (and, in dev, filled memory). */
const RENDER_LIMIT = 600;
const DEFAULT_RECENT_LIMIT = 500;
/** How old a shared recent replay may be and still fill the Tail on open. */
const RECENT_REPLAY_PEEK_MS = 15_000;
const DISCOVERY_REFRESH_MS = 30_000;
const DISPLAY_MODE_STORAGE_KEY = "openscout:tail-display-mode";

type TailAttribution = TailEvent["harness"];

const ATTRIBUTION_LABEL: Record<TailAttribution, string> = {
  "scout-managed": "scout",
  "hudson-managed": "hudson",
  unattributed: "native",
};

const ORIGIN_ABBR: Record<TailAttribution, string> = {
  "scout-managed": "sc",
  "hudson-managed": "hu",
  unattributed: "na",
};

type TailViewVariant = "tail" | "issues";
type TailViewChrome = "full" | "embedded";
type TailFilterScope = "all" | "context";
type IssueFilter = "warn-plus" | "errors-only" | "all";
type ClassifiedTailEvent = {
  event: TailEvent;
  severity: IssueSeverity | null;
};

type SourceCount = {
  source: string;
  count: number;
};

function displayHarness(source: string | null | undefined): string {
  return source?.trim().toLowerCase() || "unknown";
}

function summarizeSources(
  discovery: TailDiscoverySnapshot | null,
  events: TailEvent[],
): SourceCount[] {
  const counts = new Map<string, number>();
  const sourceRows = discovery?.transcripts?.length
    ? discovery.transcripts
    : discovery?.processes.length
      ? discovery.processes
      : events;

  for (const row of sourceRows) {
    const source = displayHarness(row.source);
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

function formatTime(ts: number): string {
  return formatClockTimestamp(ts, { milliseconds: true }) || "—";
}

/** Keys must not carry the row's position: when the buffer slides by one,
    a positional key remounts every row. Repeats of one id get a suffix. */
function tailRowKeys(rows: readonly { event: TailEvent }[]): string[] {
  const seen = new Map<string, number>();
  return rows.map(({ event }) => {
    const base = `${event.id}:${event.ts}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  });
}

function readStoredDisplayMode(): TailDisplayMode {
  try {
    const stored = sessionStorage.getItem(DISPLAY_MODE_STORAGE_KEY);
    if (stored === "work" || stored === "all") return stored;
  } catch {
    // ignore storage failures
  }
  return "work";
}

function rawRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/**
 * Codex logs a finished shell step as `item_completed`, with the command's
 * outcome inside (`item.status: "failed"`, `exit_code`). The issue classifier
 * reads that outcome, so a failed command is flagged; the row should then say
 * "command failed", not "item_completed" beside an error mark.
 */
export function tailSummaryLabel(event: TailEvent): string {
  const summary = event.summary;
  if (event.source !== "codex" || summary.trim() !== "item_completed") return summary;
  const item = rawRecord(rawRecord(rawRecord(event.raw)?.payload)?.item);
  if (!item || item.type !== "CommandExecution") return summary;
  const command = Array.isArray(item.command) && item.command.every((part) => typeof part === "string")
    ? (item.command.length >= 3 && /(?:^|\/)(?:ba|z|da)?sh$/.test(String(item.command[0])) ? String(item.command[2]) : item.command.join(" "))
    : "";
  const head = command.replace(/\s+/g, " ").trim();
  const exit = typeof item.exit_code === "number" ? item.exit_code : null;
  const failed = item.status === "failed" || (exit !== null && exit !== 0);
  const outcome = failed
    ? exit !== null && exit !== 0 ? `command failed · exit ${exit}` : "command failed"
    : "command done";
  return head ? `${outcome} · ${head}` : outcome;
}

/** `…2d0b`: session ids are time-ordered, so the tail is the part that differs. */
function sessionTail(sessionId: string): string {
  const id = sessionId.split(":")[0]?.replace(/^session_/u, "") ?? sessionId;
  const compact = id.replace(/[^A-Za-z0-9]/g, "");
  return compact ? `…${compact.slice(-4)}` : "—";
}

function issueFilterAllows(severity: IssueSeverity | null, filter: IssueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "warn-plus") return severity != null;
  return severity === "error";
}

function issueFilterLabel(filter: IssueFilter): string {
  switch (filter) {
    case "errors-only":
      return "errors";
    case "warn-plus":
      return "warnings or errors";
    case "all":
      return "all session events";
  }
}

function matchesFilter(
  event: TailEvent,
  query: string,
  severity: IssueSeverity | null = null,
  scope: TailFilterScope = "all",
): boolean {
  if (!query) return true;
  const attribution = ATTRIBUTION_LABEL[event.harness];
  const issueWords = severity === "error"
    ? "error failed failure issue"
    : severity === "warn"
      ? "warn warning issue"
      : "";
  const searchableParts = scope === "context"
    ? [
        event.project,
        event.cwd,
        event.sessionId,
        event.source,
        event.harness,
        attribution,
        issueWords,
      ]
    : [
        event.summary,
        event.project,
        event.cwd,
        event.sessionId,
        event.source,
        event.harness,
        attribution,
        issueWords,
      ];
  const haystack = searchableParts.join(" ").toLowerCase();
  // Pipe-separated terms are OR-matched ("hudson|claude" matches either)
  const terms = query.toLowerCase().split("|").map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.some((term) => haystack.includes(term));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function tailMetadataText(event: TailEvent): string {
  const rows = [
    ["time", formatFullTime(event.ts)],
    ["kind", event.kind],
    ["project", event.project],
    ["cwd", event.cwd || "—"],
    ["session", event.sessionId || "—"],
    ["source", harnessLabel(event.source)],
    ["origin", ATTRIBUTION_LABEL[event.harness]],
    ["pid", event.parentPid != null ? `${event.pid} <- ${event.parentPid}` : String(event.pid)],
  ];
  return rows.map(([key, value]) => `${key}: ${value}`).join("\n");
}

export function tailDetailSnapshot(event: TailEvent) {
  const sourceLabel = harnessLabel(event.source);
  const originLabel = ATTRIBUTION_LABEL[event.harness];
  const raw = safeJson(event.raw ?? event);
  const metadata = [
    { label: "Time", value: formatFullTime(event.ts) },
    { label: "Kind", value: event.kind },
    { label: "Project", value: event.project },
    { label: "Cwd", value: event.cwd || "—" },
    { label: "Session", value: event.sessionId || "—" },
    { label: "Source", value: sourceLabel },
    { label: "Origin", value: originLabel },
    {
      label: "Pid",
      value: event.parentPid != null ? `${event.pid} <- ${event.parentPid}` : String(event.pid),
    },
  ];
  return {
    source: "tail",
    focus: "item",
    title: `${event.kind} · ${sourceLabel}`,
    meta: `${formatFullTime(event.ts)} · ${event.project} · ${shortTailSession(event.sessionId)}`,
    body: event.summary,
    metadata,
    copy: [
      { label: "Copy message", value: event.summary },
      { label: "Copy metadata", value: tailMetadataText(event) },
      { label: "Copy raw", value: raw },
    ],
    action: event.sessionId
      ? { label: "Open session", route: { view: "sessions", sessionId: event.sessionId } }
      : null,
  };
}

function publishOpsDetail(detail: unknown) {
  if (typeof window === "undefined") return;
  const target = window as typeof window & { scoutOpsDetailSnapshot?: unknown };
  target.scoutOpsDetailSnapshot = detail;
  window.dispatchEvent(new CustomEvent("scout:ops-detail", { detail }));
}

export function TailView({
  navigate,
  initialFilter,
  sessionId,
  variant = "tail",
  chrome = "full",
  inlineDetail = false,
  filterLabel,
  filterScope = "all",
  density = "default",
  onSelect,
  keyScope,
}: {
  navigate?: (r: Route) => void;
  initialFilter?: string;
  sessionId?: string;
  variant?: TailViewVariant;
  chrome?: TailViewChrome;
  inlineDetail?: boolean;
  filterLabel?: string;
  filterScope?: TailFilterScope;
  /** Compact rows give the event text the width: session as a short tail, harness as its mark. */
  density?: "default" | "compact";
  /**
   * Hears each row pick. Returning true means the pick is shown beside the
   * tail (a view's Event panel): no detail sheet opens and nothing goes to
   * Ops' inspector. Absent, or false: as before.
   */
  onSelect?: (event: TailEvent) => boolean;
  /**
   * For an embedded tail in a view panel: bind / esc G while focus is inside
   * the returned element (views/modules/panel-scope.ts). Absent: the full
   * chrome binds them on the window and the embedded one binds none.
   */
  keyScope?: () => HTMLElement | null;
} = {}) {
  const { route } = useScout();
  const issueMode = variant === "issues";
  const embedded = chrome === "embedded";
  const [events, setEvents] = useState<TailEvent[]>([]);
  const [discovery, setDiscovery] = useState<TailDiscoverySnapshot | null>(null);
  const [filter, setFilter] = useState(initialFilter ?? "");
  // Editing/clearing the visible filter returns to ordinary fleet search.
  // Do not leave an invisible session constraint behind after Escape.
  const scopedSessionId = filter === initialFilter ? sessionId : undefined;
  const [filterOpen, setFilterOpen] = useState(Boolean(initialFilter) && !embedded);
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("warn-plus");
  const [paused, setPaused] = useState(false);
  const [pausedEvents, setPausedEvents] = useState<TailEvent[] | null>(null);
  const pausedRef = useRef(false);
  const [selectionKeys, setSelectionKeys] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const pause = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    setPausedEvents(events);
    setPaused(true);
  }, [events]);
  const [pendingCount, setPendingCount] = useState(0);
  const [selected, setSelected] = useState<TailEvent | null>(null);
  // the selected row is shown by whoever onSelect handed it to
  const [selectedBeside, setSelectedBeside] = useState(false);
  const select = useCallback((event: TailEvent) => {
    setSelectedBeside(onSelect?.(event) ?? false);
    setSelected(event);
  }, [onSelect]);
  const [displayMode, setDisplayMode] = useState<TailDisplayMode>(readStoredDisplayMode);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  const wasAtBottomRef = useRef(true);

  // Events arrive in bursts; take them once a frame, not once each. A hidden
  // tab gets no frames, so it holds the queue (capped) and draws nothing.
  const queuedRef = useRef<TailEvent[]>([]);
  const flushRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(flushRef.current), []);
  const handleEvent = useCallback((event: TailEvent) => {
    if (scopedSessionId && event.sessionId !== scopedSessionId) return;
    const queue = queuedRef.current;
    queue.push(event);
    if (queue.length > BUFFER_LIMIT) queue.splice(0, queue.length - BUFFER_LIMIT);
    if (flushRef.current) return;
    flushRef.current = requestAnimationFrame(() => {
      flushRef.current = 0;
      const batch = queuedRef.current;
      queuedRef.current = [];
      if (!batch.length) return;
      if (pausedRef.current) setPendingCount((count) => count + batch.length);
      setEvents((prev) => {
        const next = prev.concat(batch);
        return next.length > BUFFER_LIMIT ? next.slice(next.length - BUFFER_LIMIT) : next;
      });
    });
  }, [scopedSessionId]);

  useTailEvents(handleEvent);

  useEffect(() => {
    setFilter(initialFilter ?? "");
    setFilterOpen(Boolean(initialFilter) && !embedded);
  }, [embedded, initialFilter]);

  useEffect(() => {
    try {
      sessionStorage.setItem(DISPLAY_MODE_STORAGE_KEY, displayMode);
    } catch {
      // ignore storage failures
    }
  }, [displayMode]);

  // Older history on request (tail-lookback.ts). The first load below reports
  // what it read, which decides what looking back can still add.
  const hydrateEvents = useCallback((update: SetStateAction<TailEvent[]>) => {
    setEvents(update);
    // Explicitly loading older logs must also extend a paused view, while live
    // arrivals continue to accumulate outside its stable selection snapshot.
    if (pausedRef.current) setPausedEvents((held) => held === null ? held
      : typeof update === "function" ? update(held) : update);
  }, []);
  const lookback = useTailLookback(scopedSessionId, events, hydrateEvents, BUFFER_LIMIT);
  const { noteFirstLoad } = lookback;

  useEffect(() => {
    let cancelled = false;
    let pending = false;
    let hydrated = false;
    const load = async () => {
      if (pending || hydrated) return;
      pending = true;
      try {
        const params = new URLSearchParams({ limit: String(DEFAULT_RECENT_LIMIT) });
        if (scopedSessionId) params.set("sessionId", scopedSessionId);
        const transcripts = embedded || Boolean(initialFilter);
        if (transcripts) {
          params.set("transcripts", "true");
        }
        // Unscoped with transcripts, read the shared recent replay Home and the
        // session board read too, so they share one request, and keep its
        // newest lines. A read of it from the last few seconds fills at once.
        const shared = transcripts && !scopedSessionId;
        const path = shared ? RECENT_REPLAY_PATH : `/api/tail/recent?${params.toString()}`;
        const result = (shared ? peekApiGet<{ events: TailEvent[] }>(path, RECENT_REPLAY_PEEK_MS) : null)
          ?? await api<{ events: TailEvent[] }>(path);
        const recent = (result.events ?? []).slice(-DEFAULT_RECENT_LIMIT);
        hydrated = recent.length > 0;
        if (!cancelled) hydrateEvents((previous) => mergeHydratedTailEvents(
          scopedSessionId ? previous.filter((event) => event.sessionId === scopedSessionId) : previous,
          recent,
          BUFFER_LIMIT,
        ));
        if (!cancelled) noteFirstLoad({
          limit: DEFAULT_RECENT_LIMIT,
          transcripts: Boolean(scopedSessionId) || transcripts,
          count: recent.length,
        });
      } catch {
        // A just-assigned session may not be discovered yet. Retry its
        // bounded history until it arrives; keep any live events meanwhile.
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = scopedSessionId ? setInterval(() => void load(), 5_000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [embedded, hydrateEvents, initialFilter, noteFirstLoad, scopedSessionId]);

  useEffect(() => {
    if (embedded || inlineDetail || selectedBeside) return;
    publishOpsDetail(selected ? tailDetailSnapshot(selected) : null);
    return () => publishOpsDetail(null);
  }, [embedded, inlineDetail, selected, selectedBeside]);

  const loadDiscovery = useCallback(async () => {
    try {
      const snap = await api<TailDiscoverySnapshot>("/api/tail/discover");
      setDiscovery(snap);
    } catch {
      /* swallow */
    }
  }, []);

  useEffect(() => {
    void loadDiscovery();
    const id = setInterval(() => void loadDiscovery(), DISCOVERY_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadDiscovery]);

  const classifiedEvents = useMemo<ClassifiedTailEvent[]>(
    () => (pausedEvents ?? events).map((event) => ({ event, severity: classifyTailIssue(event) })),
    [events, pausedEvents],
  );

  const issueCounts = useMemo(() => {
    let warn = 0;
    let error = 0;
    for (const entry of classifiedEvents) {
      if (entry.severity === "error") error++;
      if (entry.severity === "warn") warn++;
    }
    return { warn, error, total: warn + error };
  }, [classifiedEvents]);

  const filtered = useMemo(() => {
    return classifiedEvents.filter(({ event, severity }) => {
      if (scopedSessionId && event.sessionId !== scopedSessionId) return false;
      if (issueMode && !issueFilterAllows(severity, issueFilter)) return false;
      return matchesFilter(event, filter, severity, filterScope);
    });
  }, [classifiedEvents, filter, filterScope, issueFilter, issueMode, scopedSessionId]);

  // The newest RENDER_LIMIT rows are drawn until the operator reaches back;
  // then all the view holds is, so what a look-back loaded is on screen.
  const renderLimit = lookback.last ? BUFFER_LIMIT : RENDER_LIMIT;
  const displayRows = useMemo(() => {
    // Work mode hides noise and bracketed bookkeeping rows ([attachment],
    // [api-request]) unless they carry an issue; "all" shows everything.
    const narrowed = filtered.filter(({ event, severity }) =>
      displayMode === "all"
      || (!isTailNoiseEvent(event) && (severity != null || !isBookkeepingTailEvent(event))),
    );
    const rows = collapseTailDisplayRows(
      narrowed.map((row) => ({ event: row.event, meta: row.severity })),
    );
    return rows.length > renderLimit ? rows.slice(rows.length - renderLimit) : rows;
  }, [displayMode, filtered, renderLimit]);
  const displayKeys = useMemo(() => tailRowKeys(displayRows), [displayRows]);

  // Auto-scroll-to-bottom unless paused.
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (paused) return;
    body.scrollTop = body.scrollHeight;
  }, [displayRows, paused]);

  // Detect manual scroll-up to engage pause.
  const handleScroll = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const distance = body.scrollHeight - body.scrollTop - body.clientHeight;
    const atBottom = distance < 24;
    wasAtBottomRef.current = atBottom;
    // Pause remains an explicit choice even if the viewport is at the bottom.
    if (!atBottom && !pausedRef.current) pause();
  }, [pause]);

  const focusFilter = useCallback((seed: string) => {
    setFilter(seed);
    setFilterOpen(true);
    requestAnimationFrame(() => filterInputRef.current?.focus());
  }, []);

  const navigateToSession = useCallback(
    (sessionId: string) => {
      if (!sessionId || !navigate) return;
      openContent(navigate, { view: "sessions", sessionId }, { returnTo: route });
    },
    [navigate, route],
  );

  const jumpToLive = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
    pausedRef.current = false;
    setPaused(false);
    setPausedEvents(null);
    setPendingCount(0);
    setSelectionKeys([]);
    setSelectedText("");
    body.ownerDocument.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    // A different session is a fresh stream, not the previous session's snapshot.
    pausedRef.current = false;
    setPaused(false);
    setPausedEvents(null);
    setPendingCount(0);
  }, [scopedSessionId]);

  const selectLog = useCallback((event: TailEvent, key: string, shift: boolean) => {
    if (bodyRef.current?.ownerDocument.getSelection()?.toString()) return;
    pause();
    if (shift) {
      const range = tailSelectionRange(displayKeys, selectionAnchor.current, key);
      if (!selectionAnchor.current || !displayKeys.includes(selectionAnchor.current)) selectionAnchor.current = key;
      setSelectionKeys(range);
      setSelected(null);
    } else {
      selectionAnchor.current = key;
      setSelectionKeys([key]);
      select(event);
    }
    setCopyStatus("");
  }, [displayKeys, pause, select]);

  const selectionText = selectedText || displayRows.flatMap(({ event }, index) =>
    selectionKeys.includes(displayKeys[index]!)
      ? [`${formatTime(event.ts)}\t${harnessLabel(event.source)}\t${event.project}\t${KIND_LABEL[event.kind] ?? event.kind}\t${tailSummaryLabel(event)}`]
      : [],
  ).join("\n");

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const document = body.ownerDocument;
    const changed = () => {
      const selection = document.getSelection();
      const text = selection && selection.anchorNode && body.contains(selection.anchorNode)
        ? selection.toString() : "";
      setSelectedText(text);
      setCopyStatus("");
      if (text) pause();
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [pause]);

  useEffect(() => {
    setSelectionKeys([]);
    selectionAnchor.current = null;
    setSelectedText("");
  }, [filter, displayMode, issueFilter, scopedSessionId]);

  // Keyboard shortcuts: /, Esc, G
  useEffect(() => {
    if (embedded && !keyScope) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // in a view panel, only while focus is inside it
      if (keyScope && !(target && keyScope()?.contains(target))) return;
      const inEditable = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target?.isContentEditable ?? false);

      if (event.key === "/" && !inEditable) {
        event.preventDefault();
        setFilterOpen(true);
        requestAnimationFrame(() => filterInputRef.current?.focus());
        return;
      }
      if (event.key === "Escape") {
        // Sheet escape is handled inside <SlidePanel>; here we only handle filter close.
        if (filterOpen && document.activeElement === filterInputRef.current) {
          event.preventDefault();
          setFilterOpen(false);
          filterInputRef.current?.blur();
          setFilter("");
          return;
        }
      }
      if ((event.key === "g" || event.key === "G") && !inEditable) {
        event.preventDefault();
        jumpToLive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded, filterOpen, jumpToLive, keyScope]);

  const totals = discovery?.totals;
  const transcriptCount = totals?.transcripts ?? discovery?.transcripts?.length ?? 0;
  const harnessCounts = useMemo(() => summarizeSources(discovery, events), [discovery, events]);

  return (
    <div className={`s-tail s-tail--${chrome}${density === "compact" ? " s-tail--compact" : ""}`}>
      <div className={`s-tail-status${issueMode ? " s-tail-status--issues" : ""}`}>
        {!issueMode && (
          <span className="s-tail-status-cluster s-tail-status-cluster--display">
            <span className="s-tail-issue-filter" role="group" aria-label="Tail display mode">
              <button
                type="button"
                className={`s-tail-issue-filter-btn${
                  displayMode === "work" ? " s-tail-issue-filter-btn--active" : ""
                }`}
                onClick={() => setDisplayMode("work")}
                aria-pressed={displayMode === "work"}
              >
                work
              </button>
              <button
                type="button"
                className={`s-tail-issue-filter-btn${
                  displayMode === "all" ? " s-tail-issue-filter-btn--active" : ""
                }`}
                onClick={() => setDisplayMode("all")}
                aria-pressed={displayMode === "all"}
              >
                all · {filtered.length}
              </button>
            </span>
          </span>
        )}
        {issueMode && (
          <span className="s-tail-status-cluster s-tail-status-cluster--issues">
            <span className="s-tail-status-key">flt</span>
            <span className="s-tail-issue-filter" role="group" aria-label="Alert severity filter">
              <button
                type="button"
                className={`s-tail-issue-filter-btn${
                  issueFilter === "errors-only" ? " s-tail-issue-filter-btn--active" : ""
                }`}
                onClick={() => setIssueFilter("errors-only")}
                aria-pressed={issueFilter === "errors-only"}
              >
                err:{issueCounts.error}
              </button>
              <button
                type="button"
                className={`s-tail-issue-filter-btn${
                  issueFilter === "warn-plus" ? " s-tail-issue-filter-btn--active" : ""
                }`}
                onClick={() => setIssueFilter("warn-plus")}
                aria-pressed={issueFilter === "warn-plus"}
              >
                wrn+:{issueCounts.total}
              </button>
              <button
                type="button"
                className={`s-tail-issue-filter-btn${
                  issueFilter === "all" ? " s-tail-issue-filter-btn--active" : ""
                }`}
                onClick={() => setIssueFilter("all")}
                aria-pressed={issueFilter === "all"}
              >
                all:{events.length}
              </button>
            </span>
          </span>
        )}
        <span className="s-tail-status-spacer" />
        <span className="s-tail-status-cluster s-tail-status-cluster--harnesses">
          <span className="s-tail-status-key">src</span>
          <span className="s-tail-status-inline">
            {harnessCounts.length > 0 ? (
              harnessCounts.slice(0, 4).map((entry) => (
                <span key={entry.source} className="s-tail-status-src">
                  <HarnessMark harness={entry.source} size={10} title={null} />
                  <span>{harnessLabel(entry.source)}:{entry.count}</span>
                </span>
              ))
            ) : (
              <span className="s-tail-status-src">—</span>
            )}
          </span>
        </span>
        {filter && embedded && (
          <span className="s-tail-status-filter" title={filter}>
            q={filterLabel ?? "filtered"}
          </span>
        )}
      </div>

      {filterOpen && (
        <div className="s-tail-filter">
          <span className="s-tail-filter-prompt">/</span>
          <input
            ref={filterInputRef}
            className="s-tail-filter-input"
            value={filter}
            placeholder="substring across summary · project · session"
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                filterInputRef.current?.blur();
              }
            }}
            autoFocus
            spellCheck={false}
          />
          <span className="s-tail-filter-hint">esc to clear</span>
        </div>
      )}

      <div className="s-tail-body" ref={bodyRef} onScroll={handleScroll}
        onPointerDown={(event) => {
          if (event.button === 0) pointerStart.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const start = pointerStart.current;
          if (start && event.buttons === 1 && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) pause();
        }}
        onPointerUp={() => { pointerStart.current = null; }}
        onPointerCancel={() => { pointerStart.current = null; }}
      >
        {displayRows.length > 0 && <TailLookbackLine lookback={lookback} earlier />}
        {displayRows.length === 0 ? (
          <div className="s-tail-empty">
            <span className="s-tail-empty-title">
              {issueMode ? "No alert events" : "Waiting for events"}<span className="s-tail-empty-cursor" aria-hidden="true" />
            </span>
            <span className="s-tail-empty-body">
              {filter ? (
                embedded ? (
                  <>no events match <strong>{filterLabel ?? "this work filter"}</strong></>
                ) : (
                  <>no events match filter <strong>{filter}</strong></>
                )
              ) : issueMode ? (
                <>no {issueFilterLabel(issueFilter)} in the buffered session tail</>
              ) : transcriptCount ? (
                <>watching {transcriptCount} transcript{transcriptCount === 1 ? "" : "s"} · no events yet</>
              ) : (
                <>agent tool calls, messages, and system events stream here</>
              )}
            </span>
            <TailLookbackLine lookback={lookback} />
            {!transcriptCount && !filter && (
              <span className="s-tail-empty-hint">
                Start a session to see traffic<span className="s-tail-empty-hint-sep"> · </span>
                <code>scout watch --tail</code>
              </span>
            )}
          </div>
        ) : (
          displayRows.map(({ event, repeatCount, meta: severity }, index) => (
            <TailRow
              key={displayKeys[index]}
              event={event}
              repeatCount={repeatCount}
              issueSeverity={severity}
              selected={selectionKeys.includes(displayKeys[index]!) || selected === event}
              onSelect={(event, shift) => selectLog(event, displayKeys[index]!, shift)}
              onProjectClick={focusFilter}
              onSessionClick={navigateToSession}
              compact={density === "compact"}
            />
          ))
        )}
      </div>

      <div className="s-tail-footer">
        <span className="s-tail-follow-state" role="status">
          <span className={`s-tail-live-dot${paused ? " s-tail-live-dot--paused" : ""}`} aria-hidden="true" />
          {paused ? "Paused" : "Following live"}
          {paused && pendingCount > 0 && <span className="s-tail-pending">{pendingCount} new</span>}
        </span>
        <span className="s-tail-follow-actions" role="group" aria-label="Tail following">
          <button type="button" onClick={pause} disabled={paused}>Pause</button>
          <button type="button" onClick={jumpToLive} disabled={!paused} title="Follow live (G)">Follow</button>
        </span>
        <span className="s-tail-selection-hint">
          {selectionText ? selectedText ? "Text selected" : `${selectionKeys.length} selected` : "Drag or Shift-click to select logs"}
        </span>
        {selectionText && <>
          <button type="button" onClick={async () => setCopyStatus(await copyTextToClipboard(selectionText) ? "Copied" : "Copy failed")}>
            Copy
          </button>
          <button type="button" aria-label="Clear log selection" onClick={() => {
            setSelectionKeys([]);
            setSelectedText("");
            bodyRef.current?.ownerDocument.getSelection()?.removeAllRanges();
          }}>Clear</button>
        </>}
        {copyStatus && <span role="status">{copyStatus}</span>}
        <span className="s-tail-footer-count">{displayRows.length}/{events.length} buf</span>
      </div>

      {(embedded || inlineDetail) && selected && !selectedBeside && (
        <TailDetailSheet
          event={selected}
          onClose={() => setSelected(null)}
          onProjectClick={focusFilter}
          onSessionClick={navigateToSession}
        />
      )}
    </div>
  );
}

const TailRow = memo(function TailRow({
  event,
  repeatCount = 1,
  issueSeverity,
  selected,
  onSelect,
  onProjectClick,
  onSessionClick,
  compact = false,
}: {
  event: TailEvent;
  compact?: boolean;
  repeatCount?: number;
  issueSeverity?: IssueSeverity | null;
  selected: boolean;
  onSelect: (event: TailEvent, shift: boolean) => void;
  onProjectClick?: (project: string) => void;
  onSessionClick?: (sessionId: string) => void;
}) {
  const attributionLabel = ATTRIBUTION_LABEL[event.harness];
  const sourceLabel = harnessLabel(event.source);
  const issueClass = issueSeverity ? ` s-tail-row--issue s-tail-row--issue-${issueSeverity}` : "";
  const quietClass = !issueSeverity && isBookkeepingTailEvent(event) ? " s-tail-row--bookkeeping" : "";
  const summary = tailSummaryLabel(event);
  return (
    <div
      className={`s-tail-row s-tail-row--${event.kind}${issueClass}${quietClass}${selected ? " s-tail-row--selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={(e) => onSelect(event, e.shiftKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(event, e.shiftKey);
        }
      }}
    >
      <span className="s-tail-cell-time" title={compact ? formatTime(event.ts) : undefined}>
        {compact ? formatClockTimestamp(event.ts) || "—" : formatTime(event.ts)}
      </span>
      <span className="s-tail-token s-tail-token--harness" title={`source: ${sourceLabel}`}>
        <HarnessMark harness={event.source} size={11} title={null} />
        <span className="s-tail-harness-label">{sourceLabel}</span>
      </span>
      <span
        className="s-tail-token s-tail-token--origin"
        title={`origin: ${attributionLabel}`}
      >
        {ORIGIN_ABBR[event.harness]}
      </span>
      {compact ? (
        <span className="s-tail-cell-context" title={`${event.project} / ${event.sessionId || "—"}${event.pid > 0 ? ` : pid ${event.pid}` : ""}`}>
          <TailLink
            className="s-tail-link s-tail-link--session"
            onClick={
              onSessionClick && event.sessionId
                ? () => onSessionClick(event.sessionId)
                : undefined
            }
            title={event.sessionId ? `Open session ${event.sessionId} (${event.project})` : undefined}
          >
            {sessionTail(event.sessionId)}
          </TailLink>
        </span>
      ) : (
      <span className="s-tail-cell-context">
        <TailLink
          className="s-tail-link s-tail-link--project"
          onClick={onProjectClick ? () => onProjectClick(event.project) : undefined}
          title={`Filter to ${event.project}`}
        >
          {event.project}
        </TailLink>
        <span className="s-tail-sep">/</span>
        <TailLink
          className="s-tail-link s-tail-link--session"
          onClick={
            onSessionClick && event.sessionId
              ? () => onSessionClick(event.sessionId)
              : undefined
          }
          title={event.sessionId ? `Open session ${event.sessionId}` : undefined}
        >
          {shortTailSession(event.sessionId)}
        </TailLink>
        <span className="s-tail-sep">:</span>
        <span className="s-tail-cell-pid" title={event.pid > 0 ? `pid ${event.pid}` : "file-backed log"}>
          {event.pid > 0 ? event.pid : "log"}
        </span>
      </span>
      )}
      <span className="s-tail-kind" title={event.kind}>
        <span className={`s-tail-glyph s-tail-glyph--${event.kind}`}>{KIND_GLYPH[event.kind]}</span>
        <span className="s-tail-kind-label">{KIND_LABEL[event.kind]}</span>
      </span>
      <span className="s-tail-summary">
        {issueSeverity === "error" ? "✕ " : issueSeverity === "warn" ? "△ " : null}
        {summary}
        {repeatCount > 1 ? (
          <span className="s-tail-repeat" title={`${repeatCount} identical events collapsed`}>
            {" "}×{repeatCount}
          </span>
        ) : null}
      </span>
    </div>
  );
});

/**
 * Inline hyperlink-style span. If `onClick` is provided, the span renders as a
 * clickable element that swallows row-click propagation; otherwise it renders
 * as plain text. Used so identifiers in a row (project, session) are
 * navigable without conflicting with the row's open-detail click.
 */
function TailLink({
  className,
  onClick,
  title,
  children,
}: {
  className: string;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  if (!onClick) return <span className={className} title={title}>{children}</span>;
  return (
    <span
      className={`${className} s-tail-link--active`}
      role="link"
      tabIndex={0}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }
      }}
    >
      {children}
    </span>
  );
}

function formatFullTime(ts: number): string {
  const tsMs = normalizeTimestampMs(ts);
  if (tsMs === null) return "—";
  const d = new Date(tsMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}.${ms}`;
}

function highlightJson(value: unknown): string {
  const json = JSON.stringify(value, null, 2) ?? "undefined";
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(
    /("(?:\\.|[^"\\])*"\s*:)|("(?:\\.|[^"\\])*")|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (_match, key, str, lit, num) => {
      if (key) return `<span class="s-tail-jk">${key}</span>`;
      if (str) return `<span class="s-tail-js">${str}</span>`;
      if (lit) return `<span class="s-tail-jl">${lit}</span>`;
      if (num) return `<span class="s-tail-jn">${num}</span>`;
      return _match;
    },
  );
}

type TextBlock = { type: "text"; text: string };
type ToolUseBlock = { type: "tool_use"; name?: string; input?: unknown; id?: string };
type ToolResultBlock = {
  type: "tool_result";
  content?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
};
type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown };

function getContentBlocks(raw: unknown): ContentBlock[] | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const message = obj.message as Record<string, unknown> | undefined;
  const content = (message?.content ?? obj.content) as unknown;
  if (Array.isArray(content)) return content as ContentBlock[];
  if (typeof content === "string") return [{ type: "text", text: content }];
  return null;
}

function TailDetailSheet({
  event,
  onClose,
  onProjectClick,
  onSessionClick,
}: {
  event: TailEvent;
  onClose: () => void;
  onProjectClick?: (project: string) => void;
  onSessionClick?: (sessionId: string) => void;
}) {
  const [showRaw, setShowRaw] = useState(true);
  const attributionLabel = ATTRIBUTION_LABEL[event.harness];
  const sourceLabel = harnessLabel(event.source);
  const issueSeverity = classifyTailIssue(event);
  const blocks = getContentBlocks(event.raw);

  return (
    <SlidePanel
      open
      onClose={onClose}
      side="right"
      owner="openscout.tail"
      resizable
      defaultSize={620}
      minSize={400}
      maxSize={960}
      ariaLabel="Tail event detail"
    >
      {(dismiss) => <>
        <div className="s-slide-header s-tail-sheet-header">
          <span className={`s-tail-glyph s-tail-glyph--${event.kind}`}>{KIND_GLYPH[event.kind]}</span>
          <span className="s-tail-sheet-kind">{KIND_LABEL[event.kind]}</span>
          {issueSeverity && (
            <span className={`s-tail-token s-tail-token--issue-${issueSeverity}`}>
              {issueSeverity === "error" ? "✕" : "△"}
            </span>
          )}
          <span className="s-tail-token s-tail-token--harness">
            <HarnessMark harness={event.source} size={12} title={null} />
            <span className="s-tail-harness-label">{sourceLabel}</span>
          </span>
          <span className="s-tail-token s-tail-token--origin" title={`origin: ${attributionLabel}`}>
            {ORIGIN_ABBR[event.harness]}
          </span>
          <span className="s-slide-spacer" />
          <span className="s-tail-sheet-time">{formatFullTime(event.ts)}</span>
          <button type="button" className="s-slide-close" onClick={dismiss} aria-label="Close">
            ×
          </button>
        </div>

        <div className="s-slide-body s-tail-sheet-body">
          <section className="s-tail-sheet-section">
            <div className="s-tail-sheet-grid">
              <span className="s-tail-sheet-key">project</span>
              <span className="s-tail-sheet-val">
                <TailLink
                  className="s-tail-link s-tail-link--project"
                  onClick={onProjectClick ? () => onProjectClick(event.project) : undefined}
                  title={`Filter to ${event.project}`}
                >
                  {event.project}
                </TailLink>
              </span>
              <span className="s-tail-sheet-key">cwd</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">{event.cwd || "—"}</span>
              <span className="s-tail-sheet-key">session</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">
                <TailLink
                  className="s-tail-link s-tail-link--session"
                  onClick={
                    onSessionClick && event.sessionId
                      ? () => onSessionClick(event.sessionId)
                      : undefined
                  }
                  title={event.sessionId ? `Open session ${event.sessionId}` : undefined}
                >
                  {event.sessionId || "—"}
                </TailLink>
              </span>
              <span className="s-tail-sheet-key">harness</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--harness">
                <HarnessMark harness={event.source} size={13} title={null} />
                <span>{sourceLabel}</span>
              </span>
              <span className="s-tail-sheet-key">origin</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">{attributionLabel}</span>
              <span className="s-tail-sheet-key">pid</span>
              <span className="s-tail-sheet-val s-tail-sheet-val--mono">
                {event.pid}
                {event.parentPid != null ? ` ← ${event.parentPid}` : ""}
              </span>
            </div>
          </section>

          <section className="s-tail-sheet-section">
            <h4 className="s-tail-sheet-h">summary</h4>
            <div className="s-tail-sheet-summary">{event.summary}</div>
          </section>

          {blocks && blocks.length > 0 && (
            <section className="s-tail-sheet-section">
              <h4 className="s-tail-sheet-h">content</h4>
              {blocks.map((block, i) => (
                <ContentBlockView key={i} block={block} />
              ))}
            </section>
          )}

          <section className="s-tail-sheet-section">
            <button
              type="button"
              className="s-tail-sheet-toggle"
              onClick={() => setShowRaw((v) => !v)}
            >
              {showRaw ? "▾" : "▸"} raw event
            </button>
            {showRaw && (
              <pre
                className="s-tail-sheet-json"
                dangerouslySetInnerHTML={{ __html: highlightJson(event.raw ?? event) }}
              />
            )}
          </section>
        </div>
      </>}
    </SlidePanel>
  );
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.type === "text") {
    const text = (block as TextBlock).text ?? "";
    return <div className="s-tail-sheet-text">{text}</div>;
  }
  if (block.type === "tool_use") {
    const t = block as ToolUseBlock;
    return (
      <div className="s-tail-sheet-block s-tail-sheet-block--tool">
        <div className="s-tail-sheet-block-head">
          <span className="s-tail-glyph s-tail-glyph--tool">*</span>
          <span className="s-tail-sheet-block-title">{t.name ?? "tool_use"}</span>
        </div>
        <pre
          className="s-tail-sheet-json"
          dangerouslySetInnerHTML={{ __html: highlightJson(t.input ?? {}) }}
        />
      </div>
    );
  }
  if (block.type === "tool_result") {
    const r = block as ToolResultBlock;
    const isString = typeof r.content === "string";
    return (
      <div
        className={`s-tail-sheet-block s-tail-sheet-block--tool-result${
          r.is_error ? " s-tail-sheet-block--err" : ""
        }`}
      >
        <div className="s-tail-sheet-block-head">
          <span className="s-tail-glyph s-tail-glyph--tool-result">=</span>
          <span className="s-tail-sheet-block-title">
            tool_result{r.is_error ? " · error" : ""}
          </span>
        </div>
        {isString ? (
          <pre className="s-tail-sheet-pre">{r.content as string}</pre>
        ) : (
          <pre
            className="s-tail-sheet-json"
            dangerouslySetInnerHTML={{ __html: highlightJson(r.content ?? {}) }}
          />
        )}
      </div>
    );
  }
  return (
    <div className="s-tail-sheet-block">
      <div className="s-tail-sheet-block-head">
        <span className="s-tail-glyph s-tail-glyph--other">·</span>
        <span className="s-tail-sheet-block-title">{block.type}</span>
      </div>
      <pre
        className="s-tail-sheet-json"
        dangerouslySetInnerHTML={{ __html: highlightJson(block) }}
      />
    </div>
  );
}
