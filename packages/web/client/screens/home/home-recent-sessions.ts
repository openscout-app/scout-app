/**
 * Recent agents, read as sessions: who each one is, where it ran and what it
 * was there for. What's moving draws the same columns for the agents working
 * now; these rows are about the session itself, so the line is the ask that
 * opened it rather than the latest turn.
 */
import { compactAgentId, folderName, sessionModelLabel } from "../../lib/agent-labels.ts";
import { normalizeTimestampMs } from "../../lib/time.ts";
import type { Agent, FleetActivity, FleetAsk, FleetState } from "../../lib/types.ts";
import { generatedNameSource } from "./home-derive.ts";
import { usefulHeadline } from "./home-live-action.ts";
import { humanizeMovingAction } from "./home-moving.ts";

export type RecentSessionRow = {
  agent: Agent;
  /** The name the session goes by, else its generated id as it is. */
  name: string;
  /** The session id when `name` is something else, for the tooltip. */
  sessionId: string | null;
  harness: string | null;
  /** The model without its harness prefix: `claude-fable-5` → `fable-5`. */
  model: string | null;
  /** The checkout's folder, as What's moving names it. */
  project: string | null;
  branch: string | null;
  /** What the session was asked, else what it last said; null when the fleet window holds neither. */
  topic: string | null;
  /** The ask on the line is still out. */
  topicLive: boolean;
};

/** The fleet ids an agent card answers to: its own, its definition's, and its id's head. */
function fleetKeys(agent: Agent): Set<string> {
  return new Set(
    [agent.id, agent.definitionId, compactAgentId(agent.id)]
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id)),
  );
}

type FleetSessionFacts = {
  ask: FleetAsk | null;
  asked: FleetActivity | null;
  said: FleetActivity | null;
  name: string | null;
};

function newer<T>(current: T | null, next: T, at: (item: T) => number | null | undefined): T {
  if (!current) return next;
  return (normalizeTimestampMs(at(next)) ?? 0) > (normalizeTimestampMs(at(current)) ?? 0) ? next : current;
}

/** Each fleet agent id's latest ask, the latest ask to it in the firehose, its latest message, and its name. */
function fleetFactsById(fleet: FleetState | null): Map<string, FleetSessionFacts> {
  const byId = new Map<string, FleetSessionFacts>();
  const facts = (id: string): FleetSessionFacts => {
    let entry = byId.get(id);
    if (!entry) {
      entry = { ask: null, asked: null, said: null, name: null };
      byId.set(id, entry);
    }
    return entry;
  };
  for (const ask of [...(fleet?.activeAsks ?? []), ...(fleet?.recentCompleted ?? [])]) {
    const entry = facts(ask.agentId);
    entry.ask = newer(entry.ask, ask, (item) => item.updatedAt);
    entry.name ??= ask.agentName?.trim() || null;
  }
  for (const item of fleet?.activity ?? []) {
    if (item.kind === "invocation_recorded" && item.agentId) {
      const entry = facts(item.agentId);
      entry.asked = newer(entry.asked, item, (activity) => activity.ts);
      entry.name ??= item.agentName?.trim() || null;
    } else if (item.kind === "message_posted" && item.actorId) {
      const entry = facts(item.actorId);
      entry.said = newer(entry.said, item, (activity) => activity.ts);
      entry.name ??= item.actorName?.trim() || null;
    }
  }
  return byId;
}

function mergedFacts(keys: Set<string>, byId: Map<string, FleetSessionFacts>): FleetSessionFacts {
  const merged: FleetSessionFacts = { ask: null, asked: null, said: null, name: null };
  for (const key of keys) {
    const entry = byId.get(key);
    if (!entry) continue;
    if (entry.ask) merged.ask = newer(merged.ask, entry.ask, (item) => item.updatedAt);
    if (entry.asked) merged.asked = newer(merged.asked, entry.asked, (item) => item.ts);
    if (entry.said) merged.said = newer(merged.said, entry.said, (item) => item.ts);
    merged.name ??= entry.name;
  }
  return merged;
}

function topicLine(text: string | null | undefined): string | null {
  const headline = usefulHeadline(text);
  return headline ? humanizeMovingAction(headline) || null : null;
}

export function buildRecentSessionRows(agents: readonly Agent[], fleet: FleetState | null): RecentSessionRow[] {
  const byId = fleetFactsById(fleet);
  return agents.map((agent) => {
    const keys = fleetKeys(agent);
    const facts = mergedFacts(keys, byId);
    const generatedId = generatedNameSource(agent.name, [agent.handle, agent.definitionId, agent.id]);
    // the fleet's name for the agent is its session's when the roster had none; a title-cased id is no name
    const fleetName = facts.name && !generatedNameSource(facts.name, [...keys]) ? facts.name : null;
    const friendly = agent.sessionName?.trim() || (generatedId ? fleetName : null);
    const name = friendly ?? generatedId ?? (agent.name || agent.id);

    const askTopic = topicLine(facts.ask?.task);
    const topic = askTopic ?? topicLine(facts.asked?.title) ?? topicLine(facts.said?.title);

    return {
      agent,
      name,
      sessionId: friendly ? generatedId ?? compactAgentId(agent.id) : null,
      harness: agent.harness?.trim() || null,
      model: sessionModelLabel(agent.model, agent.harness),
      project: folderName(agent.projectRoot ?? agent.cwd) ?? (agent.project?.trim() || null),
      branch: agent.branch?.trim() || null,
      topic,
      topicLive: Boolean(askTopic && (facts.ask?.status === "queued" || facts.ask?.status === "working")),
    };
  });
}
