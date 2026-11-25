/**
 * The system corner: an alternative companion surface (Studio study
 * /studies/companion-system). One row per thread, named by its task; a
 * thread carries at most one open request; urgent rows sit nearest the
 * corner. Pure functions only, so the rules are testable without a host.
 *
 * Coexists with CompanionScreen: mounted only when the runtime asks for
 * `corner=system` (see companion/main.tsx).
 */

import type { OperatorAttentionItem, WorkItem } from "../../../lib/types.ts";
import { nativeAgentId, nativeAgentName } from "../../../lib/native-agent.ts";
import { stripMarkup } from "../plain-text.ts";
import { isDeclaredRequest, isReadyRequest } from "../../requests/requests-model.ts";
import type { Remark } from "../arrivals/arrivals-model.ts";
import { QUIET_AFTER_MS } from "../arrivals/board-motion.ts";

export type CornerState = "asking" | "working" | "waiting" | "ended";

export type CornerThread = {
  /** Stable key: the work id, or the request id for a request with no work. */
  id: string;
  workId: string | null;
  conversationId: string | null;
  task: string;
  /** Who it is called by: shared by every session of a harness ("claude"), so never what tells agents apart. */
  handle: string;
  /**
   * The agent's own id: its Scout agent, else its harness session (as the
   * web app's agents name it, `native:<harness>:<session>`). Absent when
   * unknown.
   */
  identityId?: string | null;
  /**
   * The agent's own name as the web app draws it: its Scout agent's name, or
   * a native session's ("Claude 0f10496b"). Its face is seeded by it
   * (faceSeed), as the web app seeds its avatars. Absent when unknown.
   */
  faceName?: string | null;
  /** What it is doing or asking right now, one line. */
  now: string;
  state: CornerState;
  at: number;
  request: OperatorAttentionItem | null;
  facts: Array<[string, string]>;
  /** Who runs it and where (the board's identity line); absent when unknown. */
  harness?: string | null;
  project?: string | null;
  branch?: string | null;
  /** Resolved harness session reference, including a Scout-routed session with a conversation. */
  sessionRef?: string | null;
  /** What the host pins when a thread has no work: `session:<id>` for a harness session. */
  pinId?: string | null;
  /** The arrivals board's word for its state; read from `state` when absent. */
  remark?: Remark | null;
  /** When that state began (a clock time on the board); `at` when absent. */
  since?: number | null;
};

/** The id a thread is attached to a window or the desk by: its work, else its session pin. */
export function figureIdOf(t: Pick<CornerThread, "workId" | "pinId">): string | null {
  return t.workId ?? t.pinId ?? null;
}

/**
 * What an agent's face is seeded by (its own sprite, and the crew member the
 * desk hands out by default): its own name as the web app draws it, else its
 * own id, else the id its figure is pinned by. Never the handle, which every session of a harness shares, so two
 * agents never wear one face by accident, and one agent keeps its face
 * across reloads and between the desk, the board and the web app.
 */
export function faceSeed(t: Pick<CornerThread, "faceName" | "identityId" | "workId" | "pinId" | "id">): string {
  return t.faceName || t.identityId || figureIdOf(t) || t.id;
}

/** A pin that is a harness session, not Scout work: there is no work detail to load. */
export function isSessionPin(id: string): boolean {
  return id.startsWith("session:");
}

/** A place the thread lives, backed by a host `open` call. */
export type CornerPlace = { id: "conversation" | "work"; label: string; detail: string };

const ENDED_WINDOW_MS = 30 * 60_000;
const LIVE_WINDOW_MS = 24 * 60 * 60_000;

/** The command of a known native approval payload, or null (prose stays prose). */
export function permissionCommand(item: OperatorAttentionItem): string | null {
  if (!item.permission || !item.summary) return null;
  try {
    const payload = JSON.parse(item.summary) as { method?: unknown; command?: unknown } | null;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (typeof payload.command !== "string" || !payload.command.trim()) return null;
    return payload.command.trim();
  } catch {
    return null;
  }
}

/** One line for a request: "wants to run <cmd>" or its title. */
export function requestLine(item: OperatorAttentionItem): { verb: string; subject: string } {
  if (isReadyRequest(item)) return { verb: "is ready", subject: plainLine(item.ready.summary, 240) };
  const command = permissionCommand(item);
  if (command) return { verb: "wants to run", subject: command };
  if (item.kind === "question") return { verb: "asks", subject: item.title };
  return { verb: "needs", subject: item.title };
}

/** Markdown read as one plain line: no heading marks, emphasis, ticks or bullets. */
export function plainLine(text: string, max = 0): string {
  // tags and HTML comments (a routing marker in an ask's body), never shown
  const out = stripMarkup(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return max > 0 && out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

export function relAge(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 48 * 3600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function workState(item: WorkItem): CornerState {
  if (item.state === "done" || item.state === "cancelled") return "ended";
  if (item.state === "waiting" || item.state === "review" || item.attention === "interrupt") return "waiting";
  return "working";
}

/**
 * Work in the board's words, keeping what each state means: an open ask is
 * ASKING; work running is WORKING since it began, or QUIET once nothing has
 * been reported for QUIET_AFTER_MS; work handed back to you (waiting,
 * review, an interrupt) or done is DONE; cancelled work is STOPPED.
 */
function workRemark(item: WorkItem, state: CornerState, request: OperatorAttentionItem | null, now: number): { remark: Remark; since: number } {
  if (request && isReadyRequest(request)) return { remark: "READY", since: request.ready.at };
  if (request) return { remark: "ASKING", since: request.updatedAt };
  const last = Math.max(item.updatedAt, item.lastMeaningfulAt ?? 0);
  if (state === "working") return now - last >= QUIET_AFTER_MS ? { remark: "QUIET", since: last } : { remark: "WORKING", since: item.createdAt };
  if (item.state === "cancelled") return { remark: "STOPPED", since: item.updatedAt };
  return { remark: "DONE", since: item.updatedAt };
}

function workNow(item: WorkItem, state: CornerState): string {
  const said = plainLine(item.lastMeaningfulSummary ?? item.summary ?? "", 240);
  if (said) return said;
  if (state === "ended") return item.state === "cancelled" ? "cancelled" : "done";
  if (state === "waiting") return item.state === "review" ? "ready for review" : "waiting";
  return item.currentPhase ? item.currentPhase.replace(/_/g, " ") : "working";
}

function workFacts(item: WorkItem, now: number): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  facts.push(["State", item.state.replace(/_/g, " ")]);
  if (item.currentPhase) facts.push(["Phase", item.currentPhase.replace(/_/g, " ")]);
  facts.push(["Started", `${relAge(item.createdAt, now)} ago`]);
  facts.push(["Last report", item.lastMeaningfulAt ? `${relAge(item.lastMeaningfulAt, now)} ago` : "none yet"]);
  if (item.nextMoveOwnerName) facts.push(["Next move", item.nextMoveOwnerName]);
  if (item.activeFlightCount) facts.push(["Running", `${item.activeFlightCount} flight${item.activeFlightCount === 1 ? "" : "s"}`]);
  if (item.parentTitle) facts.push(["Part of", item.parentTitle]);
  return facts;
}

/**
 * Threads from work and requests. A request joins the work that shares its
 * conversation; a request with no work becomes its own thread. Ended work
 * stays for half an hour, live work for a day.
 */
export function buildCornerThreads(work: readonly WorkItem[], requests: readonly OperatorAttentionItem[], now: number): CornerThread[] {
  const open = requests.filter(isDeclaredRequest);
  const used = new Set<string>();
  const threads: CornerThread[] = [];
  for (const item of work) {
    const state = workState(item);
    const at = Math.max(item.updatedAt, item.lastMeaningfulAt ?? 0);
    if (state === "ended" && now - at > ENDED_WINDOW_MS) continue;
    if (state !== "ended" && now - at > LIVE_WINDOW_MS) continue;
    // Ready names its work item; anything else joins by conversation.
    const request = open.find((r) => !used.has(r.id) && isReadyRequest(r) && r.ready.workId === item.id)
      ?? (item.conversationId ? open.find((r) => !used.has(r.id) && r.conversationId === item.conversationId) ?? null : null);
    if (request) used.add(request.id);
    const ready = request && isReadyRequest(request) ? request : null;
    threads.push({
      id: item.id,
      workId: item.id,
      conversationId: item.conversationId,
      task: item.title,
      // A pinned chat is owned by the operator; the board names it by its harness instead.
      handle: request?.agentName ?? (item.claudeSessionId ? "claude" : item.codexThreadId ? "codex" : null) ?? item.ownerName ?? "agent",
      identityId: request?.agentId
        ?? (item.claudeSessionId ? nativeAgentId("claude", item.claudeSessionId) : item.codexThreadId ? nativeAgentId("codex", item.codexThreadId) : null)
        ?? item.ownerId
        ?? null,
      faceName: request?.agentName
        ?? (item.claudeSessionId ? nativeAgentName("claude", item.claudeSessionId) : item.codexThreadId ? nativeAgentName("codex", item.codexThreadId) : null)
        ?? (item.ownerId ? item.ownerName : null)
        ?? null,
      // Ready says what the agent said it did; it waits on the operator, but it is not a question.
      now: ready ? plainLine(ready.ready.summary, 240) || workNow(item, state) : workNow(item, state),
      state: ready ? "waiting" : request ? "asking" : state,
      at: request ? Math.max(at, request.updatedAt) : at,
      request,
      facts: workFacts(item, now),
      ...workRemark(item, state, request, now),
    });
  }
  for (const request of open) {
    if (used.has(request.id)) continue;
    if (isReadyRequest(request)) {
      threads.push({
        id: request.id,
        workId: request.ready.workId,
        conversationId: request.conversationId ?? null,
        task: request.detail ?? request.title,
        handle: request.agentName ?? request.agentId ?? "agent",
        identityId: request.agentId ?? null,
        faceName: request.agentName ?? null,
        now: plainLine(request.ready.summary, 240) || request.title,
        state: "waiting",
        at: request.updatedAt,
        request,
        facts: [["Ready", `${relAge(request.ready.at, now)} ago`]],
        remark: "READY",
        since: request.ready.at,
      });
      continue;
    }
    threads.push({
      id: request.id,
      workId: null,
      conversationId: request.conversationId ?? null,
      task: request.title,
      handle: request.agentName ?? request.agentId ?? "agent",
      identityId: request.agentId ?? null,
      faceName: request.agentName ?? null,
      now: plainLine(request.detail ?? request.title, 240),
      state: "asking",
      at: request.updatedAt,
      request,
      facts: [["From", request.sourceLabel], ["Asked", `${relAge(request.updatedAt, now)} ago`]],
      remark: "ASKING",
      since: request.updatedAt,
    });
  }
  return threads;
}

const RANK: Record<CornerState, number> = { asking: 0, waiting: 1, working: 2, ended: 3 };

/** Nearest the corner first: asks, then waiting, then newest work, then ended. */
export function byUrgency(a: CornerThread, b: CornerThread): number {
  return RANK[a.state] - RANK[b.state] || b.at - a.at;
}

/**
 * Where a thread lives, the right one first. An asking thread goes to its
 * conversation, where the ask is; working and ended work go to the work.
 * Only places the host can open today: terminal and file jumps need a host
 * method that does not exist yet, so they are not offered.
 */
export function placesFor(t: CornerThread): CornerPlace[] {
  const places: CornerPlace[] = [];
  const conversation: CornerPlace | null = t.conversationId ? { id: "conversation", label: "Conversation", detail: "the thread in Scout" } : null;
  const work: CornerPlace | null = t.workId ? { id: "work", label: "Work", detail: "the work in Scout" } : null;
  const first = t.state === "asking" || t.state === "waiting" ? [conversation, work] : [work, conversation];
  for (const p of first) if (p) places.push(p);
  return places;
}

export type CornerTurn = { who: "you" | "them"; text: string };

/**
 * The last few turns of a conversation, oldest first, for the engaged card.
 * The opening ask is already the task line, so it is not said twice.
 */
export function turnsFrom(
  messages: ReadonlyArray<{ actorId: string; body: string; createdAt: number; class: string }>,
  task: string,
  max = 4,
): CornerTurn[] {
  const clean = (s: string) => plainLine(s, 280);
  const same = (a: string, b: string) => clean(a).replace(/[.!]$/, "").toLowerCase() === clean(b).replace(/[.!]$/, "").toLowerCase();
  return [...messages]
    .filter((m) => m.class !== "status" && m.class !== "system" && clean(m.body))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((m): CornerTurn => ({ who: m.actorId === "operator" || m.class === "operator" ? "you" : "them", text: clean(m.body) }))
    .filter((t) => !(t.who === "you" && same(t.text, task)))
    .slice(-max);
}
