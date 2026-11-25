import { agentRosterTag, rosterIdentityMonogram, rosterProjectKey } from "@openscout/protocol";

import type { AgentRosterEntry, AgentRosterListResult, AgentRosterTag, RosterProjectRecord } from "../../../../shared/api/roster.ts";

/*
 * The runtime's roster, as the board reads it (GET /api/roster, the
 * runtime's /v1/roster). The board looks labels up here and never numbers an
 * agent itself (agent-roster.md in the core).
 */

export type RosterIndex = {
  /** Each agent that holds a number now, by its Scout agent id. */
  byAgent: ReadonlyMap<string, AgentRosterEntry>;
  /** Each project's code record, by its key (its name, trimmed and in lower case). */
  projects: ReadonlyMap<string, RosterProjectRecord>;
};

export const EMPTY_ROSTER_INDEX: RosterIndex = { byAgent: new Map(), projects: new Map() };

/** The runtime's list, by agent and by project. A gone agent, whose number frees soon, holds no label. */
export function indexRoster(list: AgentRosterListResult | null | undefined): RosterIndex {
  if (!list) return EMPTY_ROSTER_INDEX;
  return {
    byAgent: new Map((list.agents ?? []).filter((entry) => !entry.goneAt).map((entry) => [entry.agentId, entry])),
    projects: new Map((list.projects ?? []).map((project) => [project.projectKey, project])),
  };
}

/**
 * An agent's tag: the runtime's roster read, else the tag its agent record
 * carries (/api/agents), which the runtime sets the same way. None for an
 * agent the runtime has not numbered.
 */
export function rosterTagFor(
  agentId: string | null | undefined,
  index: RosterIndex,
  agents?: ReadonlyMap<string, { roster?: AgentRosterTag | null }>,
): AgentRosterTag | null {
  const id = agentId?.trim();
  if (!id) return null;
  const entry = index.byAgent.get(id);
  if (entry) return agentRosterTag(entry);
  return agents?.get(id)?.roster ?? null;
}

/**
 * The projects of the agents shown, as the runtime keeps them, for their
 * codes in the board's settings: the runtime's project names, which can
 * differ from a folder name the board shows.
 */
export function rosterProjectsOf(agentIds: Iterable<string | null | undefined>, index: RosterIndex, limit = 12): RosterProjectRecord[] {
  const byKey = new Map<string, RosterProjectRecord>();
  for (const id of agentIds) {
    const key = id ? index.byAgent.get(id)?.projectKey : null;
    const project = key ? index.projects.get(key) : undefined;
    if (project && !byKey.has(project.projectKey)) byKey.set(project.projectKey, project);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Which agent each figure on the desk is, by pin, so a figure whose agent
 * has gone quiet (its row off the board) keeps its label. `seen` are the
 * pins whose agent the board can see now. With `pinsNow` (the host's pins),
 * a pin that left the desk is forgotten; null while the host has not said.
 * The same object when nothing changes.
 */
export function nextPinAgents(
  prev: Readonly<Record<string, string>>,
  seen: Iterable<readonly [pin: string, agentId: string]>,
  pinsNow: readonly string[] | null,
): Readonly<Record<string, string>> {
  const next: Record<string, string> = { ...prev };
  let changed = false;
  for (const [pin, agentId] of seen) {
    if (!pin || !agentId || next[pin] === agentId) continue;
    next[pin] = agentId;
    changed = true;
  }
  if (pinsNow) {
    const on = new Set(pinsNow);
    for (const pin of Object.keys(next)) if (!on.has(pin)) { delete next[pin]; changed = true; }
  }
  return changed ? next : prev;
}

/** A stored pin-to-agent map; anything unreadable is dropped. */
export function parsePinAgents(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([pin, id]) => pin && typeof id === "string" && id.trim()));
  } catch {
    return {};
  }
}

/** A code the operator types: letters only, in capitals, at most three. Digits are refused by the runtime, so they never reach it. */
export function draftProjectCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z]/gu, "").slice(0, 3);
}

/** A project's default code, for its empty field: the runtime's, else the same rule the runtime uses. */
export function projectDefaultCode(project: Pick<RosterProjectRecord, "defaultCode" | "name">): string {
  return project.defaultCode || rosterIdentityMonogram(project.name);
}

export { rosterProjectKey };
