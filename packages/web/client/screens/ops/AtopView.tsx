/**
 * Atop — agent activity inventory.
 *
 * Sibling of TailView. Where Tail is a time-ordered firehose ("what just
 * happened?"), Atop is the agent-level view ("what is each agent actually
 * doing — how much it's spending, what tools, how many requests, how often
 * it's asking for permission").
 *
 * Row identity = one currently-running agent (today: a Claude process with
 * its active session). Columns surface agent-life metrics: requests, tokens,
 * cache hits, tool calls, permission requests, last activity. Process
 * details (pid, parent chain, command) are still useful — they sit in the
 * drawer behind the agent row.
 *
 * The rows, summary, sorting, filters and keys live in atop-model.ts (data
 * contract and backend grow points are documented there); the live read in
 * atop-feed.ts, shared with the Runtime panels (views/modules/runtime-*.tsx),
 * which mount SummaryStrip and AtopTable from here.
 */

import "./ops-atop.css";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { DataTable, type DataTableColumn } from "../../components/DataTable/DataTable.tsx";
import { HarnessMark, harnessLabel } from "../../components/HarnessMark.tsx";
import { ObservedTopologyPanel } from "../../components/ObservedTopologyPanel.tsx";
import type { TailDiscoveredProcess, TailEvent } from "../../lib/types.ts";
import { readProcessDetail, useAtopFeed, type AtopFeed } from "./atop-feed.ts";
import {
  ATTRIBUTION_LABEL,
  atopKeyAction,
  cacheHitRate,
  filterRows,
  fmtBytes,
  fmtCount,
  fmtCpu,
  fmtElapsed,
  fmtPct,
  formatRelative,
  formatRuntime,
  formatTimestamp,
  atopEmpty,
  freshnessLine,
  harnessChipClass,
  moveSelection,
  PEEK_LINE_LIMIT,
  rowEvents,
  scopeRows,
  shortCommand,
  shortSession,
  sortRows,
  STATUS_LABEL,
  STATUS_RANK,
  tokenTotal,
  toolHistogram as histogramOf,
  type AtopFreshness,
  type AtopRow,
  type AtopScope,
  type AtopStatus,
  type AtopSummary,
  type SortKey,
} from "./atop-model.ts";

/* ── Sparkline ── */

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 88;
  const h = 18;
  if (values.length < 2) {
    return <svg className="s-atop-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} />;
  }
  const max = Math.max(1, ...values);
  const dx = w / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * dx).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="s-atop-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline fill="none" stroke={color} strokeWidth="1.25" points={pts} />
    </svg>
  );
}

/* ── Main view ── */

export function AtopView() {
  const feed = useAtopFeed();
  return (
    <div className="s-atop">
      <SummaryStrip summary={feed.summary} runHistory={feed.runHistory} toolHistory={feed.toolHistory} />
      <ObservedTopologyPanel
        title="Harness families"
        size="compact"
        maxAgents={6}
        maxTasks={3}
        showEmpty
      />
      <AtopTable feed={feed} />
    </div>
  );
}

/**
 * The filter bar, the agent table, the key hints and the open row's drawer,
 * as siblings (the page's grid lays them out). `scope` narrows the rows
 * before the filter bar (a panel's harness, status or project).
 *
 * Keys: with no `keyScope` (the page) j/k, the arrows, Enter, "/" and Esc
 * answer from anywhere but a field, as they always did. In a panel they
 * answer while focus is inside it, and on the Runtime page (`own`) also
 * while nothing has focus.
 */
export function AtopTable({
  feed,
  scope,
  keyScope,
  own = true,
}: {
  feed: AtopFeed;
  scope?: AtopScope;
  keyScope?: () => HTMLElement | null;
  own?: boolean;
}) {
  const { events, discovery, now } = feed;
  const rows = useMemo(() => (scope ? scopeRows(feed.rows, scope) : feed.rows), [feed.rows, scope]);
  const summary = useMemo(() => (scope ? summarizeRows(rows, feed.summary) : feed.summary), [rows, feed.summary, scope]);

  const [search, setSearch] = useState("");
  const [harnessFilter, setHarnessFilter] = useState<Set<string>>(() => new Set());
  const [statusFilter, setStatusFilter] = useState<Set<AtopStatus>>(() => new Set());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "status", dir: 1 });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /* available filter options (only show pills for axes that have variety) */
  const harnessOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((row) => set.add(row.harness));
    return [...set];
  }, [rows]);

  const statusOptions = useMemo(() => {
    const set = new Set<AtopStatus>();
    rows.forEach((row) => set.add(row.status));
    return [...set];
  }, [rows]);

  /* filter + sort */
  const filteredRows = useMemo(
    () => filterRows(rows, { search, harness: harnessFilter, status: statusFilter }),
    [rows, search, harnessFilter, statusFilter],
  );

  const columns = useMemo(() => atopColumns(now), [now]);

  const secondarySort = useMemo(
    () => (sort.key === "status" ? undefined : (a: AtopRow, b: AtopRow) => STATUS_RANK[a.status] - STATUS_RANK[b.status]),
    [sort.key],
  );

  const displayRows = useMemo(() => sortRows(filteredRows, sort), [filteredRows, sort]);

  /* keep selected row valid */
  useEffect(() => {
    if (selectedKey == null) return;
    if (!rows.some((row) => row.key === selectedKey)) {
      setSelectedKey(null);
    }
  }, [rows, selectedKey]);

  /* keyboard nav */
  const keyScopeRef = useRef(keyScope);
  keyScopeRef.current = keyScope;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inField = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || (target?.isContentEditable ?? false);
      const scopeEl = keyScopeRef.current?.() ?? null;
      const active = document.activeElement;
      const action = atopKeyAction({
        key: event.key,
        inField,
        onControl: !!target?.closest?.("button, a[href], select, summary, [role='button']"),
        modified: event.metaKey || event.ctrlKey || event.altKey || event.shiftKey,
        hasSelection: selectedKey != null,
        page: !keyScopeRef.current,
        inside: !!scopeEl && !!active && scopeEl.contains(active),
        idle: !active || active === document.body,
        own,
      });
      if (action === null) return;
      if (action === "close") {
        event.preventDefault();
        setSelectedKey(null);
      } else if (action === "filter") {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (action === "hold") {
        event.preventDefault();
      } else if (displayRows.length > 0) {
        event.preventDefault();
        setSelectedKey(moveSelection(displayRows, selectedKey, action));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [displayRows, selectedKey, own]);

  const toggleHarness = (harness: string) => {
    setHarnessFilter((prev) => {
      const next = new Set(prev);
      if (next.has(harness)) next.delete(harness);
      else next.add(harness);
      return next;
    });
  };
  const toggleStatus = (status: AtopStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const selectedRow = useMemo(
    () => (selectedKey != null ? rows.find((row) => row.key === selectedKey) ?? null : null),
    [rows, selectedKey],
  );
  const listedProcess = useMemo(
    () => (selectedRow
      ? discovery?.processes.find((process) => process.pid === selectedRow.pid) ?? null
      : null),
    [discovery, selectedRow],
  );
  const selectedProcess = useProcessDetail(listedProcess);
  const selectedEvents = useMemo(
    () => (selectedRow ? rowEvents(events, selectedRow) : []),
    [events, selectedRow],
  );

  return (
    <>
      <FilterBar
        inputRef={inputRef}
        search={search}
        onSearch={setSearch}
        harnessOptions={harnessOptions}
        harnessFilter={harnessFilter}
        onToggleHarness={toggleHarness}
        statusOptions={statusOptions}
        statusFilter={statusFilter}
        onToggleStatus={toggleStatus}
        summary={summary}
      />

      <DataTable
        rows={filteredRows}
        columns={columns}
        rowId={(row) => row.key}
        // v2: the column set changed; widths saved for the old one must not apply
        storageKey="openscout.atop.cols.v2"
        sort={sort}
        onSortChange={setSort}
        secondarySort={secondarySort}
        onRowClick={(row) => setSelectedKey(row.key)}
        rowClassName={(row) => (selectedKey === row.key ? "s-atop-row--selected" : undefined)}
        empty={atopEmpty(feed.freshness, search.trim() !== "" || harnessFilter.size > 0 || statusFilter.size > 0)}
        density="compact"
        className="s-atop-data-table"
        ariaLabel="Agent activity inventory"
      />

      <KeyHints
        shown={displayRows.length}
        total={rows.length}
        hasSelection={selectedKey != null}
        freshness={feed.freshness}
        now={now}
      />

      {selectedRow && (
        <DetailPanel
          row={selectedRow}
          process={selectedProcess}
          events={selectedEvents}
          now={now}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </>
  );
}

/**
 * The open row's process with its parent chain. The slim list the table
 * polls leaves chains empty, so the drawer reads that one process once per
 * opening (not on every poll), and keeps what the list had if that fails.
 */
function useProcessDetail(listed: TailDiscoveredProcess | null): TailDiscoveredProcess | null {
  const [detail, setDetail] = useState<{ key: string; process: TailDiscoveredProcess | null } | null>(null);
  const key = listed ? `${listed.source}:${listed.pid}` : null;
  const hasChain = (listed?.parentChain?.length ?? 0) > 0;
  useEffect(() => {
    if (!key || !listed || hasChain) return;
    const controller = new AbortController();
    readProcessDetail({ source: listed.source, pid: listed.pid }, controller.signal)
      .then((process) => {
        if (!controller.signal.aborted) setDetail({ key, process });
      })
      .catch(() => {
        /* the drawer shows what the list had */
      });
    return () => controller.abort();
    // read once per opened process, not on every poll's new object
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hasChain]);
  if (!listed) return null;
  if (hasChain || detail?.key !== key || !detail.process) return listed;
  return { ...listed, parentChain: detail.process.parentChain };
}

/** A scoped table's own counts, for its pills: the page's request rate stays (events carry no row). */
function summarizeRows(rows: readonly AtopRow[], whole: AtopSummary): AtopSummary {
  const harnessCounts = new Map<string, number>();
  let running = 0;
  let tooling = 0;
  for (const row of rows) {
    if (row.status !== "idle") running++;
    if (row.status === "tool") tooling++;
    harnessCounts.set(row.harness, (harnessCounts.get(row.harness) ?? 0) + 1);
  }
  return {
    total: rows.length,
    running,
    tooling,
    idle: rows.length - running,
    harnesses: [...harnessCounts.entries()]
      .map(([harness, count]) => ({ harness, count }))
      .sort((a, b) => b.count - a.count || a.harness.localeCompare(b.harness)),
    reqsPerMin: whole.reqsPerMin,
  };
}

/* ── Sub-components ── */

export function SummaryStrip({
  summary,
  runHistory,
  toolHistory,
}: {
  summary: AtopSummary;
  runHistory: number[];
  toolHistory: number[];
}) {
  return (
    <div className="s-atop-summary">
      <div className="s-atop-summary-cell s-atop-summary-cell--primary">
        <div className="s-atop-summary-num">
          <strong>{summary.running}</strong>
          <span className="s-atop-summary-of">/ {summary.total}</span>
        </div>
        <span className="s-atop-summary-lbl">active</span>
        <Sparkline values={runHistory} color="var(--green)" />
      </div>
      <div className="s-atop-summary-cell">
        <div className="s-atop-summary-num">
          <strong>{summary.tooling}</strong>
        </div>
        <span className="s-atop-summary-lbl">working</span>
        <Sparkline values={toolHistory} color="var(--accent)" />
      </div>
      <div className="s-atop-summary-cell">
        <div className="s-atop-summary-num">
          <strong>{summary.idle}</strong>
        </div>
        <span className="s-atop-summary-lbl">idle</span>
      </div>
      <div className="s-atop-summary-cell s-atop-summary-cell--breakdown">
        <span className="s-atop-summary-lbl">harness</span>
        <div className="s-atop-summary-row">
          {summary.harnesses.length > 0 ? (
            summary.harnesses.slice(0, 4).map((entry) => (
              <span key={entry.harness} className={harnessChipClass(entry.harness)}>
                <HarnessMark harness={entry.harness} size={11} title={null} />
                {harnessLabel(entry.harness)} {entry.count}
              </span>
            ))
          ) : (
            <span className="s-atop-chip s-atop-chip--mute">none</span>
          )}
        </div>
      </div>
      <div className="s-atop-summary-spacer" />
      <div className="s-atop-summary-cell s-atop-summary-cell--rate">
        <div className="s-atop-summary-num">
          <strong>{summary.reqsPerMin}</strong>
          <span className="s-atop-summary-of">/ min</span>
        </div>
        <span className="s-atop-summary-lbl">requests</span>
      </div>
    </div>
  );
}

function FilterBar({
  inputRef,
  search,
  onSearch,
  harnessOptions,
  harnessFilter,
  onToggleHarness,
  statusOptions,
  statusFilter,
  onToggleStatus,
  summary,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  search: string;
  onSearch: (v: string) => void;
  harnessOptions: string[];
  harnessFilter: Set<string>;
  onToggleHarness: (h: string) => void;
  statusOptions: AtopStatus[];
  statusFilter: Set<AtopStatus>;
  onToggleStatus: (s: AtopStatus) => void;
  summary: AtopSummary;
}) {
  const harnessCount = (harness: string): number =>
    summary.harnesses.find((entry) => entry.harness === harness)?.count ?? 0;
  const statusCount = (status: AtopStatus): number => {
    if (status === "tool") return summary.tooling;
    if (status === "run") return summary.running - summary.tooling;
    return summary.idle;
  };

  return (
    <div className="s-atop-fbar">
      <div className="s-atop-search">
        <span className="s-atop-search-prompt">▸</span>
        <input
          ref={inputRef}
          className="s-atop-search-input"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="filter by pid · project · command · summary"
          spellCheck={false}
        />
        <span className="s-atop-search-kbd">/</span>
      </div>

      {harnessOptions.length > 1 && (
        <>
          <span className="s-atop-fbar-label">harness</span>
          {harnessOptions.map((harness) => {
            const on = harnessFilter.has(harness);
            return (
              <button
                key={harness}
                className={`s-atop-pill s-atop-pill--harness${on ? " s-atop-pill--on" : ""}`}
                onClick={() => onToggleHarness(harness)}
              >
                <HarnessMark harness={harness} size={11} title={null} />
                {harnessLabel(harness)}
                <span className="s-atop-pill-ct">{harnessCount(harness)}</span>
              </button>
            );
          })}
        </>
      )}

      {statusOptions.length > 1 && (
        <>
          <span className="s-atop-fbar-label">status</span>
          {(["tool", "run", "idle"] as AtopStatus[])
            .filter((s) => statusOptions.includes(s))
            .map((status) => {
              const on = statusFilter.has(status);
              return (
                <button
                  key={status}
                  className={`s-atop-pill s-atop-pill--status-${status}${on ? " s-atop-pill--on" : ""}`}
                  onClick={() => onToggleStatus(status)}
                >
                  {STATUS_LABEL[status]}
                  <span className="s-atop-pill-ct">{statusCount(status)}</span>
                </button>
              );
            })}
        </>
      )}

      <div className="s-atop-fbar-spacer" />
    </div>
  );
}

/*
 * The columns lead with what matters per agent: who and where, what it costs
 * the host (CPU, memory), what it has spent (tokens), how long it has run and
 * what it last said or was told. Requests, cache, tools, permissions and the
 * model sit in the drawer. Widths leave room for the resize handle (14px),
 * the cell padding (24px) and the sort arrow, so labels don't truncate.
 */
/** `now` is the feed's clock, so "2m ago" moves with the rest of the table. */
function atopColumns(now: number): DataTableColumn<AtopRow, SortKey>[] {
  return [

    {
      key: "status",
      label: "Status",
      cls: "s-atop-col-status",
      kind: "text",
      defaultWidth: 96,
      minWidth: 92,
      sortValue: (row) => STATUS_RANK[row.status],
      render: (row) => (
        <span className={`s-atop-status s-atop-status--${row.status}`}>
          <span className="s-atop-status-dot" />
          {STATUS_LABEL[row.status]}
        </span>
      ),
    },
    {
      key: "agent",
      label: "Agent",
      cls: "s-atop-col-agent",
      kind: "text",
      tip: "Harness · short session id",
      defaultWidth: 148,
      minWidth: 110,
      sortValue: (row) => `${row.harness}\0${row.sessionId ?? ""}`,
      render: (row) => (
        <div className="s-atop-agent-cell">
          <span
            className={harnessChipClass(row.harness)}
            title={`origin: ${ATTRIBUTION_LABEL[row.attribution]}`}
          >
            <HarnessMark harness={row.harness} size={11} title={null} />
            {harnessLabel(row.harness)}
          </span>
          <span className="s-atop-agent-id" title={row.sessionId ?? `pid ${row.pid}`}>
            {shortSession(row.sessionId)}
          </span>
        </div>
      ),
    },
    {
      key: "project",
      label: "Project",
      cls: "s-atop-col-project",
      kind: "text",
      defaultWidth: 128,
      minWidth: 96,
      maxWidth: 480,
      sortValue: (row) => row.project,
      render: (row) => <span title={row.cwd}>{row.project}</span>,
    },
    {
      key: "cpu",
      label: "CPU",
      cls: "s-atop-col-num",
      kind: "number",
      tip: "Process CPU at the last snapshot (ps %cpu; can pass 100% on several cores)",
      defaultWidth: 72,
      minWidth: 72,
      sortValue: (row) => row.cpuPercent,
      render: (row) => <MetricText text={fmtCpu(row.cpuPercent)} dim={row.cpuPercent == null} />,
    },
    {
      key: "mem",
      label: "Memory",
      cls: "s-atop-col-num",
      kind: "number",
      tip: "Process resident memory at the last snapshot",
      defaultWidth: 92,
      minWidth: 92,
      sortValue: (row) => row.rssBytes,
      render: (row) => <MetricText text={fmtBytes(row.rssBytes)} dim={row.rssBytes == null} />,
    },
    {
      key: "tokens",
      label: "Tokens",
      cls: "s-atop-col-num",
      kind: "number",
      tip: "Input / output tokens for the session, cached input included. ≥ marks a count from buffered events only.",
      defaultWidth: 112,
      minWidth: 104,
      sortValue: (row) => tokenTotal(row),
      render: (row) => <TokensCell row={row} />,
    },
    {
      key: "time",
      label: "Time",
      cls: "s-atop-col-runtime",
      kind: "number",
      tip: "How long the process has run",
      defaultWidth: 80,
      minWidth: 80,
      sortValue: (row) => row.elapsedSec,
      render: (row) => <MetricText text={fmtElapsed(row.elapsedSec)} dim={row.elapsedSec == null} />,
    },
    {
      key: "turn",
      label: "Last turn",
      cls: "s-atop-col-turn",
      kind: "text",
      tip: "The newest user or assistant turn; tool and system events are not turns",
      defaultWidth: 220,
      minWidth: 160,
      // the last column takes the panel's remaining width (ops-atop.css), so it has no handle
      resizable: false,
      sortValue: (row) => row.lastTurn?.at ?? null,
      render: (row) => <LastTurnCell row={row} now={now} />,
    },
  ];
}

function MetricText({ text, dim }: { text: string; dim?: boolean }) {
  return <span className={`s-atop-col-num${dim ? " s-atop-col-num--dim" : ""}`}>{text}</span>;
}

function TokensCell({ row }: { row: AtopRow }) {
  if (row.tokSource == null) return <MetricText text="—" dim />;
  const lowerBound = row.tokSource !== "session";
  const title = `Input ${(row.tokIn ?? 0).toLocaleString()} · output ${(row.tokOut ?? 0).toLocaleString()}${
    tokensNote(row.tokSource) ? `. ${tokensNote(row.tokSource)}` : ""
  }`;
  return (
    <span className={`s-atop-tokens${lowerBound ? " s-atop-tokens--partial" : ""}`} title={title}>
      {lowerBound && <span className="s-atop-tokens-bound">≥</span>}
      <span>{fmtCount(row.tokIn)}</span>
      <span className="s-atop-tokens-sep">/</span>
      <span>{fmtCount(row.tokOut)}</span>
    </span>
  );
}

/** Why a token count is a lower bound, when it is one. */
function tokensNote(source: AtopRow["tokSource"]): string | null {
  if (source === "buffer") return "Tokens are counted from buffered events only; the runtime doesn't report this session's totals.";
  if (source === "partial") return "The runtime is still reading this session's transcript; these are the totals so far.";
  return null;
}

function LastTurnCell({ row, now }: { row: AtopRow; now: number }) {
  const turn = row.lastTurn;
  if (!turn) return <span className="s-atop-col-num--dim">—</span>;
  return (
    <span
      className="s-atop-turn"
      title={`${turn.role === "user" ? "User" : "Assistant"}${turn.at != null ? `, ${formatTimestamp(turn.at)}` : ""}: ${turn.text}`}
    >
      <span className="s-atop-turn-when">{formatRelative(turn.at, now)}</span>
      <span className={`s-atop-turn-role s-atop-turn-role--${turn.role}`}>{turn.role === "user" ? "user" : "agent"}</span>
      <span className="s-atop-turn-text">{turn.text}</span>
    </span>
  );
}

function KeyHints({
  shown,
  total,
  hasSelection,
  freshness,
  now,
}: {
  shown: number;
  total: number;
  hasSelection: boolean;
  freshness: AtopFreshness;
  now: number;
}) {
  const fresh = freshnessLine(freshness, now);
  return (
    <div className="s-atop-keys">
      <span className="s-atop-keys-count">
        <strong>{shown}</strong> / {total} agents
      </span>
      <span className={`s-atop-fresh${fresh.stale ? " s-atop-fresh--stale" : ""}`}>
        {fresh.message && <span className="s-atop-fresh-msg" role="alert">{fresh.message}</span>}
        {fresh.age && <span className="s-atop-fresh-age">{fresh.age}</span>}
      </span>
      <span className="s-atop-keys-spacer" />
      <span><kbd>/</kbd> filter</span>
      <span><kbd>j</kbd>/<kbd>k</kbd> select</span>
      <span><kbd>click</kbd> drill in</span>
      {hasSelection && <span><kbd>esc</kbd> close</span>}
    </div>
  );
}

function DetailPanel({
  row,
  process,
  events,
  now,
  onClose,
}: {
  row: AtopRow;
  process: TailDiscoveredProcess | null;
  events: TailEvent[];
  now: number;
  onClose: () => void;
}) {
  const toolHistogram = useMemo(() => histogramOf(events), [events]);
  const bound = row.tokSource === "buffer" || row.tokSource === "partial" ? "≥ " : "";

  const peekEvents = events.slice(-PEEK_LINE_LIMIT).reverse();

  return (
    <aside
      className="s-atop-drawer"
      aria-label={`Agent ${row.key}`}
    >
        <header className="s-atop-drawer-head">
          <div className="s-atop-drawer-head-meta">
            <span className={`s-atop-status s-atop-status--${row.status}`}>
              <span className="s-atop-status-dot" />
              {STATUS_LABEL[row.status]}
            </span>
            <span className="s-atop-drawer-pid">{row.pid > 0 ? `pid ${row.pid}` : "transcript"}</span>
            <span
              className={harnessChipClass(row.harness)}
              title={`origin: ${ATTRIBUTION_LABEL[row.attribution]}`}
            >
              <HarnessMark harness={row.harness} size={11} title={null} />
              {harnessLabel(row.harness)}
            </span>
            <span className="s-atop-drawer-session">session {shortSession(row.sessionId)}</span>
          </div>
          <h2 className="s-atop-drawer-title">{row.project}</h2>
          <p className="s-atop-drawer-sub">
            {row.elapsedSec != null ? `running ${fmtElapsed(row.elapsedSec)} · ` : ""}
            {"last activity "}{formatRelative(row.lastEventAt, now)}
            {row.sessionRuntimeSec > 0 ? ` · ${formatRuntime(row.sessionRuntimeSec)} in the buffer` : ""}
          </p>
          <button className="s-atop-drawer-close" onClick={onClose} aria-label="Close (Esc)">✕</button>
        </header>

        <div className="s-atop-drawer-body">
          <section>
            <h3 className="s-atop-drawer-h3">Activity</h3>
            <div className="s-atop-metrics">
              <Metric label="CPU" value={fmtCpu(row.cpuPercent)} dim={row.cpuPercent == null} />
              <Metric label="Memory" value={fmtBytes(row.rssBytes)} dim={row.rssBytes == null} />
              <Metric label="Tokens in" value={`${bound}${fmtCount(row.tokIn)}`} dim={row.tokIn == null} />
              <Metric label="Tokens out" value={`${bound}${fmtCount(row.tokOut)}`} dim={row.tokOut == null} />
              <Metric
                label="Cache hit"
                value={fmtPct(cacheHitRate(row))}
                dim={cacheHitRate(row) == null}
              />
              <Metric label="Model" value={row.model ?? "—"} dim={row.model == null} />
              <Metric label="Requests" value={fmtCount(row.reqCount || null)} />
              <Metric label="Tools" value={fmtCount(row.toolCount || null)} />
              <Metric
                label="Permissions"
                value={fmtCount(row.permCount || null)}
                accent={row.permCount > 0 ? "amber" : undefined}
              />
              <Metric label="Events" value={fmtCount(row.eventCount || null)} />
            </div>
            <p className="s-atop-drawer-note">
              {tokensNote(row.tokSource) ? `${tokensNote(row.tokSource)} ` : ""}
              Requests, tools, permissions and events count buffered events.
            </p>
          </section>

          {row.lastTurn && (
            <section>
              <h3 className="s-atop-drawer-h3">
                Last turn
                <span className="s-atop-drawer-h3-aside">
                  {row.lastTurn.role === "user" ? "user" : "agent"} · {formatRelative(row.lastTurn.at, now)}
                </span>
              </h3>
              <p className="s-atop-drawer-turn">{row.lastTurn.text}</p>
            </section>
          )}

          {toolHistogram.length > 0 && (
            <section>
              <h3 className="s-atop-drawer-h3">Tool calls</h3>
              <ul className="s-atop-histo">
                {toolHistogram.map((tool) => (
                  <li key={tool.name}>
                    <span className="s-atop-histo-name">{tool.name}</span>
                    <span className="s-atop-histo-bar">
                      <span
                        className="s-atop-histo-fill"
                        style={{ width: `${(tool.frac * 100).toFixed(1)}%` }}
                      />
                    </span>
                    <span className="s-atop-histo-count">{tool.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="s-atop-drawer-h3">
              Recent activity
              <span className="s-atop-drawer-h3-aside">{events.length} buffered</span>
            </h3>
            {peekEvents.length === 0 ? (
              <div className="s-atop-peek-empty">no events buffered for this agent yet</div>
            ) : (
              <ol className="s-atop-peek">
                {peekEvents.map((event) => (
                  <li key={event.id} className={`s-atop-peek-row s-atop-peek-row--${event.kind}`}>
                    <span className="s-atop-peek-time">{formatTimestamp(event.ts)}</span>
                    <span className="s-atop-peek-kind">{event.kind}</span>
                    <span className="s-atop-peek-text">{event.summary}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="s-atop-drawer-section--secondary">
            <h3 className="s-atop-drawer-h3">Process</h3>
            <code className="s-atop-codeblock">{row.command}</code>
            <dl className="s-atop-kvs">
              <dt>PID</dt>
              <dd>{row.pid > 0 ? row.pid : "transcript-only"}</dd>
              <dt>Parent</dt>
              <dd>{row.parentLabel} (ppid {row.ppid})</dd>
              <dt>Process etime</dt>
              <dd>{row.procEtime}</dd>
              {row.transcriptPath && (
                <>
                  <dt>Transcript</dt>
                  <dd>{row.transcriptPath}</dd>
                </>
              )}
              <dt>Origin</dt>
              <dd>{ATTRIBUTION_LABEL[row.attribution]}</dd>
              <dt>CWD</dt>
              <dd>{row.cwd || "(none)"}</dd>
            </dl>
            {process?.parentChain && process.parentChain.length > 0 && (
              <ol className="s-atop-chain">
                {process.parentChain.map((p) => (
                  <li key={p.pid}>
                    <span className="s-atop-chain-pid">{p.pid}</span>
                    <span className="s-atop-chain-cmd">{shortCommand(p.command, 80)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
    </aside>
  );
}

function Metric({
  label,
  value,
  dim,
  accent,
}: {
  label: string;
  value: string;
  dim?: boolean;
  accent?: "amber" | "green";
}) {
  const cls = `s-atop-metric${dim ? " s-atop-metric--dim" : ""}${accent ? ` s-atop-metric--${accent}` : ""}`;
  return (
    <div className={cls}>
      <span className="s-atop-metric-lbl">{label}</span>
      <span className="s-atop-metric-val">{value}</span>
    </div>
  );
}
