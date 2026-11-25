import { backgroundReads } from "../../background-reads.ts";
import { isOpaqueChannelId, type CollaborationEvent, type CollaborationKind } from "@openscout/protocol";
import { getScoutWebPairingSessionSnapshots, type ScoutPairingState } from "../../pairing.ts";
import { queryAgents, queryBrokerAttentionHints, queryFleet } from "../../db-queries.ts";
import { queryAgentIdsByEndpointSessionId } from "../../db/agents.ts";
import { queryOperatorAttentionRows } from "../../db/fleet.ts";
import { buildAgentAttentionIndex, type AgentAttentionEntry } from "./agent-attention.ts";
import { collectTmuxHostAttention, type TmuxHostAttentionItem } from "./tmux-host-attention.ts";
import { collectHerdrContinuationStops } from "./herdr-continuation.ts";
import type { PanePrompt } from "./pane-dialog.ts";
import {
  resolveHerdrContinuationHooks,
  type HerdrContinuationHooks,
  type HerdrContinuationOptions,
} from "./herdr-continuation-host.ts";
import { appendScoutCollaborationEvent, loadScoutBrokerContext, loadScoutRemoteApprovals, readScoutBrokerTailDiscovery, type ScoutBrokerContext, type ScoutRemoteApprovalNode } from "../broker/service.ts";
import type { DiscoverySnapshot } from "@openscout/runtime/tail";
import { projectSessionsAttention, sessionApprovalAttentionId, type SessionAttentionItem } from "@openscout/runtime";
import { loadPairingState } from "../../pairing-state.ts";
import { CreateOpenScoutWebServerOptions } from "../../web-server-options.ts";
import { activeEndpointForAgent, brokerCardAgentsForWeb, mergeBrokerAgentProjection } from "../../broker-agent-projection.ts";
import { defaultCaptureTmuxPane } from "../../tmux-pane-capture.ts";
import { resolveOperatorName } from "@openscout/runtime/user-config";
import { declaredNeedOptions, pendingOperatorNeeds, restatesTitle } from "./operator-needs.ts";
import { queryRecentMessages } from "../../db/messages.ts";
import { nativeActorName, parseNativePermission, type NativePermission } from "./native-permission.ts";
import type { WebBrokerRouteAttempt, WebTaskReady } from "../../../shared/api/web.ts";

export type OperatorAttentionItem = {
  id: string;
  /** `ready`: a task the operator marked notify finished; their move is Continue or Hold. Not a question. */
  kind: "approval" | "configuration" | "ask" | "work_item" | "question" | "session" | "ready";
  title: string;
  summary: string | null;
  detail: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  updatedAt: number;
  severity: "critical" | "warning" | "info";
  sourceLabel: string;
  permission?: { requestId: string; version: string; sessionId: string; projectRoot: string; flightId?: string; native?: NativePermission };
  approval?: ScoutPairingState["pendingApprovals"][number];
  /** Where a reply answers a declared question, and the answers it offered (may be none): an option, or the operator's own words, is sent as the reply. */
  answer?: { conversationId: string; replyToMessageId: string; options: string[] };
  /**
   * The pane a prompt was caught on. A tmux pane the companion can join at the pane's own size; a Herdr pane is
   * named only for a plain permission dialog, which Yes / No answer from here (there is no live view of it).
   */
  pane?: { backend: "tmux"; sessionName: string; prompt?: PanePrompt } | { backend: "herdr"; sessionName: string; prompt: PanePrompt };
  /** A Ready task: the flight the runtime wrote Ready on, and the agent's summary line. */
  ready?: { invocationId: string; flightId: string; workId: string | null; summary: string; at: number };
  actions: Array<{
    kind: "approve" | "deny" | "open" | "configure" | "copy" | "dismiss" | "continue" | "hold";
    label: string;
    route?: { view: string; [key: string]: string | undefined };
    value?: string;
    recordId?: string;
    recordKind?: CollaborationKind;
    flightId?: string;
  }>;
};

export const AGENT_ATTENTION_TTL_MS = 10_000;

export const AGENT_BACKGROUND_REFRESH_DELAY_MS = 500;

export type TmuxPaneCapture = NonNullable<CreateOpenScoutWebServerOptions["captureTmuxPane"]>;

export type AgentAttentionSnapshot = {
  index: Map<string, AgentAttentionEntry>;
  hostItems: TmuxHostAttentionItem[];
};

export let agentAttentionCache: {
  at: number;
  capture: TmuxPaneCapture;
  herdr: HerdrContinuationHooks | null;
  snapshot: AgentAttentionSnapshot;
} | null = null;

export let agentAttentionInFlight: {
  capture: TmuxPaneCapture;
  herdr: HerdrContinuationHooks | null;
  promise: Promise<AgentAttentionSnapshot>;
} | null = null;

let agentAttentionGeneration = 0;

/** A live permission decision invalidates host observations as well as the API row. */
export function invalidateAgentAttentionSnapshot(): void {
  agentAttentionGeneration++;
  agentAttentionCache = null;
  agentAttentionInFlight = null;
}

let activeHerdrContinuation: HerdrContinuationHooks | null = null;

/** Called once per web server. Resets the attention cache it feeds. */
export function configureHerdrContinuation(option: HerdrContinuationOptions | undefined): void {
  activeHerdrContinuation = resolveHerdrContinuationHooks(option);
  invalidateAgentAttentionSnapshot();
}

export function queryAgentAttentionSnapshot(
  broker: ScoutBrokerContext | null,
  capture: TmuxPaneCapture = defaultCaptureTmuxPane,
): Promise<AgentAttentionSnapshot> {
  const herdr = activeHerdrContinuation;
  const generation = agentAttentionGeneration;
  const cached = agentAttentionCache;
  if (cached && cached.capture === capture && cached.herdr === herdr) {
    if (Date.now() - cached.at >= AGENT_ATTENTION_TTL_MS && !agentAttentionInFlight) {
      const promise = delay(AGENT_BACKGROUND_REFRESH_DELAY_MS)
        .then(() => buildAgentAttentionIndexSnapshot(broker, capture, generation))
        .finally(() => {
          if (agentAttentionInFlight?.promise === promise) {
            agentAttentionInFlight = null;
          }
        });
      agentAttentionInFlight = { capture, herdr, promise };
    }
    return Promise.resolve(cached.snapshot);
  }
  if (agentAttentionInFlight?.capture === capture && agentAttentionInFlight.herdr === herdr) {
    return agentAttentionInFlight.promise;
  }
  const promise = buildAgentAttentionIndexSnapshot(broker, capture, generation).finally(() => {
    if (agentAttentionInFlight?.promise === promise) {
      agentAttentionInFlight = null;
    }
  });
  agentAttentionInFlight = { capture, herdr, promise };
  return promise;
}

/** The pane behind a listed tmux prompt item, as the attention snapshot last saw it. */
export async function findTmuxPromptPane(
  itemId: string,
  capture: TmuxPaneCapture = defaultCaptureTmuxPane,
): Promise<{ agentId: string; sessionName: string; paneTarget: string } | null> {
  const broker = await loadScoutBrokerContext().catch(() => null);
  const snapshot = await queryAgentAttentionSnapshot(broker, capture);
  const item = snapshot.hostItems.find((candidate) => candidate.id === itemId && candidate.paneTarget);
  return item ? { agentId: item.agentId, sessionName: item.sessionId, paneTarget: item.paneTarget! } : null;
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function buildAgentAttentionIndexSnapshot(
  broker: ScoutBrokerContext | null,
  capture: TmuxPaneCapture,
  generation = agentAttentionGeneration,
): Promise<AgentAttentionSnapshot> {
  try {
    const pairingSnapshots = await getScoutWebPairingSessionSnapshots().catch(() => []);
    const sessionItems = pairingSnapshots.length > 0 ? projectSessionsAttention(pairingSnapshots) : [];
    let agentIdBySessionId = new Map<string, string>();
    try {
      // With no pairing attention to join, the full session-to-agent map is unused.
      if (sessionItems.length > 0) agentIdBySessionId = await backgroundReads.endpointAgentIds();
    } catch {
      // A direct host-attention row already owns its agent id; a temporarily
      // unavailable read model must not suppress that independent signal.
    }
    // The broker snapshot is the live authority on which agent currently
    // holds a session — it overrides any stale endpoint row in the db.
    for (const agent of Object.values(broker?.snapshot.agents ?? {})) {
      const sessionId = broker
        ? activeEndpointForAgent(broker.snapshot, agent.id)?.sessionId?.trim()
        : null;
      if (sessionId) {
        agentIdBySessionId.set(sessionId, agent.id);
      }
    }

    // Host attention only needs the current tmux surface metadata. Resolving
    // Claude transcript identities here synchronously scans transcript
    // directories for every historical roster row before the 24-candidate
    // host-attention cap is applied, which can block the web event loop for
    // minutes on a long-lived installation.
    const databaseAgents = await backgroundReads.agents();
    const brokerAgents = broker ? brokerCardAgentsForWeb(broker) : [];
    const candidatesById = new Map(databaseAgents.map((agent) => [agent.id, agent]));
    for (const agent of brokerAgents) {
      candidatesById.set(agent.id, mergeBrokerAgentProjection(candidatesById.get(agent.id) ?? agent, agent));
    }
    const tmuxItems = await collectTmuxHostAttention(
      [...candidatesById.values()],
      async (agent, paneTarget) => {
        const terminal = agent.terminalSurface;
        if (!terminal) return null;
        const result = await capture({
          agentId: agent.id,
          sessionId: terminal.sessionName,
          paneTarget,
          cwd: agent.cwd ?? agent.projectRoot,
          lines: 80,
          columns: 240,
        });
        return result?.body ?? null;
      },
    );
    const herdr = activeHerdrContinuation;
    const herdrItems = herdr
      ? await collectHerdrContinuationStops({
        ...herdr,
        agents: [...candidatesById.values()],
      }).catch(() => [])
      : [];
    const hostItems: TmuxHostAttentionItem[] = [...tmuxItems, ...herdrItems];
    const snapshot = {
      hostItems,
      index: buildAgentAttentionIndex({
        sessionItems,
        agentIdBySessionId,
        collaborationRows: await (async () => {
          try {
            return await backgroundReads.attentionRows();
          } catch {
            return [];
          }
        })(),
        hostRows: hostItems,
      }),
    };
    if (generation === agentAttentionGeneration) agentAttentionCache = { at: Date.now(), capture, herdr, snapshot };
    return snapshot;
  } catch (error) {
    // Attention is a decoration on the agent list, never a reason to 500 it.
    console.warn("[openscout-web] attention snapshot failed", error);
    const cached = agentAttentionCache;
    if (cached?.capture === capture) return cached.snapshot;
    return {
      index: new Map<string, AgentAttentionEntry>(),
      hostItems: [],
    };
  }
}

export function severityRank(severity: OperatorAttentionItem["severity"]): number {
  switch (severity) {
    case "critical":
      return 0;
    case "warning":
      return 1;
    default:
      return 2;
  }
}

export function compactAttentionSummary(value: string | null | undefined, max = 220): string | null {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  if (!compacted) {
    return null;
  }
  return compacted.length > max ? `${compacted.slice(0, max - 1)}...` : compacted;
}

export function buildScoutEntityId(prefix: string, createdAtMs: number): string {
  return `${prefix}-${createdAtMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function dismissCollaborationAction(recordKind: CollaborationKind, recordId: string): OperatorAttentionItem["actions"][number] {
  return {
    kind: "dismiss",
    label: "Dismiss",
    recordKind,
    recordId,
  };
}

export async function dismissCollaborationAttention(input: {
  recordKind: CollaborationKind;
  recordId: string;
  itemUpdatedAt: number;
}): Promise<void> {
  const at = Date.now();
  const event: CollaborationEvent = {
    id: buildScoutEntityId("evt", at),
    recordId: input.recordId,
    recordKind: input.recordKind,
    kind: "dismissed",
    actorId: "operator",
    at,
    summary: "Dismissed from operator queue.",
    metadata: {
      source: "openscout-web",
      itemUpdatedAt: input.itemUpdatedAt,
    },
  };
  await appendScoutCollaborationEvent(event);
}

/**
 * Why a route attempt failed, as the runtime recorded it. A failed delivery's
 * `detail` is the message it carried, so a message that only discusses
 * permissions must never read as a blocked session.
 */
export function routeFailureText(failure: Pick<WebBrokerRouteAttempt, "kind" | "detail" | "metadata">): string {
  if (failure.kind !== "failed_delivery") return failure.detail;
  const metadata = failure.metadata ?? {};
  for (const key of ["failureDetail", "failureReason", "reason"]) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

export function permissionSetupHint(detail: string): OperatorAttentionItem | null {
  const normalized = detail.toLowerCase();
  const mentionsPermission = /permission|approval|allow|blocked/.test(normalized);
  // 0.5 cores name the tool `reply`; sessions on older cores still ask for `messages_reply`.
  const replyTool =
    /\bmcp__?scout__messages_reply\b/.test(normalized) || /\bmcp\b.*\bmessages_reply\b/.test(normalized)
      ? "messages_reply"
      : /\bmcp__?scout__reply\b/.test(normalized)
        ? "reply"
        : null;
  const mentionsScoutMcpReply = replyTool !== null;
  const mentionsScoutMcpAsk =
    /\bmcp__?scout__ask\b/.test(normalized) ||
    /\bmcp\b.*\bscout ask\b/.test(normalized);
  const mentionsScoutMcpTool = mentionsScoutMcpReply || mentionsScoutMcpAsk;
  const mentionsScoutTool = /scout ask|allowedtools|allowlist/.test(normalized) || mentionsScoutMcpTool;
  if (!mentionsPermission || !mentionsScoutTool) {
    return null;
  }

  const command = mentionsScoutMcpTool
    ? `/allow mcp__scout__${replyTool ?? "ask"}`
    : `{ "allowedTools": ["Bash(scout:*)"] }`;
  const title = mentionsScoutMcpTool
    ? "Claude needs Scout MCP permission"
    : "Claude needs Scout CLI permission";
  const remediationDetail = mentionsScoutMcpTool
    ? "This is a Claude-session permission. Copy the /allow line, paste it into the blocked Claude session, then retry the Scout request."
    : "This is a Claude-session permission. Copy the allowed-tools snippet into the blocked Claude session or project settings, then retry the Scout request.";

  return {
    id: `config:${mentionsScoutMcpTool ? `mcp-scout-${(replyTool ?? "ask").replace("_", "-")}` : "scout-ask-cli"}`,
    kind: "configuration",
    title,
    summary: compactAttentionSummary(detail),
    detail: remediationDetail,
    agentId: null,
    agentName: null,
    conversationId: null,
    updatedAt: Date.now(),
    severity: "critical",
    sourceLabel: "Claude permissions",
    actions: [
      {
        kind: "copy",
        label: "Copy Claude fix",
        value: command,
      },
    ],
  };
}

export function dedupeAttentionItems(items: OperatorAttentionItem[]): OperatorAttentionItem[] {
  const byId = new Map<string, OperatorAttentionItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()].sort((left, right) => {
    const bySeverity = severityRank(left.severity) - severityRank(right.severity);
    if (bySeverity !== 0) {
      return bySeverity;
    }
    return right.updatedAt - left.updatedAt;
  });
}

export function operatorAttentionFromSessionItem(item: SessionAttentionItem): OperatorAttentionItem {
  const route = {
    view: "follow",
    sessionId: item.sessionId,
    preferredView: "session",
  };
  const approvalActions = item.kind === "approval" && item.approval
    ? [
        { kind: "approve" as const, label: "Approve" },
        { kind: "deny" as const, label: "Deny" },
      ]
    : [];
  const openAction = {
    kind: "open" as const,
    label: "Open session",
    route,
  };

  return {
    id: item.id,
    kind: item.kind === "approval"
      ? "approval"
      : item.kind === "question"
        ? "question"
        : "session",
    title: item.title,
    summary: item.summary,
    detail: item.detail,
    agentId: null,
    agentName: item.sessionName,
    conversationId: null,
    updatedAt: item.updatedAt,
    severity: item.severity,
    sourceLabel: item.sourceLabel,
    ...(item.approval ? { approval: item.approval } : {}),
    actions: [
      ...approvalActions,
      openAction,
    ],
  };
}

/**
 * Approvals waiting on another machine that shares them with this one. Only a
 * live link offers Approve/Deny; the answer is forwarded to that machine.
 */
export function remoteApprovalItems(nodes: ScoutRemoteApprovalNode[]): OperatorAttentionItem[] {
  return nodes.filter((node) => node.state === "live").flatMap((node) => node.approvals.map((approval): OperatorAttentionItem => ({
    id: `remote:${node.nodeId}:${sessionApprovalAttentionId(approval.sessionId, approval.turnId, approval.blockId, approval.version)}`,
    kind: "approval",
    title: approval.title,
    summary: approval.description,
    detail: approval.detail,
    agentId: null,
    agentName: approval.sessionName,
    conversationId: null,
    updatedAt: node.updatedAt ?? Date.now(),
    severity: approval.risk === "high" ? "critical" : "warning",
    sourceLabel: `${approval.adapterType} approval · ${node.label}`,
    approval: {
      ...approval,
      sessionId: remoteApprovalSessionId(node.nodeId, approval.sessionId),
      actionKind: approval.actionKind as never,
      actionStatus: "awaiting_approval",
    },
    actions: [
      { kind: "approve", label: "Approve" },
      { kind: "deny", label: "Deny" },
    ],
  })));
}

const REMOTE_SESSION_PREFIX = "remote:";

/**
 * A remote approval's sessionId carries its origin machine, so a decide goes
 * to exactly the machine the operator saw it on: `remote:<nodeId>:<sessionId>`.
 */
export function remoteApprovalSessionId(nodeId: string, sessionId: string): string {
  return `${REMOTE_SESSION_PREFIX}${encodeURIComponent(nodeId)}:${sessionId}`;
}

export function parseRemoteApprovalSessionId(value: string): { nodeId: string; sessionId: string } | null {
  if (!value.startsWith(REMOTE_SESSION_PREFIX)) return null;
  const rest = value.slice(REMOTE_SESSION_PREFIX.length);
  const split = rest.indexOf(":");
  if (split <= 0 || split === rest.length - 1) return null;
  return { nodeId: decodeURIComponent(rest.slice(0, split)), sessionId: rest.slice(split + 1) };
}

/**
 * A host snapshot is served stale while it refreshes, so a pane capture can
 * be up to about two TTLs old when a decision lands.
 */
export const SETTLED_PROMPT_HIDE_MS = 2 * AGENT_ATTENTION_TTL_MS;

/**
 * Harness sessions whose permission request the runtime settled within the
 * window. A pane capture of such a session can still show the prompt that was
 * just answered; while the request was open its own row hid that prompt.
 */
export function recentlySettledPermissionSessions(
  records: Record<string, { state?: string; updatedAt?: number; metadata?: Record<string, unknown> | null }> | undefined,
  now: number,
): Set<string> {
  const sessions = new Set<string>();
  for (const record of Object.values(records ?? {})) {
    if (record.state === "open" || typeof record.updatedAt !== "number" || now - record.updatedAt > SETTLED_PROMPT_HIDE_MS) continue;
    const sessionId = (record.metadata?.permissionRequest as { sessionId?: unknown } | undefined)?.sessionId;
    if (typeof sessionId === "string" && sessionId) sessions.add(sessionId);
  }
  return sessions;
}

const OPERATOR_QUESTION_PREFIX = "operator-question:";

/**
 * A question to the operator, as the runtime records it ("operator-question:<message id>"), is
 * answered by a reply to that message in its conversation: the runtime settles the record when the
 * operator's reply names it. Its declared options come from the message itself. A reply in your own
 * words takes the same path, so the answer is offered even when no options were declared.
 */
export function operatorQuestionAnswer(recordId: string, conversationId: string | null | undefined): { answer?: NonNullable<OperatorAttentionItem["answer"]> } {
  if (!recordId.startsWith(OPERATOR_QUESTION_PREFIX) || !conversationId || !isOpaqueChannelId(conversationId)) return {};
  const replyToMessageId = recordId.slice(OPERATOR_QUESTION_PREFIX.length);
  if (!replyToMessageId) return {};
  let options: string[] = [];
  try {
    const [message] = queryRecentMessages(1, { conversationId, messageId: replyToMessageId });
    options = declaredNeedOptions(message?.metadata) ?? [];
  } catch {
    // the message store could not be read: still answerable in words
  }
  return { answer: { conversationId, replyToMessageId, options } };
}

/**
 * A Ready task as an attention item: "<agent> is ready", the agent's summary
 * line, and the operator's two moves. Continue hands the next move back to the
 * agent in the same session; Hold takes it off the list and leaves it Ready.
 */
export function readyAttentionItem(ready: WebTaskReady): OperatorAttentionItem {
  const name = ready.agentName?.trim() || ready.agentId;
  const route = ready.conversationId
    ? { view: "conversation", conversationId: ready.conversationId }
    : ready.workId
      ? { view: "follow", workId: ready.workId, preferredView: "chat", targetAgentId: ready.agentId }
      : { view: "agents-v2", agentId: ready.agentId };
  return {
    // One flight can be Ready again after Continue. Each round is its own
    // item, so a new round arrives as new on the board.
    id: `ready:${ready.flightId}:${ready.readyAt}`,
    kind: "ready",
    title: `${name} is ready`,
    summary: compactAttentionSummary(ready.summary, 240),
    detail: compactAttentionSummary(ready.task),
    agentId: ready.agentId,
    agentName: name,
    conversationId: ready.conversationId,
    updatedAt: ready.readyAt,
    severity: "info",
    sourceLabel: "Ready",
    ready: { invocationId: ready.invocationId, flightId: ready.flightId, workId: ready.workId, summary: ready.summary, at: ready.readyAt },
    actions: [
      { kind: "continue", label: "Continue", flightId: ready.flightId },
      { kind: "hold", label: "Hold", flightId: ready.flightId },
      { kind: "open", label: ready.conversationId ? "Open conversation" : "Open", route },
    ],
  };
}

export function nativeTranscriptAskAttentionItems(
  transcripts: DiscoverySnapshot["transcripts"] | undefined,
  options: {
    coveredSessionIds: ReadonlySet<string>;
    justSettledSessionIds: ReadonlySet<string>;
    now: number;
  },
): OperatorAttentionItem[] {
  const out: OperatorAttentionItem[] = [];
  for (const transcript of transcripts ?? []) {
    if (transcript.source !== "antigravity") continue;
    const sessionId = transcript.sessionId?.trim();
    if (!sessionId || options.coveredSessionIds.has(sessionId) || options.justSettledSessionIds.has(sessionId)) continue;
    if (transcript.attention?.kind !== "ask" && transcript.status !== "waiting") continue;
    const pending = transcript.attention?.pending ?? null;
    const isQuestion = pending?.tool === "ask_question" || pending?.title === "Question";
    const isPlan = pending?.title === "Plan approval";
    const title = isQuestion
      ? "Antigravity asked a question"
      : isPlan
        ? "Antigravity plan is waiting for review"
        : "Antigravity is waiting for approval";
    const summary = compactAttentionSummary(
      pending?.subject ?? transcript.attention?.reason ?? transcript.waitingFor,
      240,
    );
    if (!summary) continue;
    const detailParts = [
      transcript.project?.trim() || transcript.cwd?.trim() || null,
      pending?.detail?.trim() || null,
    ].filter((part): part is string => Boolean(part));
    const since = transcript.attention?.since ?? transcript.statusUpdatedAt ?? transcript.mtimeMs ?? options.now;
    out.push({
      id: `native-ask:antigravity:${sessionId}:${since}`,
      kind: "question",
      title,
      summary,
      detail: detailParts.length ? detailParts.join(" · ") : null,
      agentId: `native:antigravity:${sessionId}`,
      agentName: transcript.title?.trim() || `Antigravity ${sessionId.slice(0, 8)}`,
      conversationId: null,
      updatedAt: since,
      severity: "warning",
      sourceLabel: isQuestion ? "Antigravity question" : "Antigravity approval",
      actions: [
        {
          kind: "open",
          label: "Open session",
          route: {
            view: "follow",
            sessionId: `session:antigravity:${sessionId}`,
            preferredView: "session",
          },
        },
      ],
    });
  }
  return out;
}

export async function buildOperatorAttentionState(
  currentDirectory: string,
  capture: TmuxPaneCapture = defaultCaptureTmuxPane,
) {
  const [pairing, pairingSnapshots, fleet, brokerDiagnostics, scoutBroker, remoteApprovals, tailDiscovery] = await Promise.all([
    loadPairingState(currentDirectory, false).catch(() => null),
    getScoutWebPairingSessionSnapshots().catch(() => []),
    backgroundReads.fleet({ limit: 24, activityLimit: 0 }),
    backgroundReads.attentionHints({ limit: 160, windowMs: 24 * 60 * 60_000 }),
    loadScoutBrokerContext().catch(() => null),
    loadScoutRemoteApprovals(),
    readScoutBrokerTailDiscovery().catch(() => null),
  ]);
  const hostAttention = await queryAgentAttentionSnapshot(scoutBroker, capture);

  const items: OperatorAttentionItem[] = [];
  const pendingApprovalIds = new Set<string>();

  for (const approval of pairing?.pendingApprovals ?? []) {
    const approvalId = sessionApprovalAttentionId(
      approval.sessionId,
      approval.turnId,
      approval.blockId,
      approval.version,
    );
    pendingApprovalIds.add(approvalId);
    items.push({
      id: approvalId,
      kind: "approval",
      title: approval.title,
      summary: approval.description,
      detail: approval.detail,
      agentId: null,
      agentName: approval.sessionName,
      conversationId: null,
      updatedAt: Date.now(),
      severity: approval.risk === "high" ? "critical" : "warning",
      sourceLabel: `${approval.adapterType} approval`,
      approval,
      actions: [
        { kind: "approve", label: "Approve" },
        { kind: "deny", label: "Deny" },
        {
          kind: "open",
          label: "Open session",
          route: {
            view: "follow",
            sessionId: approval.sessionId,
            preferredView: "session",
          },
        },
      ],
    });
  }

  items.push(...remoteApprovalItems(remoteApprovals));

  // Declared operator questions (`scout ask --operator --question`) are
  // conversation messages; project the unanswered ones so Requests shows them.
  // The runtime also keeps an `operator-question:` record for each: once that
  // record is settled (a reply, or a dismissal) the question has left the queue.
  if (scoutBroker) {
    const operatorName = resolveOperatorName().trim() || "operator";
    for (const need of pendingOperatorNeeds({
      messages: Object.values(scoutBroker.snapshot.messages ?? {}),
      operatorIds: [operatorName, "operator"],
    })) {
      const record = scoutBroker.snapshot.collaborationRecords?.[`operator-question:${need.messageId}`];
      if (record && record.state !== "open") continue;
      const name = scoutBroker.snapshot.actors?.[need.actorId]?.displayName?.trim() || need.actorId;
      items.push({
        id: `need:${need.messageId}`,
        kind: "question",
        title: need.question,
        summary: need.blockedReason ? `Blocked: ${need.blockedReason}` : null,
        detail: null,
        agentId: need.actorId,
        agentName: name,
        conversationId: need.conversationId,
        updatedAt: need.createdAt,
        severity: "warning",
        // Declared kind, never inferred from wording: a need raised with
        // `--permission` is a permission request; anything else is a question.
        sourceLabel: need.permission ? "Permission request" : "Question",
        // Answered by a reply to the need: one of its options, or the operator's own words.
        ...(isOpaqueChannelId(need.conversationId)
          ? { answer: { conversationId: need.conversationId, replyToMessageId: need.messageId, options: need.options } }
          : {}),
        actions: [
          {
            kind: "open",
            label: "Open conversation",
            route: { view: "conversation", conversationId: need.conversationId },
          },
          // Only a question with a runtime record can be dismissed: the runtime settles that record.
          ...(record ? [dismissCollaborationAction("question", record.id)] : []),
        ],
      });
    }
  }

  for (const record of Object.values(scoutBroker?.snapshot.collaborationRecords ?? {})) {
    const raw = record.metadata?.permissionRequest;
    if (record.kind !== "question" || record.state !== "open" || !raw || typeof raw !== "object") continue;
    const permission = raw as { version?: unknown; sessionId?: unknown; projectRoot?: unknown; flightId?: string; decisions?: unknown; decisionLabels?: { deny?: string }; native?: unknown };
    if (typeof permission.version !== "string" || typeof permission.sessionId !== "string" || typeof permission.projectRoot !== "string" || !Array.isArray(permission.decisions)) continue;
    const native = parseNativePermission(permission.native);
    items.push({
      id: `permission:${record.id}`, kind: "question", title: "Permission request",
      summary: record.summary ?? null, detail: `${permission.projectRoot} · ${permission.sessionId}${permission.flightId ? ` · ${permission.flightId}` : ""}`,
      agentId: record.createdById, agentName: scoutBroker?.snapshot.actors[record.createdById]?.displayName ?? nativeActorName(record.createdById) ?? record.createdById,
      conversationId: record.conversationId ?? null, updatedAt: record.updatedAt, severity: "warning", sourceLabel: "Permission request",
      permission: { requestId: record.id, version: permission.version, sessionId: permission.sessionId, projectRoot: permission.projectRoot, flightId: permission.flightId, ...(native ? { native } : {}) },
      actions: [
        ...(permission.decisions.includes("once") ? [{ kind: "approve" as const, label: "Allow once", value: "once" }] : []),
        ...(permission.decisions.includes("project") ? [{ kind: "approve" as const, label: "Allow always", value: "project" }] : []),
        ...(permission.decisions.includes("deny") ? [{ kind: "deny" as const, label: permission.decisionLabels?.deny === "Cancel" ? "Cancel" : "Deny", value: "deny" }] : []),
        // A native session's request has no conversation to open.
        ...(record.conversationId ? [{ kind: "open" as const, label: "Open conversation", route: { view: "conversation", conversationId: record.conversationId } }] : []),
        // The runtime refuses it while a session still waits on the request.
        dismissCollaborationAction("question", record.id),
      ],
    });
  }

  for (const sessionItem of projectSessionsAttention(pairingSnapshots, { pendingApprovalIds })) {
    items.push(operatorAttentionFromSessionItem(sessionItem));
  }

  const justSettled = recentlySettledPermissionSessions(scoutBroker?.snapshot.collaborationRecords, Date.now());
  for (const hostItem of hostAttention.hostItems) {
    if (items.some(item => item.permission?.sessionId === hostItem.sessionId && item.agentId === hostItem.agentId)) continue;
    // The pane capture can predate the decision; the prompt it shows is the one just answered.
    if (justSettled.has(hostItem.sessionId)) continue;
    const herdrStop = hostItem.id.startsWith("herdr-continuation:");
    const unmatchedHerdrPane = hostItem.agentId.startsWith("herdr:");
    const tmuxPane = hostItem.id.startsWith("tmux-host-permission:");
    items.push({
      id: hostItem.id,
      kind: "session",
      title: hostItem.title,
      summary: hostItem.summary,
      detail: hostItem.detail,
      agentId: unmatchedHerdrPane ? null : hostItem.agentId,
      agentName: hostItem.agentName,
      conversationId: null,
      updatedAt: hostItem.updatedAt,
      severity: "warning",
      sourceLabel: hostItem.sourceLabel,
      ...(tmuxPane ? { pane: { backend: "tmux" as const, sessionName: hostItem.sessionId, ...(hostItem.prompt ? { prompt: hostItem.prompt } : {}) } } : {}),
      // A Herdr pane is named only when its dialog is a plain permission one: Yes / No answer it from here.
      // There is no live view of a Herdr pane here, so anything else stays with Open terminal.
      ...(herdrStop && hostItem.prompt?.answerable ? { pane: { backend: "herdr" as const, sessionName: hostItem.sessionId, prompt: hostItem.prompt } } : {}),
      actions: [
        // A plain permission dialog: its Yes and No, pressed in the pane. Anything more is answered there.
        ...((tmuxPane || herdrStop) && hostItem.prompt?.answerable ? [
          { kind: "approve" as const, label: "Yes", value: "yes" },
          { kind: "deny" as const, label: "No", value: "no" },
        ] : []),
        {
          kind: "open",
          label: "Open terminal",
          route: herdrStop
            ? {
              view: "terminal",
              terminalBackend: "herdr",
              terminalSessionName: hostItem.sessionId,
              mode: "takeover",
              ...(unmatchedHerdrPane ? {} : { agentId: hostItem.agentId }),
            }
            : {
              view: "terminal",
              agentId: hostItem.agentId,
              mode: "takeover",
            },
        },
      ],
    });
  }

  const coveredNativeSessions = new Set<string>();
  for (const item of items) {
    if (item.permission?.sessionId) coveredNativeSessions.add(item.permission.sessionId);
    if (item.approval?.sessionId) coveredNativeSessions.add(item.approval.sessionId);
  }
  for (const hostItem of hostAttention.hostItems) coveredNativeSessions.add(hostItem.sessionId);
  items.push(...nativeTranscriptAskAttentionItems(tailDiscovery?.transcripts, {
    coveredSessionIds: coveredNativeSessions,
    justSettledSessionIds: justSettled,
    now: Date.now(),
  }));

  // Ready comes from the flights, not the work-item rows: the operator usually
  // requested the work, so those rows leave it out. Its work item stands in Ready.
  const readyWork = new Set<string>();
  for (const ready of fleet.ready ?? []) {
    if (ready.workId) readyWork.add(ready.workId);
    items.push(readyAttentionItem(ready));
  }

  for (const work of fleet.needsAttention) {
    if (work.kind === "work_item" && readyWork.has(work.recordId)) continue;
    // Managed permission IDs belong to the live adapter decision above. The
    // durable fleet projection can arrive before the broker snapshot warms;
    // do not briefly publish a second, unactionable question with another ID.
    if (work.recordId.startsWith("permission-")
      || scoutBroker?.snapshot.collaborationRecords[work.recordId]?.metadata?.permissionRequest
      || scoutBroker?.snapshot.collaborationRecords[work.recordId]?.metadata?.operatorNeedMessageId) continue;
    const route = work.conversationId
      ? { view: "conversation", conversationId: work.conversationId }
      : work.kind === "work_item" && work.recordId
        ? {
            view: "follow",
            workId: work.recordId,
            preferredView: "chat",
            ...(work.agentId ? { targetAgentId: work.agentId } : {}),
          }
        : work.agentId
          ? { view: "agents-v2", agentId: work.agentId, tab: "message" }
          : undefined;
    items.push({
      id: `${work.kind}:${work.recordId}`,
      kind: work.kind,
      title: work.title,
      summary: restatesTitle(work.summary, work.title) ? null : work.summary,
      detail: work.acceptanceState !== "none"
        ? work.acceptanceState.replace(/_/g, " ")
        : work.state.replace(/_/g, " "),
      agentId: work.agentId,
      agentName: work.agentName,
      conversationId: work.conversationId,
      updatedAt: work.updatedAt,
      severity: work.state === "waiting" ? "warning" : "info",
      sourceLabel: "Work item",
      ...operatorQuestionAnswer(work.recordId, work.conversationId),
      actions: [
        ...(route ? [{ kind: "open" as const, label: "Open", route }] : []),
        dismissCollaborationAction(work.kind, work.recordId),
      ],
    });
  }

  for (const ask of fleet.recentCompleted.filter((item) => item.status === "failed" && item.attention !== "silent")) {
    const noteworthy = ask.attention === "badge";
    const noteworthyTitle = ask.statusLabel === "Stopped" ? "Ask stopped" : "Ask interrupted";
    items.push({
      id: `ask:${ask.invocationId}`,
      kind: "ask",
      title: noteworthy ? noteworthyTitle : "Ask failed",
      summary: compactAttentionSummary(ask.summary ?? ask.task),
      detail: ask.task,
      agentId: ask.agentId,
      agentName: ask.agentName,
      conversationId: ask.conversationId,
      updatedAt: ask.updatedAt,
      severity: noteworthy ? "warning" : "critical",
      sourceLabel: noteworthy ? "Ask notice" : "Ask delivery",
      actions: [
        ...(ask.conversationId
          ? [{ kind: "open" as const, label: "Open thread", route: { view: "conversation", conversationId: ask.conversationId } }]
          : [{ kind: "open" as const, label: "Open agent", route: { view: "agents-v2", agentId: ask.agentId } }]),
        ...(ask.flightId ? [{ kind: "dismiss" as const, label: "Dismiss", flightId: ask.flightId }] : []),
      ],
    });
  }

  for (const failure of [...brokerDiagnostics.failedDeliveries, ...brokerDiagnostics.failedQueries]) {
    const hint = permissionSetupHint(routeFailureText(failure));
    if (!hint) {
      continue;
    }
    items.push({
      ...hint,
      id: `${hint.id}:${failure.id}`,
      agentName: failure.target,
      conversationId: failure.conversationId,
      updatedAt: failure.ts,
      actions: [
        ...hint.actions,
        ...(failure.conversationId
          ? [{
              kind: "open" as const,
              label: "Open thread",
              route: { view: "conversation", conversationId: failure.conversationId },
            }]
          : []),
      ],
    });
  }

  for (const message of brokerDiagnostics.dialogue) {
    if (message.actorName !== "Openscout") {
      continue;
    }
    const hint = permissionSetupHint(message.body);
    if (!hint) {
      continue;
    }
    items.push({
      ...hint,
      id: `${hint.id}:${message.conversationId}`,
      agentName: message.actorName,
      conversationId: message.conversationId,
      updatedAt: message.ts,
      actions: [
        ...hint.actions,
        {
          kind: "open" as const,
          label: "Open thread",
          route: { view: "conversation", conversationId: message.conversationId },
        },
      ],
    });
  }

  const deduped = dedupeAttentionItems(items);
  return {
    generatedAt: Date.now(),
    totals: {
      all: deduped.length,
      approvals: deduped.filter((item) => item.kind === "approval").length,
      configuration: deduped.filter((item) => item.kind === "configuration").length,
      collaboration: deduped.filter((item) =>
        item.kind === "ask"
        || item.kind === "work_item"
        || item.kind === "question"
        || item.kind === "session"
        || item.kind === "ready"
      ).length,
    },
    items: deduped,
  };
}
