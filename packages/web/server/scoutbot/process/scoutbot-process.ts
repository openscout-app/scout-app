import { createHash } from "node:crypto";
import { basename, join } from "node:path";

import type { ActorIdentity, InboxItem } from "@openscout/protocol";
import { resolveOperatorName } from "@openscout/runtime/user-config";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";

import type {
  ScoutBrokerAgentRecord,
  ScoutBrokerEndpointRecord,
  ScoutBrokerMessageRecord,
  ScoutBrokerNodeRecord,
  ScoutBrokerSnapshot,
} from "../../core/broker/service.ts";
import { SCOUTBOT_PAGE_MAX_JSON } from "../../../shared/api/scoutbot.ts";
import type { ScoutbotBrain } from "../../scoutbot-brain.ts";
import { prefilterHandle } from "../prefilter.ts";
import { handleDiagnosticCommand } from "../report.ts";
import {
  SCOUTBOT_AGENT_ID,
  SCOUTBOT_DISPLAY_NAME,
  SCOUTBOT_HANDLE,
  scoutbotProvenance,
} from "../role.ts";
import {
  buildScoutbotThreadConversation,
  ScoutbotThreadMapStore,
  type ScoutbotThreadRecord,
} from "../thread-map.ts";
import { parseSseBlock, ScoutbotBrokerError, type ScoutbotBrokerLink } from "./broker-link.ts";
import { readJsonFile, writeJsonFileDurably } from "./durable-json.ts";
import { createScoutbotHandouts, type ScoutbotHandouts } from "./handouts.ts";

/**
 * Scoutbot as its own process. The runtime underneath is exact: it routes
 * asks, keeps work durable and reports results. Scoutbot is the loose layer
 * on top: it reads what the operator means, finds the agents, sessions and
 * hosts they mean, and makes the exact runtime calls for them.
 *
 * A Scoutbot turn is durable through the runtime's inbox. Each message to
 * Scoutbot is an inbox item: Scoutbot leases it, answers it and acks it. A
 * restart leaves the item leased or pending, so the next generation takes it
 * again, the Pi conversation resumes the same turn by its request id, and the
 * reply keeps one id. The operator gets one answer.
 */

export const SCOUTBOT_PROCESS_ENDPOINT_ID = "endpoint.scoutbot.process";
export const SCOUTBOT_PROCESS_DEFAULT_MODEL = "gpt-5.6-luna";
/** The lease owner for every generation; only the claim holder answers, so a lease under this name is ours. */
export const SCOUTBOT_LEASE_OWNER = "scoutbot-process";

const LEASE_MS = 5 * 60_000;
const ANSWER_WINDOW_MS = 24 * 60 * 60_000;
const RETRY_MS = 30_000;
/** A hand-out result can come in before its ask's receipt is recorded; it waits this long for it. */
const UNROUTED_GRACE_MS = 60_000;
const ADDRESSED_REASONS = ["direct_message", "mention", "thread_reply"];
/** The runtime's cap on one inbox read; it returns the oldest open items first. */
const INBOX_LIMIT = 500;
const INBOX_QUERY = `targetId=${SCOUTBOT_AGENT_ID}&reason=${ADDRESSED_REASONS.join(",")}&limit=${INBOX_LIMIT}`;

export const SCOUTBOT_PROCESS_SYSTEM_PROMPT = [
  "You are Scout, the operator's assistant inside OpenScout. You talk with the operator in a chat thread and help with whatever they need: the app, their agents, their hosts, or getting something done.",
  "Scout's runtime is exact: it routes asks, keeps work durable and reports results. You are the loose layer on top. The operator can be vague; you do the finding.",
  "Turn loose references (\"the einstein one\", \"what I was doing yesterday\", \"this page\") into exact agents, sessions, hosts and flights with your read tools: route_context for a roughly named recipient, where for a topic, sessions_search for past work, hosts_list for machines. Then act through the runtime.",
  "When the reading matters, say how you read it, for example \"I took 'einstein' to mean einstein-13.\" When two candidates are close, ask one short question instead of guessing.",
  "To hand work to an agent, use ask with the resolved target, or projectPath plus harness for fresh work. Say it was sent only when the receipt confirms it. Do not wait in the turn: the runtime tells you when the work finishes, and you pass its result on in this thread. Use messages_send only for FYIs.",
  "You act as scoutbot, never as the operator. You cannot run commands yourself.",
  "For questions about the Scout app, a screen or setting, or Scout's runtime and protocol, call scoutbot_guide for the relevant topic before answering. Its guide and docs are loaded only on demand. Check live Scout read tools for current state.",
  "Each request carries a live snapshot of agents and work in flight, and the page the operator has open when it is known. Read \"this\", \"here\" and \"this session\" as that page and its records before asking.",
  "Keep answers short unless the operator asks for detail.",
].join("\n");

export type ScoutbotProcessLog = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

export type ScoutbotProcessOptions = {
  broker: ScoutbotBrokerLink;
  brain: ScoutbotBrain;
  currentDirectory: string;
  threads?: ScoutbotThreadMapStore;
  conversations?: ScoutbotBrainConversationMap;
  handouts?: ScoutbotHandouts;
  model?: string;
  log?: ScoutbotProcessLog;
  now?: () => number;
};

export type ScoutbotProcess = {
  /** Registers Scoutbot and makes sure its default thread exists. */
  bootstrap: () => Promise<void>;
  /** Follows Scoutbot's runtime inbox until `signal` aborts, reconnecting with backoff. */
  run: (signal: AbortSignal) => Promise<void>;
  /** One inbox item, start to ack; exposed for tests. */
  handleItem: (item: InboxItem) => Promise<void>;
  /** The source message the given Pi conversation is answering now. */
  turnOf: (conversationId: number) => string | undefined;
  /** Remembers which thread an accepted ask came from, so its result goes back there. */
  recordHandout: (flightId: string, conversationId: number) => void;
};

type Snapshot = ScoutBrokerSnapshot & {
  endpoints?: Record<string, ScoutBrokerEndpointRecord>;
  flights?: Record<string, { id: string; targetAgentId?: string; state?: string; startedAt?: number; summary?: string }>;
  messages?: Record<string, ScoutBrokerMessageRecord>;
};

/** Where an answer goes: a thread, the operator message it answers, and who hears it. */
type Destination = {
  thread: ScoutbotThreadRecord;
  replyToMessageId?: string;
  actorId: string;
  /** Set when the message is the result of Scoutbot's own ask. */
  flightId?: string;
};

/** How an inbox item is handled: answered at a destination, acked as a progress note, held for its hand-out record, or acked unrouted. */
type Routing = Destination | "progress" | "wait" | null;

type Lease = { itemId: string; generation?: number };

const defaultLog: ScoutbotProcessLog = {
  info: (message) => console.log(`[scoutbot] ${message}`),
  warn: (message) => console.warn(`[scoutbot] ${message}`),
};

export const replyMessageId = (sourceMessageId: string) =>
  `msg.scoutbot.${createHash("sha256").update(sourceMessageId).digest("hex")}`;

export function createScoutbotProcess(options: ScoutbotProcessOptions): ScoutbotProcess {
  const { broker, brain } = options;
  const log = options.log ?? defaultLog;
  const now = options.now ?? Date.now;
  const threads = options.threads ?? new ScoutbotThreadMapStore();
  const conversations = options.conversations ?? createScoutbotBrainConversationMap();
  const handouts = options.handouts ?? createScoutbotHandouts();
  // Items this generation is handling, and one queue per thread so a
  // thread's turns run in order.
  const inFlight = new Set<string>();
  const queues = new Map<string, Promise<void>>();
  // Items are routed one at a time, in arrival order, so they join their
  // thread's queue in that order.
  let intake: Promise<unknown> = Promise.resolve();
  // Hand-out results held until their ask is recorded, by flight.
  const waiting = new Set<string>();
  // A result can come in while this generation is still starting and Pi has
  // not replayed its ask yet, so the grace counts from the later of the two.
  const startedAt = now();
  // Items this generation has closed, so a full page is read again only after progress.
  let closedCount = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshAt = 0;
  let stopped = false;

  const readNode = () => broker.getJson<ScoutBrokerNodeRecord>("/v1/node");
  const readSnapshot = () => broker.getJson<Snapshot>(`/v1/snapshot?since=${Math.trunc(now() - ANSWER_WINDOW_MS)}`);

  const ensureOperatorActor = async (snapshot: Snapshot) => {
    // The DM's member rows have a foreign key on actors.
    if (snapshot.actors?.[OPERATOR_ID]) return;
    await broker.postJson("/v1/actors", buildOperatorActor());
  };

  const bootstrap = async () => {
    const node = await readNode();
    const snapshot = await readSnapshot();
    if (!snapshot.actors?.[SCOUTBOT_AGENT_ID]) {
      await broker.postJson("/v1/actors", buildScoutbotActor());
    }
    await broker.postJson("/v1/agents", buildScoutbotAgent(node.id));
    const endpoint = buildScoutbotProcessEndpoint(node.id, options.currentDirectory, now());
    await broker.postJson("/v1/endpoints", endpoint);
    // The in-web runner's Codex endpoint outranks a local socket for delivery,
    // so this process retires it.
    for (const stale of Object.values(snapshot.endpoints ?? {})) {
      if (stale.agentId !== SCOUTBOT_AGENT_ID || stale.id === endpoint.id || stale.state === "offline") continue;
      await broker.postJson("/v1/endpoints", { ...stale, state: "offline" });
      log.info(`retired endpoint ${stale.id}`);
    }
    const thread = await threads.ensureDefaultThread({ snapshot, transport: "local_socket" });
    const conversation = buildScoutbotThreadConversation(thread, snapshot, node.id);
    if (conversation && !snapshot.conversations?.[conversation.id]) {
      await ensureOperatorActor(snapshot);
      await broker.postJson("/v1/conversations", conversation);
    }
    log.info(`registered on ${broker.socketPath} as ${SCOUTBOT_AGENT_ID} (node ${node.id})`);
  };

  // --- The inbox: lease, ack, release -------------------------------------

  const claim = async (itemId: string): Promise<Lease | null> => {
    const { claimed } = await broker.postJson<{ claimed: InboxItem | null }>("/v1/inbox/claim", {
      targetId: SCOUTBOT_AGENT_ID, itemId, leaseOwner: SCOUTBOT_LEASE_OWNER, leaseMs: LEASE_MS,
    });
    return claimed ? { itemId: claimed.id, generation: claimed.leaseGeneration } : null;
  };

  const acquire = async (item: InboxItem): Promise<Lease | null> => {
    if (item.status === "leased" && item.leaseOwner === SCOUTBOT_LEASE_OWNER && (item.leaseExpiresAt ?? 0) > now()) {
      // This generation did not take it, so the previous one died holding it.
      // Only the claim holder answers, so taking it back is safe.
      await broker.postJson("/v1/inbox/nack", {
        itemId: item.id, leaseOwner: SCOUTBOT_LEASE_OWNER, leaseGeneration: item.leaseGeneration, reason: "previous_generation",
      }).catch((error) => { if (!isConflict(error)) throw error; });
    }
    return claim(item.id);
  };

  const acknowledge = async (lease: Lease, metadata: Record<string, unknown>) => {
    const ack = (current: Lease) => broker.postJson("/v1/inbox/ack", {
      itemId: current.itemId, leaseOwner: SCOUTBOT_LEASE_OWNER, leaseGeneration: current.generation, metadata,
    });
    try {
      await ack(lease);
      closedCount += 1;
    } catch (error) {
      if (!isConflict(error)) throw error;
      // The lease ran out during a long turn. The answer is posted, so take
      // the item again and close it.
      const again = await claim(lease.itemId);
      if (again) {
        await ack(again);
        closedCount += 1;
      }
    }
  };

  const release = async (lease: Lease, reason: string) => {
    await broker.postJson("/v1/inbox/nack", {
      itemId: lease.itemId, leaseOwner: SCOUTBOT_LEASE_OWNER, leaseGeneration: lease.generation, retryAfterMs: RETRY_MS, reason,
    }).catch((error) => log.warn(`could not release ${lease.itemId}: ${describeError(error)}`));
  };

  /** Reads the inbox again later: for a released item, or a result whose ask is not recorded yet. */
  const refreshLater = (delayMs: number) => {
    if (stopped) return;
    const at = now() + delayMs;
    if (refreshTimer && refreshAt <= at) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshAt = at;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void broker.getJson<InboxItem[]>(`/v1/inbox?${INBOX_QUERY}`)
        .then((items) => considerAll(items, { page: true }))
        .catch((error) => log.warn(`inbox refresh: ${describeError(error)}`));
    }, delayMs);
    refreshTimer.unref?.();
  };

  // --- Routing and answering ----------------------------------------------

  const destinationFor = async (message: ScoutBrokerMessageRecord): Promise<Routing> => {
    const thread = await threads.getThreadByConversationId(message.conversationId);
    if (thread) return { thread, replyToMessageId: message.id, actorId: message.actorId };
    const result = handoutResultOf(message);
    if (!result) return null;
    // Progress notes stay with the flight; the operator hears the final answer.
    if (result.progress) return "progress";
    const { flightId } = result;
    const handout = handouts.get(flightId);
    if (!handout) {
      if (now() - Math.max(message.createdAt, startedAt) >= UNROUTED_GRACE_MS) return null;
      waiting.add(flightId);
      return "wait";
    }
    const origin = await threads.getThread(handout.threadId);
    return origin ? { thread: origin, replyToMessageId: handout.sourceMessageId, actorId: handout.actorId, flightId } : null;
  };

  const answer = async (message: ScoutBrokerMessageRecord, destination: Destination): Promise<string> => {
    const { thread } = destination;
    const id = replyMessageId(message.id);
    // A previous generation may have posted the answer and died before the ack.
    const recent = await broker.getJson<ScoutBrokerMessageRecord[]>(
      `/v1/messages?conversationId=${encodeURIComponent(thread.conversationId)}&since=${Math.max(1, message.createdAt - 1)}&limit=500`);
    if (recent.some((candidate) => candidate.id === id)) return id;

    const [node, snapshot] = await Promise.all([readNode(), readSnapshot()]);
    const conversation = snapshot.conversations?.[thread.conversationId];
    const reply = (body: string, metadata: Record<string, unknown>) => broker.postJson("/v1/messages", {
      id,
      conversationId: thread.conversationId,
      actorId: SCOUTBOT_AGENT_ID,
      originNodeId: node.id,
      class: "agent",
      body,
      ...(destination.replyToMessageId ? { replyToMessageId: destination.replyToMessageId } : {}),
      audience: { notify: [destination.actorId], reason: "reply" },
      visibility: conversation?.visibility ?? "private",
      policy: "durable",
      createdAt: now(),
      metadata: {
        ...scoutbotProvenance({ requestedBy: destination.actorId, sourceMessageId: destination.replyToMessageId ?? message.id }),
        scoutbotThreadId: thread.threadId,
        ...(destination.flightId ? { flightId: destination.flightId, resultMessageId: message.id } : {}),
        ...metadata,
        clientMessageId: id,
      },
    });

    const prompt = destination.flightId
      ? handoutResultPrompt(message, destination.flightId, snapshot)
      : stripScoutbotAddress(message.body);
    if (!destination.flightId) {
      const prefilter = prefilterHandle(prompt, snapshot);
      if (prefilter) {
        const rule = prefilter.metadata.matched_rule;
        if (rule === "slash.report" || rule === "slash.feedback") {
          prefilter.body = await handleDiagnosticCommand(prompt);
        }
        await reply(prefilter.body, { ...prefilter.metadata, sourcePath: "scoutbot-prefilter" });
        log.info(`prefilter reply rule=${rule} source=${message.id}`);
        return id;
      }
    }

    const model = thread.model?.trim() || options.model || SCOUTBOT_PROCESS_DEFAULT_MODEL;
    const sourcePath = destination.flightId ? "scoutbot-handout" : "scoutbot-brain";
    const started = now();
    const known = conversations.get(thread.threadId);
    const turn: ScoutbotTurn = { key: message.id, ...(destination.replyToMessageId ? { replyToMessageId: destination.replyToMessageId } : {}), actorId: destination.actorId };
    // Saved before Pi opens and before it submits; see the conversation map.
    if (known !== null) conversations.setTurn(known, turn);
    try {
      const conversationId = brain.ensureConversation
        ? await brain.ensureConversation({ conversationId: known, model, systemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT })
        : known;
      if (conversationId !== null) {
        conversations.set(thread.threadId, conversationId);
        conversations.setTurn(conversationId, turn);
      }
      const result = await brain.reply({
        conversationId,
        // Pi keeps one turn per request id: after a restart this resumes the
        // same turn instead of starting a second one.
        requestId: message.id,
        body: prompt,
        state: renderScoutbotState(snapshot, now(), { page: pageOf(message) }),
        model,
        systemPrompt: SCOUTBOT_PROCESS_SYSTEM_PROMPT,
      });
      conversations.set(thread.threadId, result.conversationId);
      const text = result.text.trim() || "I came back with an empty answer. Try asking again.";
      await reply(text, {
        sourcePath,
        model,
        brainConversationId: result.conversationId,
        ...(result.usage?.totalTokens != null ? { totalTokens: result.usage.totalTokens } : {}),
      });
      log.info(`answered source=${message.id} via=${sourcePath} model=${model} ms=${now() - started}`);
    } catch (error) {
      if (error instanceof ScoutbotBrokerError || stopped) throw error;
      // A thread that never gets a reply stays "pending" for the composer, so
      // a failed turn still answers.
      log.warn(`brain failed source=${message.id}: ${describeError(error)}`);
      const text = destination.flightId
        ? `The ask finished, but I couldn't read its result: ${describeError(error)}\n\n${message.body}`
        : `I couldn't answer that: ${describeError(error)}`;
      await reply(text, { sourcePath, model, error: true });
    }
    return id;
  };

  const settle = async (item: InboxItem, destination: Destination | "progress" | null) => {
    const message = item.message!;
    const lease = await acquire(item);
    if (!lease) return;
    let metadata: Record<string, unknown>;
    try {
      if (message.actorId === SCOUTBOT_AGENT_ID) metadata = { outcome: "own_message" };
      else if (destination === "progress") metadata = { outcome: "progress" };
      else if (!destination) metadata = { outcome: "unrouted" };
      else if (now() - message.createdAt > ANSWER_WINDOW_MS) metadata = { outcome: "stale" };
      // One answer per hand-out, even when the flight reports twice.
      else if (destination.flightId && !handouts.claimAnswer(destination.flightId, message.id)) metadata = { outcome: "duplicate_result" };
      else metadata = { outcome: "answered", replyMessageId: await answer(message, destination) };
    } catch (error) {
      // The runtime refused a write or the turn could not finish. Hand the
      // item back; it is read again later.
      log.warn(`turn failed source=${message.id}: ${describeError(error)}`);
      if (!stopped) {
        await release(lease, describeError(error).slice(0, 200));
        refreshLater(RETRY_MS);
      }
      return;
    }
    await acknowledge(lease, metadata);
  };

  const enqueue = async (key: string, work: () => Promise<void>) => {
    const previous = queues.get(key) ?? Promise.resolve();
    const turn = previous.catch(() => undefined).then(work);
    queues.set(key, turn);
    try { await turn; } finally { if (queues.get(key) === turn) queues.delete(key); }
  };

  /** A message item whose message record is gone has nothing to answer; closing it frees its place in the page. */
  const closeMissing = async (item: InboxItem) => {
    try {
      const lease = await acquire(item);
      if (lease) await acknowledge(lease, { outcome: "missing_message" });
    } catch (error) {
      log.warn(`inbox item ${item.id}: ${describeError(error)}`);
    } finally {
      inFlight.delete(item.id);
    }
  };

  const handleItem = async (item: InboxItem) => {
    // Invocations to Scoutbot are not inbox turns; they are left to their own path.
    if (stopped || item.kind !== "message") return;
    if (!ADDRESSED_REASONS.includes(item.reason) || !isOpen(item, now())) return;
    if (inFlight.has(item.id)) return;
    inFlight.add(item.id);
    if (!item.message) return closeMissing(item);
    const message = item.message;
    // Only the routing waits its turn here; the answer runs on the thread's queue.
    const routed = intake.then(async () => {
      const destination = await destinationFor(message);
      if (destination === "wait") {
        refreshLater(UNROUTED_GRACE_MS);
        return undefined;
      }
      const key = destination && destination !== "progress" ? destination.thread.threadId : "unrouted";
      return { turn: enqueue(key, () => settle(item, destination)) };
    });
    intake = routed.catch(() => undefined);
    try {
      const routing = await routed;
      if (routing) await routing.turn;
    } catch (error) {
      log.warn(`inbox item ${item.id}: ${describeError(error)}`);
    } finally {
      inFlight.delete(item.id);
    }
  };

  const considerAll = (items: InboxItem[], options: { page?: boolean } = {}) => {
    const ordered = [...items].sort((a, b) => (a.message?.createdAt ?? 0) - (b.message?.createdAt ?? 0));
    const taken: Promise<void>[] = [];
    for (const item of ordered) {
      const before = inFlight.has(item.id);
      const work = handleItem(item);
      if (!before && inFlight.has(item.id)) taken.push(work);
    }
    // The runtime sends no event when a deferred item or another owner's
    // lease comes due, so read the inbox again then.
    const at = now();
    const due = ordered.map((item) => openAt(item, at)).filter((time): time is number => time !== undefined);
    if (due.length) refreshLater(Math.max(1_000, Math.min(...due) - at));
    // A full page hides newer items behind it. They come into view as these
    // close, so read again once the ones taken here are done.
    if (options.page && items.length >= INBOX_LIMIT) {
      refreshLater(RETRY_MS);
      const closedBefore = closedCount;
      if (taken.length) void Promise.allSettled(taken).then(() => { if (closedCount > closedBefore) refreshLater(1_000); });
    }
  };

  const run = async (signal: AbortSignal) => {
    let attempt = 0;
    const stop = () => {
      stopped = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = undefined;
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      while (!signal.aborted) {
        try {
          // The stream opens with a snapshot of what is waiting, then sends
          // each change, so a reconnect also catches up.
          await broker.stream(`/v1/inbox/stream?${INBOX_QUERY}`, (block) => {
            attempt = 0;
            const event = parseSseBlock(block);
            if (event?.eventName === "snapshot") considerAll((event.data as { items?: InboxItem[] }).items ?? [], { page: true });
            else if (event?.eventName === "inbox.item" || event?.eventName === "inbox.item.updated") considerAll([event.data as InboxItem]);
          }, signal);
        } catch (error) {
          if (signal.aborted) return;
          attempt += 1;
          const delayMs = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
          log.warn(`inbox stream dropped (attempt ${attempt}): ${describeError(error)}; retrying in ${delayMs}ms`);
          await sleep(delayMs, signal);
          continue;
        }
        if (!signal.aborted) await sleep(500, signal);
      }
    } finally {
      signal.removeEventListener("abort", stop);
      stop();
    }
  };

  const turnOf = (conversationId: number) => conversations.turnOf(conversationId)?.key;

  const recordHandout = (flightId: string, conversationId: number) => {
    const threadId = conversations.threadOf(conversationId);
    if (!threadId) {
      log.warn(`hand-out ${flightId} came from Pi conversation ${conversationId}, which has no thread`);
      return;
    }
    const turn = conversations.turnOf(conversationId);
    handouts.set(flightId, {
      threadId,
      ...(turn?.replyToMessageId ? { sourceMessageId: turn.replyToMessageId } : {}),
      actorId: turn?.actorId ?? OPERATOR_ID,
      at: now(),
    });
    // Its result may already be waiting; answer it now rather than at the next read.
    if (waiting.delete(flightId)) refreshLater(0);
  };

  return { bootstrap, run, handleItem, turnOf, recordHandout };
}

function isOpen(item: InboxItem, now: number): boolean {
  if (item.status === "pending" || item.status === "accepted") return true;
  if (item.status === "deferred") {
    const due = item.delivery?.metadata?.nextAttemptAt;
    return typeof due !== "number" || due <= now;
  }
  // A lease under Scoutbot's name is the previous generation's; another
  // owner's lease is honoured until it runs out.
  return item.status === "leased"
    && (item.leaseOwner === SCOUTBOT_LEASE_OWNER || (item.leaseExpiresAt ?? 0) <= now);
}

/** When an item that is closed now opens, if it will by itself. */
function openAt(item: InboxItem, now: number): number | undefined {
  if (item.kind !== "message" || !ADDRESSED_REASONS.includes(item.reason) || isOpen(item, now)) return undefined;
  if (item.status === "deferred") {
    const due = item.delivery?.metadata?.nextAttemptAt;
    return typeof due === "number" ? due : undefined;
  }
  return item.status === "leased" && typeof item.leaseExpiresAt === "number" ? item.leaseExpiresAt : undefined;
}

function isConflict(error: unknown): boolean {
  return error instanceof ScoutbotBrokerError && error.status === 409;
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * The flight a message reports on, when it is a hand-out's result. The
 * runtime's own result and failure reports carry `flightId`; an agent that
 * answers with `scout reply --ref` carries it in `completionReply`, with
 * `kind` "progress" or "final".
 */
function handoutResultOf(message: ScoutBrokerMessageRecord): { flightId: string; progress: boolean } | null {
  const flightId = metadataString(message.metadata, "flightId");
  if (flightId) return { flightId, progress: false };
  const reply = message.metadata?.completionReply;
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return null;
  const replyFlightId = metadataString(reply as Record<string, unknown>, "flightId");
  return replyFlightId ? { flightId: replyFlightId, progress: (reply as { kind?: unknown }).kind === "progress" } : null;
}

/** The page the operator had open, when the client sent one with the message. */
function pageOf(message: ScoutBrokerMessageRecord): unknown {
  const page = message.metadata?.scoutbotPage;
  if (!page || typeof page !== "object" || Array.isArray(page)) return undefined;
  return JSON.stringify(page).length <= SCOUTBOT_PAGE_MAX_JSON ? page : undefined;
}

function handoutResultPrompt(message: ScoutBrokerMessageRecord, flightId: string, snapshot: Snapshot): string {
  const author = snapshot.agents?.[message.actorId];
  const who = author?.handle ?? author?.displayName ?? message.actorId;
  const lead = message.class === "status"
    ? `The ask you made for the operator (flight ${flightId}) ended without an answer:`
    : `${who} answered the ask you made for the operator (flight ${flightId}):`;
  return `${lead}\n\n${message.body}\n\nTell the operator what came back, briefly. Do not ask again unless they want you to.`;
}

const OPERATOR_ID = "operator";

function buildOperatorActor(): ActorIdentity {
  return {
    id: OPERATOR_ID,
    kind: "person",
    displayName: resolveOperatorName().trim() || OPERATOR_ID,
    handle: OPERATOR_ID,
    labels: ["scout"],
    metadata: { source: "scoutbot" },
  };
}

function buildScoutbotActor(): ActorIdentity {
  return {
    id: SCOUTBOT_AGENT_ID,
    kind: "agent",
    displayName: SCOUTBOT_DISPLAY_NAME,
    handle: SCOUTBOT_HANDLE,
    labels: ["assistant", "scout", "scoutbot"],
    metadata: { source: "scoutbot", brokerRegistered: true, role: "operator-assistant" },
  };
}

export function buildScoutbotAgent(nodeId: string): ScoutBrokerAgentRecord {
  return {
    ...buildScoutbotActor(),
    kind: "agent",
    definitionId: SCOUTBOT_HANDLE,
    selector: `@${SCOUTBOT_HANDLE}`,
    defaultSelector: `@${SCOUTBOT_HANDLE}`,
    agentClass: "operator",
    capabilities: ["chat"],
    wakePolicy: "keep_warm",
    homeNodeId: nodeId,
    authorityNodeId: nodeId,
    advertiseScope: "local",
    metadata: {
      source: "scoutbot",
      brokerRegistered: true,
      role: "operator-assistant",
      runtime: "scoutbot-process",
      summary: "The operator's assistant, running beside the broker.",
    },
  };
}

export function buildScoutbotProcessEndpoint(nodeId: string, currentDirectory: string, now: number): ScoutBrokerEndpointRecord {
  return {
    id: `${SCOUTBOT_PROCESS_ENDPOINT_ID}.${nodeId}`,
    agentId: SCOUTBOT_AGENT_ID,
    nodeId,
    harness: "pi",
    transport: "local_socket",
    state: "idle",
    cwd: currentDirectory,
    projectRoot: currentDirectory,
    metadata: {
      source: "scoutbot",
      runtime: "scoutbot-process",
      pid: process.pid,
      startedAt: String(now),
    },
  };
}

function stripScoutbotAddress(body: string): string {
  return body.replace(/^\s*@scoutbot(?=\s|[:,]|$)[:,]?\s*/i, "").trim();
}

const MAX_STATE_AGENTS = 60;
const LIVE_ENDPOINT_STATES = new Set(["working", "waiting", "idle"]);

/** A compact, model-facing view of the control plane at this moment. */
export function renderScoutbotState(snapshot: Snapshot, now: number, extra: { page?: unknown } = {}): string {
  const endpointsByAgent = new Map<string, ScoutBrokerEndpointRecord[]>();
  for (const endpoint of Object.values(snapshot.endpoints ?? {})) {
    const list = endpointsByAgent.get(endpoint.agentId) ?? [];
    list.push(endpoint);
    endpointsByAgent.set(endpoint.agentId, list);
  }
  const agents = Object.values(snapshot.agents ?? {})
    .filter((agent) => agent.id !== SCOUTBOT_AGENT_ID)
    .map((agent) => {
      const endpoints = endpointsByAgent.get(agent.id) ?? [];
      const live = endpoints.find((endpoint) => LIVE_ENDPOINT_STATES.has(endpoint.state ?? ""))
        ?? endpoints[0];
      const project = live?.projectRoot ?? live?.cwd;
      return {
        handle: agent.handle ?? agent.id,
        name: agent.displayName,
        state: live?.state ?? "no endpoint",
        harness: live?.harness,
        project: project ? basename(project) : undefined,
      };
    })
    .sort((a, b) => Number(LIVE_ENDPOINT_STATES.has(b.state)) - Number(LIVE_ENDPOINT_STATES.has(a.state)));
  const working = Object.values(snapshot.flights ?? {})
    .filter((flight) => flight.state && !["completed", "failed", "cancelled"].includes(flight.state))
    .map((flight) => ({
      agent: flight.targetAgentId,
      state: flight.state,
      minutes: typeof flight.startedAt === "number" ? Math.round((now - flight.startedAt) / 60_000) : undefined,
      summary: flight.summary,
    }));
  return JSON.stringify({
    at: new Date(now).toISOString(),
    agentCount: agents.length,
    agents: agents.slice(0, MAX_STATE_AGENTS),
    ...(agents.length > MAX_STATE_AGENTS ? { agentsOmitted: agents.length - MAX_STATE_AGENTS } : {}),
    workInFlight: working,
    ...(extra.page !== undefined ? { page: extra.page } : {}),
  });
}

/** The turn a Pi conversation is answering. */
export type ScoutbotTurn = {
  /** The source message id: the idempotency key for the turn's writes. */
  key: string;
  /** The operator message a hand-out made in this turn answers. */
  replyToMessageId?: string;
  /** Who a hand-out's result is for. */
  actorId: string;
};

/**
 * Which Pi conversation holds each Scoutbot thread, and the turn each one is
 * answering. The turn is saved before Pi opens or submits: opening resumes an
 * unfinished turn from the last generation, and the tools it replays need the
 * same turn to send the same request ids.
 */
export type ScoutbotBrainConversationMap = {
  get: (threadId: string) => number | null;
  set: (threadId: string, conversationId: number) => void;
  /** The thread a Pi conversation belongs to. */
  threadOf: (conversationId: number) => string | undefined;
  turnOf: (conversationId: number) => ScoutbotTurn | undefined;
  setTurn: (conversationId: number, turn: ScoutbotTurn) => void;
};

export function createScoutbotBrainConversationMap(
  filePath = join(resolveOpenScoutSupportPaths().supportDirectory, "scoutbot", "process-threads.json"),
): ScoutbotBrainConversationMap {
  const parsed = readJsonFile(filePath) as { threads?: Record<string, unknown>; turns?: Record<string, unknown> } | undefined;
  let threads: Record<string, number> = {};
  for (const [threadId, value] of Object.entries(parsed?.threads ?? {})) {
    if (typeof value === "number" && Number.isInteger(value)) threads[threadId] = value;
  }
  let turns: Record<string, ScoutbotTurn> = {};
  for (const [conversationId, value] of Object.entries(parsed?.turns ?? {})) {
    const turn = value as Partial<ScoutbotTurn> | null;
    if (turn && typeof turn.key === "string" && typeof turn.actorId === "string") {
      turns[conversationId] = { key: turn.key, actorId: turn.actorId, ...(typeof turn.replyToMessageId === "string" ? { replyToMessageId: turn.replyToMessageId } : {}) };
    }
  }
  const save = (nextThreads: Record<string, number>, nextTurns: Record<string, ScoutbotTurn>) => {
    // Only conversations that still hold a thread keep a turn.
    const held = new Set(Object.values(nextThreads).map(String));
    const keptTurns = Object.fromEntries(Object.entries(nextTurns).filter(([id]) => held.has(id)));
    try {
      writeJsonFileDurably(filePath, { version: 1, threads: nextThreads, turns: keptTurns });
    } catch (error) {
      throw new Error(`Could not save Scoutbot conversation binding: ${String(error)}`);
    }
    threads = nextThreads;
    turns = keptTurns;
  };
  return {
    get: (threadId) => threads[threadId] ?? null,
    set: (threadId, conversationId) => {
      if (threads[threadId] === conversationId) return;
      save({ ...threads, [threadId]: conversationId }, turns);
    },
    threadOf: (conversationId) => Object.entries(threads).find(([, id]) => id === conversationId)?.[0],
    turnOf: (conversationId) => turns[String(conversationId)],
    setTurn: (conversationId, turn) => {
      const current = turns[String(conversationId)];
      if (current && current.key === turn.key && current.actorId === turn.actorId && current.replyToMessageId === turn.replyToMessageId) return;
      save(threads, { ...turns, [String(conversationId)]: turn });
    },
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
