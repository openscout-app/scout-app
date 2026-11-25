/*
 * The swarm: who runs point, the agents it asks, and each ask's state, built
 * from the runtime's run records (GET /api/runs). Pure and React-free so the
 * page (screens/swarm) stays a renderer and this file stays testable.
 *
 * A swarm is everything one point asked: one requester through one return
 * session (Scout MCP, the CLI, a guest link). Its members are the agents those
 * asks went to, in the order they joined. When a member asks another agent,
 * that ask joins the same swarm and is drawn from the member's lane.
 *
 * Given lanes (a goal's, see swarm-goal.ts), a member is a lane instead: every
 * session that worked in it shares one row, and asks to agents in no lane are
 * left out.
 */

import { failureWords } from "./swarm-failure.ts";
import type { AskSilence } from "./swarm-heard.ts";
import { askStops, calmStop, headlineStops, statusStopLine } from "./swarm-stop.ts";
import { withoutLaneName } from "./swarm-title.ts";
import type { AgentRun } from "./types.ts";

export type SwarmAskState =
  | "queued"
  | "working"
  | "waiting"
  | "review"
  | "done"
  | "failed"
  | "cancelled"
  | "unknown";

export type SwarmAsk = {
  id: string;
  /** The agent that asked, or null when the point did (or a lane did and its agent is not known). */
  from: string | null;
  agentId: string;
  /** The member (lane) the ask is drawn in. Without lanes, the agent's id. */
  memberId: string;
  /** The member the ask came from, or null when the point asked. */
  fromMemberId: string | null;
  title: string;
  task: string;
  reply: string | null;
  replyHeadline: string | null;
  failure: string | null;
  state: SwarmAskState;
  open: boolean;
  askedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  conversationId: string | null;
  workId: string | null;
  flightId: string | null;
  /** A working ask whose session's log has not moved for a long time (see swarm-heard.ts); absent or null while it is heard from. */
  silence?: AskSilence | null;
};

/**
 * A member whose last ask it answered by stopping is "stopped" (see swarm-stop.ts) until it is asked again.
 * One whose work the runtime calls running, on a session that has gone silent, is "silent".
 */
export type SwarmMemberStatus = Exclude<SwarmAskState, "unknown"> | "quiet" | "stopped" | "silent";

export type SwarmMember = {
  /** The agent's id, or the lane's id when lanes group agents. */
  id: string;
  name: string;
  /** A lane's tile letters ("A", "E1"); null for an agent, whose tile takes letters from its name. */
  mark: string | null;
  /** What a lane does, in a few words; null for an agent. */
  about: string | null;
  /** Where it works, read off the session name (its folder), when the name carries one. */
  place: string | null;
  /** Every agent drawn in this row, in the order they joined. */
  agentIds: string[];
  harness: string | null;
  model: string | null;
  effort: string | null;
  joinedAt: number;
  asks: SwarmAsk[];
  status: SwarmMemberStatus;
  /** One sentence: what this member is doing or last did. */
  sentence: string;
  since: number;
};

export type SwarmPoint = {
  requesterId: string;
  sessionId: string | null;
  name: string;
  /** How the point reaches the runtime, as a phrase: "Scout MCP", "the Scout CLI". */
  via: string;
};

export type SwarmEvent = {
  at: number;
  kind: "asked" | "replied" | "failed" | "cancelled";
  askId: string;
  agentId: string;
  /** The name the story gives the agent asked: its lane, or its own name inside a lane. */
  who: string;
  text: string;
  /** A reply that stopped: the lane's words for the stop, quoted. */
  stop?: string;
};

/** One agent as the swarm knows it: its short name, where it works, and its runtime. */
export type SwarmAgent = {
  id: string;
  name: string;
  place: string | null;
  harness: string | null;
  model: string | null;
  effort: string | null;
};

/** A row that holds several agents: one lane of a goal, with every session that worked in it. */
export type SwarmLane = {
  id: string;
  /** "Lane A". */
  name: string;
  /** The tile letters: "A", "E1". */
  mark: string;
  /** What the lane does, in a few words. */
  about: string;
  /** Where the row sits, so lanes keep their places; lanes without one follow in the order they joined. */
  order?: number;
};

export type Swarm = {
  key: string;
  point: SwarmPoint;
  members: SwarmMember[];
  /** Every agent that asked or was asked in this swarm, by id. */
  agents: ReadonlyMap<string, SwarmAgent>;
  asks: SwarmAsk[];
  events: SwarmEvent[];
  start: number;
  end: number;
  lastActivityAt: number;
};

export type SwarmWindowId = "1h" | "3h" | "12h" | "24h";

export const SWARM_WINDOWS: ReadonlyArray<{ id: SwarmWindowId; label: string; ms: number }> = [
  { id: "1h", label: "1h", ms: 3_600_000 },
  { id: "3h", label: "3h", ms: 3 * 3_600_000 },
  { id: "12h", label: "12h", ms: 12 * 3_600_000 },
  { id: "24h", label: "24h", ms: 24 * 3_600_000 },
];

const OPEN_STATES = new Set<SwarmAskState>(["queued", "working", "waiting", "review"]);

type Meta = Record<string, unknown>;

export function asMeta(value: unknown): Meta | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Meta : null;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function flightMeta(run: AgentRun): Meta {
  const metadata = asMeta(run.metadata);
  return asMeta(metadata?.flightMetadata) ?? asMeta(metadata?.invocationMetadata) ?? asMeta(asMeta(run.input)?.metadata) ?? {};
}

/** The labels the asker put on an ask ("goal:core-split", "lane:c"), as the runtime recorded them. */
export function askLabels(run: AgentRun): string[] {
  const labels = new Set<string>();
  for (const source of [asMeta(asMeta(run.input)?.metadata)?.labels, flightMeta(run).labels]) {
    if (!Array.isArray(source)) continue;
    for (const label of source) {
      const text = asString(label);
      if (text) labels.add(text);
    }
  }
  return [...labels];
}

export function askState(run: Pick<AgentRun, "state" | "completedAt">): SwarmAskState {
  switch (run.state) {
    case "queued":
    case "waking":
      return "queued";
    case "running":
      return "working";
    case "waiting":
      return "waiting";
    case "review":
      return "review";
    case "completed":
      return "done";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      return typeof run.completedAt === "number" ? "done" : "unknown";
  }
}

const ASK_TAG = /^\s*\[ask:[^\]\s]+\]\s*/u;

/** One line of markdown as plain words: heading and list marks, emphasis, code ticks and link targets go. */
function plainLine(line: string): string {
  return line
    // A heading mark is followed by a space; "#83: plainer words" names a pull request.
    .replace(/^\s*#{1,6}(?:\s+|$)/u, "")
    .replace(/^\s*[-*+]\s+/u, "")
    // A numbered item's mark too: "1. Fix R1" reads "Fix R1"; "1.4.3 clears it" keeps its version.
    .replace(/^\s*\d{1,2}[.)]\s+/u, "")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/gu, "$1")
    .replace(/\*\*|__|`/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/u, "")}…`;
}

// A signature names the sender, not the ask: "From Claude, running point.",
// "C, from Claude, running point.", "FYI from Claude (the operator may show as sender)."
const SIGNATURE = /^(?:(?:FYI|[A-Z][\w-]{0,3}),? )?[Ff]rom [A-Z][\w-]*(?:, [^.:()]{1,40})?(?: \([^)]{0,80}\))?[.:](?:\s+|$)/u;
// A long path reads as its file name; a URL's path is left alone.
const LONG_PATH = /(?<![\w:/])~?(?:\/[\w.@~-]+){3,}\/([\w.@~-]+)/gu;
// A full commit hash or digest reads as git's short form; a URL's is left alone.
const FULL_HASH = /(?<![\w/])([0-9a-f]{8})(?:[0-9a-f]{56}|[0-9a-f]{32})(?!\w)/gu;

function shortened(line: string): string {
  return line.replace(LONG_PATH, "$1").replace(FULL_HASH, "$1");
}

/** The first line an operator would recognize an ask by: no heading marks, no emphasis, no signature. */
export function askTitle(task: string | null | undefined, max = 96): string {
  const text = (task ?? "").replace(ASK_TAG, "");
  for (const raw of text.split("\n")) {
    const line = shortened(plainLine(raw).replace(SIGNATURE, ""));
    if (line) return clip(line, max);
  }
  return "Untitled ask";
}

const STATUS_SUMMARY = /^\S+ (?:replied|failed to respond|could not be prepared|did not finish cleanly|returned an empty reply)\.?$/u;

/** A reply as the agent wrote it, without the runtime's routing tag. */
export function replyBody(run: AgentRun): string | null {
  const output = asMeta(run.output);
  const text = asString(output?.text);
  if (text) return text.replace(ASK_TAG, "").trim() || null;
  const summary = asString(output?.summary);
  // "session-… replied." says only that a reply exists, the text being elsewhere;
  // "… failed to respond." and its kin say only that none came.
  if (!summary || STATUS_SUMMARY.test(summary)) return null;
  return summary;
}

// A line that only points at a file says where the work is, not what it says:
// "Report: REPORT.md", "Note: DESIGN.md", "Done: plans/council-jobs.md.", or the file alone.
const POINTER = /^(?:[A-Z][\w ]{0,30}:\s*)?\S+\.[A-Za-z]{1,8}\.?$/u;
// A heading, a table row, a code fence or a rule cannot carry a sentence.
const NOT_PROSE = /^\s*(?:#{1,6}\s|\||```|~~~|(?:-{3,}|\*{3,}|_{3,})\s*$)/u;
const TABLE_ROW = /^\s*\|/u;

/**
 * The reply's opening sentence, for a story line or a block caption. A lane
 * often opens with a line that points at its report ("Report: REPORT.md") or
 * one that introduces the next ("Fix pushed to #119:" then "125304d9,
 * appended to 74c75b25."), so a pointer gives way to the words after it, and a
 * line ending in a colon takes the first sentence it introduces. A pointer
 * stays when what follows says nothing yet: a heading, a table, or an
 * introduction with nothing after it. A reply that opens with a table reads
 * from the words after the table, and has no opening when nothing follows it.
 */
export function replyHeadline(reply: string | null, max = 120): string | null {
  if (!reply) return null;
  const raw = reply.split("\n").filter((line) => shortened(plainLine(line)));
  const plain = raw.map((line) => shortened(plainLine(line)));
  const prose = (at: number) => at < raw.length && !NOT_PROSE.test(raw[at]!);
  // The line's first sentence, or, when the line introduces the next, both; null when it introduces nothing.
  const opening = (at: number): string | null => {
    const line = plain[at]!;
    const sentence = firstSentence(line);
    if (sentence !== line || !line.endsWith(":")) return sentence;
    return prose(at + 1) ? `${line} ${firstSentence(plain[at + 1]!)}` : null;
  };
  let at = 0;
  while (at < raw.length && TABLE_ROW.test(raw[at]!)) at++;
  while (POINTER.test(plain[at] ?? "") && prose(at + 1) && opening(at + 1) !== null) at++;
  if (at >= plain.length) return null;
  return clip(opening(at) ?? plain[at]!.slice(0, -1), max);
}

function firstSentence(line: string): string {
  return line.match(/^(.+?[.!?])(\s|$)/u)?.[1] ?? line;
}

/** "core-split-a-lavoisier-3" reads as lavoisier-3 working in core-split-a. */
export function splitAgentName(name: string): { short: string; place: string | null } {
  const match = name.match(/^(.+)-([a-z]+-\d+)$/u);
  return match ? { short: match[2]!, place: match[1]! } : { short: name, place: null };
}

const VIA: Record<string, string> = {
  "scout-mcp": "Scout MCP",
  "scout-cli": "the Scout CLI",
  "scout-guest": "a guest link",
  "scout-web": "the Scout app",
};

export function pointOf(run: AgentRun): SwarmPoint {
  const fm = flightMeta(run);
  const ret = asMeta(fm.returnAddress);
  const source = asString(fm.source) ?? asString(asMeta(run.metadata)?.rawSource) ?? null;
  return {
    requesterId: run.requesterId,
    sessionId: asString(ret?.sessionId),
    name: asString(fm.requesterDisplayName) ?? asString(ret?.displayName) ?? run.requesterId,
    via: source ? VIA[source] ?? source : "Scout",
  };
}

function pointKey(point: Pick<SwarmPoint, "requesterId" | "sessionId">): string {
  return `${point.requesterId}|${point.sessionId ?? ""}`;
}

function runtimeOf(run: AgentRun): { harness: string | null; model: string | null; effort: string | null } {
  const fm = flightMeta(run);
  const ack = asMeta(fm.dispatchAck);
  const trace = Array.isArray(fm.sessionTrace) ? asMeta(fm.sessionTrace.at(-1)) : null;
  const resolution = asMeta(ack?.executionResolution) ?? asMeta(trace?.executionResolution);
  const dim = (key: string) => {
    const value = asMeta(resolution?.[key]);
    return asString(value?.observed) ?? asString(value?.resolved);
  };
  return {
    harness: asString(ack?.harness) ?? asString(trace?.harness) ?? asString(run.harness) ?? dim("harness"),
    model: dim("model") ?? asString(run.model),
    effort: dim("reasoningEffort"),
  };
}

type AskPlace = Pick<SwarmAsk, "from" | "memberId" | "fromMemberId">;

/** Whether an ask is still open and, when it is not, when it ended. */
function askEnd(run: AgentRun): Pick<SwarmAsk, "open" | "endedAt"> {
  const state = askState(run);
  const completedAt = asNumber(run.completedAt);
  const open = OPEN_STATES.has(state) || (state === "unknown" && completedAt === null);
  return { open, endedAt: open ? null : completedAt ?? asNumber(run.updatedAt) };
}

function toAsk(run: AgentRun, { from, memberId, fromMemberId }: AskPlace, silenceOf?: BuildSwarmsOptions["silenceOf"]): SwarmAsk {
  const state = askState(run);
  // An ask to a busy lane waits its turn: it starts when the session takes it, not when the runtime accepted it.
  const recorded = asNumber(run.startedAt);
  const delivered = asNumber(asMeta(flightMeta(run).dispatchAck)?.acknowledgedAt);
  const startedAt = recorded !== null && delivered !== null ? Math.max(recorded, delivered) : delivered ?? recorded;
  const { open, endedAt } = askEnd(run);
  // While an ask is open, its output holds the runtime's dispatch receipt, not a reply.
  const reply = open ? null : replyBody(run);
  const task = asString(asMeta(run.input)?.task) ?? "";
  const reason = asString(run.terminalReason) ?? asString(asMeta(run.output)?.error);
  return {
    id: run.id,
    from,
    agentId: run.agentId,
    memberId,
    fromMemberId,
    title: askTitle(task),
    task,
    reply,
    replyHeadline: replyHeadline(reply),
    failure: state === "failed" ? (reason ? failureWords(reason) : replyHeadline(reply)) : null,
    state,
    open,
    askedAt: run.createdAt,
    startedAt,
    endedAt,
    conversationId: asString(run.conversationId),
    workId: asString(run.workId) ?? asString(run.collaborationRecordId),
    flightId: Array.isArray(run.flightIds) ? asString(run.flightIds[0]) : null,
    silence: state === "working" && silenceOf ? silenceOf(run, startedAt ?? run.createdAt) : null,
  };
}

/** Words for a span of time: "under a minute", "4 min", "1 h 12 min", "2 d". */
export function spanWords(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return `${Math.floor(hours / 24)} d`;
}

function quote(text: string, max = 56): string {
  return `“${clip(text, max)}”`;
}

/** A stop in the lane's own words: the reply's opening, or the status line under what it delivered first. */
export function stopWords(ask: Pick<SwarmAsk, "reply" | "replyHeadline">): string | null {
  const words = headlineStops(ask.replyHeadline) ? ask.replyHeadline : replyHeadline(statusStopLine(ask.reply)) ?? ask.replyHeadline;
  return words === null ? null : calmStop(words);
}

/**
 * The open ask a member's status speaks for: a requested review, then work on a
 * session heard from, then a wait. A silent session leads only asks that wait
 * behind it, which it holds up.
 */
export function leadAsk(asks: readonly SwarmAsk[]): SwarmAsk | undefined {
  const open = asks.filter((ask) => ask.open);
  return open.find((ask) => ask.state === "review")
    ?? open.find((ask) => ask.state === "working" && !ask.silence)
    ?? open.find((ask) => ask.state === "waiting")
    ?? open.find((ask) => ask.silence)
    ?? open[0];
}

export function memberStatus(asks: SwarmAsk[], now: number): { status: SwarmMemberStatus; sentence: string; since: number } {
  const open = asks.filter((ask) => ask.open);
  const lead = leadAsk(asks);
  if (lead) {
    const others = open.filter((ask) => ask !== lead && !ask.silence).length;
    const behind = others > 1 ? ", with more asks behind it" : others === 1 ? ", with another ask behind it" : "";
    const since = lead.startedAt ?? lead.askedAt;
    if (lead.silence) {
      const ago = spanWords(now - lead.silence.since);
      return {
        status: "silent",
        since: lead.silence.since,
        sentence: lead.silence.finished
          ? `Finished ${quote(lead.title)} ${ago} ago; the reply has not reached the runtime${behind}`
          : `Silent for ${ago} on ${quote(lead.title)}${behind}`,
      };
    }
    switch (lead.state) {
      case "review":
        return { status: "review", since, sentence: `Review requested on ${quote(lead.title)}` };
      case "waiting":
        return { status: "waiting", since, sentence: `Waiting for ${spanWords(now - since)} on ${quote(lead.title)}${behind}` };
      case "queued":
        return { status: "queued", since: lead.askedAt, sentence: `Asked ${spanWords(now - lead.askedAt)} ago, not started yet` };
      default:
        return { status: "working", since, sentence: `On ${quote(lead.title)} for ${spanWords(now - since)}${behind}` };
    }
  }
  const last = asks.at(-1);
  if (!last) return { status: "quiet", since: now, sentence: "Nothing asked yet" };
  const at = last.endedAt ?? last.askedAt;
  const ago = `${spanWords(now - at)} ago`;
  if (last.state === "failed") {
    return { status: "failed", since: at, sentence: last.failure ? `Failed ${ago}: ${clip(last.failure, 64)}` : `Failed ${ago}` };
  }
  if (last.state === "cancelled") return { status: "cancelled", since: at, sentence: `Cancelled ${ago}` };
  if (askStops(last)) return { status: "stopped", since: at, sentence: `Stopped ${ago}: ${quote(stopWords(last) ?? "", 64)}` };
  return {
    status: "done",
    since: at,
    sentence: last.replyHeadline ? `Replied ${ago}: ${quote(last.replyHeadline, 64)}` : `Replied ${ago}`,
  };
}

function eventsFor(ask: SwarmAsk, { asker, who }: { asker: string; who: string }): SwarmEvent[] {
  const events: SwarmEvent[] = [{
    at: ask.askedAt,
    kind: "asked",
    askId: ask.id,
    agentId: ask.agentId,
    who,
    text: `${asker} asked ${who}: ${quote(ask.title, 72)}`,
  }];
  if (ask.endedAt !== null) {
    const ended = { at: ask.endedAt, askId: ask.id, agentId: ask.agentId, who };
    if (ask.state === "failed") {
      events.push({ ...ended, kind: "failed", text: ask.failure ? `${who} failed: ${clip(ask.failure, 72)}` : `${who}'s ask failed` });
    } else if (ask.state === "cancelled") {
      events.push({ ...ended, kind: "cancelled", text: `${who}'s ask was cancelled` });
    } else {
      const words = askStops(ask) ? stopWords(ask) : null;
      const stop = words ? quote(words, 72) : undefined;
      events.push({
        ...ended,
        kind: "replied",
        text: stop ? `${who} stopped: ${stop}` : ask.replyHeadline ? `${who} replied: ${quote(ask.replyHeadline, 72)}` : `${who} replied`,
        ...(stop ? { stop } : {}),
      });
    }
  }
  return events;
}

export type BuildSwarmsOptions = {
  now: number;
  windowMs: number;
  /**
   * Draw agents in lanes: each ask goes to its agent's lane, and asks to
   * agents in no lane are left out. Without it, each agent is its own lane.
   * `labels` are those of the latest ask to the agent that carries any.
   */
  laneOf?: (agentId: string, agentName: string | null, labels: readonly string[]) => SwarmLane | null;
  /**
   * The lane that works in a place. Agents that reach the runtime through the
   * point's own Scout MCP session are recorded as the point; the place an ask
   * was sent from tells them apart, so an ask sent from a lane's place is
   * drawn from that lane.
   */
  placeLaneOf?: (place: string) => SwarmLane | null;
  /** Without lanes, draw only the asks to these agents (an initiative's, see swarm-initiatives.ts). */
  include?: (agentId: string) => boolean;
  /** Whether the session working on an ask has gone silent (see swarm-heard.ts). Without it, every working ask reads as working. */
  silenceOf?: (run: AgentRun, startedAt: number) => AskSilence | null;
};

/** The place an ask was sent from, as the sender's Scout session reported it. */
export function senderPlace(run: AgentRun): string | null {
  return asString(asMeta(flightMeta(run).senderContext)?.project);
}

type Runtime = Pick<SwarmAgent, "harness" | "model" | "effort">;

/**
 * Every swarm with activity in the window, most recent first. An ask counts
 * when it was asked in the window, ended in it, or is still open.
 */
export function buildSwarms(runs: Iterable<AgentRun>, { now, windowMs, laneOf, placeLaneOf, include, silenceOf }: BuildSwarmsOptions): Swarm[] {
  const start = now - windowMs;
  const all = [...runs].sort((a, b) => a.createdAt - b.createdAt);

  // An agent's session name and labels, each from its latest run that carries them.
  const names = new Map<string, string>();
  const labels = new Map<string, string[]>();
  for (const run of all) {
    const name = run.agentName?.trim() || asString(flightMeta(run).targetDisplayName);
    if (name) names.set(run.agentId, name);
    const runLabels = askLabels(run);
    if (runLabels.length > 0) labels.set(run.agentId, runLabels);
  }
  const lanes = new Map<string, SwarmLane | null>();
  const laneFor = (agentId: string): SwarmLane | null => {
    if (!laneOf) return null;
    if (!lanes.has(agentId)) lanes.set(agentId, laneOf(agentId, names.get(agentId) ?? null, labels.get(agentId) ?? []));
    return lanes.get(agentId)!;
  };

  // An ask recorded as the point's but sent from a lane's place came from that
  // lane: from the agent working there with an ask open at the time, else the
  // last one asked there before it.
  const runsIn = new Map<string, AgentRun[]>();
  for (const run of all) {
    const { place } = splitAgentName(names.get(run.agentId) ?? run.agentId);
    if (place) runsIn.set(place, [...(runsIn.get(place) ?? []), run]);
  }
  const senderLanes = new Map<string, SwarmLane>();
  const senderOf = (run: AgentRun): { from: string | null; lane: SwarmLane } | null => {
    const place = placeLaneOf ? senderPlace(run) : null;
    const lane = place ? placeLaneOf!(place) : null;
    if (!place || !lane) return null;
    senderLanes.set(lane.id, lane);
    const before = (runsIn.get(place) ?? []).filter((other) => other.createdAt <= run.createdAt && other.agentId !== run.agentId);
    const open = before.filter((other) => (askEnd(other).endedAt ?? Number.POSITIVE_INFINITY) >= run.createdAt);
    return { from: (open.at(-1) ?? before.at(-1))?.agentId ?? null, lane };
  };

  // Group by point, then fold a group into the swarm that already has its
  // asker as a member: that member asked on the swarm's behalf.
  const groups = new Map<string, { point: SwarmPoint; runs: AgentRun[] }>();
  for (const run of all) {
    const point = pointOf(run);
    const key = pointKey(point);
    const group = groups.get(key) ?? { point, runs: [] };
    group.runs.push(run);
    groups.set(key, group);
  }
  const memberOf = new Map<string, string>();
  for (const [key, group] of groups) {
    for (const run of group.runs) if (!memberOf.has(run.agentId)) memberOf.set(run.agentId, key);
  }
  // The asker is the requester or, when the runtime records an agent's own
  // asks as the operator's, the agent session the replies return to.
  const askerOf = (point: SwarmPoint): string | null => {
    if (memberOf.has(point.requesterId)) return point.requesterId;
    return point.sessionId !== null && memberOf.has(point.sessionId) ? point.sessionId : null;
  };
  const rootOf = (key: string): string => {
    const seen = new Set<string>([key]);
    let current = key;
    for (;;) {
      const asker = askerOf(groups.get(current)!.point);
      const parent = asker === null ? undefined : memberOf.get(asker);
      if (!parent || seen.has(parent)) return current;
      seen.add(parent);
      current = parent;
    }
  };

  type Entry = { point: SwarmPoint; asks: SwarmAsk[]; runtime: Map<string, Runtime> };
  const swarms = new Map<string, Entry>();
  for (const [key, group] of groups) {
    const root = rootOf(key);
    const entry: Entry = swarms.get(root) ?? { point: groups.get(root)!.point, asks: [], runtime: new Map() };
    const asker = root === key ? null : askerOf(group.point);
    for (const run of group.runs) {
      const lane = laneFor(run.agentId);
      if (laneOf && !lane) continue;
      if (!laneOf && include && !include(run.agentId)) continue;
      const sender = asker === null ? senderOf(run) : null;
      const from = sender?.from ?? asker;
      const fromLane = from === null ? null : laneOf ? laneFor(from)?.id ?? null : from;
      const fromMemberId = fromLane ?? sender?.lane.id ?? null;
      const ask = toAsk(run, { from, memberId: lane?.id ?? run.agentId, fromMemberId }, silenceOf);
      // The row names the lane, so its asks' titles need not.
      if (lane) ask.title = withoutLaneName(ask.title, lane.name);
      if (!(ask.open || ask.askedAt >= start || (ask.endedAt ?? 0) >= start)) continue;
      entry.asks.push(ask);
      const runtime = runtimeOf(run);
      const known = entry.runtime.get(run.agentId);
      entry.runtime.set(run.agentId, {
        harness: runtime.harness ?? known?.harness ?? null,
        model: runtime.model ?? known?.model ?? null,
        effort: runtime.effort ?? known?.effort ?? null,
      });
    }
    swarms.set(root, entry);
  }

  const result: Swarm[] = [];
  for (const [key, entry] of swarms) {
    if (entry.asks.length === 0) continue;
    entry.asks.sort((a, b) => a.askedAt - b.askedAt);
    const agents = new Map<string, SwarmAgent>();
    const agentOf = (id: string): SwarmAgent => {
      const known = agents.get(id);
      if (known) return known;
      const { short, place } = splitAgentName(names.get(id) ?? id);
      const runtime = entry.runtime.get(id);
      const agent = { id, name: short, place, harness: runtime?.harness ?? null, model: runtime?.model ?? null, effort: runtime?.effort ?? null };
      agents.set(id, agent);
      return agent;
    };
    const byMember = new Map<string, SwarmAsk[]>();
    for (const ask of entry.asks) {
      agentOf(ask.agentId);
      if (ask.from !== null) agentOf(ask.from);
      const list = byMember.get(ask.memberId) ?? [];
      list.push(ask);
      byMember.set(ask.memberId, list);
    }
    const members: SwarmMember[] = [...byMember.entries()].map(([id, asks]) => {
      // A lane shows the agent it asked last; without lanes that is the member itself.
      const lead = agentOf(asks.at(-1)!.agentId);
      const lane = laneFor(lead.id);
      return {
        id,
        name: lane?.name ?? lead.name,
        mark: lane?.mark ?? null,
        about: lane?.about ?? null,
        place: lead.place,
        agentIds: [...new Set(asks.map((ask) => ask.agentId))],
        harness: lead.harness,
        model: lead.model,
        effort: lead.effort,
        joinedAt: asks[0]!.askedAt,
        asks,
        ...memberStatus(asks, now),
      };
    });
    const order = (member: SwarmMember) => laneFor(member.agentIds[0]!)?.order ?? Number.MAX_SAFE_INTEGER;
    if (laneOf) members.sort((a, b) => order(a) - order(b));
    const label = (agentId: string) => laneFor(agentId)?.name ?? agentOf(agentId).name;
    const events = entry.asks.flatMap((ask) => {
      // Within one lane, name the agents: "Lane A asked Lane A" says nothing.
      const inside = ask.fromMemberId !== null && ask.fromMemberId === ask.memberId;
      const asker = ask.from !== null ? (inside ? agentOf(ask.from).name : label(ask.from))
        : ask.fromMemberId !== null ? senderLanes.get(ask.fromMemberId)?.name ?? entry.point.name
        : entry.point.name;
      return eventsFor(ask, { asker, who: inside ? agentOf(ask.agentId).name : label(ask.agentId) });
    }).sort((a, b) => b.at - a.at);
    const lastActivityAt = Math.max(...entry.asks.map((ask) => (ask.open ? now : ask.endedAt ?? ask.askedAt)));
    result.push({
      key,
      point: entry.point,
      members,
      agents,
      asks: entry.asks,
      events,
      start: Math.max(start, Math.min(...entry.asks.map((ask) => ask.askedAt))),
      end: now,
      lastActivityAt,
    });
  }
  return result.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}

/**
 * Rows within a lane, so overlapping asks (one queued behind another) never
 * draw on top of each other. `gapMs` keeps asks apart that would touch on screen.
 */
export function packAsks(asks: readonly SwarmAsk[], now: number, gapMs = 0): { slots: Map<string, number>; count: number } {
  const ends: number[] = [];
  const slots = new Map<string, number>();
  for (const ask of [...asks].sort((a, b) => a.askedAt - b.askedAt)) {
    const end = Math.max(ask.endedAt ?? now, ask.askedAt);
    let slot = ends.findIndex((taken) => taken + gapMs <= ask.askedAt);
    if (slot < 0) {
      slot = ends.length;
      ends.push(end);
    } else {
      ends[slot] = end;
    }
    slots.set(ask.id, slot);
  }
  return { slots, count: Math.max(1, ends.length) };
}

/** Merge a fetch into what the page holds. Newer records win; very old ones drop. */
export function mergeRuns(held: ReadonlyMap<string, AgentRun>, incoming: Iterable<AgentRun>, keepAfter: number): Map<string, AgentRun> {
  const next = new Map(held);
  for (const run of incoming) {
    const prior = next.get(run.id);
    if (!prior || run.updatedAt >= prior.updatedAt) next.set(run.id, run);
  }
  for (const [id, run] of next) {
    const open = OPEN_STATES.has(askState(run));
    if (!open && run.updatedAt < keepAfter) next.delete(id);
  }
  return next;
}

const TICK_STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880];

/** Clock ticks for an axis: round local times, at most about `maxTicks` of them. */
export function axisTicks(start: number, end: number, maxTicks = 8): number[] {
  if (!(end > start)) return [];
  const spanMin = (end - start) / 60_000;
  const stepMin = TICK_STEPS_MIN.find((step) => spanMin / step <= maxTicks) ?? 10_080;
  const step = stepMin * 60_000;
  const offset = new Date(start).getTimezoneOffset() * 60_000;
  const first = Math.ceil((start - offset) / step) * step + offset;
  const ticks: number[] = [];
  for (let t = first; t < end; t += step) ticks.push(t);
  return ticks;
}
