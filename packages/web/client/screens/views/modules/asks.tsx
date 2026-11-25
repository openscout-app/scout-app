/**
 * In flight / Recently done — asks sent to agents, from the fleet ledger.
 *
 * Shows:  one row per ask: agent, task, status, age. In flight lists asks still
 *         out; Recently done lists asks that came back.
 * Data:   loadFleet() (GET /api/fleet), every 10s in flight, every 15s done.
 * Scope:  Agent: only asks sent to one agent.
 * Opens:  the ask's conversation.
 */
import { useScout } from "../../../scout/Provider.tsx";
import { loadFleet } from "../../../lib/fleet-store.ts";
import { timeAgo } from "../../../lib/time.ts";
import type { FleetAsk, FleetState } from "../../../lib/types.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { Quiet, optionsFrom, usePolled } from "./shared.tsx";

const agentScope: ModuleScope = {
  key: "agent",
  allLabel: "All agents",
  useOptions: () => {
    const { agents } = useScout();
    return optionsFrom(agents, (a) => a.id).map((o) => ({ ...o, label: agents.find((a) => a.id === o.value)?.name ?? o.value }));
  },
};

function AskRows({ asks, empty, navigate, config }: { asks: FleetAsk[] | undefined; empty: string } & Pick<ModuleProps, "navigate" | "config">) {
  if (!asks) return <Quiet>Reading asks…</Quiet>;
  const shown = config.agent ? asks.filter((a) => a.agentId === config.agent) : asks;
  if (!shown.length) return <Quiet>{empty}</Quiet>;
  return (
    <ul className="vw-rows">
      {shown.map((a) => (
        <li key={a.invocationId}>
          <button
            type="button"
            className="vw-row vw-row--ask"
            onClick={() => a.conversationId && navigate({ view: "conversation", conversationId: a.conversationId })}
            disabled={!a.conversationId}
          >
            <span className="vw-strong vw-ell">{a.agentName ?? a.agentId}</span>
            <span className="vw-ell vw-muted">{a.task}</span>
            <span className="vw-dim">{a.statusLabel}</span>
            <span className="vw-dim vw-num">{timeAgo(a.completedAt ?? a.startedAt ?? a.updatedAt)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function InFlight(props: ModuleProps) {
  const { data } = usePolled<FleetState>(() => loadFleet(), 10_000);
  return <AskRows asks={data?.activeAsks} empty="Nothing out right now." {...props} />;
}

function Done(props: ModuleProps) {
  const { data } = usePolled<FleetState>(() => loadFleet(), 15_000);
  return <AskRows asks={data?.recentCompleted} empty="Nothing finished recently." {...props} />;
}

export const inflightModule = defineModule({
  type: "inflight",
  title: "In flight",
  blurb: "Asks out right now",
  docs: { shows: "Asks still out: agent, task, status, age.", data: "loadFleet() → /api/fleet, every 10s.", opens: "The ask's conversation." },
  size: { w: 6, h: 10 },
  minSize: { w: 3, h: 4 },
  scopes: [agentScope],
  Component: InFlight,
});

export const doneModule = defineModule({
  type: "done",
  title: "Recently done",
  blurb: "Asks that came back",
  docs: { shows: "Asks that finished, newest first.", data: "loadFleet() → /api/fleet, every 15s.", opens: "The ask's conversation." },
  size: { w: 6, h: 10 },
  minSize: { w: 3, h: 4 },
  scopes: [agentScope],
  Component: Done,
});
