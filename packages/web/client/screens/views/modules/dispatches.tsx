/**
 * Ledger — every message the broker routed, by day: the Dispatch ledger as a panel.
 *
 * Shows:  the focus bar (focused nodes as chips, Between, the window, search),
 *         the outcome tabs (All · Needs attention · Delivered) with counts,
 *         then the dispatches grouped by day, newest first: request, route,
 *         delivery, time. Load older pages further back. An open dispatch
 *         (outcome, Retry, Investigate, Forward, the record) draws beside the
 *         ledger when the panel is wide enough for both, over it when not.
 * Data:   /api/broker through the shared dispatch ledger
 *         (broker/use-dispatch-ledger.ts): one read for the Dispatch page and
 *         every Dispatch panel on it, warm from a read under 30s old,
 *         refreshed on message and delivery events (one read per 250ms
 *         burst); Load older pages survive a refresh.
 * Scope:  on /dispatch, the page's: outcome, focus, Between and window from
 *         the URL (Back undoes a change, a link carries it), and the open
 *         dispatch; the search box is shared with every Dispatch panel there.
 *         Anywhere else its own, in settings (filter · focus · between ·
 *         window), its own search, and the open dispatch (attempt) as state.
 * Opens:  a dispatch's detail, in the panel; from the detail, the
 *         conversation, the agent, Scoutbot. Off /dispatch, Open full opens
 *         this scope and dispatch on the Dispatch page.
 *
 * Keys: j/k or arrows move along the rows, g/G (Home/End) to the ends, Enter
 * or Space opens the row, Esc closes the open dispatch (and only then; with
 * none open it leaves full view as usual). On /dispatch they bind while focus
 * is in the panel or nowhere; elsewhere only while it is in the panel.
 */
import { useCallback, useMemo, useRef } from "react";
import { BrokerScreen, type DispatchPanelControl } from "../../broker/BrokerScreen.tsx";
import { defineModule, type ModuleProps } from "./contract.ts";
import { DispatchPanelHead } from "./dispatch-head.tsx";
import { useDispatchPanelScope } from "./dispatch-panel.ts";
import { usePanelKeyScope } from "./panel-scope.ts";
import "./dispatches.css";

const keyLabel = (key: string) => key.replace(/^(agent|addr|channel):/, "");

function DispatchesPanel(props: ModuleProps) {
  const { navigate, config, setConfig } = props;
  const { root, keyScope } = usePanelKeyScope();
  const scoped = useDispatchPanelScope(props);
  const { own, scope, setScope, query, setQuery } = scoped;
  // the host hands a fresh setConfig each render: keep onSelect still
  const save = useRef(setConfig);
  save.current = setConfig;
  const onSelect = useCallback((attemptId: string | null) => save.current({ attempt: attemptId ?? "" }), []);
  const panel = useMemo<DispatchPanelControl>(
    () => (own
      ? { own, keyScope, query, onQuery: setQuery }
      : { own, keyScope, query, onQuery: setQuery, scope, onScope: setScope, onSelect }),
    [keyScope, onSelect, own, query, scope, setQuery, setScope],
  );
  const attemptId = own ? undefined : config.attempt || undefined;
  return (
    <div className="vw-dispatches dsp-root" ref={root}>
      <DispatchPanelHead
        panel={scoped}
        config={config}
        setConfig={setConfig}
        navigate={navigate}
        labelOf={keyLabel}
        attemptId={attemptId}
      />
      <BrokerScreen navigate={navigate} initialAttemptId={attemptId} panel={panel} />
    </div>
  );
}

export const dispatchesModule = defineModule({
  type: "dispatches",
  title: "Ledger",
  blurb: "Every request by day, with outcome tabs, focus, search and the open request",
  docs: {
    shows: "The focus bar, outcome tabs with counts, dispatches grouped by day with Load older; the open dispatch beside the ledger, or over it when narrow.",
    data: "/api/broker through the shared dispatch ledger: one read per page, warm under 30s, refreshed on message and delivery events.",
    opens: "A dispatch's detail in the panel; from it the conversation or agent. Off /dispatch, Open full opens the Dispatch page.",
  },
  size: { w: 8, h: 16 },
  // the focus bar, the tabs and three rows still fit
  minSize: { w: 4, h: 10 },
  // the open dispatch is live state, not a choice
  state: ["attempt"],
  // on /dispatch it holds the page's one open dispatch
  maxPerView: 1,
  Component: DispatchesPanel,
});
