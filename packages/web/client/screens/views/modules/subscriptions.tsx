/**
 * Subscriptions — what each plan is, how much is left, and when it resets.
 *
 * Shows:  a row per provider, detected ones first: every usage window at a
 *         glance (label, meter, percent), the next reset and the reading's
 *         age. A row opens to window detail, source, dashboard links and,
 *         for Cursor and Grok, the dashboard import.
 * Data:   the shared Providers loop (harnesses/use-service-budgets.ts):
 *         /api/service-budgets now, a forced ?refresh=1 600ms after, then
 *         every 30s; one read for every Providers panel on the view.
 * Scope:  Provider: one row ("" = every provider).
 * Opens:  each provider's dashboard (new tab); Refresh reads every provider
 *         again; Open full: /providers.
 */
import { useMemo } from "react";
import { buildHarnessRows, SubscriptionSection } from "../../harnesses/HarnessesScreen.tsx";
import { useServiceBudgets } from "../../harnesses/use-service-budgets.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import "./providers-panels.css";

/** The provider rows the Providers page draws, as scope choices. */
const PROVIDER_OPTIONS = buildHarnessRows([]).map((row) => ({ value: row.id, label: row.label }));

function Subscriptions({ route, navigate, config }: ModuleProps) {
  const { gauges, hiddenProviders, loading, refreshing, error, load } = useServiceBudgets({ fresh: true });
  const rows = useMemo(() => buildHarnessRows(gauges), [gauges]);
  return (
    <div className="vw-hs">
      <ModuleHead>
        <button type="button" className="vw-chip" disabled={refreshing} onClick={() => void load(true)} title="Read every provider again">
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
        {route.view !== "harnesses" && (
          <button type="button" className="vw-chip" onClick={() => navigate({ view: "harnesses" })} title="Open the Providers page">
            Open full
          </button>
        )}
      </ModuleHead>
      {error && <div className="hs-error" role="status" aria-live="polite">refresh: {error}</div>}
      <SubscriptionSection rows={rows} loading={loading} onImported={() => load(false)} only={config.provider || undefined} hidden={hiddenProviders} />
    </div>
  );
}

const providerScope: ModuleScope = {
  key: "provider",
  allLabel: "Every provider",
  useOptions: () => PROVIDER_OPTIONS,
};

export const subscriptionsModule = defineModule({
  type: "subscriptions",
  title: "Subscriptions",
  blurb: "Each plan, how much is left, and when it resets",
  docs: {
    shows: "Provider rows with usage, next reset and reading age; expand for windows, sources, links and dashboard capture.",
    data: "The shared Providers loop: /api/service-budgets now, forced once 600ms after, then every 30s.",
    opens: "Provider dashboards (new tab); Refresh reads every provider again; Open full: /providers.",
  },
  fit: true,
  size: { w: 8, h: 24 },
  minSize: { w: 4, h: 10 },
  scopes: [providerScope],
  Component: Subscriptions,
});
