import { watchSharedScoutMessages } from "./broker-message-fanout.ts";
// Relay client — connects the bridge OUTBOUND to a relay server.
//
// This lets phones and tablets reach the bridge when they're not on the same
// LAN. The bridge connects to the relay as the "bridge" role, and each mobile
// device connects as a "client". The relay assigns each client socket a relay
// id, and the bridge keeps a distinct Noise transport per relay client so
// reconnects or multiple devices cannot corrupt one another's cipher state.
//
// The bridge is the Noise "responder" — the phone initiates the handshake
// because it scanned the QR code containing the bridge's public key.
//
// The bridge waits in two rooms on each relay, so that knowing where it is
// isn't enough to get in (see RelayRoomKind).

import type { Bridge } from "./bridge.ts";
import { handleRPC } from "./server.ts";
import { bridgeRouter } from "./router.ts";
import {
  callTRPCProcedure,
  getErrorShape,
  getTRPCErrorFromUnknown,
  isTrackedEnvelope,
  TRPCError,
  type TrackedEnvelope,
} from "@trpc/server";
import { isObservable, observableToAsyncIterable } from "@trpc/server/observable";
import { log } from "./log.ts";
import {
  type ScoutBrokerConversationLifecycleRecord,
  type ScoutBrokerMessageRecord,
} from "../../../broker/service.ts";
import {
  SecureTransport,
  type SocketLike,
  type KeyPair,
  type QRPayload,
  createQRPayload,
  bytesToHex,
  isTrustedPeer,
  saveTrustedPeer,
} from "../security/index.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Which of the bridge's two rooms a relay connection holds.
 *
 * - "pairing": the room in the QR code, the pairing link and the account's
 *   rendezvous entry. The bridge joins it without its key, so the relay's
 *   /resolve can't hand it out. A device that completes the handshake here
 *   becomes trusted, the way a scan always has.
 * - "reconnect": the room /resolve returns for the bridge's key, which is how
 *   a paired phone finds the Mac again after it restarts. Only devices already
 *   in the trust store get in; any other is closed with 4003, the same as the
 *   direct port.
 * - "account": the room the account's directory entry names, which the
 *   console hands to a browser. The cloud says who gets it, so a new device
 *   here waits for the host's owner to allow it (`admitNewDevice`) and can
 *   call nothing but `web.admission` until then; one declined is closed 4003.
 */
export type RelayRoomKind = "pairing" | "reconnect" | "account";

export interface RelayClientOptions {
  /** Enable Noise encryption on the relay connection. Default: true. */
  secure?: boolean;
  /** Relay URL advertised to phones. Defaults to the URL used by the bridge. */
  publicRelayUrl?: string;
  /** Additional relay URLs phones should try after the advertised primary. */
  fallbackRelayUrls?: string[];
  /** Shared QR payload when one bridge joins multiple relay servers. */
  qrPayload?: QRPayload;
  /** Which room this connection holds. Default: "reconnect". */
  kind?: RelayRoomKind;
  /**
   * The account room's gate: asks the host's owner about a new device. Without
   * it the account room admits no one new.
   */
  admitNewDevice?: (publicKeyHex: string, signal: AbortSignal) => Promise<"admitted" | "denied" | "expired">;
  /** The room to join. Defaults to the QR payload's room. */
  room?: string;
  /** The reconnect room, which trusted devices learn from `mobile.endpoints`. */
  reconnectRoom?: string;
  /** Optional lifecycle callbacks for status surfaces. */
  events?: RelayEventHandlers;
  /** Heartbeat timing; tests shorten it. */
  heartbeat?: { intervalMs: number; staleMs: number };
}

export interface RelayConnection {
  /** QR payload for the phone to scan — contains relay URL, room ID, bridge public key. */
  qrPayload: QRPayload;
  /** Disconnect from the relay and stop reconnecting. */
  disconnect: () => void;
  /**
   * Drop the current socket and connect again now, as after the host wakes:
   * a line that went quiet while it slept can look open for a long time.
   */
  reconnectNow: (reason: string) => void;
  /**
   * Reconnect rooms only: tell the relay this host is about to sleep, so it
   * shows the host asleep and closes its clients with a reason, instead of
   * leaving them on a line that goes quiet.
   */
  sayGoingToSleep: () => void;
  /**
   * Pairing rooms only: stop trusting new devices here, and leave the room
   * once the devices still connected through it have gone.
   */
  retire: () => void;
}

export interface RelayEventHandlers {
  onConnecting?: (detail: { relayUrl: string; room: string }) => void;
  onConnected?: (detail: { relayUrl: string; room: string }) => void;
  /** `newDevice`: the handshake added a device to the trust store. */
  onPaired?: (detail: {
    relayUrl: string;
    room: string;
    kind: RelayRoomKind;
    remotePublicKey: Uint8Array;
    newDevice: boolean;
  }) => void;
  onError?: (detail: { relayUrl: string; room: string; error: Error }) => void;
  onClosed?: (detail: { relayUrl: string; room: string; code: number; reason: string }) => void;
  onReconnectScheduled?: (detail: { relayUrl: string; room: string; delayMs: number }) => void;
}

interface RelayEnvelope {
  phase: "relay";
  event: "message" | "close";
  clientId: string;
  payload?: string;
  code?: number;
  reason?: string;
}

interface RelayPeerState {
  clientId: string;
  transport: SecureTransport;
  deviceId?: string;
  trustedPeer?: boolean;
  /** Set while a device in the account room waits for the owner's answer. */
  awaitingAdmission?: AbortController;
  /** Live subscriptions by request id; all stop when the peer leaves. */
  subscriptions: Map<string | number, AbortController>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Heartbeat (mobile-relay.ts mirrors these literals byte for byte). The relay
// answers a ping without waking, so a host is up while its pongs come back.
const RELAY_PING_FRAME = "{\"v\":1,\"kind\":\"relay_ping\"}";
const RELAY_PONG_FRAME = "{\"v\":1,\"kind\":\"relay_pong\"}";
const RELAY_GOODBYE_SLEEP_FRAME = "{\"v\":1,\"kind\":\"relay_goodbye\",\"reason\":\"sleep\"}";
const RELAY_PING_INTERVAL_MS = 20_000;
/** A relay that has answered pings and then goes this long without a frame holds a dead line. */
const RELAY_STALE_MS = 75_000;
/** Every few pings, a reconnect room asks the relay over HTTPS whether it still routes to this socket. */
const RELAY_HEALTH_CHECK_EVERY = 3;
const RELAY_HEALTH_CHECK_AFTER_MS = 45_000;

const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const BACKOFF_MULTIPLIER = 2;
const LEGACY_CLIENT_ID = "__legacy__";

function mobileConversationChangedEvent(message: ScoutBrokerMessageRecord) {
  const rawClientMessageId = message.metadata?.clientMessageId;
  const clientMessageId = typeof rawClientMessageId === "string" && rawClientMessageId.trim().length > 0
    ? rawClientMessageId.trim()
    : null;
  return {
    event: "mobile:conversation:changed" as const,
    conversationId: message.conversationId,
    messageId: message.id,
    clientMessageId,
  };
}

function mobileConversationLifecycleEvent(lifecycle: ScoutBrokerConversationLifecycleRecord) {
  return {
    event: "mobile:conversation:lifecycle" as const,
    conversationId: lifecycle.conversationId,
    messageId: lifecycle.messageId ?? null,
    clientMessageId: lifecycle.clientMessageId ?? null,
    invocationId: lifecycle.invocationId ?? null,
    flightId: lifecycle.flightId ?? null,
    targetAgentId: lifecycle.targetAgentId ?? null,
    lifecycleState: lifecycle.state,
    summary: lifecycle.summary ?? null,
    error: lifecycle.error ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Connect the bridge to a relay server for remote mobile access.
 *
 * Returns a QR payload (to display / encode for the phone) and a disconnect
 * function. The connection auto-reconnects with exponential backoff.
 */
export function connectToRelay(
  relayUrl: string,
  identity: KeyPair,
  bridge: Bridge,
  options: RelayClientOptions = {},
): RelayConnection {
  const { secure = true, events } = options;
  const pingIntervalMs = options.heartbeat?.intervalMs ?? RELAY_PING_INTERVAL_MS;
  const staleMs = options.heartbeat?.staleMs ?? RELAY_STALE_MS;
  const eventRelayUrl = options.publicRelayUrl?.trim() || relayUrl;
  const qrPayload = options.qrPayload
    ?? createQRPayload(identity.publicKey, eventRelayUrl, options.fallbackRelayUrls);
  const kind = options.kind ?? "reconnect";
  const room = options.room ?? qrPayload.room;
  const reconnectRoom = options.reconnectRoom ?? (kind === "reconnect" ? room : undefined);
  // Only a pairing room that hasn't been retired trusts devices it hasn't seen.
  let admitsNewDevices = kind === "pairing";
  let retired = false;

  let ws: WebSocket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let eventUnsub: (() => void) | null = null;
  let brokerWatchAbort: AbortController | null = null;
  let stopped = false;
  let backoff = INITIAL_BACKOFF_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const securePeers = new Map<string, RelayPeerState>();
  const plaintextClients = new Set<string>();

  function connect(): void {
    if (stopped) return;

    // Registering the key is what lets /resolve find a room, so only the reconnect room does.
    const bridgeKeyHex = kind === "reconnect" ? bytesToHex(identity.publicKey) : undefined;
    const url = buildRelayUrl(relayUrl, room, bridgeKeyHex);
    console.log(`[relay-client] connecting to relay (${kind} room: ${room})`);
    events?.onConnecting?.({ relayUrl: eventRelayUrl, room });

    const socket = new WebSocket(url, relayWebSocketOptions(relayUrl) as never);
    ws = socket;
    // Frames prove the line is alive. A relay that never answers a ping
    // predates heartbeats, so only one that has answered can be judged stale.
    let heardAt = Date.now();
    let openedAt = 0;
    let relayAnswersPings = false;
    let pings = 0;

    socket.addEventListener("open", () => {
      if (ws !== socket) return;
      console.log(`[relay-client] connected to relay (room: ${room})`);
      backoff = INITIAL_BACKOFF_MS;
      heardAt = openedAt = Date.now();
      startHeartbeat();
      events?.onConnected?.({ relayUrl: eventRelayUrl, room });
    });

    socket.addEventListener("message", (event) => {
      if (ws !== socket) return;
      heardAt = Date.now();
      if (event.data === RELAY_PONG_FRAME) {
        relayAnswersPings = true;
        return;
      }
      handleRelaySocketMessage(event.data);
    });

    const startHeartbeat = () => {
      stopHeartbeat();
      heartbeat = setInterval(() => {
        if (ws !== socket) {
          stopHeartbeat();
          return;
        }
        if (relayAnswersPings && Date.now() - heardAt > staleMs) {
          reconnectNow(`relay silent for ${Math.round(staleMs / 1000)}s`);
          return;
        }
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(RELAY_PING_FRAME);
        pings += 1;
        // A pong only proves some relay instance holds this socket. Around a
        // relay deploy an old instance can keep answering while requests go
        // to a new one with no bridge, so ask the one /resolve reaches.
        if (bridgeKeyHex && pings % RELAY_HEALTH_CHECK_EVERY === 0 && Date.now() - openedAt > RELAY_HEALTH_CHECK_AFTER_MS) {
          void relayStillRoutesTo(relayUrl, bridgeKeyHex).then((routes) => {
            if (routes === false && ws === socket) reconnectNow("relay no longer routes to this socket");
          });
        }
      }, pingIntervalMs);
    };

    socket.addEventListener("close", (event) => {
      if (ws !== socket) return;
      console.log(`[relay-client] disconnected (code: ${event.code}, reason: ${event.reason})`);
      events?.onClosed?.({
        relayUrl: eventRelayUrl,
        room,
        code: event.code,
        reason: event.reason,
      });
      cleanup();
      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (ws !== socket) return;
      const error = new Error("Relay websocket error");
      console.error("[relay-client] connection error");
      events?.onError?.({ relayUrl: eventRelayUrl, room, error });
      // The close event will fire after this, triggering reconnect.
    });
  }

  function handleRelaySocketMessage(raw: unknown): void {
    const envelope = parseRelayEnvelope(raw);

    if (!secure) {
      handlePlaintextRelayMessage(envelope, raw);
      return;
    }

    if (!envelope) {
      const payload = asStringPayload(raw);
      if (!payload) return;
      routeSecurePayload(LEGACY_CLIENT_ID, payload);
      return;
    }

    if (envelope.event === "close") {
      teardownSecurePeer(envelope.clientId);
      return;
    }

    if (!envelope.payload) {
      return;
    }

    routeSecurePayload(envelope.clientId, envelope.payload);
  }

  function routeSecurePayload(clientId: string, payload: string): void {
    let peer = securePeers.get(clientId);
    const handshakePattern = detectHandshakePattern(payload);

    if (handshakePattern && (!peer || peer.transport.isReady())) {
      teardownSecurePeer(clientId);
      peer = createSecurePeer(clientId, handshakePattern);
    }

    if (!peer && !handshakePattern && clientId !== LEGACY_CLIENT_ID) {
      // A session from before this socket: the bridge dropped off the relay
      // and came back without its keys. Reset it as a failed decrypt does, so
      // the client shakes hands again instead of waiting on an answer.
      sendRelayClose(clientId, 4002, "Transport reset");
      return;
    }

    peer?.transport.receive(payload);
  }

  function createSecurePeer(clientId: string, pattern?: "XX" | "IK"): RelayPeerState | undefined {
    if (!ws) return undefined;

    const peer: RelayPeerState = {
      clientId,
      subscriptions: new Map(),
      transport: undefined as unknown as SecureTransport,
      deviceId: undefined,
      trustedPeer: false,
    };

    const socketAdapter: SocketLike = {
      send: (data) => {
        sendRelayMessage(clientId, data);
      },
    };

    const transport = new SecureTransport(
      socketAdapter,
      "responder",
      identity,
      {
        onReady: (remotePublicKey, readyInfo) => {
          const pubHex = bytesToHex(remotePublicKey);
          const newDevice = !readyInfo.wasTrustedPeer;
          if (newDevice && kind === "account" && options.admitNewDevice && !retired) {
            awaitAdmission(peer, remotePublicKey, options.admitNewDevice);
            return;
          }
          if (newDevice && !admitsNewDevices) {
            const where = kind === "reconnect" ? "the reconnect room" : "a used pairing room";
            console.warn(
              `[relay-client] rejecting unpaired device ${pubHex.slice(0, 12)}... in ${where}; pair with the Mac's current code`,
            );
            sendRelayClose(clientId, 4003, "Untrusted peer");
            teardownSecurePeer(clientId);
            return;
          }
          admitPeer(peer, remotePublicKey, readyInfo.trustedPeer, newDevice);
        },

        onMessage: (message) => {
          handleIncomingRPC(peer, message);
        },

        onError: (err) => {
          console.error("[relay-client] secure transport error:", err.message);
          log.error("trns:cry", `decrypt failed for ${clientId} — resetting handshake: ${err.message}`);
          events?.onError?.({ relayUrl: eventRelayUrl, room, error: err });
          sendRelayClose(clientId, 4002, "Transport reset");
          teardownSecurePeer(clientId);
        },

        onClose: () => {
          teardownSecurePeer(clientId);
        },
      },
      {
        ...(pattern ? { pattern } : {}),
        trustOnComplete: admitsNewDevices,
        // A pairing room retired mid-handshake must not write the new device after all.
        skipTrustWrite: (remotePublicKeyHex) => !admitsNewDevices && !isTrustedPeer(remotePublicKeyHex),
      },
    );

    peer.transport = transport;
    securePeers.set(clientId, peer);
    return peer;
  }

  /** A device in the room for good: it gets the session feed and the router. */
  function admitPeer(peer: RelayPeerState, remotePublicKey: Uint8Array, trustedPeer: boolean, newDevice: boolean): void {
    const pubHex = bytesToHex(remotePublicKey);
    peer.deviceId = pubHex.slice(0, 16);
    peer.trustedPeer = trustedPeer;
    replaceOlderPeerForSameDevice(peer);
    ensureBridgeEventSubscription();
    ensureBrokerMessageSubscription();
    console.log(
      `[relay-client] secure handshake complete (peer: ${pubHex.slice(0, 12)}..., trusted: ${peer.trustedPeer}, device: ${peer.deviceId}, client: ${peer.clientId})`,
    );
    events?.onPaired?.({ relayUrl: eventRelayUrl, room, kind, remotePublicKey, newDevice });
    sendExistingSessions((json) => {
      if (peer.transport.isReady()) {
        peer.transport.send(json);
      }
    });
  }

  /**
   * Hold a new device in the account room until the host's owner answers. It
   * stays connected so it can say it's waiting, but gets no feed and no router.
   */
  function awaitAdmission(
    peer: RelayPeerState,
    remotePublicKey: Uint8Array,
    admit: NonNullable<RelayClientOptions["admitNewDevice"]>,
  ): void {
    const pubHex = bytesToHex(remotePublicKey);
    const waiting = new AbortController();
    peer.deviceId = pubHex.slice(0, 16);
    peer.trustedPeer = false;
    peer.awaitingAdmission = waiting;
    console.log(`[relay-client] device ${pubHex.slice(0, 12)}... in the account room is waiting to be allowed`);
    admit(pubHex, waiting.signal).then(
      (decision) => {
        if (waiting.signal.aborted || peer.awaitingAdmission !== waiting) return;
        peer.awaitingAdmission = undefined;
        if (decision !== "admitted") {
          console.warn(`[relay-client] device ${pubHex.slice(0, 12)}... was not allowed (${decision})`);
          sendRelayClose(peer.clientId, 4003, decision === "denied" ? "Declined by the host" : "Not allowed in time");
          teardownSecurePeer(peer.clientId);
          return;
        }
        const pairedAt = new Date().toISOString();
        saveTrustedPeer({ publicKey: pubHex, name: "Device (account)", pairedAt, lastSeen: pairedAt });
        admitPeer(peer, remotePublicKey, true, true);
      },
      (error) => {
        if (peer.awaitingAdmission !== waiting) return;
        peer.awaitingAdmission = undefined;
        console.error("[relay-client] account admission failed:", error instanceof Error ? error.message : String(error));
        sendRelayClose(peer.clientId, 4003, "Untrusted peer");
        teardownSecurePeer(peer.clientId);
      },
    );
  }

  /**
   * What a device waiting for the owner may ask: whether it's in yet. Any
   * other call is refused before it reaches the router.
   */
  function answerWhileAwaitingAdmission(req: any, send: (json: string) => void): void {
    if (req?.method === "subscription.stop" || req?.id == null) return;
    if (req.params?.path === "web.admission") {
      send(JSON.stringify({ id: req.id, jsonrpc: "2.0", result: { type: "data", data: { state: "pending" } } }));
      return;
    }
    send(JSON.stringify({
      id: req.id,
      jsonrpc: "2.0",
      error: {
        message: "This host hasn't allowed this device yet",
        code: -32001,
        data: { code: "FORBIDDEN", httpStatus: 403 },
      },
    }));
  }

  function replaceOlderPeerForSameDevice(peer: RelayPeerState): void {
    if (!peer.deviceId) return;

    for (const [otherClientId, otherPeer] of securePeers) {
      if (otherClientId === peer.clientId || otherPeer.deviceId !== peer.deviceId) {
        continue;
      }
      sendRelayClose(otherClientId, 4001, "Replaced by newer connection");
      teardownSecurePeer(otherClientId);
    }
  }

  function teardownSecurePeer(clientId: string): void {
    const leaving = securePeers.get(clientId);
    leaving?.awaitingAdmission?.abort();
    for (const subscription of leaving?.subscriptions.values() ?? []) subscription.abort();
    leaving?.subscriptions.clear();
    if (!securePeers.has(clientId)) {
      return;
    }
    securePeers.delete(clientId);
    maybeReleaseMobileSubscriptions();
    if (retired && securePeers.size === 0) {
      disconnect();
    }
  }

  function handlePlaintextRelayMessage(envelope: RelayEnvelope | null, raw: unknown): void {
    if (envelope?.event === "close") {
      plaintextClients.delete(envelope.clientId);
      maybeReleaseMobileSubscriptions();
      return;
    }

    const clientId = envelope?.clientId ?? LEGACY_CLIENT_ID;
    const payload = envelope?.payload ?? asStringPayload(raw);
    if (!payload) return;

    const isNewClient = !plaintextClients.has(clientId);
    plaintextClients.add(clientId);
    ensureBridgeEventSubscription();
    ensureBrokerMessageSubscription();

    if (isNewClient) {
      sendExistingSessions((json) => sendRelayMessage(clientId, json));
    }

    handlePlaintextMessage(clientId, payload);
  }

  function ensureBridgeEventSubscription(): void {
    if (eventUnsub) return;

    eventUnsub = bridge.onEvent((sequenced) => {
      const json = JSON.stringify({
        seq: sequenced.seq,
        event: sequenced.event,
      });

      broadcastToMobileClients(json);
    });
  }

  function ensureBrokerMessageSubscription(): void {
    if (brokerWatchAbort) return;

    const abort = new AbortController();
    brokerWatchAbort = abort;
    void watchSharedScoutMessages({
      allConversations: true,
      signal: abort.signal,
      onMessage(message) {
        broadcastToMobileClients(JSON.stringify(mobileConversationChangedEvent(message)));
      },
      onLifecycle(lifecycle) {
        broadcastToMobileClients(JSON.stringify(mobileConversationLifecycleEvent(lifecycle)));
      },
    }).catch((error) => {
      if (abort.signal.aborted) return;
      log.warn(
        "broker",
        "Broker message invalidation stream ended unexpectedly",
        { error: error instanceof Error ? error.message : String(error) },
      );
      if (brokerWatchAbort === abort) brokerWatchAbort = null;
    });
  }

  function maybeReleaseMobileSubscriptions(): void {
    if (secure ? securePeers.size > 0 : plaintextClients.size > 0) {
      return;
    }

    eventUnsub?.();
    eventUnsub = null;
    brokerWatchAbort?.abort();
    brokerWatchAbort = null;
  }

  function broadcastToMobileClients(json: string): void {
    if (secure) {
      for (const peer of securePeers.values()) {
        if (peer.transport.isReady() && !peer.awaitingAdmission) {
          peer.transport.send(json);
        }
      }
      return;
    }

    for (const clientId of plaintextClients) {
      sendRelayMessage(clientId, json);
    }
  }

  function sendExistingSessions(send: (json: string) => void): void {
    for (const session of bridge.listSessions()) {
      send(JSON.stringify({
        seq: 0,
        event: { event: "session:update", session },
      }));
    }
  }

  async function dispatchTRPC(
    req: any,
    send: (json: string) => void,
    context: { deviceId?: string; secureTransport?: boolean; trustedPeer?: boolean; reconnectRoom?: string } = {},
    subscriptions?: Map<string | number, AbortController>,
  ): Promise<void> {
    const { id, method, params } = req;

    if (method === "subscription.stop") {
      subscriptions?.get(id)?.abort();
      subscriptions?.delete(id);
      return;
    }

    const type = method as "query" | "mutation" | "subscription";
    const path = params?.path;
    let input = params?.input;

    if (!path) {
      send(JSON.stringify({ id, jsonrpc: "2.0", error: { code: -32600, message: "Missing path in params" } }));
      return;
    }

    const sendError = (cause: unknown) => {
      const error = getTRPCErrorFromUnknown(cause);
      send(JSON.stringify({
        id,
        jsonrpc: "2.0",
        error: getErrorShape({ config: bridgeRouter._def._config, error, type, path, input, ctx: undefined }),
      }));
    };

    if (type === "subscription") {
      // A resuming client names the last event it saw; the procedure reads it from its input.
      if (params?.lastEventId !== undefined) {
        input = input && typeof input === "object" && !Array.isArray(input)
          ? { ...input, lastEventId: params.lastEventId }
          : input ?? { lastEventId: params.lastEventId };
      }
      if (!subscriptions) {
        sendError(new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: "Subscriptions need a secure channel" }));
        return;
      }
      if (subscriptions.has(id)) {
        sendError(new TRPCError({ code: "BAD_REQUEST", message: `Duplicate id ${id}` }));
        return;
      }
      const abort = new AbortController();
      subscriptions.set(id, abort);
      void runSubscription(id, path, input, abort, send, context, sendError).finally(() => {
        if (subscriptions.get(id) === abort) subscriptions.delete(id);
      });
      return;
    }

    try {
      const ctx = { bridge, cwd: process.cwd(), ...context };
      const result = await callTRPCProcedure({
        router: bridgeRouter,
        path,
        getRawInput: () => Promise.resolve(input),
        ctx,
        type,
        signal: AbortSignal.timeout(30_000),
        batchIndex: 0,
      });
      send(JSON.stringify({ id, jsonrpc: "2.0", result: { type: "data", data: result } }));
    } catch (cause) {
      const errMsg = cause instanceof Error ? cause.message : String(cause);
      log.error("rpc:err", `✗ ${path} — ${errMsg}`);
      sendError(cause instanceof TRPCError ? cause : new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause }));
    }
  }

  /** One subscription's frames, as the bridge's own socket sends them: started, data (tracked ids kept), stopped. */
  async function runSubscription(
    id: string | number,
    path: string,
    input: unknown,
    abort: AbortController,
    send: (json: string) => void,
    context: Record<string, unknown>,
    sendError: (cause: unknown) => void,
  ): Promise<void> {
    let iterator: AsyncIterator<unknown>;
    try {
      const result = await callTRPCProcedure({
        router: bridgeRouter,
        path,
        getRawInput: () => Promise.resolve(input),
        ctx: { bridge, cwd: process.cwd(), ...context },
        type: "subscription",
        signal: abort.signal,
        batchIndex: 0,
      });
      const iterable = isObservable(result)
        ? observableToAsyncIterable(result, abort.signal)
        : result as AsyncIterable<unknown>;
      if (!iterable || typeof (iterable as AsyncIterable<unknown>)[Symbol.asyncIterator] !== "function") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Subscription ${path} did not return a stream` });
      }
      iterator = iterable[Symbol.asyncIterator]();
    } catch (cause) {
      sendError(cause);
      return;
    }

    send(JSON.stringify({ id, jsonrpc: "2.0", result: { type: "started" } }));
    const aborted = new Promise<"abort">((resolve) => {
      if (abort.signal.aborted) resolve("abort");
      abort.signal.addEventListener("abort", () => resolve("abort"), { once: true });
    });
    try {
      while (true) {
        const next = await Promise.race([iterator.next(), aborted]);
        if (next === "abort" || next.done) break;
        const value = next.value;
        if (isTrackedEnvelope(value)) {
          const [eventId, data] = value as TrackedEnvelope<unknown>;
          send(JSON.stringify({ id, jsonrpc: "2.0", result: { type: "data", id: eventId, data: { id: eventId, data } } }));
        } else {
          send(JSON.stringify({ id, jsonrpc: "2.0", result: { type: "data", data: value } }));
        }
      }
      await iterator.return?.();
      if (!abort.signal.aborted) send(JSON.stringify({ id, jsonrpc: "2.0", result: { type: "stopped" } }));
    } catch (cause) {
      log.error("rpc:err", `✗ ${path} — ${cause instanceof Error ? cause.message : String(cause)}`);
      sendError(cause);
      await iterator.return?.().catch(() => undefined);
    }
  }

  function handlePlaintextMessage(clientId: string, raw: string): void {
    let req;
    try {
      req = JSON.parse(raw);
    } catch {
      sendRelayMessage(clientId, JSON.stringify({ id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }

    const send = (json: string) => {
      sendRelayMessage(clientId, json);
    };

    if (isTRPCMessage(req)) {
      void dispatchTRPC(req, send);
    } else {
      void handleRPC(bridge, req, undefined).then((res) => send(JSON.stringify(res)));
    }
  }

  function handleIncomingRPC(peer: RelayPeerState, message: string): void {
    let req;
    try {
      req = JSON.parse(message);
    } catch {
      if (peer.transport.isReady()) {
        peer.transport.send(
          JSON.stringify({ id: null, error: { code: -32700, message: "Parse error" } }),
        );
      }
      return;
    }

    const send = (json: string) => {
      if (peer.transport.isReady()) {
        peer.transport.send(json);
      }
    };

    if (peer.awaitingAdmission) {
      answerWhileAwaitingAdmission(req, send);
      return;
    }

    if (isTRPCMessage(req)) {
      void dispatchTRPC(req, send, {
        deviceId: peer.deviceId,
        secureTransport: true,
        trustedPeer: peer.trustedPeer,
        reconnectRoom,
      }, peer.subscriptions);
    } else {
      void handleRPC(bridge, req, {
        deviceId: peer.deviceId,
        secureTransport: true,
        trustedPeer: peer.trustedPeer,
      }).then((res) => send(JSON.stringify(res)));
    }
  }

  function isTRPCMessage(req: any): boolean {
    return req.jsonrpc === "2.0" && ["query", "mutation", "subscription", "subscription.stop"].includes(req.method);
  }

  function sendRelayMessage(clientId: string, data: string | Uint8Array): void {
    const payload = asStringPayload(data);
    if (!payload || !ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({
      phase: "relay",
      event: "message",
      clientId,
      payload,
    } satisfies RelayEnvelope));
  }

  function sendRelayClose(clientId: string, code: number, reason: string): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify({
      phase: "relay",
      event: "close",
      clientId,
      code,
      reason,
    } satisfies RelayEnvelope));
  }

  function stopHeartbeat(): void {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function reconnectNow(reason: string): void {
    if (stopped) return;
    console.log(`[relay-client] reconnecting now (${kind} room: ${room}): ${reason}`);
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    const abandoned = ws;
    cleanup();
    try {
      // A half-open socket may never finish closing; its late events are ignored.
      abandoned?.close(4000, "Bridge reconnecting");
    } catch {
      // Already gone.
    }
    if (retired) {
      stopped = true;
      return;
    }
    backoff = INITIAL_BACKOFF_MS;
    connect();
  }

  function sayGoingToSleep(): void {
    if (kind !== "reconnect" || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(RELAY_GOODBYE_SLEEP_FRAME);
  }

  function cleanup(): void {
    stopHeartbeat();
    eventUnsub?.();
    eventUnsub = null;
    brokerWatchAbort?.abort();
    brokerWatchAbort = null;
    securePeers.clear();
    plaintextClients.clear();
    ws = null;
  }

  function scheduleReconnect(): void {
    if (stopped) return;
    // A retired pairing room has nobody left to come back for: the drop closed them all.
    if (retired) {
      stopped = true;
      return;
    }

    console.log(`[relay-client] reconnecting in ${backoff}ms...`);
    events?.onReconnectScheduled?.({ relayUrl: eventRelayUrl, room, delayMs: backoff });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, backoff);

    backoff = Math.min(backoff * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
  }

  function disconnect(): void {
    stopped = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const activeWs = ws;
    cleanup();
    activeWs?.close(1000, "Bridge disconnecting");
    console.log("[relay-client] disconnected from relay");
  }

  function retire(): void {
    if (kind !== "pairing" || retired) return;
    admitsNewDevices = false;
    retired = true;
    if (securePeers.size === 0 && plaintextClients.size === 0) {
      disconnect();
    }
  }

  connect();

  return { qrPayload, disconnect, retire, reconnectNow, sayGoingToSleep };
}

/**
 * Whether the relay that answers HTTPS still routes this bridge key to an open
 * socket. Null when it can't say: the request failed, or the relay didn't
 * answer for this key.
 */
async function relayStillRoutesTo(relayUrl: string, bridgeKeyHex: string): Promise<boolean | null> {
  try {
    const url = new URL(relayUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/healthz`;
    url.search = "";
    url.searchParams.set("bridgePublicKey", bridgeKeyHex);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      ...(url.protocol === "https:" ? { tls: { rejectUnauthorized: false } } : {}),
    } as RequestInit);
    if (!response.ok) return null;
    const health = await response.json() as { bridgePublicKey?: unknown; bridgeConnected?: unknown };
    if (health.bridgePublicKey !== bridgeKeyHex || typeof health.bridgeConnected !== "boolean") return null;
    return health.bridgeConnected;
  } catch {
    return null;
  }
}

function relayWebSocketOptions(
  relayUrl: string,
): Bun.WebSocketOptions | undefined {
  if (!relayUrl.startsWith("wss://")) {
    return undefined;
  }

  return {
    tls: {
      rejectUnauthorized: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRelayUrl(baseUrl: string, roomId: string, bridgePublicKey?: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("room", roomId);
  url.searchParams.set("role", "bridge");
  if (bridgePublicKey) {
    url.searchParams.set("key", bridgePublicKey);
  }
  return url.toString();
}

function detectHandshakePattern(payload: string): "XX" | "IK" | null {
  try {
    const wire = JSON.parse(payload) as { phase?: string; payload?: string };
    if (wire.phase !== "handshake" || typeof wire.payload !== "string") {
      return null;
    }
    const handshakePayload = Uint8Array.from(atob(wire.payload), (char) => char.charCodeAt(0));
    return handshakePayload.length > 32 ? "IK" : "XX";
  } catch {
    return null;
  }
}

function parseRelayEnvelope(raw: unknown): RelayEnvelope | null {
  if (typeof raw !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<RelayEnvelope>;
    if (parsed.phase !== "relay" || typeof parsed.clientId !== "string") {
      return null;
    }
    if (parsed.event !== "message" && parsed.event !== "close") {
      return null;
    }
    return {
      phase: "relay",
      event: parsed.event,
      clientId: parsed.clientId,
      payload: typeof parsed.payload === "string" ? parsed.payload : undefined,
      code: typeof parsed.code === "number" ? parsed.code : undefined,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
    };
  } catch {
    return null;
  }
}

function asStringPayload(raw: unknown): string | null {
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof Uint8Array) {
    return new TextDecoder().decode(raw);
  }
  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(raw));
  }
  return null;
}
