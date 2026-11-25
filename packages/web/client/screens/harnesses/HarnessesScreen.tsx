import { ProviderDiscovery } from "../../components/ProviderDiscovery.tsx";
import { SCOUT_MODEL_INVENTORY_URL, type ScoutModelInventory } from "../../../shared/model-inventory.ts";
import { getDestination } from "../../scout/nav-destinations.ts";
import { ClipboardPaste, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  buildOrchestrationProviderMap,
  orchestrationRuntimeRouteLabel,
  type OrchestrationRuntimeAssignment,
  type ProviderUsageForMapping,
} from "@openscout/protocol";
import { RUNTIME_CAPABILITY_SEED, type RuntimeCapabilityCatalog } from "../../lib/runtime-capabilities.ts";
import { quotaWindowRolledOver } from "../home/quota-reset.ts";

import { HarnessMark, harnessLabel as sharedHarnessLabel } from "../../components/HarnessMark.tsx";
import { api } from "../../lib/api.ts";
import { hostFleet } from "../../lib/hosts/host-fleet.ts";
import { usePersistentString } from "../../lib/persistent-state.ts";
import { routeMachineId } from "../../lib/router.ts";
import {
  formatAbsoluteTimestamp,
  normalizeTimestampMs,
  timeAgo,
} from "../../lib/time.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../../scout/Provider.tsx";
import { useContentOwnsSecondaryNav } from "../../scout/sidebar/useContentSecondaryNav.ts";
import type { ServiceGauge } from "../home/HomeHero.tsx";
import { OpsSubnav } from "../ops/OpsSubnav.tsx";
import { canonicalHarnessId } from "./provider-ids.ts";
import type { CloudAccount } from "./service-budgets-loop.ts";
import { useServiceBudgets } from "./use-service-budgets.ts";
import "./harnesses-screen.css";

type QuotaGauge = Extract<ServiceGauge, { kind: "quota" }>;
type QuotaWindow = NonNullable<QuotaGauge["windows"]>[number];
export type HarnessRow = {
  id: string;
  label: string;
  gauge: ServiceGauge | null;
};

const HARNESS_LABELS: Record<string, string> = {
  codex: "Codex",
  claude: "Claude",
  kimi: "Kimi",
  minimax: "MiniMax",
  cursor: "Cursor",
  native: "Native",
  worker: "Worker",
  bridge: "Bridge",
  http: "HTTP",
  pi: "Pi",
  flue: "Flue",
  github: "GitHub",
  unknown: "Unknown",
};

const SUBSCRIPTION_PROVIDERS = [
  {
    id: "claude",
    description: "Anthropic plan windows captured from Claude Code.",
    links: [
      { label: "Usage", href: "https://claude.ai/settings/usage" },
      { label: "Manage plan", href: "https://claude.ai/settings/billing" },
    ],
  },
  {
    id: "codex",
    description: "OpenAI plan windows reported by local Codex sessions.",
    links: [
      { label: "Usage", href: "https://chatgpt.com/codex/settings/usage" },
      { label: "Open Codex", href: "https://chatgpt.com/codex" },
    ],
  },
  {
    id: "kimi",
    description: "Kimi Code subscription windows and membership level.",
    links: [
      { label: "Kimi Code", href: "https://www.kimi.com/code" },
      { label: "Docs", href: "https://www.kimi.com/code/docs/en/" },
    ],
  },
  {
    id: "grok",
    description: "SuperGrok quota reported by local Grok, with dashboard capture and local activity as fallbacks.",
    links: [
      { label: "Open Grok", href: "https://grok.com/" },
      { label: "Billing", href: "https://grok.com/?_s=billing" },
      { label: "Help", href: "https://docs.x.ai/grok/faq" },
    ],
  },
  {
    id: "minimax",
    description: "MiniMax Token Plan 5-hour and weekly allowance.",
    links: [
      { label: "Usage", href: "https://platform.minimax.io/console/plan" },
      { label: "Docs", href: "https://platform.minimax.io/docs/token-plan/intro" },
    ],
  },
  {
    id: "cursor",
    description: "Cursor membership detected locally, plus usage totals from an exported dashboard capture.",
    links: [
      { label: "Usage", href: "https://cursor.com/dashboard/usage" },
      { label: "Manage plan", href: "https://cursor.com/dashboard/billing" },
    ],
  },
] as const;

/** Each account's dashboard. An account's own href (a Slack workspace) wins. */
const ACCOUNT_DASHBOARDS: Record<string, string> = {
  cloudflare: "https://dash.cloudflare.com/",
  vercel: "https://vercel.com/dashboard",
  exe: "https://exe.dev/",
  github: "https://github.com/",
  fly: "https://fly.io/dashboard",
  netlify: "https://app.netlify.com/",
  railway: "https://railway.com/dashboard",
  render: "https://dashboard.render.com/",
  aws: "https://console.aws.amazon.com/",
  gcloud: "https://console.cloud.google.com/",
  digitalocean: "https://cloud.digitalocean.com/",
  hetzner: "https://console.hetzner.cloud/",
  slack: "https://app.slack.com/",
};

const ACCOUNT_KIND_LABELS: Record<NonNullable<CloudAccount["kind"]>, string> = {
  model: "Model access",
  hosting: "Hosting",
  compute: "Agent compute",
  code: "Code",
  chat: "Chat",
};
const ACCOUNT_KIND_ORDER: Array<NonNullable<CloudAccount["kind"]>> = ["model", "hosting", "compute", "code", "chat"];

function accountProvider(account: CloudAccount): string {
  return account.provider ?? account.id;
}

/** Where each provider's favicon lives; other accounts use their link's host. */
const ACCOUNT_DOMAINS: Record<string, string> = {
  cloudflare: "cloudflare.com",
  vercel: "vercel.com",
  exe: "exe.dev",
  github: "github.com",
  slack: "slack.com",
};

function accountDomain(provider: string, href: string | undefined): string | null {
  if (ACCOUNT_DOMAINS[provider]) return ACCOUNT_DOMAINS[provider];
  if (!href) return null;
  try {
    return new URL(href).hostname.split(".").slice(-2).join(".");
  } catch {
    return null;
  }
}

/** The provider's own favicon, from its domain; the first letter when it has none or it fails to load. */
function CloudProviderMark({ domain, label }: { domain: string | null; label: string }) {
  const [failed, setFailed] = useState(false);
  if (!domain || failed) {
    return <span className="hs-cloud-mark hs-cloud-mark--letter" aria-hidden="true">{label.slice(0, 1)}</span>;
  }
  return (
    <span className="hs-cloud-mark" aria-hidden="true">
      <img
        src={`https://${domain}/favicon.ico`}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}

export function harnessLabel(id: string): string {
  return HARNESS_LABELS[id] ?? sharedHarnessLabel(id);
}

function formatLegacyQuotaLabel(label: string): string {
  switch (label) {
    case "weekly":
      return "7d";
    case "req/h":
      return "1h";
    default:
      return label || "quota";
  }
}

function quotaWindows(gauge: QuotaGauge): QuotaWindow[] {
  return gauge.windows && gauge.windows.length > 0
    ? gauge.windows
    : [{
        label: formatLegacyQuotaLabel(gauge.unitLabel),
        fill: gauge.fill,
        usedLabel: gauge.usedLabel,
        capLabel: gauge.capLabel,
        unitLabel: gauge.unitLabel,
        resetAt: gauge.resetAt,
      }];
}

/** Kimi's headline is the weekly allowance. Never pair it with a 5h reset. */
export function subscriptionSummaryWindows(gauge: QuotaGauge): QuotaWindow[] {
  const windows = quotaWindows(gauge);
  if (canonicalHarnessId(gauge.id) !== "kimi") return windows;
  return windows.filter((window) => window.windowMs !== undefined
    ? window.windowMs === 7 * 24 * 60 * 60_000
    : /^(7d|weekly|7 days?)$/iu.test(window.label.trim()));
}

function usageLabel(window: QuotaWindow): string {
  if (window.capLabel === "100%" && window.usedLabel.endsWith("%")) return window.usedLabel;
  return `${window.usedLabel}/${window.capLabel}`;
}

function gaugeTone(fill: number): "ok" | "warn" | "err" {
  if (fill >= 0.9) return "err";
  if (fill >= 0.75) return "warn";
  return "ok";
}

function formatResetRelative(resetAt: number): string {
  const rawDiffSec = Math.floor((resetAt - Date.now()) / 1000);
  const stale = rawDiffSec < 0;
  const diffSec = Math.abs(rawDiffSec);
  let label: string;
  if (diffSec >= 86400) {
    const days = Math.floor(diffSec / 86400);
    const hours = Math.floor((diffSec % 86400) / 3600);
    label = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  } else if (diffSec >= 3600) {
    const hours = Math.floor(diffSec / 3600);
    const minutes = Math.floor((diffSec % 3600) / 60);
    label = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  } else {
    label = `${Math.max(1, Math.floor(diffSec / 60))}m`;
  }
  return stale ? `stale ${label}` : label;
}

function budgetLatestAt(gauge: ServiceGauge | null): number | null {
  if (!gauge) return null;
  const direct = normalizeTimestampMs(gauge.capturedAt);
  if (gauge.kind !== "quota") return direct;
  const windows = subscriptionSummaryWindows(gauge);
  if (windows.length === 0) return null;
  const windowCapture = windows.reduce<number | null>((latest, window) => {
    const capturedAt = normalizeTimestampMs(window.capturedAt);
    return Math.max(latest ?? 0, capturedAt ?? 0) || latest;
  }, null);
  if (windowCapture) return windowCapture;
  if (direct && canonicalHarnessId(gauge.id) !== "kimi") return direct;
  return windows
    .flatMap((window) => window.history ?? [])
    .reduce<number | null>((latest, point) => {
      const capturedAt = normalizeTimestampMs(point.capturedAt);
      return Math.max(latest ?? 0, capturedAt ?? 0) || latest;
    }, null);
}

function DashboardCapture({
  provider,
  onImported,
}: {
  provider: "grok" | "cursor";
  onImported: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fieldId = `hs-${provider}-dashboard-capture`;
  const providerLabel = harnessLabel(provider);

  if (!open) {
    return (
      <button type="button" className="hs-dashboard-capture-trigger" onClick={() => setOpen(true)}>
        <ClipboardPaste size={12} aria-hidden="true" />
        Import dashboard
      </button>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await api<{ ok: true; gauge: ServiceGauge }>("/api/service-budgets/dashboard-import", {
        method: "POST",
        body: JSON.stringify({ provider, text }),
      });
      setText("");
      setMessage("Usage snapshot imported.");
      await onImported();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="hs-dashboard-capture" onSubmit={(event) => void submit(event)}>
      <label htmlFor={fieldId}>{providerLabel} usage snapshot</label>
      <p>
        {provider === "cursor"
          ? "Paste the exported Usage CSV or copied usage table."
          : "Copy the signed-in Usage panel and paste it here."}
        {" "}Scout keeps only normalized totals, not this text.
      </p>
      <textarea
        id={fieldId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={128 * 1024}
        rows={5}
        placeholder={provider === "cursor" ? "Date (UTC),Type,Model,Tokens,Cost…" : "Weekly SuperGrok… Limit · 12% used · Resets…"}
        aria-describedby={message ? `${fieldId}-message` : undefined}
      />
      {message ? <span id={`${fieldId}-message`} className="hs-dashboard-capture-message" role="status">{message}</span> : null}
      <div className="hs-dashboard-capture-actions">
        <button type="button" onClick={() => { setOpen(false); setMessage(null); }} disabled={submitting}>Cancel</button>
        <button type="submit" disabled={!text.trim() || submitting}>{submitting ? "Importing…" : "Use snapshot"}</button>
      </div>
    </form>
  );
}

export function buildHarnessRows(gauges: ServiceGauge[]): HarnessRow[] {
  const gaugesById = new Map(gauges.map((gauge) => [canonicalHarnessId(gauge.id), gauge]));
  return SUBSCRIPTION_PROVIDERS.map(({ id }) => ({
    id,
    label: harnessLabel(id),
    gauge: gaugesById.get(id) ?? null,
  }));
}

function SubscriptionQuotaWindow({ gauge, window }: { gauge: QuotaGauge; window: QuotaWindow }) {
  const unknown = quotaWindowRolledOver(window, new Date()) || !Number.isFinite(window.fill);
  const percentUsed = Math.max(0, Math.min(100, Math.round(window.fill * 100)));
  const percentRemaining = 100 - percentUsed;
  const tone = gaugeTone(window.fill);
  const resetDateTime = Number.isFinite(window.resetAt) ? new Date(window.resetAt).toISOString() : undefined;
  return (
    <div className="hs-subscription-window">
      <div className="hs-subscription-window-head">
        <div>
          <span className="hs-subscription-window-label">{window.label} window</span>
          <strong className={`hs-subscription-usage hs-subscription-usage--${tone}`}>
            {unknown ? "Awaiting a new reading" : `${percentUsed}% used`}
          </strong>
        </div>
        <div className="hs-subscription-remaining">
          <strong>{unknown ? "—" : `${percentRemaining}%`}</strong>
          <span>{unknown ? "usage unknown" : "available"}</span>
        </div>
      </div>
      {!unknown && <div
        className="hs-subscription-meter"
        role="progressbar"
        aria-label={`${gauge.label} ${window.label} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentUsed}
      >
        <span className={`hs-subscription-meter-fill hs-subscription-meter-fill--${tone}`} style={{ width: `${percentUsed}%` }} />
      </div>}
      <div className="hs-subscription-window-meta">
        <span>{unknown ? "Usage unknown" : `${usageLabel(window)} ${window.unitLabel === "quota" ? "quota" : window.unitLabel}`}</span>
        <span>
          {unknown ? "Waiting for provider usage" : `resets in ${formatResetRelative(window.resetAt)}`}
          {resetDateTime ? (
            <time dateTime={resetDateTime} title={formatAbsoluteTimestamp(window.resetAt) || undefined}>
              {` · ${formatAbsoluteTimestamp(window.resetAt) || ""}`}
            </time>
          ) : null}
        </span>
      </div>
    </div>
  );
}

/** Every window at a glance: label, a short meter, percent used. Details live in the expanded row. */
function UsageGlance({ gauge }: { gauge: QuotaGauge }) {
  const now = new Date();
  return (
    <span className="hs-glance">
      {subscriptionSummaryWindows(gauge).length === 0 ? <span>Weekly reading unavailable</span> : null}
      {subscriptionSummaryWindows(gauge).map((window) => {
        const unknown = quotaWindowRolledOver(window, now) || !Number.isFinite(window.fill);
        const used = Math.max(0, Math.min(100, Math.round(window.fill * 100)));
        const tone = gaugeTone(window.fill);
        return (
          <span
            key={window.label}
            className={`hs-glance-window hs-glance-window--${unknown ? "unknown" : tone}`}
            title={unknown ? `${window.label}: awaiting a new reading` : `${window.label}: ${used}% used`}
          >
            <span className="hs-glance-label">{window.label}</span>
            {unknown ? <span className="hs-glance-value">Awaiting reading</span> : (
              <>
                <span className="hs-glance-meter" aria-hidden="true"><span style={{ width: `${used}%` }} /></span>
                <span className="hs-glance-value">{used}%</span>
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

export function orchestrationMapInput(
  gauges: ServiceGauge[],
  generatedAt: number,
  now: number,
): ProviderUsageForMapping {
  const providers = gauges.flatMap((gauge) => {
    if (gauge.kind !== "quota") return [];
    const windows = quotaWindows(gauge).map((window) => {
      const capturedAt = normalizeTimestampMs(window.capturedAt ?? gauge.capturedAt);
      const usedPercent = Math.round(Math.max(0, Math.min(1, window.fill)) * 1_000) / 10;
      return {
        label: window.label,
        usedPercent,
        percentRemaining: Math.round((100 - usedPercent) * 10) / 10,
        windowMs: window.windowMs ?? null,
        resetAt: normalizeTimestampMs(window.resetAt),
        resetIn: Number.isFinite(window.resetAt) ? formatResetRelative(window.resetAt) : "",
        freshness: {
          ageMs: capturedAt ? Math.max(0, now - capturedAt) : null,
          label: capturedAt ? timeAgo(capturedAt) || "now" : "unknown",
        },
      };
    });
    return [{
      id: canonicalHarnessId(gauge.id),
      label: harnessLabel(canonicalHarnessId(gauge.id)),
      plan: gauge.plan ?? null,
      windows,
    }];
  });
  return { generatedAt, generatedAtLocal: formatAbsoluteTimestamp(generatedAt) || "now", providers };
}

function quotaNote(assignment: OrchestrationRuntimeAssignment): string {
  const quota = assignment.quota;
  if (assignment.quotaRisk) return `${quota.providerLabel} ${quota.availability}`;
  if (quota.confidence === "unknown") return "quota not visible";
  if (quota.minimumRemainingPercent !== null) return `${Math.round(quota.minimumRemainingPercent)}% left`;
  return quota.availability;
}

/**
 * Where each kind of work goes now: the first choice for the current quota,
 * then the next two. The roster and heuristics come from the core's routing
 * map, which follows the runtime catalog. Advisory; it dispatches nothing.
 */
export function TaskRouting() {
  const [inventory, setInventory] = useState<ScoutModelInventory | null>(null);
  const [inventoryFailed, setInventoryFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void api<ScoutModelInventory>("/api/model-inventory").then(value => {
      if (active) setInventory(value);
    }).catch(() => { if (active) setInventoryFailed(true); });
    return () => { active = false; };
  }, []);
  const { gauges, generatedAt, loading } = useServiceBudgets({ fresh: true });
  const map = useMemo(() => {
    const now = Date.now();
    return buildOrchestrationProviderMap(orchestrationMapInput(gauges, generatedAt, now), { now, taste: inventory?.taste, catalog: inventory?.catalog });
  }, [gauges, generatedAt, inventory]);
  return (
    <section className="hs-routing" aria-labelledby="hs-routing-title" aria-busy={loading}>
      <div className="hs-section-head">
        <div>
          <h3 id="hs-routing-title">By task</h3>
          <p>The suggested model for each kind of work, with current quota taken into account. Advisory only.</p>
        </div>
      </div>
      <p className="hs-defaults-status" role="status">
        {inventory ? `${inventory.source === "published" ? "Scout website" : inventory.source === "cached" ? "Cached Scout website" : "Included Scout inventory"} · reviewed ${inventory.taste.factsReviewedAt}` : inventoryFailed ? "Website inventory unavailable. Using included Scout preferences." : "Included Scout preferences · checking website…"}
        {" · "}<a href={SCOUT_MODEL_INVENTORY_URL} target="_blank" rel="noreferrer">Scout JSON</a>
      </p>
      <table className="hs-defaults-table hs-routing-table">
        <thead><tr><th scope="col">Task</th><th scope="col">Use</th><th scope="col">Then</th><th scope="col">Quota</th></tr></thead>
        <tbody>
          {map.assignments.map((assignment) => (
            <tr key={assignment.role}>
              <th scope="row" title={assignment.objective}>{assignment.roleLabel}</th>
              <td title={`${assignment.taskRationale}\n${orchestrationRuntimeRouteLabel(assignment.route)}`}>
                {assignment.modelLabel}
              </td>
              <td className="hs-routing-then">
                {assignment.alternatives.map((alternative) => alternative.label).join(", ") || "—"}
              </td>
              <td className={assignment.quotaRisk ? "hs-routing-risk" : undefined} title={assignment.quotaRiskMessage ?? undefined}>
                {loading && gauges.length === 0 ? "…" : quotaNote(assignment)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Reads the same runtime defaults as the new-session picker. No routing policy. */
export function ModelDefaults({ machineId }: { machineId?: string | null }) {
  const [catalog, setCatalog] = useState<RuntimeCapabilityCatalog | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setCatalog(null);
    setError(false);
    void api<RuntimeCapabilityCatalog>("/api/runner/options?scope=global").then((value) => {
      if (value.schemaVersion !== "openscout.runtime-capabilities.v1") throw new Error("Invalid runtime catalog");
      if (active) setCatalog(value);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [machineId, attempt]);
  const current = catalog ?? RUNTIME_CAPABILITY_SEED;
  const harnesses = [...current.harnesses].sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id));
  return (
    <section className="hs-defaults" aria-labelledby="hs-defaults-title">
      <div className="hs-section-head">
        <div>
          <h3 id="hs-defaults-title">Model defaults</h3>
          <p>Used for new sessions without a model override. Existing sessions keep their model.</p>
        </div>
      </div>
      <div className="hs-defaults-status" role="status">
        {error ? "Couldn’t read runtime defaults. Showing the included catalog." : catalog ? "Runtime catalog" : "Included catalog · reading runtime defaults…"}
        {error && <button type="button" className="hs-refresh" onClick={() => setAttempt((value) => value + 1)}>Retry</button>}
      </div>
      <table className="hs-defaults-table">
        <thead><tr><th scope="col">Harness</th><th scope="col">Default model</th><th scope="col">Effort</th></tr></thead>
        <tbody>
          {harnesses.map((harness) => {
            const defaults = current.defaultsByHarness?.[harness.id];
            const model = current.models.find((entry) => entry.id === defaults?.model && entry.harnesses.includes(harness.id));
            return (
              <tr key={harness.id}>
                <th scope="row">{harness.label ?? harness.id}</th>
                <td>{model?.label ?? defaults?.model ?? "Chosen by harness"}</td>
                <td>{defaults?.reasoningEffort ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

/** `only` narrows the list to one provider (a Subscriptions panel scoped to it). */
export function SubscriptionSection({ rows, loading, onImported, only, hidden = [] }: {
  rows: HarnessRow[];
  loading: boolean;
  onImported: () => Promise<void>;
  only?: string;
  /** Legacy host defaults; browser display choices take precedence. */
  hidden?: readonly string[];
}) {
  // Visibility is personal display chrome, so paired watch-only browsers can
  // change it too. Host preferences remain defaults until explicitly overridden.
  const [rawVisibility, saveVisibility] = usePersistentString(
    `scout:providers:visibility:v1:${hostFleet.focused().id}`, "{}",
  );
  const visibility = useMemo<Record<string, boolean>>(() => {
    try {
      const parsed: unknown = JSON.parse(rawVisibility);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const record = parsed as Record<string, unknown>;
      return Object.fromEntries(SUBSCRIPTION_PROVIDERS.flatMap(({ id }) =>
        typeof record[id] === "boolean" ? [[id, record[id]]] : []));
    } catch { return {}; }
  }, [rawVisibility]);
  const section = useRef<HTMLElement>(null);
  const focusAfterChange = useRef<{ provider: string; hidden: boolean } | null>(null);
  useEffect(() => {
    const target = focusAfterChange.current;
    if (!target) return;
    focusAfterChange.current = null;
    section.current?.querySelector<HTMLElement>(
      `[data-provider-${target.hidden ? "show" : "summary"}="${target.provider}"]`,
    )?.focus();
  }, [rawVisibility]);
  const setHidden = (provider: string, nextHidden: boolean) => {
    focusAfterChange.current = { provider, hidden: nextHidden };
    saveVisibility(JSON.stringify({ ...visibility, [provider]: nextHidden }));
  };
  const isHidden = (provider: string) => visibility[provider] ?? hidden.includes(provider);
  const inScope = SUBSCRIPTION_PROVIDERS.filter((provider) => !only || provider.id === only);
  const hiddenProviders = inScope.filter((provider) => isHidden(provider.id));
  const subscriptions = inScope.filter((provider) => !isHidden(provider.id)).map((provider) => ({
    provider,
    row: rows.find((row) => row.id === provider.id) ?? null,
  }));
  subscriptions.sort((a, b) => Number(Boolean(b.row?.gauge)) - Number(Boolean(a.row?.gauge))
    || harnessLabel(a.provider.id).localeCompare(harnessLabel(b.provider.id)));

  return (
    <section ref={section} className="hs-subscriptions" aria-labelledby="hs-subscriptions-title" aria-busy={loading}>
      <div className="hs-section-head hs-subscriptions-head">
        <div>
          <h3 id="hs-subscriptions-title">Subscriptions</h3>
          <p>Usage and reset times. Hide providers you don’t use; show them again below.</p>
        </div>
      </div>

      {subscriptions.length > 0 ? <div className="hs-subscription-columns" aria-hidden="true">
        <span>Provider</span><span>Usage</span><span>Next reset</span><span>Updated</span>
      </div> : <p className="hs-subscription-description">All providers are hidden. Show a provider below.</p>}
      <div className="hs-subscription-list">
        {subscriptions.map(({ provider, row }) => {
          const gauge = row?.gauge ?? null;
          const pending = loading && !gauge;
          const plan = gauge?.kind === "quota" ? gauge.plan : null;
          const latestAt = budgetLatestAt(gauge);
          const windows = gauge?.kind === "quota" ? subscriptionSummaryWindows(gauge) : [];
          const nextReset = windows.filter((window) => Number.isFinite(window.resetAt) && window.resetAt > Date.now())
            .sort((a, b) => a.resetAt - b.resetAt)[0]?.resetAt;
          const usage = pending ? "Checking…" : gauge?.kind === "quota" ? <UsageGlance gauge={gauge} />
            : gauge?.kind === "status" ? [gauge.statusLabel, gauge.balanceLabel].filter(Boolean).join(" · ") : "Not detected";
          return (
            <details key={provider.id} className="hs-subscription-row">
              <summary data-provider-summary={provider.id}>
                <span className="hs-subscription-provider">
                  <HarnessMark harness={provider.id} size={16} title={null} className="hs-subscription-mark" />
                  <span><strong>{harnessLabel(provider.id)}</strong>{plan ? <small>{plan}</small> : null}</span>
                </span>
                <span>{usage}</span>
                <span className="hs-subscription-reset"><span className="hs-row-label">Next reset: </span>{nextReset ? formatResetRelative(nextReset) : "—"}</span>
                <span className="hs-subscription-updated"><span className="hs-row-label">Updated: </span>{latestAt ? timeAgo(latestAt) || "now" : "—"}</span>
              </summary>
              <div className="hs-subscription-details">
                <p className="hs-subscription-description">{provider.description}</p>

                {pending ? (
                  <p className="hs-subscription-description">Reading usage…</p>
                ) : gauge?.kind === "quota" ? (
                  <div className="hs-subscription-windows">
                    {quotaWindows(gauge).map((window) => (
                      <SubscriptionQuotaWindow key={`${provider.id}:${window.label}`} gauge={gauge} window={window} />
                    ))}
                  </div>
                ) : gauge?.kind === "status" ? (
                  <div className="hs-subscription-status-detail">
                    <strong>{gauge.statusLabel}</strong>
                    <span>{gauge.detailLabel || "Subscription detected locally. Open the provider dashboard for live usage."}</span>
                  </div>
                ) : (
                  <div className="hs-subscription-missing">
                    <strong>{hidden.includes(provider.id) ? "Usage collection is disabled on the host" : "No local subscription feed yet"}</strong>
                    <span>{hidden.includes(provider.id) ? "Showing this provider leaves the host’s usage settings unchanged." : "Open the provider locally, then refresh Scout."}</span>
                  </div>
                )}

                {provider.id === "cursor" || (provider.id === "grok" && gauge?.kind !== "quota") ? (
                  <DashboardCapture provider={provider.id} onImported={onImported} />
                ) : null}

                <footer className="hs-subscription-footer">
                  <span>
                    {pending ? "checking local feed" : latestAt ? `updated ${timeAgo(latestAt) || "now"}` : gauge ? "detected locally" : "waiting for provider data"}
                    {gauge?.source ? ` · ${gauge.source}` : ""}
                  </span>
                  <nav aria-label={`${harnessLabel(provider.id)} quick links`}>
                    {provider.links.map((link) => (
                      <a key={link.href} href={link.href} target="_blank" rel="noreferrer">
                        {link.label}
                        <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    ))}
                    <button
                      type="button"
                      className="hs-subscription-hide"
                      aria-label={`Hide ${harnessLabel(provider.id)}`}
                      onClick={() => setHidden(provider.id, true)}
                      title={`Hide ${harnessLabel(provider.id)} in this browser. You can show it again below.`}
                    >
                      Hide
                    </button>
                  </nav>
                </footer>
              </div>
            </details>
          );
        })}
      </div>

      {hiddenProviders.length > 0 ? (
        <div className="hs-subscription-hidden" role="group" aria-label="Hidden providers">
          <span>Hidden providers</span>
          {hiddenProviders.map((provider) => (
            <button
              key={provider.id}
              type="button"
              data-provider-show={provider.id}
              onClick={() => setHidden(provider.id, false)}
              title={`Show ${harnessLabel(provider.id)} again`}
            >
              <HarnessMark harness={provider.id} size={12} title={null} />
              Show {harnessLabel(provider.id)}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function sortAccounts(accounts: CloudAccount[]): CloudAccount[] {
  const rank = (account: CloudAccount) => ACCOUNT_KIND_ORDER.indexOf(account.kind ?? "hosting");
  return [...accounts].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
}

/** One line per account or integration: mark, name, what it is, status, and its dashboard. */
export function CloudAccountsSection({ accounts, loading }: { accounts: CloudAccount[]; loading: boolean }) {
  if (accounts.length === 0 && !loading) return null;
  return (
    <section className="hs-cloud-accounts" aria-labelledby="hs-cloud-accounts-title" aria-busy={loading}>
      <div className="hs-section-head hs-cloud-accounts-head">
        <div>
          <h3 id="hs-cloud-accounts-title">Accounts and integrations</h3>
          <p>Model access, hosting, compute, code and chat accounts found on this host.</p>
        </div>
        <span className="hs-section-meta">{loading ? "checking" : `${accounts.length} found`}</span>
      </div>
      <ul className="hs-cloud-list">
        {loading && accounts.length === 0 ? <li className="hs-subscription-description">Reading accounts…</li> : null}
        {sortAccounts(accounts).map((account) => {
          const provider = accountProvider(account);
          const href = account.href ?? ACCOUNT_DASHBOARDS[provider];
          return (
            <li key={account.id} className="hs-cloud-row" title={[account.detailLabel, account.balanceSource, account.checkedAt ? `Checked ${formatAbsoluteTimestamp(account.checkedAt)}` : null].filter(Boolean).join(" · ")}>
              <CloudProviderMark domain={accountDomain(provider, href)} label={account.label} />
              <span className="hs-cloud-name">{account.label}</span>
              <span className="hs-cloud-kind">{account.kind ? ACCOUNT_KIND_LABELS[account.kind] : account.detailLabel}</span>
              <span className="hs-cloud-status">{account.balanceLabel ? `${account.statusLabel} · ${account.balanceLabel}` : account.statusLabel}</span>
              {href ? (
                <a className="hs-cloud-open" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${account.label}`}>
                  <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M6 3h7v7M13 3 5 11" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </a>
              ) : <span />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function HarnessesScreen({ navigate }: { navigate: (r: Route) => void }) {
  const { route } = useScout();
  const machineId = routeMachineId(route);
  // The shared Providers loop (service-budgets-loop.ts): warm from a read
  // under 30s old, a read now, a forced ?refresh=1 600ms later, then every 30s.
  const { gauges: serviceGauges, cloudAccounts, hiddenProviders, loading, refreshing, error, load } = useServiceBudgets({ fresh: true });
  const rows = useMemo(() => buildHarnessRows(serviceGauges), [serviceGauges]);

  const contentOwnsSecondaryNav = useContentOwnsSecondaryNav();

  return (
    <div className="s-ops">
      {contentOwnsSecondaryNav ? (
        <div className="s-ops-header">
          <OpsSubnav activeRoute={{ view: "harnesses", ...(machineId ? { machineId } : {}) }} navigate={navigate} />
        </div>
      ) : null}
      <div className="s-ops-body hs-body">
        <div className="hs-page">
          <header className="hs-page-head">
            <div className="hs-title-group">
              <span className="hs-kicker">ops / provider central</span>
              <h2>{getDestination("providers").label}</h2>
              <p>
                Plans, usage, and model defaults.
              </p>
            </div>
            <div className="hs-page-actions">
              <button
                type="button"
                className="hs-refresh"
                disabled={refreshing}
                onClick={() => void load(true)}
              >
                <RefreshCw size={14} className={refreshing ? "hs-refresh-icon-spinning" : ""} aria-hidden="true" />
                <span>{refreshing ? "Refreshing" : "Refresh"}</span>
              </button>
            </div>
          </header>

          {error && <div className="hs-error" role="status" aria-live="polite">refresh: {error}</div>}
          <div className="hs-provider-view">
            <ProviderDiscovery onRefresh={() => load(true)} refreshing={refreshing} refreshError={error} />
            <SubscriptionSection rows={rows} loading={loading} onImported={() => load(false)} hidden={hiddenProviders} />
            <CloudAccountsSection accounts={cloudAccounts} loading={loading} />
            <TaskRouting />
            <ModelDefaults machineId={machineId} />
          </div>
        </div>
      </div>
    </div>
  );
}
