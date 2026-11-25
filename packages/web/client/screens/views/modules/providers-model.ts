import type { ServiceGauge } from "../../home/HomeHero.tsx";
import { canonicalHarnessId } from "../../harnesses/provider-ids.ts";
import type { ModuleScopeOption } from "./contract.ts";

/*
 * The Providers panels' rules (Subscriptions, Cloud accounts, Plans &
 * quotas), without React, so they test on their own. README.md › "The
 * modules" has the table. Every one reads the shared Providers loop
 * (harnesses/use-service-budgets.ts); none polls on its own.
 */

export type QuotaGauge = Extract<ServiceGauge, { kind: "quota" }>;

/** Plan windows (quota gauges), narrowed to one provider when a panel is scoped to it. */
export function quotaGauges(gauges: readonly ServiceGauge[], provider: string | undefined): QuotaGauge[] {
  return gauges.filter((gauge): gauge is QuotaGauge => gauge.kind === "quota" && (!provider || canonicalHarnessId(gauge.id) === provider));
}

/** Providers that report plan windows, for a Plans & quotas scope. */
export function quotaProviderOptions(gauges: readonly ServiceGauge[], label: (id: string) => string): ModuleScopeOption[] {
  const seen = new Set<string>();
  for (const gauge of gauges) if (gauge.kind === "quota") seen.add(canonicalHarnessId(gauge.id));
  return [...seen].sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: label(value) }));
}
