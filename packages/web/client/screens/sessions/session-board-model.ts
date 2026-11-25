import { formatSessionRouteRef, parseSessionRouteRef, sessionHarnessMatches } from "../../../shared/session-route-ref.ts";
import { conversationSessionId } from "../../lib/conversation-kind.ts";
import { isAgentBusy, isAgentInFlight } from "../../lib/agent-state.ts";
import { groupByProject, OTHER_CHATS_LABEL, plainListTitle, projectLabelForSession } from "../../lib/chat-list.ts";
import { harnessSessionTitle, isScoutLaunchName, operatorNamedSession, scoutLaunchName, sessionTitle } from "../../lib/harness-session-title.ts";
import type { Agent, ObserveData, OperatorAttentionItem, SessionEntry, TailDiscoveredTranscript, TailEvent } from "../../lib/types.ts";
import { buildLaneFacts, nativeObserveData, nativeSessionAgent, type AgentLane } from "../ops/agent-lanes-model.ts";
import type { SessionFilter, SessionSelection } from "./slot-deck.ts";

export type SessionOrigin = { kind: "you" | "agent" | "unknown"; label: string };
export type SessionBoardRow = {
  key: string;
  selection: SessionSelection;
  sessionId: string;
  title: string;
  /** The operator named this session: `title` is that name and wins over any task line. */
  named?: boolean;
  harness: string | null;
  project: string | null;
  branch: string | null;
  model: string | null;
  machine: string | null;
  machineName: string | null;
  working: boolean;
  asks: boolean;
  /** Last observed activity (ms); null when no evidence carries a time. */
  lastActiveAt: number | null;
  /** What the session is about when it differs from the title. */
  preview: string | null;
  origin: SessionOrigin;
  conversation: SessionEntry | null;
  lane: AgentLane | null;
};

export function boardRowQueued(row: SessionBoardRow): boolean {
  return Boolean(row.lane?.source === "scout" && isAgentInFlight(row.lane.agent.state, row.lane.agent));
}

/** A child's activity is not a claim that its parent is itself in a turn. */
export function boardRowActivityLabel(row: SessionBoardRow, children: readonly SessionBoardRow[] = []): string | null {
  if (row.asks) return "Waiting";
  const waiting = children.filter((child) => child.asks).length;
  if (waiting) return waiting === 1 ? "Subagent waiting" : "Subagents waiting";
  if (row.working) return boardRowQueued(row) ? "Queued" : "Working";
  const working = children.filter((child) => child.working && !boardRowQueued(child)).length;
  if (working) return working === 1 ? "Subagent working" : "Subagents working";
  const queued = children.filter((child) => child.working && boardRowQueued(child)).length;
  if (queued) return queued === 1 ? "Subagent queued" : "Subagents queued";
  return null;
}

export function sessionOrigin(input: {
  conversation?: SessionEntry | null;
  requester?: { requesterId: string; requesterName: string } | null;
  parentSessionId?: string | null;
  agents?: readonly Agent[];
  operatorName?: string | null;
}): SessionOrigin {
  const { conversation, requester, agents = [], operatorName } = input;
  const by = (id: string, name?: string): SessionOrigin => id === "operator" || id === operatorName
    ? { kind: "you", label: "started by you" }
    : { kind: "agent", label: `started by ${name || agents.find((a) => a.id === id)?.name || (/^session[-:]/.test(id) ? "another session" : id)}` };
  if (requester) return by(requester.requesterId, requester.requesterName);
  // a parent is always a session; its harness id is no name to show
  if (input.parentSessionId) return by(input.parentSessionId, agents.find((a) => a.harnessSessionId === input.parentSessionId)?.name ?? "another session");
  const members = conversation?.participants?.filter((p) => p.kind !== "session" && p.agentId !== conversation.agentId && p.actorId !== conversation.agentId) ?? [];
  // Membership alone cannot establish the initiator of a room. These are only
  // single-session direct lines; a unique non-target member is the requester.
  if (conversation?.kind === "direct" && members.length === 1) return by(members[0].actorId, members[0].displayName);
  const ids = conversation?.kind === "direct" ? conversation.participantIds.filter((id) => id !== conversation.agentId && !id.startsWith("session:")) : [];
  if (ids?.length === 1) return by(ids[0]);
  return { kind: "unknown", label: "Start origin not recorded" };
}

/** Attention keeps its exact decision payload. Remote ids are namespaced and
 * only match a slot explicitly scoped to that machine; agent identity is never
 * enough to select an approval from the agent's other sessions. */
export function attentionForSession(items: readonly OperatorAttentionItem[], refs: readonly string[], conversationId?: string | null, machineId?: string | null, localNodeId?: string | null): OperatorAttentionItem[] {
  const parsed = refs.map(parseSessionRouteRef).filter((ref) => ref !== null);
  const matches = (value: string) => {
    let ref = value;
    if (value.startsWith("remote:")) {
      const split = value.indexOf(":", 7);
      if (split < 0 || !machineId) return false;
      try { if (decodeURIComponent(value.slice(7, split)) !== machineId) return false; } catch { return false; }
      ref = value.slice(split + 1);
    } else if (machineId && machineId !== localNodeId) return false;
    const candidate = parseSessionRouteRef(ref);
    return !!candidate && parsed.some((wanted) => wanted.refId === candidate.refId
      && (!wanted.harness || !candidate.harness || sessionHarnessMatches(wanted.harness, candidate.harness)));
  };
  return items.filter((item) => {
    if (item.approval) return matches(item.approval.sessionId);
    // Native questions have no conversation; the follow action is the backing.
    const sessionRoutes = (item.actions ?? []).flatMap((action) => action.route && "sessionId" in action.route && action.route.sessionId ? [action.route.sessionId] : []);
    return sessionRoutes.length ? sessionRoutes.some(matches) : Boolean(conversationId && item.conversationId === conversationId);
  });
}

function distinctPreview(preview: string | null | undefined, title: string): string | null {
  const text = preview?.replace(/\s+/gu, " ").trim();
  return text && text !== title.trim() ? text : null;
}

/** The name Scout launched this transcript's harness under, if it did. */
function transcriptLaunchName(transcript: Pick<TailDiscoveredTranscript, "title" | "agentName">): string | null {
  const name = transcript.agentName?.trim() || transcript.title?.trim();
  return name && isScoutLaunchName(name) ? name : null;
}

export { harnessSessionTitle };

export function buildSessionBoardRows(input: {
  conversations: readonly SessionEntry[];
  transcripts: readonly TailDiscoveredTranscript[];
  events: TailEvent[];
  agents: Agent[];
  attention: readonly OperatorAttentionItem[];
  now: number;
  operatorName?: string | null;
  localNodeId?: string | null;
}): SessionBoardRow[] {
  const rows = new Map<string, SessionBoardRow>();
  const { agents, attention, now } = input;
  const eventsById = new Map<string, TailEvent[]>();
  for (const event of input.events) {
    const events = eventsById.get(event.sessionId) ?? []; events.push(event); eventsById.set(event.sessionId, events);
  }
  const keyOf = (harness: string | null, id: string, machine?: string | null) => `${machine ?? "local"}:${harness ?? ""}:${id}`;
  // A session Scout started is a conversation under Scout's id and a transcript
  // under the harness's own; the launch name joins the two into one row. An
  // agent with more than one session row names no single one, so it joins none.
  const launched = new Map<string, string | null>();
  // Several direct conversations can name one backing session. One might
  // carry its provider alias and another only the Scout ref. Join them before
  // choosing which conversation supplies its title and activity.
  const aliases = new Map<string, string | null>();
  const backed = input.conversations.flatMap((conversation) => {
    const ref = conversationSessionId(conversation);
    if (!ref) return [];
    const native = conversation.harnessSessionId?.trim();
    const agent = agents.find((a) => a.id === conversation.agentId && a.harnessSessionId === (native || ref));
    const machine = conversation.executionNodeId || agent?.homeNodeId || input.localNodeId || null;
    const scoped = keyOf(conversation.harness, ref, machine);
    if (native && native !== ref) aliases.set(scoped, aliases.has(scoped) && aliases.get(scoped) !== native ? null : native);
    return [{ conversation, ref, agent, machine, scoped }];
  });
  for (const { conversation, ref, agent, machine, scoped } of backed) {
    const id = aliases.get(scoped) ?? ref;
    const key = keyOf(conversation.harness, id, machine);
    const working = Boolean(agent && isAgentBusy(agent.state, agent));
    if (conversation.agentId) {
      const name = scoutLaunchName(conversation.agentId);
      launched.set(name, launched.has(name) && launched.get(name) !== key ? null : key);
    }
    const previous = rows.get(key);
    if (previous && (previous.lastActiveAt ?? 0) >= (conversation.lastMessageAt ?? 0)) continue;
    rows.set(key, {
      key, sessionId: id, selection: { sessionRef: formatSessionRouteRef(conversation.harness, ref)!, ...(machine ? { machineId: machine } : {}) },
      title: conversation.title || conversation.preview || id, harness: conversation.harness,
      project: conversation.workspaceRoot, branch: conversation.currentBranch, model: conversation.model ?? agent?.model ?? null,
      machine, machineName: conversation.executionNodeName ?? agent?.homeNodeName ?? null,
      working, asks: attentionForSession(attention, [id, conversation.sessionId ?? ""], conversation.id, machine, input.localNodeId).length > 0,
      lastActiveAt: conversation.lastMessageAt ?? null,
      preview: distinctPreview(conversation.preview, conversation.title || conversation.preview || id),
      origin: sessionOrigin({ conversation, agents, operatorName: input.operatorName }), conversation,
      lane: agent ? { id, agent, source: "scout", observe: null, lastActiveAt: conversation.lastMessageAt ?? 0, current: working } : null,
    });
  }
  // a relaunched harness leaves more than one transcript under one name; the newest joins
  const joining = new Map<string, TailDiscoveredTranscript>();
  for (const transcript of input.transcripts) {
    const name = transcriptLaunchName(transcript);
    if (!name || !launched.get(name)) continue;
    const held = joining.get(name);
    if (!held || (transcript.lastEventAt ?? transcript.mtimeMs) > (held.lastEventAt ?? held.mtimeMs)) joining.set(name, transcript);
  }
  for (const transcript of input.transcripts) {
    const id = transcript.sessionId?.trim() || transcript.transcriptPath.split("/").at(-1)?.replace(/\.jsonl$/u, "");
    if (!id) continue;
    const agent = agents.find((a) => a.harnessSessionId === id && a.harness === transcript.source);
    const ownKey = keyOf(transcript.source, id, agent?.homeNodeId ?? input.localNodeId ?? null);
    const name = transcriptLaunchName(transcript);
    const key = !rows.has(ownKey) && name && joining.get(name) === transcript ? launched.get(name)! : ownKey;
    const previous = rows.get(key);
    const machine = previous?.machine ?? agent?.homeNodeId ?? input.localNodeId ?? null;
    const events = eventsById.get(id) ?? [];
    const lastActiveAt = transcript.lastEventAt ?? transcript.mtimeMs;
    // Reuse the lane's observed-turn facts; transcript mtime is not proof of work.
    const native = agent ?? nativeSessionAgent(transcript, lastActiveAt, false, events);
    const observe: ObserveData = nativeObserveData(transcript, events, false);
    const facts = buildLaneFacts(transcript, events, native, [], observe);
    const working = agent ? isAgentBusy(agent.state, agent) : facts.turn?.phase === "started" && now - lastActiveAt < 30 * 60_000;
    const lane: AgentLane = { id, agent: native, source: agent ? "scout" : "native", observe, facts, lastActiveAt, current: working };
    rows.set(key, {
      // a joined row keeps its conversation's id and ref; the lane carries the harness's id
      key, sessionId: previous?.sessionId ?? id, selection: previous?.selection ?? { sessionRef: formatSessionRouteRef(transcript.source, id)!, ...(machine ? { machineId: machine } : {}) },
      title: sessionTitle(transcript) ?? previous?.title ?? facts.currentTask ?? native.name, harness: transcript.source,
      named: operatorNamedSession(transcript) || previous?.named,
      project: transcript.cwd, branch: previous?.branch ?? facts.branch ?? null, model: previous?.model ?? facts.model ?? null,
      machine, machineName: previous?.machineName ?? agent?.homeNodeName ?? null, working,
      asks: previous?.asks || attentionForSession(attention, [id], null, machine, input.localNodeId).length > 0,
      lastActiveAt: Math.max(previous?.lastActiveAt ?? 0, lastActiveAt ?? 0) || null,
      preview: previous?.preview ?? distinctPreview(facts.currentTask, previous?.title ?? facts.currentTask ?? native.name),
      origin: previous?.origin.kind !== "unknown" && previous?.origin ? previous.origin
        : sessionOrigin({ parentSessionId: facts.parentSessionId, agents, operatorName: input.operatorName }),
      conversation: previous?.conversation ?? null, lane,
    });
  }
  return [...rows.values()];
}

/** The bucket for sessions that run in no folder. */
export const NO_PROJECT_LABEL = "No project";

/** The project a row is listed under: its folder's name, "home", or No project. */
export function boardRowProject(row: Pick<SessionBoardRow, "project">): string {
  const label = projectLabelForSession({ workspaceRoot: row.project }, undefined);
  return label === OTHER_CHATS_LABEL ? NO_PROJECT_LABEL : label;
}

const sameWords = (a: string, b: string | null | undefined) => Boolean(b) && a.trim().toLowerCase() === b!.trim().toLowerCase();
/** "Demo app" and "demo-app" name one thing: case, spaces and punctuation aside. */
const sameName = (a: string, b: string) => {
  const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  return key(a) !== "" && key(a) === key(b);
};

/**
 * The name Scout makes up for a harness session it knows only by id: the
 * harness and a short id ("Claude d97dbae8", "Claude subagent ac12655c"). It
 * says no more than the row's harness mark, so it names nobody.
 */
function madeUpName(row: Pick<SessionBoardRow, "lane">, name: string): boolean {
  if (row.lane?.source !== "native") return false;
  const harness = row.lane.agent.harness?.trim();
  if (!harness) return false;
  const lead = `${harness[0]!.toUpperCase()}${harness.slice(1)} `;
  return name.startsWith(lead) && /^(?:subagent )?\S{1,8}$/u.test(name.slice(lead.length));
}

/**
 * A title that only restates the harness and a short id ("Grok 01a1c133",
 * "Claude subagent ac12655c"). The harness mark already says which runtime.
 */
export function isHarnessIdTitle(name: string, harness: string | null | undefined): boolean {
  const text = name.trim();
  if (!text) return false;
  const key = harness?.trim();
  if (key) {
    const lead = `${key[0]!.toUpperCase()}${key.slice(1)} `;
    if (text.toLowerCase().startsWith(lead.toLowerCase())) {
      return /^(?:subagent )?[0-9a-f]{6,8}$/iu.test(text.slice(lead.length));
    }
  }
  return /^(?:subagent )?[0-9a-f]{6,8}$/iu.test(text);
}

/** The session page's heading: an operator name verbatim, a real task, or the short id once the harness word is gone. */
export function sessionPageTitle(task: string, harness: string | null | undefined, operatorNamed = false): string {
  const text = task.trim();
  if (operatorNamed || !isHarnessIdTitle(text, harness)) return text;
  const key = harness?.trim() ?? "";
  if (!key) return text;
  const lead = `${key[0]!.toUpperCase()}${key.slice(1)} `;
  return text.toLowerCase().startsWith(lead.toLowerCase()) ? text.slice(lead.length) : text;
}

/** Who runs the session: its agent's name, else the harness session's own name. */
export function boardRowWho(row: Pick<SessionBoardRow, "conversation" | "lane">): string | null {
  const agentName = row.conversation?.agentName?.trim();
  if (agentName) return agentName;
  const name = row.lane?.agent.name?.trim();
  return name && !madeUpName(row, name) ? name : null;
}

/**
 * A row's line in a list: what the session is about, in plain words. A title
 * that only repeats the agent's name says nothing in a list of that agent's
 * sessions, so the task it is on comes next (as its transcript shows it, else
 * as Scout last asked it), then what it last said; the name is the last resort.
 */
export function boardRowTask(row: Pick<SessionBoardRow, "title" | "named" | "preview" | "conversation" | "lane">): string {
  if (row.named && row.title.trim()) return row.title.trim();
  const who = boardRowWho(row);
  const candidates = [
    sameWords(row.title, who) ? null : row.title,
    row.lane?.facts?.currentTask,
    row.conversation?.task,
    row.preview,
    row.title,
  ];
  for (const candidate of candidates) {
    const line = candidate ? plainListTitle(candidate) : "";
    if (line) return line;
  }
  return row.title;
}

/**
 * The line under the task: who runs it, and who started it when that was not
 * you. Listed under its project, an agent
 * named for that project goes unsaid: the project's line over the rows already
 * says it.
 */
export function boardRowMeta(row: Pick<SessionBoardRow, "title" | "preview" | "conversation" | "lane" | "origin">, under?: string): string {
  const who = boardRowWho(row);
  const task = boardRowTask(row);
  const said = who && (sameWords(task, who) || (under != null && sameName(who, under)));
  // Who started a session belongs in its details, not on every row.
  return who && !said ? who : "";
}

/**
 * A subagent works inside the session that started it, so where both are
 * listed the subagent folds into its parent's row: `subagents` holds the
 * folded rows by the key of the row they fold into, a subagent's subagent
 * under the outermost listed parent. A subagent whose parent is not listed
 * keeps its own row.
 */
export function foldSubagentRows(rows: readonly SessionBoardRow[]): {
  rows: SessionBoardRow[];
  subagents: ReadonlyMap<string, readonly SessionBoardRow[]>;
} {
  // a joined row answers to Scout's session id and to its harness's
  const byId = new Map<string, SessionBoardRow>();
  for (const row of rows) {
    byId.set(row.sessionId, row);
    if (row.lane) byId.set(row.lane.id, row);
  }
  const parentOf = (row: SessionBoardRow) => {
    const id = row.lane?.facts?.parentSessionId?.trim();
    return (id && byId.get(id)) || null;
  };
  // the outermost listed parent; none for a row with no listed parent, or in a loop
  const outermost = (row: SessionBoardRow) => {
    const seen = new Set([row]);
    let at = row;
    for (let up = parentOf(at); up; up = parentOf(at)) {
      if (seen.has(up)) return null;
      seen.add(up);
      at = up;
    }
    return at === row ? null : at;
  };
  const shown: SessionBoardRow[] = [];
  const subagents = new Map<string, SessionBoardRow[]>();
  for (const row of rows) {
    const top = outermost(row);
    if (!top) { shown.push(row); continue; }
    const folded = subagents.get(top.key) ?? [];
    folded.push(row);
    subagents.set(top.key, folded);
  }
  // A parent displaying “Subagent working” belongs with the running rows too.
  shown.sort((a, b) => compareSessionActivity(a, b, subagents));
  return { rows: shown, subagents };
}

export function matchesSessionFilter(row: SessionBoardRow, filter: SessionFilter): boolean {
  if (filter.project && row.project !== filter.project) return false;
  if (filter.machine && (row.machine ?? "local") !== filter.machine) return false;
  if (filter.harness && row.harness !== filter.harness) return false;
  switch (filter.scope) {
    case "working": return row.working;
    case "asks": return row.asks;
    case "working_asks": return row.working || row.asks;
    case "from_agents": return row.origin.kind === "agent";
    default: return true;
  }
}

function running(row: SessionBoardRow) {
  return row.working && !boardRowQueued(row);
}

function compareSessionActivity(a: SessionBoardRow, b: SessionBoardRow, children?: ReadonlyMap<string, readonly SessionBoardRow[]>): number {
  const active = (row: SessionBoardRow) => running(row) || (children?.get(row.key)?.some(running) ?? false);
  return Number(active(b)) - Number(active(a))
    || (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0) || a.key.localeCompare(b.key);
}

/** Members already have their running-first order. Projects rank by time alone. */
export function sessionProjectGroups(rows: SessionBoardRow[]) {
  return groupByProject(rows, boardRowProject)
    .map((group) => ({ ...group, latest: group.sessions.reduce((at, row) => Math.max(at, row.lastActiveAt ?? 0), 0) }))
    .sort((a, b) => b.latest - a.latest || a.label.localeCompare(b.label));
}

/**
 * The ref a listed row is still read by when the refs already tried find
 * nothing: its harness's own id, for a row joined from its transcript. An old execution can
 * outlive a runtime endpoint or its available transcript.
 */
export function boardRowFallbackRef(
  row: Pick<SessionBoardRow, "harness" | "lane" | "sessionId"> | null | undefined,
  tried: readonly (string | null | undefined)[],
): string | null {
  if (!row) return null;
  const id = row.lane?.id?.trim() || row.sessionId;
  const ref = formatSessionRouteRef(row.harness, id);
  if (!ref) return null;
  return tried.some((value) => parseSessionRouteRef(value)?.refId === id) ? null : ref;
}

export function rowMatchesSelection(row: SessionBoardRow, selection: SessionSelection | null | undefined): boolean {
  const parsed = parseSessionRouteRef(selection?.sessionRef);
  // a joined row answers to Scout's id and to its harness's (the lane's)
  if (!selection || !parsed) return false;
  const sameRef = row.sessionId === parsed.refId || row.lane?.id === parsed.refId
    || parseSessionRouteRef(row.selection.sessionRef)?.refId === parsed.refId;
  return sameRef && sessionHarnessMatches(parsed.harness, row.harness)
    && (!selection.machineId || selection.machineId === row.machine);
}

export type SessionRowsInput = {
  conversations: readonly SessionEntry[];
  transcripts: readonly TailDiscoveredTranscript[];
  events: TailEvent[];
  agents: Agent[];
  attention: readonly OperatorAttentionItem[];
  now: number;
  operatorName?: string | null;
  localNodeId?: string | null;
};

/**
 * The board's rows, built once per change of what they are built from, in a
 * seat order every reader shares: two panels on one view draw the same rows
 * in the same order and the build runs once.
 */
export function createSessionRowsMemo() {
  let last: { input: SessionRowsInput; rows: SessionBoardRow[] } | null = null;
  const same = (a: SessionRowsInput, b: SessionRowsInput) =>
    a.conversations === b.conversations && a.transcripts === b.transcripts && a.events === b.events && a.agents === b.agents
    && a.attention === b.attention && a.now === b.now && (a.operatorName ?? null) === (b.operatorName ?? null)
    && (a.localNodeId ?? null) === (b.localNodeId ?? null);
  return (input: SessionRowsInput): SessionBoardRow[] => {
    if (last && same(last.input, input)) return last.rows;
    const rows = buildSessionBoardRows(input).sort(compareSessionActivity);
    last = { input, rows };
    return rows;
  };
}
