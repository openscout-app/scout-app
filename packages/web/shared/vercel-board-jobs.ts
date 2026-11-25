/**
 * Vercel Board jobs: Board tasks in a mirrored channel, folded from the
 * runtime's copy of the channel and its hand-offs into runs (one per plan),
 * jobs (one per task) and attempts (one per claim, for the agent lanes).
 *
 * Vercel Board is a team's coordination surface. It is not Scout's work board;
 * nothing here reads or writes work items.
 *
 * The runtime wire types come from `@openscout/protocol`. Only the room view
 * and the client fold live here.
 *
 * The fold runs on the client: the room read returns the raw copy and
 * hand-offs, and each `vercel_board.handoff` event is applied to them as it
 * arrives (`applyVercelBoardHandoff`), so a change lands without a read.
 */

import type {
  VercelBoardActorRef,
  VercelBoardChannelMirrorStatus,
  VercelBoardConnectionStatus as RuntimeVercelBoardConnectionStatus,
  VercelBoardHandoff,
  VercelBoardHandoffKind,
  VercelBoardMirroredMessage,
  VercelBoardMirrorState,
  VercelBoardTaskState,
} from "@openscout/protocol";

export type {
  VercelBoardActorRef,
  VercelBoardHandoff,
  VercelBoardHandoffKind,
  VercelBoardMirroredMessage,
  VercelBoardMirrorState,
  VercelBoardTaskState,
};

export type VercelBoardChannelStatus = VercelBoardChannelMirrorStatus;
export type VercelBoardConnectionStatus = Pick<RuntimeVercelBoardConnectionStatus,
  "id" | "url" | "state" | "principal" | "profile" | "mirror" | "lastGoodReadAt" | "detail" | "fix">;

/** One Board room as the web server reads it: the raw copy, its hand-offs, and who is who. */
export interface VercelBoardRoomData {
  connectionId: string;
  channel: string;
  conversationId: string;
  /** Where the room comes from, for room details. */
  board: { name: string | null; team: string | null; url: string };
  mirror: VercelBoardMirrorState;
  lastDeltaAt: number | null;
  lastGoodReadAt: number | null;
  connectionState: string;
  operatorPrincipal: string;
  messages: VercelBoardMirroredMessage[];
  handoffs: VercelBoardHandoff[];
  /** Scout agent ID → harness (claude, codex, …), for the lane marks. */
  harnesses: Record<string, string>;
  /** Board actor ID (a principal, or `principal+profile`) → the name Board shows for it. */
  actors?: Record<string, string>;
}

/** Who an actor is, for the table's "who" colour. Never inferred from text. */
export type VercelBoardWhoKind = "operator" | "agent" | "person" | "board";

export interface VercelBoardWho {
  kind: VercelBoardWhoKind;
  /** What the row shows: a Scout agent's handle, "You", or the Board principal. */
  label: string;
  /** The full identity, for a title attribute. */
  detail: string;
  /** A stable key for the actor's lane: the Scout agent ID, or the Board principal. */
  key: string;
}

/**
 * How a job stands. `ready` is unclaimed with nothing left to wait for;
 * `waiting` has needs still to complete. Board's own "open" is every state a
 * task can still leave by being worked (waiting, ready, claimed, blocked).
 */
export type VercelBoardJobState = "ready" | "waiting" | "running" | "blocked" | "done" | "failed" | "cancelled";

export interface VercelBoardChainStep {
  id: string;
  kind: VercelBoardHandoffKind;
  at: number;
  by: VercelBoardWho | null;
  to: VercelBoardWho | null;
  note: string | null;
  derived: boolean;
}

export type VercelBoardAttemptOutcome = "running" | "done" | "failed" | "released" | "blocked" | "cancelled";

/** One claim of a task, from claim to its end: a bar in its holder's lane. */
export interface VercelBoardAttempt {
  who: VercelBoardWho;
  from: number;
  to: number | null;
  outcome: VercelBoardAttemptOutcome;
  derived: boolean;
}

export interface VercelBoardJob {
  taskId: string;
  title: string;
  /** A short name for the task: its `step` label, or its title without the run's common prefix. */
  step: string;
  /** The Scout plan that wrote the task (`scout.plan`), or null for a task written by hand. */
  plan: string | null;
  needs: string[];
  /** When the task left for a worker: its newest claim (or assignment). */
  dispatchedAt: number | null;
  createdAt: number | null;
  from: VercelBoardWho | null;
  to: VercelBoardWho | null;
  state: VercelBoardJobState;
  boardState: VercelBoardTaskState;
  finishedAt: number | null;
  /** First line of the result or the reason. Board text: render as quoted. */
  result: string | null;
  /** The Scout flight carrying the work, when the claim is Scout's. */
  flightId: string | null;
  chain: VercelBoardChainStep[];
  attempts: VercelBoardAttempt[];
  /** Every step is inferred from a backfill, so the real order is unknown. */
  derivedOnly: boolean;
  /** The task's full text (Board text: render as quoted). */
  text: string;
  /** The full result or reason, unabridged. Board text. */
  resultText: string | null;
}

/** The tasks one plan wrote: the page's unit. */
export interface VercelBoardRun {
  key: string;
  label: string;
  startedAt: number | null;
  /** The newest finish, once every task has finished; null while any is open. */
  finishedAt: number | null;
  jobs: VercelBoardJob[];
  /** Scout copied the run after it ran: claims and finish times were not recorded. */
  backfilled: boolean;
}

export const VERCEL_BOARD_PROBE_CHANNEL = "scout/probe";
const CUSTODIAN_MARKER = "Scout custodian marker.";

const SCOUT_AGENT_SUFFIX = /\.[a-z0-9-]+$/i;

/**
 * A plan's name as people read it, or null when the plan has none: a plan made
 * from a message is keyed by that message's ID (`msg-request-<hash>`), which
 * groups its tasks but names nothing.
 */
export function vercelBoardPlanName(plan: string | null | undefined): string | null {
  const name = plan?.trim();
  if (!name || /[0-9a-f]{20,}/i.test(name)) return null;
  return name;
}

/** A Scout agent ID reads better without its node suffix: vbs-claude-a.dev-host → vbs-claude-a. */
export function shortAgentLabel(agentId: string): string {
  const parts = agentId.split(".");
  return parts.length > 1 ? agentId.replace(SCOUT_AGENT_SUFFIX, "") : agentId;
}

interface WhoContext { operatorPrincipal: string; scoutAgentId?: string | null; names?: Record<string, string> }

/** A principal Board has no name for: its ID without the platform prefix. */
function principalLabel(principal: string, context: WhoContext): string {
  return context.names?.[principal] || principal.replace(/^vercel:user:/, "");
}

function agentWho(agentId: string, identity: string): VercelBoardWho {
  return { kind: "agent", label: shortAgentLabel(agentId), detail: `${agentId} · ${identity}`, key: `agent:${agentId}` };
}

/**
 * Who an actor is. A Scout agent named on the event wins. Otherwise the
 * operator's own principal is "You", whatever Board profile wrote it: Scout's
 * custodian writes as the operator's `+scout` profile, and that is plumbing,
 * not a separate actor.
 */
export function whoOf(actor: VercelBoardActorRef | null | undefined, context: WhoContext): VercelBoardWho | null {
  if (!actor) return null;
  const detail = `${actor.principal}${actor.profile ? `+${actor.profile}` : ""}`;
  if (context.scoutAgentId) return agentWho(context.scoutAgentId, detail);
  if (actor.principal === context.operatorPrincipal) return { kind: "operator", label: "You", detail, key: "operator" };
  // A profile Board names is its own actor, as Board shows it: "ada via arach1". Hosted chat
  // posts each member as the token's user plus their profile, so the profile is who wrote it.
  // The `+scout` profile is Scout's custodian, plumbing for the principal, not someone else.
  const own = actor.profile && actor.profile !== "scout" ? context.names?.[actor.actor] : undefined;
  if (own) return { kind: "person", label: `${own} via ${principalLabel(actor.principal, context)}`, detail, key: `person:${actor.actor}` };
  return { kind: "person", label: principalLabel(actor.principal, context), detail, key: `person:${actor.principal}` };
}

/** A Board actor ID in `to`: the operator's own principal, or someone else's. */
function whoOfTarget(target: string | null, context: WhoContext): VercelBoardWho | null {
  if (!target) return null;
  if (context.scoutAgentId) return agentWho(context.scoutAgentId, target);
  const principal = target.replace(/\+.*$/, "");
  if (principal === context.operatorPrincipal) return { kind: "operator", label: "You", detail: target, key: "operator" };
  // A task held for one of a person's profiles (`+reviewer`) is held for that agent.
  const profileName = target !== principal ? context.names?.[target] : undefined;
  if (profileName) return { kind: "agent", label: profileName, detail: target, key: `agent:${target}` };
  return { kind: "person", label: principalLabel(principal, context), detail: target, key: `person:${principal}` };
}

export function jobStateOf(state: VercelBoardTaskState): VercelBoardJobState {
  switch (state) {
    case "ready": return "ready";
    case "waiting": return "waiting";
    case "claimed": return "running";
    case "blocked": return "blocked";
    case "completed": return "done";
    case "failed": return "failed";
    case "canceled": return "cancelled";
  }
}

/**
 * A task's state as it stands now, as Board reads it: a claim past its lease
 * is over, so the task is ready to claim again, whatever the board last wrote.
 */
export function vercelBoardTaskStateNow(task: NonNullable<VercelBoardMirroredMessage["task"]>, now: number): VercelBoardTaskState {
  if (task.state !== "claimed" || !task.claim) return task.state;
  const until = Date.parse(task.claim.until);
  return Number.isFinite(until) && until <= now ? "ready" : "claimed";
}

export function firstLine(text: string | null | undefined, max = 140): string | null {
  if (!text) return null;
  // Results are often Markdown: a one-line cell drops a leading heading or bullet marker.
  const line = text.split("\n").map(part => part.trim().replace(/^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)/, "").trim()).find(Boolean) ?? "";
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Markdown's inline marks off a line: links keep their text, emphasis and code their words. */
function plainInline(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\((?:<[^>]*>|[^)]*)\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/(^|\s)[*_]([^*_\s][^*_]*?)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

function sameWords(a: string, b: string): boolean {
  const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const left = words(a);
  const right = words(b);
  return Boolean(left && right) && (left === right || left.startsWith(`${right} `));
}

/**
 * A result as one line that ends cleanly: the first sentence of its first
 * line of substance. A heading, a label line ("Risks, highest first:") or a
 * line that only repeats the task is skipped while something follows it;
 * Markdown marks come off. A sentence too long for the line stops at a word,
 * with an ellipsis, never inside one.
 */
export function vercelBoardSummary(text: string | null | undefined, title = "", max = 140): string | null {
  if (!text) return null;
  const lines: { text: string; label: boolean }[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```")) { fenced = !fenced; continue; }
    if (fenced || !trimmed || /^(?:[-*_]\s*){3,}$/.test(trimmed) || trimmed.startsWith("|")) continue;
    const heading = /^#{1,6}\s+/.test(trimmed);
    const line = plainInline(trimmed.replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, ""));
    if (line) lines.push({ text: line, label: heading || line.endsWith(":") || (title !== "" && sameWords(line, title)) });
  }
  const line = (lines.find(entry => !entry.label) ?? lines[0])?.text;
  if (!line) return null;
  // the first sentence: a stop followed by a space and a capital, a digit or a quote
  const stop = /[.!?](?=\s+["'\u201c(\[\p{Lu}\p{N}])/u.exec(line);
  const sentence = stop ? line.slice(0, stop.index + 1) : line;
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:\u2013\u2014-]+$/, "")}\u2026`;
}

/** Scout's own housekeeping on the board: the custodian marker and the setup probe. Never a row. */
export function isVercelBoardProbe(message: VercelBoardMirroredMessage): boolean {
  return message.channel === VERCEL_BOARD_PROBE_CHANNEL
    || message.labels["scout.probe"] !== undefined
    || message.text.startsWith(CUSTODIAN_MARKER);
}

const FINISHED = new Set<VercelBoardJobState>(["done", "failed", "cancelled"]);
const FINISH_KINDS = new Set<VercelBoardHandoffKind>(["completed", "failed", "canceled"]);
const DISPATCH_KINDS = new Set<VercelBoardHandoffKind>(["claimed", "assigned"]);
const ORIGIN_KINDS = new Set<VercelBoardHandoffKind>(["created", "planned", "assigned"]);

function sortHandoffs(events: VercelBoardHandoff[]): VercelBoardHandoff[] {
  return events.slice().sort((a, b) => a.at - b.at || a.cursor.localeCompare(b.cursor));
}

/** Claims and how each ended, in order. A finished task with no recorded end closes at its finish. */
function attemptsOf(events: VercelBoardHandoff[], ctx: (event: VercelBoardHandoff) => WhoContext, finishedAt: number | null, state: VercelBoardJobState, lapsedAt: number | null): VercelBoardAttempt[] {
  const attempts: VercelBoardAttempt[] = [];
  let current: VercelBoardAttempt | null = null;
  let closing: VercelBoardHandoff | null = null;
  const close = (at: number, outcome: VercelBoardAttemptOutcome) => {
    if (!current) return;
    current.to = Math.max(current.from, at);
    current.outcome = outcome;
    // a claim ended by an event the copy made up at backfill has no end it can vouch for
    if (closing?.derived) current.derived = true;
    current = null;
  };
  for (const event of events) {
    closing = event;
    if (event.kind === "claimed" || (event.kind === "assigned" && event.to)) {
      const who = whoOfTarget(event.to, ctx(event));
      if (!who) continue;
      close(event.at, "released");
      current = { who, from: event.at, to: null, outcome: "running", derived: Boolean(event.derived) };
      attempts.push(current);
    } else if (event.kind === "released" || event.kind === "expired") close(event.at, "released");
    else if (event.kind === "completed") close(event.at, "done");
    else if (event.kind === "failed") close(event.at, "failed");
    else if (event.kind === "canceled") close(event.at, "cancelled");
    else if (event.kind === "blocked") close(event.at, "blocked");
  }
  // The copy is the truth on state: an attempt still open on a finished task ends at the finish.
  const open = current as VercelBoardAttempt | null;
  // a claim whose lease ran out ended there, though no event says so yet
  if (open && lapsedAt !== null) {
    open.to = Math.max(open.from, lapsedAt);
    open.outcome = "released";
  } else if (open && FINISHED.has(state)) {
    // with no finish time it can vouch for, the claim's end is unknown: it leaves the lanes
    open.to = finishedAt !== null ? Math.max(open.from, finishedAt) : open.from;
    if (finishedAt === null) open.derived = true;
    open.outcome = state === "done" ? "done" : state === "failed" ? "failed" : "cancelled";
  }
  return attempts;
}

/**
 * Fold one channel into job rows. The task's state comes from the copy (Board
 * owns it); the who-and-when comes from the hand-off chain. The newest claim
 * wins `to` and `dispatchedAt`, so a release and re-claim shows the current
 * holder and keeps the earlier one in the chain. Probe tasks and replies are
 * not rows.
 */
export function foldVercelBoardJobs(input: {
  messages: VercelBoardMirroredMessage[];
  handoffs: VercelBoardHandoff[];
  operatorPrincipal: string;
  actors?: Record<string, string>;
  /** The time to read claims' leases against. */
  now?: number;
}): VercelBoardJob[] {
  const now = input.now ?? Date.now();
  const byTask = new Map<string, VercelBoardHandoff[]>();
  for (const handoff of input.handoffs) {
    const list = byTask.get(handoff.taskId) ?? [];
    if (!list.some(existing => existing.id === handoff.id)) list.push(handoff);
    byTask.set(handoff.taskId, list);
  }
  const base: WhoContext = { operatorPrincipal: input.operatorPrincipal, names: input.actors };
  const ctx = (event: VercelBoardHandoff): WhoContext => ({ ...base, scoutAgentId: event.scout?.agentId ?? null });
  const jobs: VercelBoardJob[] = [];
  for (const message of input.messages) {
    if (message.re !== null || !message.task || isVercelBoardProbe(message)) continue;
    const events = sortHandoffs(byTask.get(message.id) ?? []);
    const chain: VercelBoardChainStep[] = events.map(event => ({
      id: event.id,
      kind: event.kind,
      at: event.at,
      by: whoOf(event.actor, base),
      to: DISPATCH_KINDS.has(event.kind) || event.kind === "completed" || event.kind === "failed" ? whoOfTarget(event.to, ctx(event)) : null,
      note: firstLine(event.result ?? event.reason ?? null, 120),
      derived: Boolean(event.derived),
    }));
    const origin = events.find(event => ORIGIN_KINDS.has(event.kind));
    const dispatch = [...events].reverse().find(event => DISPATCH_KINDS.has(event.kind));
    const finish = [...events].reverse().find(event => FINISH_KINDS.has(event.kind));
    const scoutClaim = [...events].reverse().find(event => event.scout);
    const boardState = vercelBoardTaskStateNow(message.task, now);
    const state = jobStateOf(boardState);
    const lapsedAt = boardState !== message.task.state && message.task.claim ? Date.parse(message.task.claim.until) : null;
    // Board keeps a blocked task's reason apart from a finish's: the copy may only have it on the hand-off.
    const block = state === "blocked" ? [...events].reverse().find(event => event.kind === "blocked") : undefined;
    const said = message.task.result ?? message.task.reason ?? finish?.result ?? finish?.reason ?? block?.reason ?? null;
    const finished = state === "done" || state === "failed" || state === "cancelled";
    // A finish the copy made up at backfill carries the backfill's time, not
    // the task's: it is not a time Scout can vouch for.
    const finishedAt = finished ? ((finish && !finish.derived ? finish.at : null) ?? message.editedAt ?? null) : null;
    // Board names the current holder on the task itself, even when no claim event was copied.
    const holder = message.task.claim?.actor ? whoOfTarget(message.task.claim.actor, base) : null;
    const title = firstLine(message.deleted ? "Deleted on the board" : message.text, 160) ?? message.id;
    jobs.push({
      taskId: message.id,
      title,
      step: message.labels.step?.trim() || title,
      plan: message.labels["scout.plan"]?.trim() || null,
      needs: message.task.needs ?? [],
      createdAt: message.createdAt ?? origin?.at ?? null,
      // a claim time the copy made up at backfill is not the claim's
      dispatchedAt: dispatch && !dispatch.derived ? dispatch.at : null,
      from: origin ? whoOf(origin.actor, base) : whoOf(message.by, base),
      to: dispatch ? whoOfTarget(dispatch.to, ctx(dispatch)) : (scoutClaim ? whoOfTarget(scoutClaim.to, ctx(scoutClaim)) : holder),
      state,
      boardState,
      finishedAt,
      result: firstLine(said),
      flightId: scoutClaim?.scout?.flightId ?? null,
      chain,
      attempts: attemptsOf(events, ctx, finishedAt, state, lapsedAt),
      derivedOnly: chain.length > 0 && chain.every(step => step.derived),
      text: message.deleted ? "Deleted on the board" : message.text,
      resultText: said,
    });
  }
  // A stable order, so a row never jumps while it is watched: newest task first,
  // and a plan's tasks (written in one call) in the order they were planned.
  const order = new Map(jobs.map((job, index) => [job.taskId, index]));
  return jobs.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || order.get(a.taskId)! - order.get(b.taskId)!);
}

/** "Swarm test: review the mirror" and "Swarm test: combine…" share "Swarm test". */
function commonTitlePrefix(titles: string[]): string | null {
  const heads = titles.map(title => title.includes(":") ? title.slice(0, title.indexOf(":")).trim() : null);
  const first = heads[0];
  return first && heads.every(head => head === first) ? first : null;
}

/**
 * Group jobs into runs, one per Scout plan; a task written by hand is a run of
 * its own. Runs come newest first; within a run, tasks keep the plan's order.
 * A step without a `step` label drops the run's shared title prefix.
 */
export function groupVercelBoardRuns(jobs: VercelBoardJob[]): VercelBoardRun[] {
  const byKey = new Map<string, VercelBoardJob[]>();
  for (const job of jobs) {
    const key = job.plan ? `plan:${job.plan}` : `task:${job.taskId}`;
    const list = byKey.get(key) ?? [];
    list.push(job);
    byKey.set(key, list);
  }
  const runs: VercelBoardRun[] = [];
  for (const [key, list] of byKey) {
    // a run reads in the order it was planned; a plan's tasks share a time and keep the fold's plan order
    const planned = list.slice().sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const prefix = planned.length > 1 ? commonTitlePrefix(planned.map(job => job.title)) : null;
    const withSteps = planned.map(job => job.step !== job.title || !prefix ? job : { ...job, step: job.title.slice(job.title.indexOf(":") + 1).trim() || job.title });
    const starts = withSteps.map(job => job.createdAt).filter((at): at is number => at !== null);
    const done = withSteps.every(job => FINISHED.has(job.state));
    const ends = withSteps.map(job => job.finishedAt);
    // the run's end is the newest finish, and only when every finish is known
    const endsKnown = ends.every((at): at is number => at !== null);
    runs.push({
      key,
      label: prefix ?? (planned.length === 1 ? withSteps[0]!.title : vercelBoardPlanName(list[0]!.plan) ?? withSteps[0]!.title),
      startedAt: starts.length ? Math.min(...starts) : null,
      finishedAt: done && endsKnown && ends.length ? Math.max(...(ends as number[])) : null,
      jobs: withSteps,
      backfilled: withSteps.every(job => job.derivedOnly || job.chain.length === 0),
    });
  }
  return runs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

/** Depth in the run's `needs` graph: a task with no needs inside the run is stage 0. */
export function vercelBoardStages(run: VercelBoardRun): VercelBoardJob[][] {
  const inRun = new Map(run.jobs.map(job => [job.taskId, job]));
  const depth = new Map<string, number>();
  const visit = (job: VercelBoardJob, seen: Set<string>): number => {
    const known = depth.get(job.taskId);
    if (known !== undefined) return known;
    if (seen.has(job.taskId)) return 0;
    seen.add(job.taskId);
    const parents = job.needs.map(id => inRun.get(id)).filter((parent): parent is VercelBoardJob => Boolean(parent));
    const value = parents.length ? 1 + Math.max(...parents.map(parent => visit(parent, seen))) : 0;
    depth.set(job.taskId, value);
    return value;
  };
  const stages: VercelBoardJob[][] = [];
  for (const job of run.jobs) {
    const d = visit(job, new Set());
    (stages[d] ??= []).push(job);
  }
  return stages.filter(Boolean);
}

/**
 * The Board task state a hand-off leaves behind, as Board folds it. `null`:
 * the hand-off doesn't say. An unblocked task that needs others goes back to
 * waiting; Board sends `task.ready` at once if they have all completed.
 */
function stateAfter(kind: VercelBoardHandoffKind, task: NonNullable<VercelBoardMirroredMessage["task"]>): VercelBoardTaskState | null {
  switch (kind) {
    case "unblocked": return task.needs.length > 0 ? "waiting" : "ready";
    case "claimed": case "assigned": return "claimed";
    case "completed": return "completed";
    case "failed": return "failed";
    case "canceled": return "canceled";
    case "blocked": return "blocked";
    case "released": case "expired": case "reopened": return "ready";
    default: return null;
  }
}

/**
 * Apply one streamed hand-off to a room's raw data, so the change lands before
 * the next read. Returns the same object when the hand-off is already known or
 * names a task the copy hasn't seen yet (a newly planned task needs a read for
 * its text and labels). The next read is still the truth.
 */
export function applyVercelBoardHandoff(data: VercelBoardRoomData, handoff: VercelBoardHandoff): VercelBoardRoomData {
  if (handoff.connectionId !== data.connectionId || handoff.channel !== data.channel) return data;
  if (data.handoffs.some(existing => existing.id === handoff.id)) return data;
  const index = data.messages.findIndex(message => message.id === handoff.taskId);
  if (index < 0) return data;
  const message = data.messages[index]!;
  const next = message.task ? stateAfter(handoff.kind, message.task) : null;
  const messages = data.messages.slice();
  if (next && message.task) {
    messages[index] = {
      ...message,
      task: {
        ...message.task,
        state: next,
        // a new claim's lease is the next read's to say; every other move ends the claim
        claim: null,
        ...(handoff.epoch !== undefined ? { epoch: handoff.epoch } : {}),
        ...(handoff.kind === "completed" && handoff.result ? { result: handoff.result } : {}),
        ...((handoff.kind === "failed" || handoff.kind === "blocked" || handoff.kind === "canceled") && handoff.reason ? { reason: handoff.reason } : {}),
      },
    };
  }
  return { ...data, messages, handoffs: [...data.handoffs, handoff] };
}

/** "General" and "arach" from https://api.vercel.com/v1/messageboard/boards/General?teamId=arach. */
export function vercelBoardSource(url: string): { name: string | null; team: string | null } {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.match(/\/boards\/([^/]+)/)?.[1];
    return { name: name ? decodeURIComponent(name) : null, team: parsed.searchParams.get("teamId") };
  } catch {
    return { name: null, team: null };
  }
}

/* ── the conversation: the channel as a message stream ───────────────────── */

/** A reply in a task's (or a post's) Board thread. Board text: render as quoted. */
export interface VercelBoardReply {
  id: string;
  at: number | null;
  by: VercelBoardWho | null;
  text: string;
}

/** One entry in a post's thread: a Board reply, or a hand-off from the task's chain. */
export type VercelBoardThreadEntry =
  | { kind: "reply"; id: string; at: number | null; reply: VercelBoardReply }
  | { kind: "step"; id: string; at: number | null; step: VercelBoardChainStep };

/**
 * One root message in the channel: a task (with its job fold) or a plain
 * post. Its thread holds the Board replies and, for a task, its hand-offs.
 */
export interface VercelBoardPost {
  id: string;
  at: number | null;
  by: VercelBoardWho | null;
  /** Board text: render as quoted. */
  text: string;
  plan: string | null;
  job: VercelBoardJob | null;
  thread: VercelBoardThreadEntry[];
  replyCount: number;
}

/**
 * The channel as a stream, oldest first: every root message, each with its
 * thread (Board replies, and for a task its claims and hand-offs, in order).
 * A step the copy made up at backfill has no time of its own: it keeps its
 * place after the dated entries and shows no time.
 */
export function foldVercelBoardConversation(input: {
  messages: VercelBoardMirroredMessage[];
  handoffs: VercelBoardHandoff[];
  operatorPrincipal: string;
  actors?: Record<string, string>;
}): VercelBoardPost[] {
  const base: WhoContext = { operatorPrincipal: input.operatorPrincipal, names: input.actors };
  const jobs = new Map(foldVercelBoardJobs(input).map(job => [job.taskId, job]));
  const replies = new Map<string, VercelBoardReply[]>();
  for (const message of input.messages) {
    if (message.re === null || isVercelBoardProbe(message)) continue;
    const scoutAgentId = message.labels["scout.agent"] && message.labels["scout.agent"] !== "operator" ? message.labels["scout.agent"] : null;
    const list = replies.get(message.re) ?? [];
    list.push({ id: message.id, at: message.createdAt, by: whoOf(message.by, { ...base, scoutAgentId }), text: message.deleted ? "Deleted on the board" : message.text });
    replies.set(message.re, list);
  }
  const posts: VercelBoardPost[] = [];
  for (const message of input.messages) {
    if (message.re !== null || isVercelBoardProbe(message)) continue;
    const job = jobs.get(message.id) ?? null;
    const own = replies.get(message.id) ?? [];
    const dated: VercelBoardThreadEntry[] = [
      ...own.map(reply => ({ kind: "reply" as const, id: reply.id, at: reply.at, reply })),
      // the task's posting is the message itself; its thread starts at the first move
      ...(job?.chain ?? []).filter(step => step.kind !== "planned" && step.kind !== "created").map(step => ({ kind: "step" as const, id: step.id, at: step.derived ? null : step.at, step })),
    ];
    const thread = dated.slice().sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
    posts.push({
      id: message.id,
      at: message.createdAt,
      by: whoOf(message.by, base),
      text: message.deleted ? "Deleted on the board" : message.text,
      plan: message.labels["scout.plan"]?.trim() || null,
      job,
      thread,
      replyCount: own.length,
    });
  }
  const order = new Map(input.messages.map((message, index) => [message.id, index]));
  return posts.sort((a, b) => (a.at ?? 0) - (b.at ?? 0) || order.get(a.id)! - order.get(b.id)!);
}

/** Which view a Board room opens on. */
export type VercelBoardView = "conversation" | "tasks";

/**
 * A channel opens on Tasks when it is mostly tasks (an operational board,
 * such as scout/work). It opens on Conversation when it is mostly talk, and
 * for a decisions channel, which is read as a discussion even when its
 * questions are posted as tasks.
 */
export function vercelBoardDefaultView(channel: string, messages: VercelBoardMirroredMessage[]): VercelBoardView {
  if (/(^|\/)decisions$/i.test(channel)) return "conversation";
  const roots = messages.filter(message => message.re === null && !isVercelBoardProbe(message));
  if (!roots.length) return "conversation";
  return roots.filter(message => message.task).length * 2 >= roots.length ? "tasks" : "conversation";
}
