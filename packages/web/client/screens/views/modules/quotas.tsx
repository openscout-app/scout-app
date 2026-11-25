/**
 * Plans & quotas — how much of each plan window is used, and when it resets.
 *
 * Shows:  one meter per plan window (Codex, Claude, GitHub…): used %, reset time.
 * Data:   the shared Providers loop (harnesses/use-service-budgets.ts):
 *         /api/service-budgets every 30s while any plan panel is open, one
 *         read for all of them; it never forces a provider refresh.
 * Scope:  Provider: one provider's windows ("" = every provider).
 * Opens:  Open full: /providers.
 */
import { useMemo } from "react";
import { timeAgo } from "../../../lib/time.ts";
import { harnessLabel } from "../../harnesses/HarnessesScreen.tsx";
import { useServiceBudgets } from "../../harnesses/use-service-budgets.ts";
import { defineModule, type ModuleProps, type ModuleScope } from "./contract.ts";
import { ModuleHead } from "./ModuleHead.tsx";
import { quotaGauges, quotaProviderOptions } from "./providers-model.ts";
import { Quiet } from "./shared.tsx";

function Quotas({ route, navigate, config }: ModuleProps) {
  const { gauges: all, loading, error } = useServiceBudgets();
  const gauges = useMemo(() => quotaGauges(all, config.provider || undefined), [all, config.provider]);
  const head = route.view !== "harnesses" && (
    <ModuleHead>
      <button type="button" className="vw-chip" onClick={() => navigate({ view: "harnesses" })} title="Open the Providers page">
        Open full
      </button>
    </ModuleHead>
  );
  if (loading || (error && all.length === 0)) return <>{head}<Quiet>{error ? "Couldn't read plans." : "Reading plans…"}</Quiet></>;
  if (!gauges.length) return <>{head}<Quiet>No plan windows reported.</Quiet></>;
  return (
    <>
      {head}
      <ul className="vw-rows">
        {gauges.map((g) => (
          <li key={g.id} className="vw-gauge">
            <span className="vw-ell">{g.label}</span>
            <span className="vw-meter">
              <b style={{ width: `${Math.round(Math.min(1, Math.max(0, g.fill)) * 100)}%` }} />
            </span>
            <span className="vw-num">{Math.round(g.fill * 100)}%</span>
            <span className="vw-dim vw-ell">{g.resetAt ? `resets ${timeAgo(g.resetAt)}` : g.capLabel}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const providerScope: ModuleScope = {
  key: "provider",
  allLabel: "Every provider",
  useOptions: () => {
    const { gauges } = useServiceBudgets();
    return useMemo(() => quotaProviderOptions(gauges, harnessLabel), [gauges]);
  },
};

export const quotasModule = defineModule({
  type: "quotas",
  title: "Plans & quotas",
  blurb: "Plan windows and how much is left",
  docs: {
    shows: "A meter per plan window with its reset time.",
    data: "The shared Providers loop: /api/service-budgets, every 30s.",
    opens: "Open full: /providers.",
  },
  size: { w: 4, h: 8 },
  minSize: { w: 3, h: 4 },
  scopes: [providerScope],
  Component: Quotas,
});
