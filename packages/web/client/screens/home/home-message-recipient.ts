/**
 * What Home's Message panel lists in its To menu, and who a message reaches.
 *
 * The menu lists projects, not agents. It used to list every agent record,
 * one row per session, so it ran to hundreds of rows, and a row did not say
 * whether it was a project or an agent. A project row folds every worktree
 * and copy of the repository in, with the same identity the Projects page
 * uses (agents/project-identity.ts), so the two lists agree.
 *
 * Send still writes to one agent's chat. A project resolves to that agent:
 *
 *   1. the agent last sent to from this panel, when it is in the project;
 *   2. else the project's own agents before one-off session agents;
 *   3. newest `updatedAt` first within each.
 *
 * Only agents that can receive count. A project with none is not listed, and
 * an agent with no project root has no project row.
 *
 * Projects are ordered by the operator's own history, strongest first: the
 * last recipient's project, then the device-local recent project roots
 * (lib/project-recency.ts, the list New Chat uses), then the newest activity.
 * Both signals are written only on an explicit pick or a send. A default the
 * panel chose itself is never written back, or the default would confirm
 * itself (see project-recency.ts).
 */
import { isAgentBusy, normalizeAgentState } from "../../lib/agent-state.ts";
import { isSessionStyleAgent } from "../../lib/mesh-roster.ts";
import type { Agent } from "../../lib/types.ts";
import { basename, projectIdentityForRooted } from "../agents/project-identity.ts";

const LAST_RECIPIENT_STORAGE_KEY = "openscout.home.message.recipient.v1";

export type HomeMessageRecency = {
  /** The agent last sent to from the panel. */
  lastAgentId?: string | null;
  /** Recent project roots, newest first. */
  recentRoots?: readonly string[];
};

/** One row of the To menu. */
export type HomeMessageProject = {
  /** The project's identity key, shared with the Projects page. */
  key: string;
  /** The row's name: "/" and the repository folder, as New Chat writes it. */
  label: string;
  /** The canonical root, "~"-relative. */
  root: string;
  /** Agents that can receive, in the order a message would pick them. */
  agents: Agent[];
  /** Some agent in the project is in a turn or has work in flight. */
  working: boolean;
  /** The newest `updatedAt` among its agents. */
  lastActivityAt: number;
};

function normalizeRoot(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > 1 ? trimmed.replace(/\/+$/u, "") : trimmed;
}

/** The path an agent works in: its project root, else its cwd. */
export function homeMessageAgentRoot(agent: Pick<Agent, "projectRoot" | "cwd">): string | null {
  return normalizeRoot(agent.projectRoot) ?? normalizeRoot(agent.cwd);
}

/** An agent the runtime will not deliver to: retired, a stale registration, or unavailable. */
export function homeMessageCannotReceive(agent: Agent): boolean {
  return normalizeAgentState(agent.state, agent) === "blocked";
}

/** The project a path belongs to, or null when the path names no project. */
function projectOfRoot(root: string | null): { key: string; root: string } | null {
  if (!root) return null;
  const identity = projectIdentityForRooted(null, root);
  return identity.root ? { key: identity.key, root: identity.root } : null;
}

/** The project key an agent's messages go under, or null when it has no project. */
export function homeMessageProjectKey(agent: Pick<Agent, "projectRoot" | "cwd">): string | null {
  return projectOfRoot(homeMessageAgentRoot(agent))?.key ?? null;
}

function compareRecipients(lastAgentId: string | null) {
  return (left: Agent, right: Agent): number => {
    const lastDelta = Number(right.id === lastAgentId) - Number(left.id === lastAgentId);
    if (lastDelta !== 0) return lastDelta;
    const sessionDelta = Number(isSessionStyleAgent(left)) - Number(isSessionStyleAgent(right));
    if (sessionDelta !== 0) return sessionDelta;
    const leftAt = left.updatedAt ?? Number.NEGATIVE_INFINITY;
    const rightAt = right.updatedAt ?? Number.NEGATIVE_INFINITY;
    if (leftAt !== rightAt) return leftAt > rightAt ? -1 : 1;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  };
}

/** How strongly the operator's own history points at each project: lower is stronger. */
function historyRanks(projects: readonly HomeMessageProject[], recency: HomeMessageRecency): Map<string, number> {
  const ranks = new Map<string, number>();
  const lastAgentId = recency.lastAgentId?.trim() || null;
  if (lastAgentId) {
    const owner = projects.find((project) => project.agents.some((agent) => agent.id === lastAgentId));
    if (owner) ranks.set(owner.key, -1);
  }
  for (const raw of recency.recentRoots ?? []) {
    const key = projectOfRoot(normalizeRoot(raw))?.key;
    if (key && !ranks.has(key)) ranks.set(key, ranks.size);
  }
  return ranks;
}

/**
 * The To menu: one row per project that has an agent able to receive. The
 * operator's history leads, then the newest activity.
 */
export function buildHomeMessageProjects(
  agents: readonly Agent[],
  recency: HomeMessageRecency = {},
): HomeMessageProject[] {
  const byKey = new Map<string, HomeMessageProject>();
  for (const agent of agents) {
    if (homeMessageCannotReceive(agent)) continue;
    const project = projectOfRoot(homeMessageAgentRoot(agent));
    if (!project) continue;
    const row = byKey.get(project.key) ?? {
      key: project.key,
      label: `/${basename(project.root) ?? project.root}`,
      root: project.root,
      agents: [],
      working: false,
      lastActivityAt: Number.NEGATIVE_INFINITY,
    };
    row.agents.push(agent);
    row.working ||= isAgentBusy(agent.state, agent);
    row.lastActivityAt = Math.max(row.lastActivityAt, agent.updatedAt ?? Number.NEGATIVE_INFINITY);
    byKey.set(project.key, row);
  }

  const lastAgentId = recency.lastAgentId?.trim() || null;
  const projects = [...byKey.values()];
  for (const project of projects) project.agents.sort(compareRecipients(lastAgentId));

  const ranks = historyRanks(projects, recency);
  const rankOf = (project: HomeMessageProject) => ranks.get(project.key) ?? Number.POSITIVE_INFINITY;
  return projects.sort((left, right) => {
    const leftRank = rankOf(left);
    const rightRank = rankOf(right);
    if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
    if (left.lastActivityAt !== right.lastActivityAt) return left.lastActivityAt > right.lastActivityAt ? -1 : 1;
    return left.label.localeCompare(right.label) || left.root.localeCompare(right.root);
  });
}

/** The agent a message to this project reaches. */
export function homeMessageProjectRecipient(project: HomeMessageProject | null | undefined): Agent | null {
  return project?.agents[0] ?? null;
}

/**
 * The second part of each row: the root when two projects share a folder
 * name, and "working" when some agent in it is busy.
 */
export function homeMessageProjectDetail(
  project: HomeMessageProject,
  projects: readonly HomeMessageProject[],
): string | undefined {
  const shared = projects.some((other) => other.key !== project.key && other.label === project.label);
  const parts = [shared ? project.root : null, project.working ? "working" : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/**
 * The project preselected when the panel opens: the head of the list, but
 * only when the operator's own history put it there. Freshness alone is not a
 * reason to address a project, so with no such signal the panel asks which.
 */
export function defaultHomeMessageProject(
  projects: readonly HomeMessageProject[],
  recency: HomeMessageRecency = {},
): HomeMessageProject | null {
  const head = projects[0];
  if (!head) return null;
  return historyRanks(projects, recency).has(head.key) ? head : null;
}

/** The agent last sent to from the panel on this device. */
export function readHomeMessageLastRecipient(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_RECIPIENT_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

/** Record a send. Never call it for a default. */
export function rememberHomeMessageRecipient(agentId: string): void {
  const id = agentId.trim();
  if (!id || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_RECIPIENT_STORAGE_KEY, id);
  } catch {
    /* storage may be unavailable */
  }
}
