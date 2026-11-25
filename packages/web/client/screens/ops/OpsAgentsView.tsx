import "./ops-agents.css";

import { Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { stateColor } from "../../lib/colors.ts";
import { api } from "../../lib/api.ts";
import { loadFleet } from "../../lib/fleet-store.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { DataTable, type DataTableColumn } from "../../components/DataTable/DataTable.tsx";
import { useAgentHoverCard } from "../../components/useAgentHoverCard.tsx";
import {
  agentOpsTotals,
  compactNumber,
  formatCost,
  formatLatency,
  rowForAgent,
  searchAgentRows,
  STATE_RANK,
  type AgentOpsRow,
} from "./ops-agents-model.ts";
import type {
  ActivityItem,
  Agent,
  AgentObservePayload,
  FleetState,
  Route,
  SessionEntry,
} from "../../lib/types.ts";

const BROKER_EVENT_REFRESH_DELAY_MS = 1500;

type AgentOpsColumnKey =
  | "agent"
  | "task"
  | "team"
  | "machine"
  | "active"
  | "sessions24h"
  | "throughput"
  | "avgLatency"
  | "input"
  | "cacheRead"
  | "cacheWrite"
  | "output"
  | "apiEquiv"
  | "billed"
  | "errors"
  | "lastActive";

const AGENT_COLUMNS: DataTableColumn<AgentOpsRow, AgentOpsColumnKey>[] = [
  {
    key: "agent",
    label: "Agent",
    kind: "custom",
    sortable: true,
    sortValue: (row) => row.agent.name.toLowerCase(),
    defaultWidth: 220,
    minWidth: 160,
    render: (row) => (
      <div className="s-ops-agents-agent-cell">
        <span
          className="s-ops-agents-dot"
          style={{ background: stateColor(row.state) }}
          aria-hidden
        />
        <span className="s-ops-agents-agent-name" title={row.agent.name}>
          {row.agent.handle ?? row.agent.name}
        </span>
      </div>
    ),
  },
  {
    key: "task",
    label: "Active task",
    kind: "custom",
    sortable: true,
    sortValue: (row) => (row.activeTask ?? "").toLowerCase() || null,
    defaultWidth: 240,
    minWidth: 140,
    render: (row) =>
      row.activeTask ? (
        <span className="s-ops-agents-task" title={row.activeTask}>
          {row.activeTask}
        </span>
      ) : (
        <span className="s-ops-agents-task s-ops-agents-task--idle">—</span>
      ),
  },
  {
    key: "team",
    label: "Project",
    kind: "text",
    defaultWidth: 140,
    minWidth: 90,
    cls: "s-ops-agents-meta",
    render: (row) => <span className="s-ops-agents-meta-cell">{row.team}</span>,
    sortValue: (row) => row.team.toLowerCase(),
  },
  {
    key: "machine",
    label: "Machine",
    kind: "text",
    defaultWidth: 120,
    minWidth: 88,
    cls: "s-ops-agents-meta",
    render: (row) => <span className="s-ops-agents-meta-cell">{row.machine}</span>,
    sortValue: (row) => row.machine.toLowerCase(),
  },
  {
    key: "active",
    label: "Active",
    kind: "number",
    defaultWidth: 90,
    minWidth: 64,
    cls: "s-ops-agents-num",
    render: (row) => row.activeFlights,
    sortValue: (row) => row.activeFlights,
  },
  {
    key: "sessions24h",
    label: "24h sessions",
    kind: "number",
    defaultWidth: 108,
    minWidth: 78,
    cls: "s-ops-agents-num",
    render: (row) => row.sessions24h,
    sortValue: (row) => row.sessions24h,
  },
  {
    key: "throughput",
    label: "Throughput",
    kind: "custom",
    sortable: false,
    defaultWidth: 110,
    minWidth: 90,
    render: (row) => <Sparkline values={row.throughput} warn={row.errors > 0} />,
  },
  {
    key: "avgLatency",
    label: "Avg latency",
    kind: "number",
    defaultWidth: 108,
    minWidth: 80,
    cls: "s-ops-agents-num",
    render: (row) => formatLatency(row.avgLatencyMs),
    sortValue: (row) => row.avgLatencyMs,
  },
  {
    key: "input",
    label: "Input",
    kind: "number",
    defaultWidth: 88,
    minWidth: 64,
    cls: "s-ops-agents-num",
    render: (row) => compactNumber(row.usage.uncachedInput ?? row.usage.input),
    sortValue: (row) => row.usage.uncachedInput ?? row.usage.input ?? null,
  },
  {
    key: "cacheRead",
    label: "Cache read",
    kind: "number",
    defaultWidth: 98,
    minWidth: 72,
    cls: "s-ops-agents-num",
    render: (row) => compactNumber(row.usage.cachedInput),
    sortValue: (row) => row.usage.cachedInput ?? null,
  },
  {
    key: "cacheWrite",
    label: "Cache write",
    kind: "number",
    defaultWidth: 98,
    minWidth: 72,
    cls: "s-ops-agents-num",
    render: (row) => compactNumber(row.usage.cacheWrite),
    sortValue: (row) => row.usage.cacheWrite ?? null,
  },
  {
    key: "output",
    label: "Output",
    kind: "number",
    defaultWidth: 88,
    minWidth: 64,
    cls: "s-ops-agents-num",
    render: (row) => compactNumber(row.usage.output),
    sortValue: (row) => row.usage.output ?? null,
  },
  {
    key: "apiEquiv",
    label: "API equiv",
    kind: "number",
    defaultWidth: 92,
    minWidth: 72,
    cls: "s-ops-agents-num",
    render: (row) => (
      <span className={row.cost.rateCardSource === "unknown" ? "s-ops-agents-num--dim" : undefined}>
        {formatCost(row.cost.totalUsd)}
      </span>
    ),
    sortValue: (row) => row.cost.totalUsd ?? null,
  },
  {
    key: "billed",
    label: "Billed",
    kind: "number",
    defaultWidth: 92,
    minWidth: 72,
    cls: "s-ops-agents-num",
    render: (row) => (
      <span className={row.cost.billingMode === "subscription" ? "s-ops-agents-num--covered" : undefined}>
        {formatCost(row.cost.billedTotalUsd)}
      </span>
    ),
    sortValue: (row) => row.cost.billedTotalUsd ?? null,
  },
  {
    key: "errors",
    label: "Errors",
    kind: "number",
    defaultWidth: 72,
    minWidth: 58,
    cls: "s-ops-agents-num",
    render: (row) => (
      <span className={row.errors > 0 ? "s-ops-agents-num--warn" : undefined}>{row.errors}</span>
    ),
    sortValue: (row) => row.errors,
  },
  {
    key: "lastActive",
    label: "Last active",
    kind: "time",
    defaultWidth: 104,
    minWidth: 78,
    cls: "s-ops-agents-last",
    render: (row) => (row.lastActiveAt ? timeAgo(row.lastActiveAt) : "—"),
    sortValue: (row) => row.lastActiveAt,
  },
];


function Sparkline({ values, warn = false }: { values: number[]; warn?: boolean }) {
  const width = 92;
  const height = 22;
  const peak = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - (value / peak) * (height - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={`s-ops-agents-spark${warn ? " s-ops-agents-spark--warn" : ""}`} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The Agents directory. `variant="panel"` (the Agents directory panel) drops
 * the page's breadcrumb and hero; the panel head carries its title and
 * scopes. `agents` is whoever the caller scoped it to.
 */
export function OpsAgentsView({
  navigate,
  agents,
  variant = "page",
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
  variant?: "page" | "panel";
}) {
  const [fleet, setFleet] = useState<FleetState | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [observePayloads, setObservePayloads] = useState<AgentObservePayload[]>([]);
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const brokerRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const ids = agents.map((agent) => agent.id).join(",");
    const [fleetResult, sessionsResult, activityResult, observeResult] = await Promise.allSettled([
      loadFleet(),
      api<SessionEntry[]>("/api/conversations"),
      api<ActivityItem[]>("/api/activity"),
      // Session scope: the token columns are whole-session totals.
      ids ? api<AgentObservePayload[]>(`/api/observe/agents?ids=${encodeURIComponent(ids)}&scope=session`) : Promise.resolve([]),
    ]);

    if (fleetResult.status === "fulfilled") setFleet(fleetResult.value);
    if (sessionsResult.status === "fulfilled") setSessions(sessionsResult.value);
    if (activityResult.status === "fulfilled") setActivity(activityResult.value);
    if (observeResult.status === "fulfilled") setObservePayloads(observeResult.value);
    setNow(Date.now());
  }, [agents]);

  useEffect(() => {
    void load();
  }, [load]);
  const scheduleBrokerRefresh = useCallback(() => {
    if (brokerRefreshTimer.current) return;
    brokerRefreshTimer.current = setTimeout(() => {
      brokerRefreshTimer.current = null;
      void load();
    }, BROKER_EVENT_REFRESH_DELAY_MS);
  }, [load]);
  useBrokerEvents(scheduleBrokerRefresh);
  useEffect(() => {
    return () => {
      if (brokerRefreshTimer.current) {
        clearTimeout(brokerRefreshTimer.current);
        brokerRefreshTimer.current = null;
      }
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const observeByAgent = useMemo(
    () => new Map(observePayloads.map((payload) => [payload.agentId, payload])),
    [observePayloads],
  );

  const rows = useMemo(() => {
    const activeAsks = fleet?.activeAsks ?? [];
    return agents.map((agent) =>
      rowForAgent(agent, sessions, activity, activeAsks, observeByAgent, now),
    );
  }, [activity, agents, fleet?.activeAsks, now, observeByAgent, sessions]);

  const filteredRows = useMemo(() => searchAgentRows(rows, query), [query, rows]);

  const [sort, setSort] = useState<{ key: AgentOpsColumnKey; dir: 1 | -1 } | null>({
    key: "lastActive",
    dir: -1,
  });

  // Status promotion: working > ready > not ready, applied as a tiebreaker so
  // user-chosen sort always wins within a tier but busy agents stay near the top.
  const secondarySort = useMemo(
    () => (sort?.key === "agent"
      ? undefined
      : (a: AgentOpsRow, b: AgentOpsRow) => STATE_RANK[a.state] - STATE_RANK[b.state]),
    [sort?.key],
  );

  const filteredAgents = useMemo(() => filteredRows.map((r) => r.agent), [filteredRows]);
  const orderedIds = useMemo(() => filteredRows.map((r) => r.agent.id), [filteredRows]);
  const hover = useAgentHoverCard({
    agents: filteredAgents,
    orderedIds,
    navigate,
    selectMode: "preview",
  });

  const { running, online, tokens, apiCost, billedCost, avgLatency } = useMemo(() => agentOpsTotals(rows), [rows]);
  const page = variant === "page";

  return (
    <div className={`s-ops-agents${page ? "" : " s-ops-agents--panel"}`}>
      <main className="s-ops-agents-main">
        <div className="s-ops-agents-toolbar">
          {page && <div className="s-ops-agents-breadcrumb">Agents <span>/</span> Directory</div>}
          <div className="s-ops-agents-live">
            <span className="s-ops-agents-live-dot" />
            {online} active
          </div>
          <div className="s-ops-agents-search">
            <Search size={13} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents, tasks, projects, machines…" />
          </div>
          {page && (
            <button className="s-ops-agents-icon-btn" type="button" title="Filters">
              <SlidersHorizontal size={14} />
            </button>
          )}
        </div>

        {page && (
          <section className="s-ops-agents-hero">
            <div>
              <div className="s-ops-agents-kicker">Agents</div>
              <h1>All agents</h1>
              <p>Every registered agent across the local fleet, sorted by live status.</p>
            </div>
          </section>
        )}

        <section className="s-ops-agents-stats">
          <Metric label="Running" value={String(running)} sub={`of ${agents.length} total`} />
          <Metric label="Tokens" value={compactNumber(tokens || null)} sub={apiCost == null ? "usage metadata pending" : `${formatCost(apiCost)} API equiv`} />
          <Metric label="Avg latency" value={formatLatency(avgLatency)} sub="recent observe events" />
          <Metric label="Billed" value={formatCost(billedCost)} sub="subscription usage can mark this down" />
        </section>

        <section className="s-ops-agents-table-panel">
          <div className="s-ops-agents-table-title">
            Agents <span>{filteredRows.length}</span>
            <span className="s-ops-agents-hint" aria-hidden>
              <kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>enter</kbd> pin · <kbd>o</kbd> open · <kbd>esc</kbd> clear
            </span>
          </div>
          <div className="s-ops-agents-table-wrap" ref={hover.containerRef}>
            <DataTable
              rows={filteredRows}
              columns={AGENT_COLUMNS}
              rowId={(row) => row.agent.id}
              storageKey="openscout.opsAgents.cols"
              sort={sort}
              onSortChange={setSort}
              secondarySort={secondarySort}
              density="compact"
              rowBindings={(id) => {
                const bindings = hover.bind<HTMLTableRowElement>(id);
                return {
                  ...bindings,
                  onKeyDown: (event: ReactKeyboardEvent<HTMLTableRowElement>) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    bindings.onClick();
                  },
                };
              }}
              rowState={(id) => hover.getState(id)}
              empty={{ title: "No agents match", body: "Adjust the search to find a different slice of the fleet." }}
              className="s-ops-agents-data-table"
              ariaLabel="Agents directory"
            />
          </div>
        </section>
      </main>
      {hover.card}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "warn";
}) {
  return (
    <div className={`s-ops-agents-metric s-ops-agents-metric--${tone}`}>
      <div className="s-ops-agents-metric-label">{label}</div>
      <div className="s-ops-agents-metric-value">{value}</div>
      <div className="s-ops-agents-metric-sub">{sub}</div>
    </div>
  );
}
