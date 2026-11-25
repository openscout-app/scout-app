/**
 * Host Advisor's readings without React: the page and the advisor panels
 * (views/modules/host-*.tsx) draw from the same fetched data through these.
 * Every verdict is computed from what was read; where a source is empty the
 * reading says it is empty, never a literal figure.
 */
import { timeAgo } from "../../lib/time.ts";
import type { Agent, PairingState, Route, SessionEntry, TailDiscoverySnapshot } from "../../lib/types.ts";
import { readBudgetSection, type BudgetSectionReading } from "./host-advisor-gauges.ts";

export type HostInfo = {
  nodeId?: string;
  meshId?: string;
  nodeName?: string;
  hostName?: string;
  advertiseScope?: string;
  brokerUrl?: string;
  webUrl?: string;
  brokerSocketPath?: string;
  supportDirectory?: string;
  runtimeDirectory?: string;
  ports?: {
    broker?: number;
    web?: number;
  };
  services?: {
    broker?: { url?: string; host?: string; port?: number; socketPath?: string };
    web?: { url?: string; host?: string; port?: number };
  };
};

export type BuildInfo = {
  version?: string;
  gitHash?: string;
  gitBranch?: string;
  commitTime?: string;
  dirty?: boolean;
  runtime?: {
    engine?: string;
    engineVersion?: string;
    platform?: string;
    arch?: string;
  };
};

export type ServiceQuotaGauge = {
  id: string;
  label: string;
  kind: "quota" | "status";
  fill?: number;
  usedLabel?: string;
  capLabel?: string;
  unitLabel?: string;
  resetAt?: number;
  plan?: string;
  statusLabel?: string;
};

export type KnowledgeStatus = {
  indexedSessions?: number;
  totalTokens?: number;
  dbPath?: string;
  lastIndexedAt?: number;
};

export type TerminalSessionSummary = {
  id: string;
  title?: string;
  origin?: string;
  backend?: string;
  cwd?: string;
  active?: boolean;
  updatedAt?: number;
};

/** What the advisor reads, as the shared store (host-advisor-data.ts) holds it. Null = not read yet. */
export type HostAdvisorData = {
  hostInfo: HostInfo | null;
  buildInfo: BuildInfo | null;
  /** null while the first read is out; [] when the read failed or nothing is configured. */
  quotas: ServiceQuotaGauge[] | null;
  tailDiscovery: TailDiscoverySnapshot | null;
  knowledgeStatus: KnowledgeStatus | null;
  pairingState: PairingState | null;
  terminalSessions: TerminalSessionSummary[];
  sessions: SessionEntry[];
};

export const EMPTY_HOST_ADVISOR_DATA: HostAdvisorData = {
  hostInfo: null,
  buildInfo: null,
  quotas: null,
  tailDiscovery: null,
  knowledgeStatus: null,
  pairingState: null,
  terminalSessions: [],
  sessions: [],
};

/** The readings a panel can show, in the page's order. `processes` was the page's Matrix table. */
export type AdvisorReadingKey = "attention" | "unattended" | "budgets" | "subsystems" | "processes";

export const ADVISOR_READINGS: readonly { key: AdvisorReadingKey; label: string }[] = [
  { key: "attention", label: "Attention" },
  { key: "unattended", label: "Unattended" },
  { key: "budgets", label: "Budgets" },
  { key: "subsystems", label: "Subsystems" },
  { key: "processes", label: "Processes" },
];

/** The four the page draws in its Inquiries mode; a panel with no reading chosen draws these. */
export const INQUIRY_READINGS: readonly AdvisorReadingKey[] = ["attention", "unattended", "budgets", "subsystems"];

/** A panel's readings: the one chosen, or the page's four. Unknown values fall back to the four. */
export function readingsFor(choice: string | undefined): readonly AdvisorReadingKey[] {
  const known = ADVISOR_READINGS.find((r) => r.key === choice);
  return known ? [known.key] : INQUIRY_READINGS;
}

type Process = TailDiscoverySnapshot["processes"][number];

export function formatProcessCommand(cmd?: string, harness?: string): string {
  if (!cmd) return harness || "process";
  if (cmd.includes("--append-system-prompt")) {
    const match = cmd.match(/session-[a-zA-Z0-9_-]+/);
    if (match) return `${harness || "harness"} (relay ${match[0]})`;
    return `${harness || "harness"} (prompted relay)`;
  }
  if (cmd.length > 70) {
    return `${cmd.slice(0, 67)}...`;
  }
  return cmd;
}

export function extractProjectName(path?: string | null): string {
  if (!path) return "workspace";
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/** `ps -o etime` emits MM:SS, HH:MM:SS or DD-HH:MM:SS. */
export function etimeSeconds(etime?: string): number | undefined {
  if (!etime) return undefined;
  const [days, clock] = etime.includes("-") ? etime.split("-") : ["0", etime];
  const parts = clock.split(":").map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.some((value) => !Number.isFinite(value))) return undefined;
  const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
  return ((Number.parseInt(days, 10) || 0) * 24 + hours) * 3600 + minutes * 60 + seconds;
}

export function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${Math.round(totalSeconds)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h${String(remainder).padStart(2, "0")}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24}h`;
}

export function basenameOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

export const UNATTENDED_KIND_LABEL: Record<string, string> = {
  stalled_relay: "relay",
  idle_process: "process",
  uncommitted_branch: "branch",
  unresumed_session: "session",
};

export type WorktreeGroup = { root: string; name: string; agents: Agent[]; branches: Set<string>; processes: Process[] };

/** Agents by the root they work in, with the harness processes running under it. */
export function worktreeGroups(agents: readonly Agent[], processes: readonly Process[]): WorktreeGroup[] {
  const map = new Map<string, WorktreeGroup>();
  for (const agent of agents) {
    const root = agent.projectRoot || agent.cwd || "unknown";
    if (!map.has(root)) {
      map.set(root, { root, name: extractProjectName(root), agents: [], branches: new Set(), processes: [] });
    }
    const group = map.get(root)!;
    group.agents.push(agent);
    if (agent.branch) group.branches.add(agent.branch);
  }
  for (const proc of processes) {
    if (!proc.cwd) continue;
    for (const [root, group] of map.entries()) {
      if (proc.cwd.startsWith(root) || root.startsWith(proc.cwd)) {
        group.processes.push(proc);
      }
    }
  }
  return Array.from(map.values());
}

export type RankedRoot = WorktreeGroup & { weight: number; percent: number; primaryBranch: string };

export type AttentionBreakdown = {
  ranked: RankedRoot[];
  topProjects: RankedRoot[];
  topProject: RankedRoot | undefined;
  otherProjects: RankedRoot[];
  otherPercent: number;
  totalProjects: number;
};

/** Each root weighs its agents plus three per running process; the top five are named, the rest are the tail. */
export function attentionBreakdown(groups: readonly WorktreeGroup[], buildInfo: BuildInfo | null): AttentionBreakdown {
  const totalWeights = groups.reduce((sum, g) => sum + Math.max(1, g.agents.length + g.processes.length * 3), 0);
  const ranked = groups
    .map((g) => {
      const weight = Math.max(1, g.agents.length + g.processes.length * 3);
      const percent = totalWeights > 0 ? Math.round((weight / totalWeights) * 100) : 0;
      return {
        ...g,
        weight,
        percent,
        primaryBranch: Array.from(g.branches)[0] || (g.name === "openscout" ? buildInfo?.gitBranch || "main" : "main"),
      };
    })
    .sort((a, b) => b.weight - a.weight);

  const topProjects = ranked.slice(0, 5);
  const otherProjects = ranked.slice(5);
  return {
    ranked,
    topProjects,
    topProject: ranked[0],
    otherProjects,
    otherPercent: otherProjects.reduce((acc, p) => acc + p.percent, 0),
    totalProjects: ranked.length,
  };
}

export type AttentionReading = {
  verdict: "Concentrated" | "Weighted" | "Scattered";
  topPercent: number;
  tailPercent: number;
  tailCount: number;
  tailAgents: number;
  tailProcesses: number;
  aboveTen: number;
};

export function attentionReading(breakdown: AttentionBreakdown): AttentionReading | null {
  const ranked = breakdown.ranked;
  if (ranked.length === 0) return null;
  const topPercent = ranked[0].percent;
  const tail = breakdown.otherProjects;
  return {
    verdict: topPercent >= 50 ? "Concentrated" : topPercent >= 25 ? "Weighted" : "Scattered",
    topPercent,
    tailPercent: breakdown.otherPercent,
    tailCount: tail.length,
    tailAgents: tail.reduce((acc, p) => acc + p.agents.length, 0),
    tailProcesses: tail.reduce((acc, p) => acc + p.processes.length, 0),
    aboveTen: ranked.filter((p) => p.percent >= 10).length,
  };
}

export type UnattendedItem = {
  id: string;
  kind: "stalled_relay" | "idle_process" | "uncommitted_branch" | "unresumed_session";
  title: string;
  subtitle: string;
  ageLabel: string;
  projectRoot?: string;
  harness?: string;
  pid?: number;
  conversationId?: string;
  ageSeconds?: number;
  severity: "warn" | "neutral" | "info";
  actionLabel: string;
  actionRoute?: Route;
};

/**
 * What is left running or waiting with nobody on it: prompted relay
 * processes, a build branch off main, and the first four conversations whose
 * last turn is over an hour old.
 */
export function unattendedItems(
  processes: readonly Process[],
  buildInfo: BuildInfo | null,
  sessions: readonly SessionEntry[],
  now: number,
): UnattendedItem[] {
  const items: UnattendedItem[] = [];

  for (const proc of processes) {
    if (proc.command && proc.command.includes("--append-system-prompt")) {
      const match = proc.command.match(/session-[a-zA-Z0-9_-]+/);
      const sessionId = match ? match[0] : `PID ${proc.pid}`;
      items.push({
        id: `relay-${proc.pid}`,
        kind: "stalled_relay",
        title: sessionId,
        subtitle: `Launched in ${extractProjectName(proc.cwd)} · PID ${proc.pid} · Runtime ${proc.etime || "active"}`,
        ageLabel: proc.etime || "active",
        ageSeconds: etimeSeconds(proc.etime),
        projectRoot: proc.cwd || undefined,
        harness: proc.harness,
        pid: proc.pid,
        severity: "warn",
        actionLabel: "Tail Process",
        actionRoute: { view: "ops", mode: "mission" },
      });
    }
  }

  if (buildInfo?.gitBranch && buildInfo.gitBranch !== "main") {
    items.push({
      id: "branch-divergence",
      kind: "uncommitted_branch",
      title: buildInfo.gitBranch,
      subtitle: `Local worktree is ahead with uncommitted edits on ${buildInfo.runtime?.platform || "darwin"}`,
      ageLabel: "Unmerged",
      severity: "neutral",
      actionLabel: "Inspect Repos",
      actionRoute: { view: "repos" },
    });
  }

  for (const s of sessions.slice(0, 4)) {
    if (s.lastMessageAt && now - s.lastMessageAt > 3600 * 1000) {
      items.push({
        id: `session-${s.id}`,
        kind: "unresumed_session",
        title: s.title || s.id,
        subtitle: `Last turn recorded ${timeAgo(s.lastMessageAt, now)} · ${s.messageCount} messages · ${extractProjectName(s.workspaceRoot)}`,
        ageLabel: timeAgo(s.lastMessageAt, now),
        ageSeconds: (now - s.lastMessageAt) / 1000,
        conversationId: s.id,
        projectRoot: s.workspaceRoot || undefined,
        harness: s.harness || undefined,
        severity: "info",
        actionLabel: "Open Chat",
        actionRoute: { view: "conversation", conversationId: s.id },
      });
    }
  }

  return items;
}

export type UnattendedReading = { verdict: string; byKind: Record<string, number>; oldestLabel: string | null };

export function unattendedReading(items: readonly UnattendedItem[]): UnattendedReading {
  const byKind = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {});
  const oldest = items
    .map((item) => item.ageSeconds)
    .filter((s): s is number => typeof s === "number")
    .sort((left, right) => right - left)[0];
  return {
    verdict: items.length === 0 ? "Nothing unattended" : `${items.length} unattended`,
    byKind,
    oldestLabel: oldest ? formatDuration(oldest) : null,
  };
}

/** The most used plan window, by fill. */
export function peakQuota(quotas: readonly ServiceQuotaGauge[] | null): ServiceQuotaGauge | null {
  if (!quotas?.length) return null;
  return [...quotas].sort((a, b) => (b.fill ?? 0) - (a.fill ?? 0))[0];
}

export type SubsystemReading = {
  key: string;
  label: string;
  detail: string;
  state: string;
  tone: "ok" | "idle" | "warn" | "unknown";
  action?: { label: string; route: Route };
};

export function subsystems(data: Pick<HostAdvisorData, "hostInfo" | "terminalSessions" | "knowledgeStatus" | "pairingState">): SubsystemReading[] {
  const { hostInfo, terminalSessions, knowledgeStatus, pairingState } = data;
  const ptySockets = terminalSessions.length;
  const indexed = knowledgeStatus?.indexedSessions ?? 0;
  const peers = pairingState?.trustedPeerCount ?? 0;
  const brokerEndpoint = hostInfo?.brokerUrl
    || (hostInfo?.ports?.broker ? `127.0.0.1:${hostInfo.ports.broker}` : null);

  return [
    {
      key: "broker",
      label: "broker",
      detail: brokerEndpoint
        ? [brokerEndpoint, hostInfo?.brokerSocketPath ? basenameOf(hostInfo.brokerSocketPath) : null]
          .filter(Boolean).join(" · ")
        : "endpoint not reported",
      state: brokerEndpoint ? "UP" : "UNKNOWN",
      tone: brokerEndpoint ? "ok" : "unknown",
    },
    {
      key: "pty",
      label: "pty relay",
      detail: ptySockets > 0
        ? `${ptySockets} socket${ptySockets === 1 ? "" : "s"}`
        : "0 sockets · latency unmeasured",
      state: ptySockets > 0 ? "ACTIVE" : "IDLE",
      tone: ptySockets > 0 ? "ok" : "idle",
    },
    {
      key: "knowledge",
      label: "knowledge",
      detail: indexed > 0
        ? `${indexed.toLocaleString()} transcript${indexed === 1 ? "" : "s"} indexed`
        : "0 transcripts indexed",
      state: indexed > 0 ? "INDEXED" : "EMPTY",
      tone: indexed > 0 ? "ok" : "warn",
      action: indexed > 0 ? undefined : { label: "Index", route: { view: "search" } },
    },
    {
      key: "mesh",
      label: "mesh",
      detail: peers > 0
        ? `${peers} trusted peer${peers === 1 ? "" : "s"} · scope ${hostInfo?.advertiseScope || "mesh"}`
        : `no trusted peers · scope ${hostInfo?.advertiseScope || "mesh"}`,
      state: peers > 0 ? "PAIRED" : "UNPAIRED",
      tone: peers > 0 ? "ok" : "idle",
    },
  ];
}

export function subsystemSummary(items: readonly SubsystemReading[]): { verdict: string; figures: string } {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.tone] = (acc[item.tone] ?? 0) + 1;
    return acc;
  }, {});
  const flagged = items.filter((item) => item.tone === "warn");
  return {
    verdict: flagged.length > 0
      ? `${flagged.length} ${flagged.length === 1 ? "needs" : "need"} attention`
      : "All nominal",
    figures: [
      counts.ok ? `${counts.ok} up` : null,
      counts.idle ? `${counts.idle} idle` : null,
      counts.warn ? `${counts.warn} empty` : null,
      counts.unknown ? `${counts.unknown} unknown` : null,
    ].filter(Boolean).join(" · "),
  };
}

/** "darwin arm64 · bun 1.2" from the build's runtime; a dash until the build is read. */
export function platformLine(buildInfo: BuildInfo | null): string {
  return buildInfo?.runtime
    ? `${buildInfo.runtime.platform} ${buildInfo.runtime.arch} · ${buildInfo.runtime.engine} ${buildInfo.runtime.engineVersion}`
    : "—";
}

export type HostAdvisorModel = {
  processes: Process[];
  groups: WorktreeGroup[];
  breakdown: AttentionBreakdown;
  attention: AttentionReading | null;
  unattended: UnattendedItem[];
  unattendedReading: UnattendedReading;
  budget: BudgetSectionReading;
  peak: ServiceQuotaGauge | null;
  subsystems: SubsystemReading[];
  subsystemSummary: { verdict: string; figures: string };
};

/** Every reading at once, from one read of the data. */
export function readHostAdvisor(data: HostAdvisorData, agents: readonly Agent[], now: number): HostAdvisorModel {
  const processes = data.tailDiscovery?.processes ?? [];
  const groups = worktreeGroups(agents, processes);
  const breakdown = attentionBreakdown(groups, data.buildInfo);
  const unattended = unattendedItems(processes, data.buildInfo, data.sessions, now);
  const subs = subsystems(data);
  return {
    processes,
    groups,
    breakdown,
    attention: attentionReading(breakdown),
    unattended,
    unattendedReading: unattendedReading(unattended),
    budget: readBudgetSection(data.quotas),
    peak: peakQuota(data.quotas),
    subsystems: subs,
    subsystemSummary: subsystemSummary(subs),
  };
}
