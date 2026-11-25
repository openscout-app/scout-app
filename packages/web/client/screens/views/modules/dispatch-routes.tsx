/**
 * Routes — who dispatched to whom: senders on the left, destinations on the right.
 *
 * Shows:  the busiest senders (five) and destinations (seven) in scope, one
 *         curve per route weighted by how many went that way; a route with
 *         failures is dashed. An agent node goes by its session's name, leads
 *         with its harness mark and names its checkout and branch under it,
 *         and its host when the fleet spans more than one; a session with no
 *         agent card is placed from the ledger's session facts. Above, what
 *         the graph is of ("All
 *         routes", "Between Opus and Codex") and how many dispatches it draws.
 *         Focused nodes with nothing in scope sit quiet below it. Clicking a
 *         node shows its card: harness, model, checkout and branch, kind,
 *         machine, address and path, sent and received in view, and Focus or
 *         Remove focus.
 * Data:   the shared dispatch ledger (/api/broker; see Ledger): the same
 *         loaded dispatches, through the same scope, so it never disagrees
 *         with the Ledger beside it.
 * Scope:  on /dispatch, the page's, from the URL: Focus here narrows the
 *         Ledger, its counts and Health, and the Ledger's search narrows the
 *         graph. Anywhere else its own, in settings: focus (set by Focus, a
 *         chip clears it), outcome and window (behind Scope).
 * Opens:  nothing; Focus changes the scope. Off /dispatch, Open full opens
 *         this scope on the Dispatch page.
 */
import { useCallback, useMemo, useState } from "react";
import { CopyIconButton } from "../../broker/BrokerScreen.tsx";
import { DispatchNodeCard, DispatchRouteGraph } from "../../broker/DispatchFocus.tsx";
import { DISPATCH_WINDOWS, dispatchGraph } from "../../broker/dispatch-focus.ts";
import { dispatchScopeTitle, scopeIsActive } from "../../broker/dispatch-scope.ts";
import { useDispatchLedgerView } from "../../broker/use-dispatch-ledger.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { DispatchPanelHead } from "./dispatch-head.tsx";
import { DISPATCH_OUTCOME_SCOPE, DISPATCH_WINDOW_SCOPE, useDispatchPanelScope } from "./dispatch-panel.ts";
import { Quiet } from "./shared.tsx";
import "../../broker/dispatch-focus.css";
import "./dispatch-routes.css";

const ROUTES_SCOPES = [DISPATCH_OUTCOME_SCOPE, DISPATCH_WINDOW_SCOPE];

function DispatchRoutesPanel(props: ModuleProps) {
  const { navigate, config, setConfig } = props;
  const scoped = useDispatchPanelScope(props);
  const { scope, setScope, query } = scoped;
  const { broker, loading, error, result, nodeCatalog } = useDispatchLedgerView(scope, query);
  const matching = result.matching;
  const graph = useMemo(() => dispatchGraph(matching, scope.focus, nodeCatalog), [matching, nodeCatalog, scope.focus]);
  const labelOf = useCallback((key: string) => nodeCatalog.get(key)?.label ?? key.replace(/^(agent|addr|channel):/, ""), [nodeCatalog]);

  // Which node's card is open is this panel's alone: looking is not scoping.
  const [inspectedKey, setInspectedKey] = useState<string | null>(null);
  const inspected = inspectedKey ? nodeCatalog.get(inspectedKey) ?? null : null;
  const traffic = useMemo(() => {
    let sent = 0;
    let received = 0;
    if (inspectedKey) {
      for (const row of matching) {
        if (row.from.key === inspectedKey) sent += 1;
        if (row.to.key === inspectedKey) received += 1;
      }
    }
    return { sent, received };
  }, [inspectedKey, matching]);

  const windowLabel = DISPATCH_WINDOWS.find((entry) => entry.value === scope.window)?.label ?? "All loaded";
  const head = (
    <DispatchPanelHead panel={scoped} config={config} setConfig={setConfig} navigate={navigate} labelOf={labelOf} scopes={ROUTES_SCOPES} />
  );

  if (!broker) {
    return (
      <div className="vw-droutes dsp-root">
        {head}
        <Quiet>{loading ? "Reading dispatches…" : error ? `Dispatch did not load: ${error}` : "No dispatch data yet."}</Quiet>
      </div>
    );
  }

  return (
    <div className="vw-droutes dsp-root">
      {head}
      {graph.edges.length === 0 && graph.quiet.length === 0 && !scopeIsActive(scope, query) ? (
        <Quiet>No dispatches yet. Routes appear here as agents message each other.</Quiet>
      ) : (
        <DispatchRouteGraph
          graph={graph}
          inspectedKey={inspectedKey}
          onInspect={(key) => setInspectedKey((current) => (current === key ? null : key))}
          title={dispatchScopeTitle(scope, labelOf)}
          meta={`${matching.length} ${matching.length === 1 ? "request" : "requests"} · ${windowLabel}`}
        />
      )}
      {inspected && (
        <DispatchNodeCard
          node={inspected}
          sent={traffic.sent}
          received={traffic.received}
          focused={scope.focus.includes(inspected.key)}
          onFocus={() => setScope({ focus: [...scope.focus, inspected.key] })}
          onUnfocus={() => setScope({ focus: scope.focus.filter((key) => key !== inspected.key) })}
          onClose={() => setInspectedKey(null)}
          copyButton={(value, subject) => <CopyIconButton value={value} subject={subject} />}
        />
      )}
    </div>
  );
}

export const dispatchRoutesModule = defineModule({
  type: "dispatch-routes",
  title: "Routes",
  blurb: "Who dispatched to whom: senders, destinations and the routes between them",
  docs: {
    shows: "The busiest senders and destinations in scope, each agent with its harness, checkout and branch; one curve per route, failures dashed; a node's card with Focus.",
    data: "The shared dispatch ledger (/api/broker), through the same scope as the Ledger.",
    opens: "Nothing; Focus narrows the scope (on /dispatch, every Dispatch panel). Off /dispatch, Open full opens the Dispatch page.",
  },
  // tall enough for seven destinations without scrolling
  size: { w: 8, h: 12 },
  minSize: { w: 4, h: 6 },
  Component: DispatchRoutesPanel,
});
