/**
 * Health — how dispatch is going in scope: what got through, and what needs a look.
 *
 * Shows:  Delivered, Needs attention and Pending, each with its count and
 *         share, over one bar; the newest dispatches that need attention
 *         (up to four); the busiest route; the route mix (direct, channel,
 *         broadcast); when the latest dispatch went and when the ledger last
 *         read. Counts are of the dispatches in scope before the outcome tab,
 *         the same set the Ledger's tab counts come from.
 * Data:   the shared dispatch ledger (/api/broker; see Ledger), through the
 *         same scope as every Dispatch panel.
 * Scope:  on /dispatch, the page's, from the URL. Anywhere else its own, in
 *         settings: focus (a chip clears it) and window (behind Scope). It
 *         counts every outcome either way.
 * Opens:  on /dispatch, Delivered or Needs attention sets the page's outcome
 *         (the Ledger and Routes narrow to it; again to clear), a dispatch
 *         opens its detail in the Ledger, and the busiest route focuses its
 *         two ends, Between. Elsewhere a count or a dispatch opens the
 *         Dispatch page on it, the busiest route focuses this panel, and
 *         Open full opens this scope there.
 */
import { ArrowRight } from "lucide-react";
import { useCallback, useMemo } from "react";
import { timeAgo, timeAgoWithSuffix } from "../../../lib/time.ts";
import type { BrokerRouteAttempt, DispatchFilter } from "../../../lib/types.ts";
import { useScout } from "../../../scout/Provider.tsx";
import { scopeIsActive, scopeRoute } from "../../broker/dispatch-scope.ts";
import { useDispatchLedgerView } from "../../broker/use-dispatch-ledger.ts";
import { defineModule, type ModuleProps } from "./contract.ts";
import { DispatchPanelHead } from "./dispatch-head.tsx";
import { dispatchHealth, healthPercent } from "./dispatch-health-model.ts";
import { DISPATCH_WINDOW_SCOPE, useDispatchPanelScope } from "./dispatch-panel.ts";
import { Quiet } from "./shared.tsx";
import "../../broker/dispatch-focus.css";
import "./dispatch-health.css";

const HEALTH_SCOPES = [DISPATCH_WINDOW_SCOPE];

function DispatchHealthPanel(props: ModuleProps) {
  const { navigate, config, setConfig } = props;
  const { inspectBrokerAttempt } = useScout();
  const scoped = useDispatchPanelScope(props);
  const { own, scope, setScope, query } = scoped;
  const { broker, loading, error, result, nodeCatalog } = useDispatchLedgerView(scope, query);
  const health = useMemo(() => dispatchHealth(result.scoped), [result.scoped]);
  const labelOf = useCallback((key: string) => nodeCatalog.get(key)?.label ?? key.replace(/^(agent|addr|channel):/, ""), [nodeCatalog]);

  const open = (attempt: BrokerRouteAttempt) => {
    // On /dispatch the Ledger beside it draws the detail; elsewhere the page does.
    if (own) inspectBrokerAttempt(attempt);
    else navigate(scopeRoute(scope, attempt.id));
  };
  // On /dispatch an outcome narrows the Ledger and Routes beside it; Health
  // itself always counts every outcome. Elsewhere it opens the page on it.
  const pickOutcome = (filter: DispatchFilter) => {
    if (own) setScope({ filter: scope.filter === filter ? "all" : filter });
    else navigate(scopeRoute({ ...scope, filter }));
  };

  // Health counts every outcome, so off /dispatch its scope is focus and window.
  const head = <DispatchPanelHead panel={scoped} config={config} setConfig={setConfig} navigate={navigate} labelOf={labelOf} scopes={HEALTH_SCOPES} />;

  if (!broker) {
    return (
      <div className="vw-dhealth dsp-root">
        {head}
        <Quiet>{loading ? "Reading dispatches…" : error ? `Dispatch did not load: ${error}` : "No dispatch data yet."}</Quiet>
      </div>
    );
  }

  if (health.total === 0) {
    return (
      <div className="vw-dhealth dsp-root">
        {head}
        <Quiet>{scopeIsActive(scope, query) ? "No dispatches in this scope." : "No dispatches yet."}</Quiet>
      </div>
    );
  }

  const tallies: Array<{ filter: DispatchFilter | null; label: string; count: number; share: number | null; tone: string }> = [
    { filter: "delivered", label: "Delivered", count: health.delivered, share: health.deliveredShare, tone: "delivered" },
    { filter: "failed", label: "Needs attention", count: health.attention, share: health.attentionShare, tone: health.attention > 0 ? "attention" : "quiet" },
    { filter: null, label: "Pending", count: health.pending, share: health.total > 0 ? health.pending / health.total : null, tone: "pending" },
  ];

  return (
    <div className="vw-dhealth dsp-root">
      {head}
      <div className="vw-dhealth-tally" role="group" aria-label={`${health.total} ${health.total === 1 ? "request" : "requests"} in scope`}>
        {tallies.map((tally) => {
          const body = (
            <>
              <span className="vw-dhealth-num">{tally.count}</span>
              <span className="vw-dhealth-label">{tally.label}</span>
              <span className="vw-dhealth-share">{healthPercent(tally.share)}</span>
            </>
          );
          return tally.filter ? (
            <button
              key={tally.label}
              type="button"
              className={`vw-dhealth-stat vw-dhealth-stat--${tally.tone}`}
              aria-pressed={own ? scope.filter === tally.filter : undefined}
              onClick={() => pickOutcome(tally.filter!)}
              title={!own
                ? `Open ${tally.label.toLowerCase()} on the Dispatch page`
                : scope.filter === tally.filter ? "Show every outcome" : `Show only ${tally.label.toLowerCase()}`}
            >
              {body}
            </button>
          ) : (
            <div key={tally.label} className={`vw-dhealth-stat vw-dhealth-stat--${tally.tone}`}>{body}</div>
          );
        })}
      </div>
      <div
        className="vw-dhealth-bar"
        role="img"
        aria-label={`${healthPercent(health.deliveredShare)} delivered, ${healthPercent(health.attentionShare)} need attention`}
      >
        <b className="is-delivered" style={{ width: `${(health.deliveredShare ?? 0) * 100}%` }} />
        <b className="is-attention" style={{ width: `${(health.attentionShare ?? 0) * 100}%` }} />
      </div>

      <section className="vw-dhealth-section" aria-label="Needs attention">
        <h3>Needs attention</h3>
        {health.needsAttention.length === 0 ? (
          <p className="vw-dhealth-none">Nothing in scope needs attention.</p>
        ) : (
          <ul className="vw-dhealth-list">
            {health.needsAttention.map((row) => (
              <li key={row.attempt.id}>
                <button type="button" className="vw-dhealth-row" onClick={() => open(row.attempt)} title={row.title}>
                  <span className="dsp-status-mark" aria-hidden="true">!</span>
                  <span className="vw-dhealth-row-title">{row.title}</span>
                  <span className="vw-dhealth-row-route">
                    {row.from.label}
                    <ArrowRight size={10} aria-hidden="true" />
                    {row.to.label}
                  </span>
                  <span className="vw-dhealth-row-time">{timeAgo(row.attempt.ts)}</span>
                </button>
              </li>
            ))}
            {health.attention > health.needsAttention.length && (
              <li>
                <button type="button" className="vw-dhealth-more" onClick={() => pickOutcome("failed")} disabled={own && scope.filter === "failed"}>
                  {health.attention - health.needsAttention.length} more
                </button>
              </li>
            )}
          </ul>
        )}
      </section>

      {health.busiest && (
        <section className="vw-dhealth-section" aria-label="Busiest route">
          <h3>Busiest route</h3>
          <button
            type="button"
            className="vw-dhealth-route"
            onClick={() => setScope({ focus: [health.busiest!.from.key, health.busiest!.to.key], between: true })}
            title="Focus on this route"
          >
            <span className="vw-dhealth-row-route">
              {health.busiest.from.label}
              <ArrowRight size={10} aria-hidden="true" />
              {health.busiest.to.label}
            </span>
            <span className="vw-dhealth-route-count">
              {health.busiest.count}
              {health.busiest.attention > 0 && <span className="vw-dhealth-route-attn"> · {health.busiest.attention} need attention</span>}
            </span>
          </button>
        </section>
      )}

      {health.routeMix.length > 1 && (
        <section className="vw-dhealth-section" aria-label="Route mix">
          <h3>Route mix</h3>
          <ul className="vw-dhealth-mix">
            {health.routeMix.map((entry) => (
              <li key={entry.label}>
                <span className="vw-dhealth-mix-label">{entry.label}</span>
                <span className="vw-dhealth-mix-meter" aria-hidden="true"><b style={{ width: `${entry.share * 100}%` }} /></span>
                <span className="vw-dhealth-mix-count">{entry.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="vw-dhealth-foot">
        {health.latestAt !== null && <>Latest dispatch {timeAgoWithSuffix(health.latestAt)} · </>}
        Updated {timeAgoWithSuffix(broker.generatedAt)}
      </p>
    </div>
  );
}

export const dispatchHealthModule = defineModule({
  type: "dispatch-health",
  title: "Health",
  blurb: "Delivered, needs attention and pending in scope, the newest failures, the busiest route",
  docs: {
    shows: "Delivered, Needs attention and Pending with counts and shares over one bar; the newest dispatches that need attention; the busiest route; the route mix.",
    data: "The shared dispatch ledger (/api/broker), through the same scope as the Ledger.",
    opens: "On /dispatch, a count sets the page's outcome and a dispatch opens in the Ledger; elsewhere both open the Dispatch page. The busiest route focuses its two ends.",
  },
  size: { w: 4, h: 12 },
  minSize: { w: 3, h: 6 },
  Component: DispatchHealthPanel,
});
