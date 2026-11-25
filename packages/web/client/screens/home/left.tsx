import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { Cpu, GitBranch } from "lucide-react";
import "../../scout/slots/ctx-panel.css";
import "./left.css";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { peekApiGet } from "../../lib/api.ts";
import { stateColor } from "../../lib/colors.ts";
import { loadFleet } from "../../lib/fleet-store.ts";
import {
  filterAgentsByMachineScope,
  filterFleetByMachineScope,
  machineScopedAgentIds,
} from "../../lib/machine-scope.ts";
import { routeMachineId } from "../../lib/router.ts";
import { useBrokerEventsRefresh } from "../../lib/sse.ts";
import { FLEET_REFRESH_POLICY } from "../../lib/broker-event-kinds.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openAgent } from "../../scout/slots/openAgent.ts";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import { activityVerb, generatedNameSource, liveActivityFrom, scrubActivityIds } from "./home-derive.ts";
import { buildRecentSessionRows, type RecentSessionRow } from "./home-recent-sessions.ts";
import type {
  Agent,
  FleetActivity,
  FleetState,
  Route,
} from "../../lib/types.ts";


// enough to fill a tall window when Recent takes its column's room (grow); the panel scrolls past what fits
const RECENT_AGENTS_LIMIT = 30;
const RECENT_ACTIVITY_LIMIT = 4;
const FLEET_PATH = "/api/fleet";
const ROUTE_CACHE_MAX_AGE_MS = 30_000;

type HomeLeftProps = {
  prepend?: ReactNode;
  /**
   * Recent Scout coordination under the agents. Off where the page already
   * draws the Coordination panel (Home), which leads with the same rows.
   */
  activity?: boolean;
  /**
   * The "Recent agents" label row. Off where it is the panel's only section
   * and the panel head already names it and carries All (Home).
   */
  agentsLabel?: boolean;
};

export function HomeLeft({ prepend, activity = true, agentsLabel = true }: HomeLeftProps) {
  const { agents, agentsLoaded, navigate, route } = useScout();
  const [initialFleet] = useState(() => peekApiGet<FleetState>(FLEET_PATH, ROUTE_CACHE_MAX_AGE_MS));
  const [fleet, setFleet] = useState<FleetState | null>(initialFleet);
  const [fleetLoaded, setFleetLoaded] = useState(initialFleet !== null);
  const machineId = routeMachineId(route);
  const scopedAgentIds = useMemo(
    () => machineScopedAgentIds(agents, machineId),
    [agents, machineId],
  );
  const scopedAgents = useMemo(
    () => filterAgentsByMachineScope(agents, machineId),
    [agents, machineId],
  );
  const scopedFleet = useMemo(
    () => filterFleetByMachineScope(fleet, scopedAgentIds),
    [fleet, scopedAgentIds],
  );

  const load = useCallback(async () => {
    try {
      setFleet(await loadFleet());
    } catch {
      // Preserve last-known fleet data; the status bar owns connectivity errors.
    } finally {
      setFleetLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEventsRefresh(FLEET_REFRESH_POLICY.matches, () => void load());

  const recentAgents = useMemo(
    () => buildRecentSessionRows(sortRecentAgents(scopedAgents).slice(0, RECENT_AGENTS_LIMIT), scopedFleet),
    [scopedAgents, scopedFleet],
  );
  const recentActivity = useMemo(
    // the firehose logs some events twice (a message, then its invocation):
    // one row per event, as the Coordination panel draws them
    () => liveActivityFrom(scopedFleet?.activity, 0).slice(0, RECENT_ACTIVITY_LIMIT),
    [scopedFleet],
  );

  return (
    <div className="ctx-panel base-rail">
      {prepend ? <div className="base-rail-prepend">{prepend}</div> : null}

      <RecentAgentsSection
        agents={recentAgents}
        totalCount={scopedAgents.length}
        loading={!agentsLoaded}
        label={agentsLabel}
        onSelect={(agent) => openAgent(navigate, agent, { from: "base-rail", returnTo: route })}
        onSeeAll={() => navigate({ view: "agents-v2" })}
      />

      {activity && (
        <RecentActivitySection
          items={recentActivity}
          loading={!fleetLoaded}
          onSelect={(item) => navigate(routeForActivity(item))}
          onSeeAll={() => navigate({ view: "activity" })}
        />
      )}
    </div>
  );
}

function RecentAgentsSection({
  agents,
  totalCount,
  loading,
  label,
  onSelect,
  onSeeAll,
}: {
  agents: RecentSessionRow[];
  totalCount: number;
  loading: boolean;
  label: boolean;
  onSelect: (agent: Agent) => void;
  onSeeAll: () => void;
}) {
  return (
    <section className="ctx-panel-section base-rail-section base-rail-section--sessions">
      {label && (
        <SectionLabel
          title="Recent agents"
          onSeeAll={totalCount > 0 ? onSeeAll : undefined}
        />
      )}
      {loading ? (
        <RailLoadingRows />
      ) : agents.length === 0 ? (
        <div className="ctx-panel-empty">No agents yet</div>
      ) : (
        agents.map((row) => (
          <RecentSessionItem key={row.agent.id} row={row} onSelect={() => onSelect(row.agent)} />
        ))
      )}
    </section>
  );
}

/**
 * One session: state and when, harness, name, what it was asked, where it ran
 * and on which model. The panel draws What's moving's columns on one line; the
 * rail stacks them under the name.
 */
function RecentSessionItem({ row, onSelect }: { row: RecentSessionRow; onSelect: () => void }) {
  const { agent } = row;
  const state = normalizeAgentState(agent.state, agent);
  const working = state === "in_turn" || state === "in_flight";
  return (
    <button
      type="button"
      className={`base-rail-session${row.topic ? "" : " base-rail-session--no-topic"}`}
      title={sessionRowTooltip(row)}
      onClick={onSelect}
    >
      <span className="base-rail-session-when">
        <span
          className={`dot${working ? " dot--pulse dot--glow" : ""}`}
          style={{ color: stateColor(agent.state) }}
          aria-hidden="true"
        />
        <span>{agent.updatedAt ? timeAgo(agent.updatedAt) : ""}</span>
      </span>
      <span className="base-rail-session-mark">
        {row.harness ? <HarnessMark harness={row.harness} size={14} /> : <Cpu size={14} aria-hidden="true" />}
      </span>
      <span className="base-rail-session-name">{row.name}</span>
      {row.topic && (
        <span className={`base-rail-session-topic${row.topicLive ? " is-live" : ""}`}>{row.topic}</span>
      )}
      <span className="base-rail-session-where">
        {row.project && <span className="base-rail-session-project">{row.project}</span>}
        {row.branch && (
          <span className="chip chip--mono chip--sm chip--neutral base-rail-session-branch">
            <GitBranch size={9} aria-hidden="true" />
            <span>{row.branch}</span>
          </span>
        )}
      </span>
      {row.model && <span className="base-rail-session-model">{row.model}</span>}
    </button>
  );
}

function sessionRowTooltip(row: RecentSessionRow): string {
  const { agent } = row;
  return [
    row.topic,
    row.sessionId && `session: ${row.sessionId}`,
    agent.projectRoot && `project: ${agent.projectRoot}`,
    row.branch && `branch: ${row.branch}`,
    agent.harness && `harness: ${agent.harness}`,
    agent.model && `model: ${agent.model}`,
    agent.homeNodeName && `host: ${agent.homeNodeName}`,
  ].filter(Boolean).join("\n");
}

function RecentActivitySection({
  items,
  loading,
  onSelect,
  onSeeAll,
}: {
  items: FleetActivity[];
  loading: boolean;
  onSelect: (item: FleetActivity) => void;
  onSeeAll: () => void;
}) {
  return (
    <section className="ctx-panel-section base-rail-section">
      <SectionLabel
        title="Recent Scout coordination"
        meta={items.length > 0 ? undefined : undefined}
        onSeeAll={items.length > 0 ? onSeeAll : undefined}
      />
      {loading ? (
        <RailLoadingRows />
      ) : items.length === 0 ? (
        <div className="ctx-panel-empty">No recent Scout messages or dispatches</div>
      ) : (
        items.map((item) => {
          const label = generatedNameSource(item.actorName, [item.actorId, item.agentId])
            ?? item.actorName ?? item.agentName ?? item.agentId ?? "system";
          const verb = activityVerb(item.kind);
          const headline = scrubActivityIds(item.title ?? item.summary ?? "") || verb || "Coordination";
          return (
            <RailRow
              key={item.id}
              name={headline}
              meta={item.ts ? timeAgo(item.ts) : undefined}
              tone="neutral"
              title={verb ? `${label} ${verb}` : label}
              onClick={() => onSelect(item)}
            />
          );
        })
      )}
    </section>
  );
}


function RailLoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="base-rail-loading" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

function SectionLabel({
  title,
  meta,
  onSeeAll,
}: {
  title: string;
  meta?: string;
  onSeeAll?: () => void;
}) {
  return (
    <div className="ctx-panel-section-label base-rail-section-label">
      <span>{title}</span>
      <span className="base-rail-section-trailing">
        {meta ? <span className="ctx-panel-count">{meta}</span> : null}
        {onSeeAll ? (
          <button type="button" className="base-rail-see-all" onClick={onSeeAll}>
            all
          </button>
        ) : null}
      </span>
    </div>
  );
}

function sortRecentAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

function routeForActivity(item: FleetActivity): Route {
  if (item.conversationId) {
    return { view: "conversation", conversationId: item.conversationId };
  }
  if (item.agentId) {
    return { view: "agents-v2", agentId: item.agentId };
  }
  return { view: "activity" };
}
