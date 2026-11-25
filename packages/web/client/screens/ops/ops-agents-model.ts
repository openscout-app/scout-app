/**
 * Ops › Agents without React: one row per agent (its live asks, sessions,
 * throughput, latency, tokens and cost), the totals over the stats strip,
 * the search, and the labels the rail groups by. The page, its rail
 * (left-agents.tsx) and the Agents directory panel (views/modules/agents-directory.tsx)
 * all read these.
 */
import {
  estimateAdapterCost,
  type AdapterCostEstimate,
  type AdapterTokenBreakdown,
} from "@openscout/agent-sessions/protocol/cost";
import { isAgentOnline, normalizeAgentState } from "../../lib/agent-state.ts";
import type { ActivityItem, Agent, AgentObservePayload, FleetAsk, SessionEntry } from "../../lib/types.ts";
import { resolveAgentRuntimeIdentity } from "./agent-runtime-identity.ts";

export type AgentOpsRow = {
  agent: Agent;
  team: string;
  machine: string;
  model: string | null;
  provider: string | null;
  state: ReturnType<typeof normalizeAgentState>;
  activeFlights: number;
  sessions24h: number;
  throughput: number[];
  avgLatencyMs: number | null;
  usage: AdapterTokenBreakdown;
  cost: AdapterCostEstimate;
  errors: number;
  lastActiveAt: number | null;
  /** Top in-flight task title for this agent, if any. Differentiates two agents that share a name. */
  activeTask: string | null;
};

export const DAY_MS = 24 * 60 * 60_000;
const LATENCY_WINDOW_MS = 90 * 60_000;

export const STATE_RANK: Record<AgentOpsRow["state"], number> = {
  needs_attention: 0,
  in_turn: 1,
  in_flight: 2,
  callable: 3,
  blocked: 4,
};

export function basename(path: string | null | undefined): string | null {
  if (!path) return null;
  const cleaned = path.replace(/\/+$/, "");
  const idx = cleaned.lastIndexOf("/");
  return (idx >= 0 ? cleaned.slice(idx + 1) : cleaned) || null;
}

/** The most agents /api/agents returns (server/routes/agents.ts); the newest by updatedAt. */
export const AGENT_ROSTER_LIMIT = 100;

/**
 * A count taken over the roster the web reads. When the roster came back
 * full, there may be more agents than it holds, so the count reads "N+"
 * instead of a ratio against the limit.
 */
export function agentRosterCount(count: number, rosterLength: number, limit = AGENT_ROSTER_LIMIT): string {
  return rosterLength >= limit ? `${count}+` : String(count);
}

export function compactNumber(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

export function formatLatency(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatCost(value: number | null): string {
  if (value == null) return "$—";
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

/** The mean gap between message and tool events in the last 90 minutes, ignoring gaps of 2 minutes or more. */
export function averageLatencyMs(payload: AgentObservePayload | undefined, now: number): number | null {
  if (!payload) return null;
  const events = payload.data.events
    .filter((event) => event.kind === "message" || event.kind === "tool")
    .filter((event) => now - event.t <= LATENCY_WINDOW_MS)
    .sort((left, right) => left.t - right.t);
  if (events.length < 2) return null;
  const gaps: number[] = [];
  for (let idx = 1; idx < events.length; idx += 1) {
    const gap = events[idx].t - events[idx - 1].t;
    if (gap > 0 && gap < 120_000) gaps.push(gap);
  }
  if (gaps.length === 0) return null;
  return Math.round(gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length);
}

/** The last 24 hours of activity in 24 hourly buckets, oldest first. */
export function makeThroughput(activity: readonly ActivityItem[], now: number): number[] {
  const buckets = new Array<number>(24).fill(0);
  const start = now - DAY_MS;
  for (const item of activity) {
    if (item.ts < start || item.ts > now) continue;
    const bucket = Math.min(23, Math.max(0, Math.floor(((item.ts - start) / DAY_MS) * buckets.length)));
    buckets[bucket] += 1;
  }
  return buckets;
}

/** Where an agent runs, as the table and the rail's Machines group name it. */
export function machineLabel(agent: Agent): string {
  return agent.authorityNodeName
    ?? agent.homeNodeName
    ?? agent.authorityNodeId
    ?? agent.homeNodeId
    ?? agent.transport
    ?? basename(agent.cwd)
    ?? basename(agent.projectRoot)
    ?? "local";
}

/** What an agent works on, as the table's Project column and the rail's Projects group name it. */
export function teamLabel(agent: Agent): string {
  return agent.project ?? agent.role ?? agent.agentClass ?? "Unassigned";
}

const ASK_RANK: Record<FleetAsk["status"], number> = {
  working: 0,
  needs_attention: 1,
  queued: 2,
  failed: 3,
  completed: 4,
};

/** Prefer in-flight work; fall back to anything queued or waiting so the cell still tells siblings apart. */
export function pickActiveTask(asks: readonly FleetAsk[]): string | null {
  if (asks.length === 0) return null;
  const sorted = [...asks].sort((a, b) => {
    const rd = ASK_RANK[a.status] - ASK_RANK[b.status];
    if (rd !== 0) return rd;
    return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
  });
  const top = sorted[0];
  const raw = (top.task ?? top.summary ?? "").trim();
  return raw || null;
}

export function rowForAgent(
  agent: Agent,
  sessions: readonly SessionEntry[],
  activity: readonly ActivityItem[],
  activeAsks: readonly FleetAsk[],
  observe: ReadonlyMap<string, AgentObservePayload>,
  now: number,
): AgentOpsRow {
  const agentSessions = sessions.filter((session) => session.agentId === agent.id);
  const recentSessions = agentSessions.filter((session) => {
    const lastAt = session.lastMessageAt ?? 0;
    return lastAt > 0 && now - lastAt <= DAY_MS;
  });
  const agentConversationId = agent.conversationId;
  const agentActivity = activity.filter(
    (item) =>
      item.actorName === agent.name
      || Boolean(agentConversationId && item.conversationId === agentConversationId),
  );
  const payload = observe.get(agent.id);
  const { model, provider } = resolveAgentRuntimeIdentity(agent, payload);
  const cost = estimateAdapterCost({
    adapterType: payload?.data.metadata?.session?.adapterType,
    capturedAt: payload?.updatedAt ?? now,
    model,
    provider,
    usage: payload?.data.metadata?.usage,
  });
  const agentAsks = activeAsks.filter((ask) => ask.agentId === agent.id);
  return {
    agent,
    team: teamLabel(agent),
    machine: machineLabel(agent),
    model,
    provider,
    state: normalizeAgentState(agent.state),
    activeFlights: agentAsks.length,
    activeTask: pickActiveTask(agentAsks),
    sessions24h: recentSessions.length,
    throughput: makeThroughput(agentActivity, now),
    avgLatencyMs: averageLatencyMs(payload, now),
    usage: cost.usage,
    cost,
    errors: agentAsks.filter((ask) => ask.status === "failed" || ask.status === "needs_attention").length,
    lastActiveAt: Math.max(
      0,
      ...agentSessions.map((session) => session.lastMessageAt ?? 0),
      ...agentActivity.map((item) => item.ts),
      agent.updatedAt ?? 0,
    ) || null,
  };
}

/** The search box: name, project, machine, handle, harness and active task. */
export function searchAgentRows(rows: readonly AgentOpsRow[], query: string): AgentOpsRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((row) =>
    `${row.agent.name} ${row.team} ${row.machine} ${row.agent.handle ?? ""} ${row.agent.harness ?? ""} ${row.activeTask ?? ""}`
      .toLowerCase()
      .includes(q),
  );
}

export type AgentOpsTotals = {
  running: number;
  online: number;
  tokens: number;
  apiCost: number | null;
  billedCost: number | null;
  avgLatency: number | null;
};

/** The stats strip: Running, Tokens (with API equivalent), Avg latency, Billed. A cost is null until some row has one. */
export function agentOpsTotals(rows: readonly AgentOpsRow[]): AgentOpsTotals {
  const latencies = rows.map((row) => row.avgLatencyMs).filter((value): value is number => value != null);
  return {
    running: rows.filter((row) => row.state === "in_turn" || row.state === "in_flight").length,
    online: rows.filter((row) => isAgentOnline(row.agent.state, row.agent)).length,
    tokens: rows.reduce((sum, row) => sum + (row.usage.total ?? 0), 0),
    apiCost: rows.some((row) => row.cost.totalUsd != null)
      ? rows.reduce((sum, row) => sum + (row.cost.totalUsd ?? 0), 0)
      : null,
    billedCost: rows.some((row) => row.cost.billedTotalUsd != null)
      ? rows.reduce((sum, row) => sum + (row.cost.billedTotalUsd ?? 0), 0)
      : null,
    avgLatency: latencies.length === 0 ? null : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
  };
}

/** The rail's Projects and Machines groups: label and agent count, most first, the first `limit`. */
export function countBy(agents: readonly Agent[], label: (agent: Agent) => string, limit = 8): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const key = label(agent);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}
