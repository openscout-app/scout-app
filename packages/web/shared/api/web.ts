/**
 * Response shapes the web server serves to the web client, built by
 * `server/db-queries.ts`. Shared so the client reads the same definitions the
 * server writes, instead of keeping its own copies.
 *
 * Cross-surface shapes live in `./common.ts`; mobile-specific shapes stay in
 * `server/db/types/mobile.ts`.
 */

import type { AgentRosterTag, AgentRun, ExternalWorkContext, FlightSessionTraceEntry, MessageAttachment } from "@openscout/protocol";

import type { AgentSummaryState, WorkAttention } from "./common.ts";
import type { WorkMaterialsInventory } from "./work-materials.ts";

export type WebTerminalSurfaceDescriptor = {
  backend: "tmux" | "zellij" | "herdr";
  sessionName: string;
  paneId: string | null;
  socketDir: string | null;
};

export type WebAgentBrokerActivity = {
  id: string;
  kind: "message" | "invocation" | "flight";
  at: number;
  state: string | null;
  summary: string;
  conversationId: string | null;
};

export type WebAgentAuthorityProfile = {
  roleId: string;
  readTools: string[];
  writeTools: string[];
  shell: boolean;
  codebaseWrites: boolean;
};

export type WebAgentRuntimePolicy = {
  approvalPolicy: string | null;
  sandbox: string | null;
  shellTool: boolean | null;
};

export type WebAgent = {
  id: string;
  definitionId: string;
  name: string;
  handle: string | null;
  /**
   * The name the Scout session behind this card goes by ("demo-app-epicurus-12"),
   * when its session actor is known on this host. `name` stays the card's own,
   * which for a session card is its id title-cased.
   */
  sessionName?: string | null;
  agentClass: string;
  harness: string | null;
  state: string | null;
  /** The pending question / approval / handoff text when state is needs_attention. */
  pendingAsk?: string | null;
  projectRoot: string | null;
  cwd: string | null;
  updatedAt: number | null;
  createdAt: number | null;
  transport: string | null;
  selector: string | null;
  defaultSelector: string | null;
  nodeQualifier: string | null;
  workspaceQualifier: string | null;
  wakePolicy: string | null;
  capabilities: string[];
  project: string | null;
  branch: string | null;
  /** Canonical git remote identity (`host/org/repo`) for checkout grouping. */
  repoKey?: string | null;
  role: string | null;
  model: string | null;
  modelProvider?: string | null;
  reasoningEffort?: string | null;
  harnessSessionId: string | null;
  terminalSurface: WebTerminalSurfaceDescriptor | null;
  harnessLogPath: string | null;
  conversationId: string | null;
  authorityNodeId: string | null;
  authorityNodeName: string | null;
  homeNodeId: string | null;
  homeNodeName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerHandle: string | null;
  staleLocalRegistration: boolean;
  retiredFromFleet: boolean;
  replacedByAgentId: string | null;
  providerName?: string | null;
  providerUrl?: string | null;
  protocol?: string | null;
  skills?: string[];
  brokerActivity?: WebAgentBrokerActivity[];
  authorityProfile?: WebAgentAuthorityProfile | null;
  runtimePolicy?: WebAgentRuntimePolicy | null;
  /** The agent's code in the runtime's roster (`OS-003`); null while it holds no number. */
  roster?: AgentRosterTag | null;
};

export type WebActivityItem = {
  id: string;
  kind: string;
  ts: number;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  conversationId: string | null;
  workspaceRoot: string | null;
  agentId: string | null;
  agentName: string | null;
  flightId: string | null;
  invocationId: string | null;
  sessionId: string | null;
  messageId: string | null;
  recordId: string | null;
};

export type WebMessage = {
  id: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  body: string;
  createdAt: number;
  class: string;
  metadata: Record<string, unknown> | null;
  replyToMessageId: string | null;
  threadConversationId: string | null;
  threadSummary?: {
    count: number;
    participants: string[];
    lastActiveAt: number;
  };
};

/**
 * One message as GET /api/messages serves it: a durable projection row, or a
 * live broker message, which also carries its attachments and may leave
 * `metadata` out.
 */
export type WebServedMessage = Omit<WebMessage, "metadata"> & {
  metadata?: Record<string, unknown> | null;
  attachments?: MessageAttachment[];
};

export type WebBrokerRouteAttempt = {
  id: string;
  kind: "success" | "failed_query" | "failed_delivery" | "delivery_attempt";
  status: string;
  ts: number;
  actorName: string | null;
  target: string | null;
  route: string | null;
  detail: string;
  conversationId: string | null;
  messageId: string | null;
  deliveryId: string | null;
  invocationId: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Where a Scout session at one end of a dispatch runs, from its session actor
 * and latest endpoint. A session that never registered an agent card is not on
 * the roster, so these ride on the attempt as `metadata.actorSession` (the
 * sender) and `metadata.targetSession` (the destination).
 */
export type WebDispatchSessionFacts = {
  /** The name the session goes by ("research-curie-3"). */
  name: string | null;
  harness: string | null;
  model: string | null;
  project: string | null;
  projectRoot: string | null;
  branch: string | null;
  /** The host the endpoint is on. */
  node: string | null;
};

export type WebBrokerDialogueItem = {
  id: string;
  ts: number;
  actorName: string | null;
  conversationId: string;
  body: string;
  class: string;
};

export type WebBrokerHistoryKey = "attempts" | "failedQueries" | "failedDeliveries" | "dialogue";

export type WebBrokerDiagnosticsSource = {
  mode: "live_broker" | "sqlite_projection";
  status: "current" | "degraded" | "unknown";
  brokerReachable?: boolean | null;
  latestMessageAt: number | null;
  projectionLatestMessageAt: number | null;
  liveMessageCount: number | null;
  projectionMessageCount: number | null;
  detail: string | null;
};

export type WebBrokerDiagnostics = {
  generatedAt: number;
  windowMs: number;
  source?: WebBrokerDiagnosticsSource;
  ledger: {
    mode: "latest";
    limit: number;
    cursor: string | null;
    cursors: Record<WebBrokerHistoryKey, string | null>;
    hasMore: Record<WebBrokerHistoryKey, boolean>;
  };
  totals: {
    successfulDispatches: number;
    failedQueries: number;
    failedDeliveries: number;
    deliveryAttempts: number;
    failedDeliveryAttempts: number;
    dialogueMessages: number;
  };
  rates: {
    messagesPerHour: number;
    failedQueriesPerHour: number;
    failedDeliveriesPerHour: number;
    failureRate: number;
  };
  attempts: WebBrokerRouteAttempt[];
  failedQueries: WebBrokerRouteAttempt[];
  failedDeliveries: WebBrokerRouteAttempt[];
  dialogue: WebBrokerDialogueItem[];
};

export type WebWorkItem = {
  id: string;
  title: string;
  summary: string | null;
  ownerId: string | null;
  ownerName: string | null;
  nextMoveOwnerId: string | null;
  nextMoveOwnerName: string | null;
  conversationId: string | null;
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  parentTitle: string | null;
  state: string;
  acceptanceState: string;
  /** Source-owned observations. These do not grant controls or replace Scout acceptance. */
  externalContext?: ExternalWorkContext | null;
  priority: string | null;
  currentPhase: string;
  attention: WorkAttention;
  activeChildWorkCount: number;
  activeFlightCount: number;
  lastMeaningfulAt: number;
  lastMeaningfulSummary: string | null;
  /** A Codex chat pinned from the ChatGPT app (`scout session pin`): its thread id. */
  codexThreadId?: string | null;
  /** A Claude Code chat pinned with `scout session pin`: its session id. */
  claudeSessionId?: string | null;
  /** The item's newest flight that has not ended, and the last activity recorded for it. Null when none. */
  liveFlight?: WebWorkLiveFlight | null;
  /** Waiting only because its last run failed, with the failed flight. Null when the wait is real or there is none. */
  failedRun?: { flightId: string } | null;
};

/**
 * A work item's newest unended flight. `lastActivityAt` is the latest of the flight's start, its session's last
 * acknowledgement, and the item's latest work event: the runtime records no session heartbeat beyond these.
 */
export type WebWorkLiveFlight = {
  id: string;
  /** A FlightState that has not ended: queued, waking, running or waiting. */
  state: string;
  /** The flight's current session (the last entry of its session trace), once it has one. */
  sessionId: string | null;
  harness: string | null;
  startedAt: number | null;
  lastActivityAt: number | null;
};

/** One station of a work lifecycle: a board column. Each maps to one work state. */
export type WebWorkStation = {
  id: string;
  name: string;
  state: string;
  purpose: string | null;
  /** Checked on every move into the station. */
  rules: Array<{ id: string; check: string; effect: "deny" | "hold" | "consult" | "advise"; message: string; shadow: boolean }>;
  /** Applied by a reviewer after a move into the station. */
  judges: Array<{ id: string; criterion: string }>;
};

export type WebWorkLifecycle = {
  id: string;
  name: string;
  version: number;
  hash: string;
  description: string | null;
  stations: WebWorkStation[];
  transitions: Array<{ from: string; to: string; name: string | null }>;
};

export type WebWorkBoardCard = {
  station: string;
  reviewPending: boolean;
  revision: number;
  /** Stations this card can move to. */
  next: string[];
  item: WebWorkItem;
};

export type WebWorkBoard = {
  lifecycle: WebWorkLifecycle;
  lifecycles: Array<{ id: string; name: string }>;
  cards: WebWorkBoardCard[];
};

export type WebWorkMoveVerdict = "allow" | "deny" | "hold" | "consult";

export type WebWorkMoveDecision = {
  verdict: WebWorkMoveVerdict;
  from: string;
  to: string;
  toState: string;
  reasons: Array<{ ruleId: string; scope: string; check: string; outcome: "pass" | "fail"; effect: string; message: string; shadow?: boolean }>;
  judges: string[];
  review: "pending" | "not_needed";
};

export type WebWorkMove = {
  id: string;
  itemId: string;
  lifecycleId: string;
  from: string;
  to: string;
  moverId: string;
  verdict: WebWorkMoveVerdict;
  decision: WebWorkMoveDecision;
  note?: string;
  revision?: number;
  review: "pending" | "not_needed" | "confirmed" | "reopened" | "consulted" | "stale";
  reviewNote?: string;
  reviewedById?: string;
  reviewedAt?: number;
  createdAt: number;
};

export type WebWorkMoveResponse = { decision: WebWorkMoveDecision; move?: WebWorkMove; applied: boolean };

export type WebMeshOpsFlight = {
  id: string;
  state: string;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

/**
 * Mesh Ops row — one work item with its latest flight rollup and host
 * attribution derived from the owner agent's node id. Timestamps are epoch
 * milliseconds, consistent with WebWorkItem.
 *
 * kind = "work" is the owned-work row. kind = "session" is an observed runtime
 * session inside the recency lookback (live or recently ended); session rows
 * carry the common columns plus a `session` detail block and never claim
 * attention above silent.
 */
export type WebMeshOpsItem = {
  id: string;
  kind: "work" | "session";
  title: string;
  summary: string | null;
  state: string;
  acceptanceState: string;
  priority: string | null;
  labels: string[];
  ownerId: string | null;
  ownerName: string | null;
  nextMoveOwnerId: string | null;
  updatedAt: number;
  createdAt: number;
  /** null = unattributed (owner is the operator or has no agent row). */
  hostNodeId: string | null;
  hostLabel: string | null;
  projectRoot: string | null;
  latestFlight: WebMeshOpsFlight | null;
  activeFlightCount: number;
  currentPhase: string | null;
  lastMeaningfulAt: number | null;
  lastMeaningfulSummary: string | null;
  attention: WorkAttention;
  /** Present when the item waits on someone/something (e.g. "Held by operator"). */
  waitingOn?: { kind?: string; label: string } | null;
  /** Session rows only: the observed runtime detail behind the row. */
  session?: {
    harness: string;
    state: string;
    live: boolean;
    alias: string | null;
    agentLabel: string;
    cwd: string | null;
    startedAt: number | null;
    lastSeenAt: number;
    endedAt: number | null;
    /** Broker delivery machinery (ephemeral `session-*` agents), not a named agent. */
    relay: boolean;
  } | null;
};

/**
 * A mesh host (broker `nodes` row) with a runtime-session rollup, so the
 * board can show every known machine — including ones with no current work.
 */
export type WebMeshOpsHost = {
  nodeId: string;
  /** Short display name (host_name first label, else the node name). */
  label: string;
  hostName: string | null;
  brokerUrl: string | null;
  tailnetName: string | null;
  lastSeenAt: number | null;
  registeredAt: number | null;
  /** Sessions in the mesh-ops lookback window on this host. */
  sessionCount: number;
  liveSessionCount: number;
  lastActivityAt: number | null;
};

export type WebFlight = {
  id: string;
  invocationId: string;
  messageId?: string | null;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  collaborationRecordId: string | null;
  state: string;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
  sessions: FlightSessionTraceEntry[];
  dispatchOutcome?: {
    status: string;
    reason: string | null;
    checkedAt: number | null;
  } | null;
  /**
   * The requester stopped waiting for a synchronous result (broker
   * `requesterTimedOut` / `timeoutScope: requester_wait`). The agent may still
   * be running; the operator's turn is no longer live.
   */
  requesterWaitTimedOut?: boolean;
  /**
   * The operator asked to hear when this task is done (core `readyNotify`: the
   * flight's mark, else the ask's). Absent from older servers.
   */
  notify?: boolean;
};

export type WebWorkInvocation = {
  invocationId: string;
  flightId: string | null;
  action: string;
  task: string;
  source: string | null;
  requestedHarness: string | null;
  requestedModel: string | null;
  requestedReasoningEffort: string | null;
  requestedPermissionProfile: string | null;
  targetSessionId: string | null;
  requesterId: string | null;
  requesterName: string | null;
  targetAgentId: string | null;
  targetAgentName: string | null;
  resolvedHarness: string | null;
  resolvedModel: string | null;
  resolvedReasoningEffort: string | null;
  observedHarness: string | null;
  observedModel: string | null;
  observedReasoningEffort: string | null;
  resolvedTransport: string | null;
  resolvedSessionId: string | null;
  conversationId: string | null;
  workId: string | null;
  state: string | null;
  summary: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
};

export type WebAgentRun = AgentRun & {
  agentName: string | null;
};

export type WebFollowTarget = {
  flightId: string | null;
  invocationId: string | null;
  conversationId: string | null;
  workId: string | null;
  sessionId: string | null;
  targetAgentId: string | null;
  /**
   * The harness's own conversation id (Claude/Codex session uuid) behind the
   * Scout session, when known. Tail events carry this id, never Scout's
   * `session-…` / `flt-…` / `inv-…` / `chn-…` ids, so a tail link must filter
   * on it to match anything.
   */
  harnessSessionId?: string | null;
};

export type WebWorkTimelineKind =
  | "collaboration_event"
  | "flight_started"
  | "flight_completed"
  | "message";

export type WebWorkTimelineItem = {
  id: string;
  kind: WebWorkTimelineKind;
  at: number;
  actorId: string | null;
  actorName: string | null;
  title: string | null;
  summary: string | null;
  /** Discriminator: event sub-kind, flight state, or message class. */
  detailKind: string | null;
  flightId: string | null;
  messageId: string | null;
  conversationId: string | null;
};

export type WebWorkDetail = WebWorkItem & {
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  parentTitle: string | null;
  childWork: WebWorkItem[];
  activeFlights: WebFlight[];
  timeline: WebWorkTimelineItem[];
  primaryInvocation: WebWorkInvocation | null;
  allFlights: WebFlight[];
};

/** GET /api/work/:id — the work item plus what it touched. */
export type WebWorkDetailResponse = WebWorkDetail & {
  inventory: WorkMaterialsInventory;
};

export type WebFleetActivity = WebActivityItem & {
  actorId: string | null;
  /** Harness of the actor's latest endpoint, when the broker knows one. */
  actorHarness?: string | null;
  agentId: string | null;
  flightId: string | null;
  invocationId: string | null;
  messageId: string | null;
  recordId: string | null;
  sessionId: string | null;
};

export type WebFleetAskStatus =
  | "queued"
  | "working"
  | "needs_attention"
  | "completed"
  | "failed";

export type WebFleetAsk = {
  invocationId: string;
  flightId: string | null;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  collaborationRecordId: string | null;
  task: string;
  status: WebFleetAskStatus;
  statusLabel: string;
  acknowledgedAt: number | null;
  attention: WorkAttention;
  agentState: AgentSummaryState;
  harness: string | null;
  transport: string | null;
  summary: string | null;
  startedAt: number | null;
  completedAt: number | null;
  updatedAt: number;
};

export type WebFleetAttentionItem = {
  kind: "work_item" | "question";
  recordId: string;
  title: string;
  summary: string | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
  state: string;
  acceptanceState: string;
  updatedAt: number;
};

/**
 * Ready (core protocol `task-ready.ts`): a task the operator marked `notify`
 * finished, and the next move is theirs. Read from the flight's
 * `metadata.ready`, never from the work item's attention or the reply's
 * wording. Not the board station `ready` (planned, ready to start).
 */
export type WebTaskReady = {
  invocationId: string;
  flightId: string;
  agentId: string;
  agentName: string | null;
  conversationId: string | null;
  /** The task's work item, when it has one. */
  workId: string | null;
  /** What the agent was asked. */
  task: string;
  /** The first prose line of the agent's reply, as the runtime kept it. */
  summary: string;
  /** When the flight entered Ready. */
  readyAt: number;
  /** A Hold. A held Ready is listed again only after its work item changes. */
  heldAt: number | null;
};

/** The operator's two moves on a Ready task (core `POST /v1/tasks/ready/decide`). */
export type WebTaskReadyDecision = "continue" | "hold";

export type WebFleetState = {
  generatedAt: number;
  totals: {
    active: number;
    recentCompleted: number;
    needsAttention: number;
    activity: number;
  };
  activeAsks: WebFleetAsk[];
  recentCompleted: WebFleetAsk[];
  needsAttention: WebFleetAttentionItem[];
  /** Ready tasks on the operator's list, newest first. Absent from older servers. */
  ready?: WebTaskReady[];
  activity: WebFleetActivity[];
};
