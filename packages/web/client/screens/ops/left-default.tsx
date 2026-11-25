import { useCallback, useEffect, useState } from "react";
import "../../scout/slots/ctx-panel.css";
import { loadFleet } from "../../lib/fleet-store.ts";
import { normalizeAgentState } from "../../lib/agent-state.ts";
import { routeForFleetAsk, routeForOperatorAttention } from "../../lib/operator-attention.ts";
import { useBrokerEvents } from "../../lib/sse.ts";
import { timeAgo } from "../../lib/time.ts";
import { useScout } from "../../scout/Provider.tsx";
import { openContent } from "../../scout/slots/openContent.ts";
import { RailRow } from "../../scout/slots/RailRow.tsx";
import type { NavigateOptions } from "../../lib/router.ts";
import type { FleetAsk, FleetAttentionItem, FleetState, Route } from "../../lib/types.ts";
import type { PanelContent } from "../../components/hud-grid/hud-grid-fold.ts";
import { queueContent } from "./ops-panel-content.ts";

type OpsSurface = {
  name: string;
  route: Route;
  active: (route: Route) => boolean;
};

const OPS_SURFACES: OpsSurface[] = [
  {
    name: "Control",
    route: { view: "ops", mode: "mission" },
    active: (route) => route.view === "ops" && (route.mode === undefined || route.mode === "mission"),
  },
  {
    name: "Tail",
    route: { view: "ops", mode: "tail" },
    active: (route) => route.view === "ops" && route.mode === "tail",
  },
  {
    name: "Processes",
    route: { view: "ops", mode: "atop" },
    active: (route) => route.view === "ops" && route.mode === "atop",
  },
];

export function OpsDefaultLeft() {
  const { navigate, route } = useScout();

  return (
    <div className="ctx-panel ctx-panel--ops">
      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">Surfaces</div>
        {OPS_SURFACES.map((surface) => (
          <RailRow
            key={surface.name}
            name={surface.name}
            tone="neutral"
            active={surface.active(route)}
            onClick={() => navigate(surface.route)}
          />
        ))}
      </section>
      <OpsFleetQueue navigate={navigate} route={route} />
    </div>
  );
}

/**
 * The fleet's Requests (asks waiting on the operator) and Active asks, as
 * rail sections. The Ops rail shows the first few; the Requests · Active
 * panel (views/modules/ops-queue.tsx) passes Infinity to show them all.
 */
export function OpsFleetQueue({
  navigate,
  route,
  requestLimit = 4,
  activeLimit = 10,
  onContent,
}: {
  navigate: (route: Route, options?: NavigateOptions) => void;
  route: Route;
  requestLimit?: number;
  activeLimit?: number;
  /** What it holds, once the fleet has loaded: a host grid folds it while empty (ops-panel-content.ts). */
  onContent?: (content: PanelContent) => void;
}) {
  const [state, setState] = useState<FleetState | null>(null);

  const load = useCallback(async () => {
    const data = await loadFleet().catch(() => null);
    setState(data);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useBrokerEvents((event) => {
    if (
      event.kind === "message.posted" ||
      event.kind === "flight.updated" ||
      event.kind === "collaboration.event.appended"
    ) {
      void load();
    }
  });

  const needs = state?.needsAttention ?? [];
  const active = (state?.activeAsks ?? []).filter((ask) => ask.status !== "needs_attention");
  const content = state ? queueContent(needs, active) : null;
  const contentKey = content ? `${content.empty}|${content.count}|${content.state}|${content.mark ?? ""}` : "";
  useEffect(() => {
    if (content) onContent?.(content);
  }, [contentKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAttention = (item: FleetAttentionItem) => {
    openContent(navigate, routeForOperatorAttention(item), { returnTo: route });
  };

  const openAsk = (ask: FleetAsk) => {
    openContent(navigate, routeForFleetAsk(ask), { returnTo: route });
  };

  return (
    <>
      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Requests
          {needs.length > 0 && <span className="ctx-panel-count">{needs.length}</span>}
        </div>
        {needs.length === 0 ? (
          <div className="ctx-panel-empty">All clear</div>
        ) : (
          needs.slice(0, requestLimit).map((item) => {
            const label = item.agentName ?? item.agentId ?? "operator";
            return (
              <RailRow
                key={item.recordId}
                name={item.title}
                meta={timeAgo(item.updatedAt)}
                tone="in_turn"
                unread
                title={`${label} · ${item.kind}`}
                onClick={() => openAttention(item)}
              />
            );
          })
        )}
      </section>

      <section className="ctx-panel-section">
        <div className="ctx-panel-section-label">
          Active
          {active.length > 0 && <span className="ctx-panel-count">{active.length}</span>}
        </div>
        {active.length === 0 ? (
          <div className="ctx-panel-empty">No active requests</div>
        ) : (
          active.slice(0, activeLimit).map((ask) => (
            <RailRow
              key={ask.invocationId}
              name={ask.task}
              meta={timeAgo(ask.updatedAt)}
              tone={normalizeAgentState(ask.agentState)}
              title={`${ask.agentName ?? ask.agentId} · ${ask.statusLabel}`}
              onClick={() => openAsk(ask)}
            />
          ))
        )}
      </section>
    </>
  );
}
