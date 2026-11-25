import "./host-advisor.css";

import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  Compass,
  Cpu,
  Database,
  FileText,
  FolderGit2,
  Gauge,
  LayoutGrid,
  RefreshCw,
} from "lucide-react";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { timeAgo } from "../../lib/time.ts";
import type { Agent, Route } from "../../lib/types.ts";
import {
  asciiGaugeBar,
  gaugeFill,
  isNearCeiling,
  isUnusedGauge,
} from "./host-advisor-gauges.ts";
import { refreshHostAdvisor, useHostAdvisorData } from "./host-advisor-data.ts";
import {
  extractProjectName,
  formatDuration,
  formatProcessCommand,
  INQUIRY_READINGS,
  platformLine,
  readHostAdvisor,
  UNATTENDED_KIND_LABEL,
  type AdvisorReadingKey,
  type HostAdvisorData,
  type HostAdvisorModel,
  type ServiceQuotaGauge,
} from "./host-advisor-model.ts";

export type {
  BuildInfo,
  HostInfo,
  KnowledgeStatus,
  ServiceQuotaGauge,
  TerminalSessionSummary,
} from "./host-advisor-model.ts";

type AdvisorDisplayMode = "inquiry" | "matrix";

function BudgetGaugeRow({ gauge }: { gauge: ServiceQuotaGauge }) {
  const fill = gaugeFill(gauge);
  const near = isNearCeiling(gauge);
  const unused = isUnusedGauge(gauge);
  const bar = asciiGaugeBar(fill ?? 0);
  const measured = fill !== null;
  const tone = near ? "warn" : unused || !measured ? "unused" : "ok";
  const note = unused
    ? "UNUSED"
    : gauge.resetAt
      ? `RESET ${timeAgo(gauge.resetAt)}`
      : gauge.statusLabel || gauge.usedLabel || "";

  return (
    <div className={`s-host-rack-row ${near ? "s-host-rack-row--warn" : ""} ${unused || !measured ? "s-host-rack-row--unused" : ""}`}>
      <span className="s-host-rack-name font-mono">{gauge.label}</span>
      <span
        className={`s-host-gauge s-host-gauge--${tone}`}
        role="meter"
        aria-label={measured ? `${gauge.label} ${bar.percent} percent` : `${gauge.label} ${gauge.statusLabel || "no quota"}`}
        aria-valuemin={measured ? 0 : undefined}
        aria-valuemax={measured ? 100 : undefined}
        aria-valuenow={measured ? bar.percent : undefined}
      >
        <span className="s-host-gauge-chrome" aria-hidden="true">[</span><span className="s-host-gauge-fill" aria-hidden="true">{bar.filled}</span><span className="s-host-gauge-rest" aria-hidden="true">{bar.rest}</span><span className="s-host-gauge-chrome" aria-hidden="true">]</span>
      </span>
      <span className={`s-host-rack-right font-mono ${near ? "s-host-rack-age--warn" : ""} ${unused || !measured ? "s-host-rack-dim" : ""}`}>
        {measured ? `${bar.percent}%` : "—"}
      </span>
      <span className="s-host-rack-right s-host-rack-dim font-mono s-host-rack-truncate">{note}</span>
    </div>
  );
}

/**
 * The advisor's data and readings: one shared read (host-advisor-data.ts) for
 * the page and every advisor panel, derived for the roster passed in.
 */
export function useHostAdvisor(agents: readonly Agent[]) {
  const { data, loading, refreshing } = useHostAdvisorData();
  const model = useMemo(() => readHostAdvisor(data, agents, Date.now()), [data, agents]);
  return { data, model, loading, refreshing, refresh: refreshHostAdvisor };
}

type AdvisorPartProps = { data: HostAdvisorData; model: HostAdvisorModel };

/** NODE / platform / git: the line over the page's title, and over the readouts in a panel. */
export function HostAdvisorStatusLine({ data }: { data: HostAdvisorData }) {
  const { hostInfo, buildInfo } = data;
  const platformStr = platformLine(buildInfo);
  return (
    <div className="s-host-header-status-line">
      <span className="dot dot--sm dot--working dot--pulse" aria-hidden="true" />
      <span className="label-xs s-host-mono-dim">NODE: {hostInfo?.nodeId || "local"}</span>
      <span className="s-host-header-divider">/</span>
      <span className="label-xs s-host-mono-dim">{platformStr}</span>
      {buildInfo?.gitHash && (
        <>
          <span className="s-host-header-divider">/</span>
          <span className="label-xs s-host-mono-dim">git:{buildInfo.gitHash.slice(0, 7)}</span>
        </>
      )}
    </div>
  );
}

/** Readouts — noun, figure, qualifier: agents, roots, peak budget, unattended, mesh peers. */
export function HostAdvisorReadouts({ agents, data, model }: AdvisorPartProps & { agents: readonly Agent[] }) {
  const { hostInfo, pairingState } = data;
  const { processes, groups: worktreeGroups, attention: attentionReading, peak: peakQuota, unattended: droppedThreads, unattendedReading } = model;
  return (
    <section className="s-host-readouts" aria-label="Host Readouts">
      <div className="s-host-readout">
        <span className="label-xs s-host-readout-label">Agents</span>
        <span className="s-host-readout-figure">{agents.length}</span>
        <span className="label-xs s-host-readout-qual">
          {processes.length} PROCESS{processes.length === 1 ? "" : "ES"}
        </span>
      </div>

      <div className="s-host-readout">
        <span className="label-xs s-host-readout-label">Roots</span>
        <span className="s-host-readout-figure">{worktreeGroups.length}</span>
        <span className="label-xs s-host-readout-qual">
          {attentionReading ? `TOP SHARE ${attentionReading.topPercent}%` : "NONE ACTIVE"}
        </span>
      </div>

      <div className={`s-host-readout ${peakQuota && isNearCeiling(peakQuota) ? "s-host-readout--warn" : ""}`}>
        <span className="label-xs s-host-readout-label">Peak budget</span>
        <span className="s-host-readout-figure">
          {peakQuota ? `${Math.round((peakQuota.fill ?? 0) * 100)}%` : "—"}
        </span>
        <span className="label-xs s-host-readout-qual">
          {peakQuota
            ? `${peakQuota.label}${peakQuota.resetAt ? ` · RESET ${timeAgo(peakQuota.resetAt)}` : ""}`
            : "NO PROVIDERS CONFIGURED"}
        </span>
      </div>

      <div className={`s-host-readout ${droppedThreads.length > 0 ? "s-host-readout--flag" : ""}`}>
        <span className="label-xs s-host-readout-label">Unattended</span>
        <span className="s-host-readout-figure">{droppedThreads.length}</span>
        <span className="label-xs s-host-readout-qual">
          {unattendedReading.oldestLabel ? `OLDEST ${unattendedReading.oldestLabel}` : "NONE OPEN"}
        </span>
      </div>

      <div className="s-host-readout">
        <span className="label-xs s-host-readout-label">Mesh peers</span>
        <span className="s-host-readout-figure">{pairingState?.trustedPeerCount ?? 0}</span>
        <span className="label-xs s-host-readout-qual">
          SCOPE {(hostInfo?.advertiseScope || "mesh").toUpperCase()}
        </span>
      </div>
    </section>
  );
}

/**
 * One reading: 01 Attention, 02 Unattended, 03 Budgets, 04 Subsystems, or the
 * harness process table the page's Matrix mode drew (`processLimit` caps its rows).
 */
export function HostAdvisorReading({
  reading,
  data,
  model,
  navigate,
  processLimit,
}: AdvisorPartProps & { reading: AdvisorReadingKey; navigate: (r: Route) => void; processLimit?: number }) {
  const { quotas } = data;
  const {
    processes,
    breakdown: attentionBreakdown,
    attention: attentionReading,
    unattended: droppedThreads,
    unattendedReading,
    budget: budgetReading,
    subsystems,
    subsystemSummary,
  } = model;

  if (reading === "attention") {
    return (
      <article className="s-host-reading">
        <div className="s-host-reading-head">
          <span className="label-xs s-host-reading-num">01 // ATTENTION</span>
          <span className="s-host-reading-verdict">
            {attentionReading?.verdict ?? "No active roots"}
          </span>
          <span className="s-host-reading-figures">
            {attentionReading ? (
              <>
                top {attentionReading.topPercent}%
                <span className="s-host-sep">·</span>
                tail {attentionReading.tailPercent}%
                <span className="s-host-sep">·</span>
                {attentionReading.aboveTen} root{attentionReading.aboveTen === 1 ? "" : "s"} above 10%
              </>
            ) : (
              <>no agents or processes bound to a workspace</>
            )}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => navigate({ view: "repos" })}>
            <span>Repos</span>
            <ArrowUpRight size={10} />
          </button>
        </div>

        {attentionBreakdown.ranked.length > 0 && (
          <>
            <div className="s-host-share-bar">
              {attentionBreakdown.topProjects.map((project, index) => (
                <div
                  key={project.root}
                  className={`s-host-share-seg s-host-share-seg--${Math.min(index, 4)}`}
                  style={{ width: `${project.percent}%` }}
                  title={`${project.name} ${project.percent}%`}
                >
                  <span className="s-host-share-seg-label font-mono text-2xs">
                    {project.name} {project.percent}%
                  </span>
                </div>
              ))}
              {attentionReading && attentionReading.tailCount > 0 && (
                <div className="s-host-share-seg s-host-share-seg--tail" style={{ flex: 1 }}>
                  <span className="s-host-share-seg-label font-mono text-2xs">
                    {attentionReading.tailCount} OTHER ROOTS — {attentionReading.tailPercent}%
                  </span>
                </div>
              )}
            </div>

            <div className="s-host-rack s-host-rack--roots">
              <div className="s-host-rack-row s-host-rack-row--head">
                <span className="label-xs">Root</span>
                <span className="label-xs">Share</span>
                <span className="label-xs s-host-rack-right">%</span>
                <span className="label-xs s-host-rack-right">Agents</span>
                <span className="label-xs s-host-rack-right">Procs</span>
                <span className="label-xs s-host-rack-right">Branch</span>
              </div>

              {attentionBreakdown.topProjects.map((project) => (
                <div key={project.root} className="s-host-rack-row">
                  <span className="s-host-rack-name font-mono">{project.name}</span>
                  <span className="s-host-rack-track">
                    <span
                      className="s-host-rack-fill"
                      style={{
                        width: `${attentionReading && attentionReading.topPercent > 0
                          ? Math.round((project.percent / attentionReading.topPercent) * 100)
                          : 0}%`,
                      }}
                    />
                  </span>
                  <span className="s-host-rack-right font-mono">{project.percent}%</span>
                  <span className="s-host-rack-right s-host-rack-dim font-mono">{project.agents.length}</span>
                  <span className="s-host-rack-right s-host-rack-dim font-mono">{project.processes.length}</span>
                  <span className="s-host-rack-right s-host-rack-dim font-mono s-host-rack-truncate">
                    {project.primaryBranch}
                  </span>
                </div>
              ))}

              {attentionReading && attentionReading.tailCount > 0 && (
                <div className="s-host-rack-row s-host-rack-row--tail">
                  <span className="s-host-rack-name font-mono">tail — {attentionReading.tailCount} roots</span>
                  <span className="s-host-rack-track s-host-rack-track--hatch" />
                  <span className="s-host-rack-right font-mono">{attentionReading.tailPercent}%</span>
                  <span className="s-host-rack-right s-host-rack-dim font-mono">{attentionReading.tailAgents}</span>
                  <span className="s-host-rack-right s-host-rack-dim font-mono">{attentionReading.tailProcesses}</span>
                  <span className="s-host-rack-right s-host-rack-dim font-mono">each below {attentionBreakdown.topProjects.at(-1)?.percent ?? 0}%</span>
                </div>
              )}
            </div>
          </>
        )}
      </article>
    );
  }

  if (reading === "unattended") {
    return (
      <article className="s-host-reading">
        <div className="s-host-reading-head">
          <span className="label-xs s-host-reading-num">02 // UNATTENDED</span>
          <span className="s-host-reading-verdict">{unattendedReading.verdict}</span>
          <span className="s-host-reading-figures">
            {droppedThreads.length > 0 ? (
              <>
                {unattendedReading.oldestLabel && (
                  <>
                    oldest {unattendedReading.oldestLabel}
                    <span className="s-host-sep">·</span>
                  </>
                )}
                {Object.entries(unattendedReading.byKind)
                  .map(([kind, count]) => `${count} ${UNATTENDED_KIND_LABEL[kind] ?? kind}`)
                  .join(" · ")}
                <span className="s-host-sep">·</span>
                of {processes.length} processes
              </>
            ) : (
              <>no idle relays, diverged branches or stale conversations</>
            )}
          </span>
        </div>

        {droppedThreads.length > 0 && (
          <div className="s-host-rack s-host-rack--unattended">
            <div className="s-host-rack-row s-host-rack-row--head">
              <span className="label-xs" />
              <span className="label-xs">Signal</span>
              <span className="label-xs">Root</span>
              <span className="label-xs s-host-rack-right">Ref</span>
              <span className="label-xs s-host-rack-right">Age</span>
              <span className="label-xs s-host-rack-right">Action</span>
            </div>

            {droppedThreads.map((item) => (
              <div key={item.id} className="s-host-rack-row">
                <span
                  className={`dot dot--sm ${item.severity === "warn" ? "dot--warning" : "dot--neutral"}`}
                  aria-hidden="true"
                />
                <span className="s-host-rack-name font-mono s-host-rack-truncate">{item.title}</span>
                <span className="s-host-rack-dim font-mono s-host-rack-truncate">
                  {item.projectRoot ? extractProjectName(item.projectRoot) : "—"}
                </span>
                <span className="s-host-rack-right s-host-rack-dim font-mono">
                  {item.pid ? `pid ${item.pid}` : UNATTENDED_KIND_LABEL[item.kind] ?? item.kind}
                </span>
                <span
                  className={`s-host-rack-right font-mono s-host-rack-age ${item.severity === "warn" ? "s-host-rack-age--warn" : ""}`}
                >
                  {item.ageSeconds ? formatDuration(item.ageSeconds) : item.ageLabel}
                </span>
                <span className="s-host-rack-right s-host-rack-actions">
                  {item.actionRoute && (
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => item.actionRoute && navigate(item.actionRoute)}
                    >
                      {item.actionLabel}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </article>
    );
  }

  if (reading === "budgets") {
    return (
      <article className="s-host-reading">
        <div className="s-host-reading-head">
          <span className="label-xs s-host-reading-num">03 // BUDGETS</span>
          <span className="s-host-reading-verdict">{budgetReading.verdict}</span>
          <span className="s-host-reading-figures">{budgetReading.figures}</span>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => navigate({ view: "harnesses" })}
          >
            <span>Providers</span>
            <ArrowUpRight size={10} />
          </button>
        </div>

        {budgetReading.showGauges && quotas && (
          <div className="s-host-rack s-host-rack--budgets">
            <div className="s-host-rack-row s-host-rack-row--head">
              <span className="label-xs">Provider</span>
              <span className="label-xs">Gauge</span>
              <span className="label-xs s-host-rack-right">%</span>
              <span className="label-xs s-host-rack-right">Note</span>
            </div>

            {quotas.map((gauge) => (
              <BudgetGaugeRow key={gauge.id} gauge={gauge} />
            ))}
          </div>
        )}
      </article>
    );
  }

  if (reading === "subsystems") {
    return (
      <article className="s-host-reading">
        <div className="s-host-reading-head">
          <span className="label-xs s-host-reading-num">04 // SUBSYSTEMS</span>
          <span className="s-host-reading-verdict">{subsystemSummary.verdict}</span>
          <span className="s-host-reading-figures">{subsystemSummary.figures}</span>
        </div>

        <div className="s-host-rack s-host-rack--subsystems">
          <div className="s-host-rack-row s-host-rack-row--head">
            <span className="label-xs" />
            <span className="label-xs">Subsystem</span>
            <span className="label-xs">Detail</span>
            <span className="label-xs s-host-rack-right">State</span>
          </div>

          {subsystems.map((item) => (
            <div key={item.key} className="s-host-rack-row">
              <span className={`dot dot--sm s-host-dot--${item.tone}`} aria-hidden="true" />
              <span className="s-host-rack-name font-mono">{item.label}</span>
              <span className="s-host-rack-dim font-mono s-host-rack-truncate">{item.detail}</span>
              <span className="s-host-rack-right s-host-rack-actions">
                {item.action && (
                  <button
                    type="button"
                    className="btn btn--sm s-host-btn-accent"
                    onClick={() => item.action && navigate(item.action.route)}
                  >
                    {item.action.label}
                  </button>
                )}
                <span className={`chip chip--sm chip--mono s-host-state s-host-state--${item.tone}`}>
                  {item.state}
                </span>
              </span>
            </div>
          ))}
        </div>
      </article>
    );
  }

  const displayedProcesses = processLimit == null ? processes : processes.slice(0, processLimit);
  return (
    <section className="s-host-block" aria-label="Active Processes">
      <div className="s-host-block-head">
        <span className="label-xs">ACTIVE HARNESS PROCESSES ({processes.length})</span>
      </div>
      <div className="s-host-table-box">
        <div className="s-host-table">
          {displayedProcesses.map((proc) => (
            <div key={proc.pid} className="s-host-table-row">
              <div className="s-host-table-cell-main">
                <span className="dot dot--sm dot--working dot--pulse" aria-hidden="true" />
                <HarnessMark harness={proc.harness} size={13} />
                <span className="font-semibold text-xs font-mono">
                  {formatProcessCommand(proc.command, proc.harness)}
                </span>
                <span className="chip chip--sm chip--ghost chip--mono">PID {proc.pid}</span>
                {proc.etime && <span className="chip chip--sm chip--ghost chip--mono">{proc.etime}</span>}
              </div>
              <div className="s-host-table-cell-action">
                <button
                  type="button"
                  className="btn btn--sm"
                  onClick={() => navigate({ view: "ops", mode: "mission" })}
                >
                  <span>Tail</span>
                  <ArrowUpRight size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The page's Matrix mode: four stat boxes over the harness process table (first five). */
function HostAdvisorMatrix({ agents, data, model, navigate }: AdvisorPartProps & { agents: readonly Agent[]; navigate: (r: Route) => void }) {
  const { terminalSessions } = data;
  const { processes, groups: worktreeGroups, peak: peakQuota } = model;
  return (
    <div className="s-host-matrix-container">
      <section className="s-host-telemetry-grid" aria-label="Host Telemetry Overview">
        <div className="s-host-stat-box">
          <div className="s-host-stat-head">
            <span className="label-xs s-host-stat-label">Registered agents</span>
            <Cpu size={13} className="s-host-stat-icon" />
          </div>
          <div className="s-host-stat-body">
            <span className="s-host-stat-big">{agents.length}</span>
            <span className="s-host-stat-kicker">{processes.length} background processes</span>
          </div>
        </div>

        <div className="s-host-stat-box">
          <div className="s-host-stat-head">
            <span className="label-xs s-host-stat-label">Service quota radar</span>
            <Gauge size={13} className="s-host-stat-icon" />
          </div>
          <div className="s-host-stat-body">
            <span className="s-host-stat-big">
              {peakQuota ? `${Math.round((peakQuota.fill ?? 0) * 100)}%` : "Nominal"}
            </span>
            <span className="s-host-stat-kicker">peak token consumption</span>
          </div>
        </div>

        <div className="s-host-stat-box">
          <div className="s-host-stat-head">
            <span className="label-xs s-host-stat-label">Workspaces & repos</span>
            <FolderGit2 size={13} className="s-host-stat-icon" />
          </div>
          <div className="s-host-stat-body">
            <span className="s-host-stat-big">{worktreeGroups.length}</span>
            <span className="s-host-stat-kicker">registered project roots</span>
          </div>
        </div>

        <div className="s-host-stat-box">
          <div className="s-host-stat-head">
            <span className="label-xs s-host-stat-label">Subsystem relays</span>
            <Database size={13} className="s-host-stat-icon" />
          </div>
          <div className="s-host-stat-body">
            <span className="s-host-stat-big">{terminalSessions.length}</span>
            <span className="s-host-stat-kicker">live terminal relays</span>
          </div>
        </div>
      </section>

      <HostAdvisorReading reading="processes" data={data} model={model} navigate={navigate} processLimit={5} />
    </div>
  );
}

export function HostAdvisorView({
  navigate,
  agents,
}: {
  navigate: (r: Route) => void;
  agents: Agent[];
}) {
  const { data, model, refreshing, refresh } = useHostAdvisor(agents);
  const [displayMode, setDisplayMode] = useState<AdvisorDisplayMode>("inquiry");

  return (
    <div className="s-host-view">
      {/* ── 1. Host Masthead & Mode Switcher ─────────────────────────── */}
      <header className="s-host-header">
        <div className="s-host-header-left">
          <HostAdvisorStatusLine data={data} />
          <h1 className="s-host-title">
            <Compass size={22} className="s-host-title-icon" />
            <span>Host Advisor</span>
          </h1>
        </div>

        <div className="s-host-header-right">
          <div className="s-host-mode-toggle" role="group" aria-label="Advisor Format">
            <button
              type="button"
              className={`s-host-mode-btn ${displayMode === "inquiry" ? "s-host-mode-btn--active" : ""}`}
              onClick={() => setDisplayMode("inquiry")}
              title="Formatted Executive Inquiries & Operator Answers"
            >
              <FileText size={12} />
              <span>Inquiries</span>
            </button>
            <button
              type="button"
              className={`s-host-mode-btn ${displayMode === "matrix" ? "s-host-mode-btn--active" : ""}`}
              onClick={() => setDisplayMode("matrix")}
              title="Compact Infrastructure Matrix"
            >
              <LayoutGrid size={12} />
              <span>Matrix</span>
            </button>
          </div>

          <button
            type="button"
            className={`btn btn--sm ${refreshing ? "btn--accent" : ""}`}
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={12} className={refreshing ? "s-spin" : ""} />
            <span>{refreshing ? "Scanning..." : "Refresh"}</span>
          </button>
        </div>
      </header>

      {/* ── 2. Readouts: noun, figure, qualifier ─────────────────────── */}
      <HostAdvisorReadouts agents={agents} data={data} model={model} />

      {/* ── MODE A: Readings ─────────────────────────────────────────── */}
      {displayMode === "inquiry" ? (
        <div className="s-host-readings" aria-label="Host Readings">
          {INQUIRY_READINGS.map((reading) => (
            <HostAdvisorReading key={reading} reading={reading} data={data} model={model} navigate={navigate} />
          ))}
        </div>
      ) : (
        /* ── MODE B: Compact Subsystem Matrix ────────────────────────── */
        <HostAdvisorMatrix agents={agents} data={data} model={model} navigate={navigate} />
      )}
    </div>
  );
}
