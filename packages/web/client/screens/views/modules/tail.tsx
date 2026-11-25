/**
 * Tail / Alerts — every session event as it lands; Alerts keeps the warnings and errors.
 *
 * Shows:  the live event stream, newest at the bottom, with its status line
 *         (live or paused; Tail: work / all; Alerts: err / wrn+ / all with
 *         counts) and its filter. Above the oldest row, "Earlier" reads further
 *         back, until a read finds nothing older ("Nothing earlier."). A
 *         picked row opens in the Event panel beside it, or in its own sheet
 *         when there is none (or this panel is in full view).
 * Data:   the broker tail stream through TailView (pushed, not polled), opened
 *         on recent replay (/api/tail/recent); /api/tail/discover every 30s.
 *         "Earlier" re-reads /api/tail/recent with more lines (2,000, then
 *         5,000), once per click (tail-lookback.ts). On Ops › Tail with follow
 *         ids, GET /api/follow every 5s resolves them to a harness session.
 * Scope:  q: "This page's filter" (@route): on its own Ops page (Tail on
 *         /ops/tail, Alerts on /ops/issues) the URL's ?q= and, on Tail, the
 *         follow ids (?flightId ?invocationId ?conversationId ?workId
 *         ?sessionId ?targetAgentId) narrowed to their session, with the page's
 *         keys (/ filter, G live, esc clear). Otherwise a project or harness
 *         from what the tail watches ("" = every session), kept in settings and
 *         matched against each event's project, folder, session and harness;
 *         its keys work while focus is in the panel. density: "compact"
 *         (no picker; Home ships its tail that way) draws Home's tighter rows.
 * Opens:  a row: its detail. The project in a row filters to it; the session
 *         opens it. Open full (own filter): Ops › Tail or Alerts.
 */
import { useCallback, useEffect, useMemo } from "react";
import { api } from "../../../lib/api.ts";
import type { TailDiscoverySnapshot, TailEvent } from "../../../lib/types.ts";
import { useFollowTailQuery } from "../../ops/follow-tail-query.ts";
import { TailView } from "../../shared/TailView.tsx";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { usePanelKeyScope } from "./panel-scope.ts";
import { usePolled } from "./shared.tsx";
import { TAIL_FILTER_KEY, tailFullRoute, tailPanelPlan, tailScopeOptions, type TailPanelKind } from "./tail-panel-model.ts";
import { tailPicks } from "./tail-picks.ts";
import "./tail-panels.css";

function useWatchedOptions() {
  const { data } = usePolled(() => api<TailDiscoverySnapshot>("/api/tail/discover"), 60_000);
  return useMemo(() => tailScopeOptions(data), [data]);
}

const filterScope: ModuleScope = {
  key: TAIL_FILTER_KEY,
  allLabel: "Every session",
  useOptions: useWatchedOptions,
  followsPage: "This page's filter",
};

type Select = (event: TailEvent) => boolean;

/** Ops › Tail's own panel: the URL's ?q=, or its follow ids resolved to one harness session. */
function PageTail({ route, navigate, onSelect }: Pick<ModuleProps, "route" | "navigate"> & { onSelect: Select }) {
  const { query, sessionId } = useFollowTailQuery(route, route.view === "ops" ? route.tailQuery : undefined);
  return <TailView navigate={navigate} initialFilter={query} sessionId={sessionId} variant="tail" inlineDetail onSelect={onSelect} />;
}

function TailPanel({ kind, instanceId, route, navigate, config }: ModuleProps & { kind: TailPanelKind }) {
  const plan = tailPanelPlan(route, kind, config);
  const { root, keyScope } = usePanelKeyScope();

  // A pick opens in the Event panel beside this one when there is one, unless
  // this panel is lifted over the grid (full view hides the Event panel).
  const onSelect = useCallback<Select>(
    (event) => {
      const full = root.current?.closest(".hud-grid-panel")?.classList.contains("is-full") ?? false;
      if (full || !tailPicks.watched()) return false;
      tailPicks.publish(instanceId, event, kind);
      return true;
    },
    [instanceId, kind, root],
  );
  useEffect(() => () => tailPicks.withdraw(instanceId), [instanceId]);

  return (
    <div ref={root} className="vw-tail">
      {plan.follows === "page" ? (
        kind === "tail" ? (
          <PageTail route={route} navigate={navigate} onSelect={onSelect} />
        ) : (
          <TailView
            navigate={navigate}
            initialFilter={route.view === "ops" ? route.tailQuery : undefined}
            variant="issues"
            inlineDetail
            onSelect={onSelect}
          />
        )
      ) : (
        <>
          <ModuleHead>
            <button
              type="button"
              className="vw-chip"
              onClick={() => navigate(tailFullRoute(kind, plan.q))}
              title={kind === "tail" ? "Open this filter on Ops › Tail" : "Open Ops › Alerts"}
            >
              Open full
            </button>
          </ModuleHead>
          <TailView
            navigate={navigate}
            chrome="embedded"
            variant={kind}
            initialFilter={plan.q || undefined}
            filterLabel={plan.q || undefined}
            // a picked project or harness matches where the event ran, not what it says
            filterScope={plan.q ? "context" : "all"}
            keyScope={keyScope}
            onSelect={onSelect}
            density={config.density === "compact" ? "compact" : "default"}
          />
        </>
      )}
    </div>
  );
}

export const tailModule = defineModule({
  type: "tail",
  title: "Tail",
  blurb: "Every event as it lands",
  docs: {
    shows: "The live event stream with its status and filter. Earlier, above the oldest row, reads further back. A picked row opens in Event beside it, or its own sheet.",
    data: "Broker tail stream via TailView; pushed, opened on recent replay. Earlier re-reads /api/tail/recent with more lines, on click. Follow ids: /api/follow every 5s.",
    opens: "A row's detail; a row's session; Open full: Ops › Tail with this filter.",
  },
  size: { w: 6, h: 14 },
  minSize: { w: 4, h: 7 },
  scopes: [filterScope],
  Component: (props) => <TailPanel {...props} kind="tail" />,
});

export const alertsModule = defineModule({
  type: "alerts",
  title: "Alerts",
  blurb: "Warnings and errors as they land",
  docs: {
    shows: "The tail's warnings and errors (err, wrn+, or all), with counts. Earlier reads further back. A picked row opens in Event beside it, or its own sheet.",
    data: "Broker tail stream via TailView (issues), pushed, opened on recent replay; Earlier re-reads /api/tail/recent with more lines, on click.",
    opens: "A row's detail; a row's session; Open full: Ops › Alerts.",
  },
  size: { w: 6, h: 14 },
  minSize: { w: 4, h: 7 },
  scopes: [filterScope],
  Component: (props) => <TailPanel {...props} kind="issues" />,
});
