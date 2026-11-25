/*
 * Initiatives for /swarm: the bigger pieces of work in the runtime's asks,
 * found by reading the asks rather than by who sent them. Every Claude session
 * in a project returns through one Scout MCP session, so "who asked" lumps
 * days of unrelated work into one point (on 2026-10-21, 444 of the last 500
 * asks). An agent's initiative is, in order:
 *   1. a goal: the goal registry (swarm-goal.ts) claims it, or its asks carry a `goal:` label;
 *   2. the initiative of the agent that asked it, when another agent alone asked it;
 *   3. its place, when that is a worktree or another project: every session in
 *      core-split-a, or in lattices, shares one initiative;
 *   4. itself: a session started in the asker's own checkout is its own piece of work.
 * An initiative that generated enough asks, or asked enough sessions, is a root
 * the picker lists first. Pure and React-free, like swarm-model.ts.
 */

import { goalLaneOf, goalPlaceLaneOf, type SwarmGoal } from "./swarm-goal.ts";
import {
  askLabels,
  asMeta,
  asString,
  buildSwarms,
  flightMeta,
  leadAsk,
  memberStatus,
  pointOf,
  spanWords,
  splitAgentName,
  type BuildSwarmsOptions,
  type Swarm,
  type SwarmLane,
  type SwarmMember,
} from "./swarm-model.ts";
import type { AgentRun } from "./types.ts";

export type InitiativeKind = "goal" | "place" | "session";

/** What buildSwarms needs to draw one initiative: its lanes and the places they work in, or the agents it holds. */
export type InitiativeScope = Pick<BuildSwarmsOptions, "laneOf" | "placeLaneOf" | "include">;

/** One row of an initiative: a lane of a goal, or a session. */
export type InitiativeLane = { id: string; mark: string | null; name: string };

export type Initiative = {
  /** "goal:core-split", "place:lattices", "session:<agent id>". */
  id: string;
  kind: InitiativeKind;
  title: string;
  /** One sentence on what the initiative is. */
  summary: string;
  scope: InitiativeScope;
  /** The runs to its agents: enough to rebuild its swarms for another window. */
  runs: AgentRun[];
  /** Its asks as swarms, one per point that asked, most asks first. */
  swarms: Swarm[];
  lanes: InitiativeLane[];
  asks: number;
  sessions: number;
  open: number;
  start: number;
  lastActivityAt: number;
  /** What is happening in it now, or how long it has been quiet. */
  sentence: string;
  tone: "review" | "work" | "quiet";
  /** It generated enough asks, or asked enough sessions, to count as a root initiative. */
  major: boolean;
};

export type FindInitiativesOptions = {
  now: number;
  /** Goals with named lanes. A `goal:` label with no entry here still makes an initiative. */
  goals?: readonly SwarmGoal[];
  /** An initiative with at least this many asks is a root. */
  minAsks?: number;
  /** An initiative that asked at least this many sessions is a root. */
  minSessions?: number;
  /** Whether the session working on an ask has gone silent (see swarm-heard.ts). */
  silenceOf?: BuildSwarmsOptions["silenceOf"];
};

/** "modules-anywhere" reads as "Modules anywhere". */
export function humanize(slug: string): string {
  const words = slug.replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : slug;
}

/** Tile letters for a session that has no lane: "lavoisier-3" is L3, "Grok Cursor" is GC. */
export function sessionMark(name: string): string {
  const { short } = splitAgentName(name);
  const numbered = short.match(/^([a-z])[a-z]*-(\d+)$/iu);
  if (numbered) return `${numbered[1]!.toUpperCase()}${numbered[2]}`;
  return short.split(/[\s_-]+/u).filter(Boolean).slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("") || "?";
}

function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 3) return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * What the members are doing, the way the lanes' story says it: a review first, then work, then a lane that stopped,
 * then how long it has been quiet. Lanes whose sessions have gone silent are named after whatever else is said.
 */
export function initiativeSentence(members: readonly SwarmMember[], lastActivityAt: number, now: number): Pick<Initiative, "sentence" | "tone"> {
  const named = (status: SwarmMember["status"]) => members.filter((member) => member.status === status).map((member) => member.name);
  const silent = silentSentences(members);
  const lead = leadSentence(named);
  if (lead) return silent.length > 0 ? { ...lead, sentence: [lead.sentence, ...silent].join(" ") } : lead;
  if (silent.length > 0) return { sentence: silent.join(" "), tone: "work" };
  return { sentence: `Quiet for ${spanWords(now - lastActivityAt)}.`, tone: "quiet" };
}

/**
 * Silent lanes, as their rows say it: a session that went quiet mid-work, then one
 * whose turn ended while its reply never reached the runtime. On 10-24 the header
 * said two lanes "have gone silent" over rows that read "Finished … 32 h ago".
 */
function silentSentences(members: readonly SwarmMember[]): string[] {
  const silent = members.filter((member) => member.status === "silent");
  const finished = (member: SwarmMember) => leadAsk(member.asks)?.silence?.finished === true;
  const quiet = silent.filter((member) => !finished(member)).map((member) => member.name);
  const ended = silent.filter(finished).map((member) => member.name);
  const sentences: string[] = [];
  if (quiet.length > 0) sentences.push(`${listNames(quiet)} ${quiet.length === 1 ? "has" : "have"} gone silent.`);
  if (ended.length > 0) {
    sentences.push(`${listNames(ended)} finished; ${ended.length === 1 ? "its reply has" : "their replies have"} not reached the runtime.`);
  }
  return sentences;
}

function leadSentence(named: (status: SwarmMember["status"]) => string[]): Pick<Initiative, "sentence" | "tone"> | null {
  const review = named("review");
  if (review.length === 1) return { sentence: `Review requested on ${review[0]}'s reply.`, tone: "review" };
  if (review.length > 1) return { sentence: `Review requested on replies from ${listNames(review)}.`, tone: "review" };
  const working = named("working");
  if (working.length > 0) return { sentence: `${listNames(working)} ${working.length === 1 ? "is" : "are"} working.`, tone: "work" };
  const waiting = named("waiting");
  if (waiting.length > 0) return { sentence: `${listNames(waiting)} ${waiting.length === 1 ? "is" : "are"} waiting.`, tone: "work" };
  const queued = named("queued");
  if (queued.length > 0) return { sentence: `${listNames(queued)} ${queued.length === 1 ? "has an ask" : "have asks"} not started yet.`, tone: "work" };
  const stopped = named("stopped");
  if (stopped.length > 0) return { sentence: `${listNames(stopped)} stopped.`, tone: "work" };
  return null;
}

type Facts = { name: string | null; labels: string[]; askers: Set<string>; pointAsked: boolean; project: string | null };

type LaneOf = NonNullable<BuildSwarmsOptions["laneOf"]>;

/** A goal named only by labels: a lane per `lane:` label, else a row for the session. */
function labelLane(agentId: string, agentName: string | null, labels: readonly string[]): SwarmLane {
  const lane = labels.find((label) => label.startsWith("lane:") && label.length > "lane:".length)?.slice("lane:".length);
  if (lane) return { id: lane, name: `Lane ${lane.toUpperCase()}`, mark: lane.toUpperCase(), about: "" };
  const name = agentName ?? agentId;
  return { id: agentId, name: splitAgentName(name).short, mark: sessionMark(name), about: "" };
}

/** Members of several swarms as one list: a lane two points asked is one lane, with every ask it took. */
export function initiativeMembers(swarms: readonly Swarm[], now: number): SwarmMember[] {
  const byId = new Map<string, SwarmMember>();
  for (const swarm of swarms) {
    for (const member of swarm.members) {
      const known = byId.get(member.id);
      if (!known) {
        byId.set(member.id, member);
        continue;
      }
      const asks = [...known.asks, ...member.asks].sort((a, b) => a.askedAt - b.askedAt);
      byId.set(member.id, { ...known, asks, agentIds: [...new Set([...known.agentIds, ...member.agentIds])], ...memberStatus(asks, now) });
    }
  }
  return [...byId.values()];
}

/**
 * Every initiative in the runs, the ones with something open first, then the
 * most recently active. Each holds its asks as swarms, drawn with its own lanes.
 */
export function findInitiatives(runs: Iterable<AgentRun>, { now, goals = [], minAsks = 5, minSessions = 3, silenceOf }: FindInitiativesOptions): Initiative[] {
  const all = [...runs].sort((a, b) => a.createdAt - b.createdAt);
  if (all.length === 0) return [];
  const agentIds = new Set(all.map((run) => run.agentId));

  // What each agent's runs say about it: its session name and labels (each from its latest run that has them),
  // who asked it, and the project the asker worked in.
  const facts = new Map<string, Facts>();
  for (const run of all) {
    const fact = facts.get(run.agentId) ?? { name: null, labels: [], askers: new Set<string>(), pointAsked: false, project: null };
    const name = run.agentName?.trim() || asString(flightMeta(run).targetDisplayName);
    if (name) fact.name = name;
    const labels = askLabels(run);
    if (labels.length > 0) fact.labels = labels;
    const point = pointOf(run);
    const asker = agentIds.has(point.requesterId) ? point.requesterId
      : point.sessionId !== null && agentIds.has(point.sessionId) ? point.sessionId : null;
    if (asker === null || asker === run.agentId) fact.pointAsked = true;
    else fact.askers.add(asker);
    fact.project = asString(asMeta(flightMeta(run).senderContext)?.project) ?? fact.project;
    facts.set(run.agentId, fact);
  }

  const registry = goals.map((goal) => ({ goal, laneOf: goalLaneOf(goal), placeLaneOf: goalPlaceLaneOf(goal) }));
  const keys = new Map<string, string>();
  // A session that joined the initiative of the agent that asked it, by that agent.
  const adopted = new Map<string, string>();
  const keyOf = (agentId: string, seen: ReadonlySet<string> = new Set()): string => {
    const known = keys.get(agentId);
    if (known) return known;
    const fact = facts.get(agentId)!;
    const key = (() => {
      for (const { goal, laneOf } of registry) if (laneOf(agentId, fact.name, fact.labels)) return `goal:${goal.id}`;
      const goal = fact.labels.find((label) => label.startsWith("goal:") && label.length > "goal:".length);
      if (goal) return goal;
      // A session only another agent asked does that agent's work.
      if (!fact.pointAsked && fact.askers.size === 1) {
        const [asker] = fact.askers;
        if (asker !== undefined && !seen.has(asker)) {
          adopted.set(agentId, asker);
          return keyOf(asker, new Set([...seen, agentId]));
        }
      }
      const { place } = splitAgentName(fact.name ?? agentId);
      return place && place !== fact.project ? `place:${place}` : `session:${agentId}`;
    })();
    keys.set(agentId, key);
    return key;
  };

  const byKey = new Map<string, AgentRun[]>();
  for (const run of all) {
    const key = keyOf(run.agentId);
    const held = byKey.get(key) ?? [];
    held.push(run);
    byKey.set(key, held);
  }

  const windowMs = now - all[0]!.createdAt + 1;
  const out: Initiative[] = [];
  for (const [id, held] of byKey) {
    const kind: InitiativeKind = id.startsWith("goal:") ? "goal" : id.startsWith("place:") ? "place" : "session";
    const known = registry.find(({ goal }) => `goal:${goal.id}` === id);
    const members = new Set(held.map((run) => run.agentId));
    // A goal's lanes; a session it adopted works in the lane of the agent that asked it.
    const base: LaneOf = known ? known.laneOf : labelLane;
    const laneOf: LaneOf = (agentId, agentName, labels) => {
      const seen = new Set<string>();
      let id = agentId;
      let lane = members.has(id) ? base(id, agentName, labels) : null;
      while (!lane && adopted.has(id) && !seen.has(id)) {
        seen.add(id);
        id = adopted.get(id)!;
        const fact = facts.get(id);
        lane = members.has(id) && fact ? base(id, fact.name, fact.labels) : null;
      }
      return lane;
    };
    const scope: InitiativeScope = kind === "goal" ? { laneOf, placeLaneOf: known?.placeLaneOf }
      : { include: (agentId: string) => members.has(agentId) };
    const swarms = buildSwarms(held, { now, windowMs, ...scope, silenceOf }).sort((a, b) => b.asks.length - a.asks.length);
    const asks = swarms.flatMap((swarm) => swarm.asks);
    if (asks.length === 0) continue;
    const lanes = initiativeMembers(swarms, now);
    const lastActivityAt = Math.max(...swarms.map((swarm) => swarm.lastActivityAt));
    const first = asks.reduce((earliest, ask) => (ask.askedAt < earliest.askedAt ? ask : earliest));
    const sessions = new Set(asks.map((ask) => ask.agentId)).size;
    const slug = id.slice(id.indexOf(":") + 1);
    const agent = swarms[0]!.agents.get(first.agentId);
    const title = known ? known.goal.title
      : kind === "session" ? first.title
      : humanize(slug);
    const summary = known ? known.goal.summary
      : kind === "goal" ? `The asks labeled ${id}.`
      : kind === "place" ? `Every session working in ${slug}.`
      : `The asks to ${agent?.name ?? first.agentId}${agent?.place ? `, working in ${agent.place}` : ""}.`;
    out.push({
      id,
      kind,
      title,
      summary,
      scope,
      runs: held,
      swarms,
      lanes: lanes.map((member) => ({ id: member.id, mark: member.mark, name: member.name })),
      asks: asks.length,
      sessions,
      open: asks.filter((ask) => ask.open).length,
      start: first.askedAt,
      lastActivityAt,
      ...initiativeSentence(lanes, lastActivityAt, now),
      major: asks.length >= minAsks || sessions >= minSessions,
    });
  }
  const busy = (initiative: Initiative) => (initiative.tone === "quiet" ? 1 : 0);
  return out.sort((a, b) => busy(a) - busy(b) || b.lastActivityAt - a.lastActivityAt);
}
