import { useCallback, useEffect, useMemo, useState } from "react";
import "../../scout/slots/ctx-panel.css";
import { api } from "../../lib/api.ts";
import { useBrokerEventsRefresh } from "../../lib/sse.ts";
import { CONVERSATION_EVENT_KINDS, matchesKinds } from "../../lib/broker-event-kinds.ts";
import { useScout } from "../../scout/Provider.tsx";
import { useFleetActiveAsks } from "../../lib/use-fleet-active-asks.ts";
import { isAgentOnline } from "../../lib/agent-state.ts";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import type { Route, SessionEntry } from "../../lib/types.ts";
import { countBy, machineLabel, teamLabel } from "./ops-agents-model.ts";

const matchesConversationEvent = matchesKinds(CONVERSATION_EVENT_KINDS);

/** Ops › Agents' rail. The Agents roster panel (views/modules/agents-roster.tsx) passes its own navigate. */
export function OpsAgentsLeft({ navigate: navigateTo }: { navigate?: (route: Route) => void } = {}) {
  const scout = useScout();
  const { agents } = scout;
  const navigate = navigateTo ?? scout.navigate;
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const activeAsks = useFleetActiveAsks();

  const loadSessions = useCallback(async () => {
    const data = await api<SessionEntry[]>("/api/conversations").catch(() => [] as SessionEntry[]);
    setSessions(data);
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useBrokerEventsRefresh(
    matchesConversationEvent,
    () => void loadSessions(),
  );

  const online = useMemo(() => agents.filter((a) => isAgentOnline(a.state)).length, [agents]);
  const errored = useMemo(() => {
    let count = 0;
    for (const ask of activeAsks.asks) {
      if (ask.status === "failed" || ask.status === "needs_attention") count += 1;
    }
    return count;
  }, [activeAsks]);

  const teams = useMemo(() => countBy(agents, teamLabel), [agents]);
  const machines = useMemo(() => countBy(agents, machineLabel), [agents]);

  return (
    <div className="ctx-panel">
      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">Agents</div>
        <RailRow
          name="Overview"
          meta={`${agents.length}`}
          tone="neutral"
          onClick={() => navigate({ view: "inbox" })}
        />
        <RailRow
          name="Agents"
          meta={`${online}`}
          tone="callable"
          active
          onClick={() => navigate({ view: "ops", mode: "agents" })}
        />
        <RailRow
          name="Sessions"
          meta={`${sessions.length}`}
          tone="neutral"
          onClick={() => navigate({ view: "sessions" })}
        />
        <RailRow
          name="Alerts"
          meta={`${errored}`}
          tone={errored > 0 ? "in_turn" : "neutral"}
          unread={errored > 0}
          onClick={() => navigate({ view: "activity" })}
        />
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">Projects</div>
        {teams.length === 0 ? (
          <div className="ctx-panel-empty">No projects</div>
        ) : (
          teams.map(([team, count]) => (
            <RailRow
              key={team}
              name={team}
              meta={`${count}`}
              tone="neutral"
              title={`${count} agent${count === 1 ? "" : "s"} on ${team}`}
            />
          ))
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">Machines</div>
        {machines.length === 0 ? (
          <div className="ctx-panel-empty">No machines</div>
        ) : (
          machines.map(([machine, count]) => (
            <RailRow
              key={machine}
              name={machine}
              meta={`${count}`}
              tone="neutral"
              title={`${count} agent${count === 1 ? "" : "s"} on ${machine}`}
            />
          ))
        )}
      </section>
    </div>
  );
}
