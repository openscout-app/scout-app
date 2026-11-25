/**
 * A Mac reached the way the phone reaches it: a WebSocket into the Mac's room
 * on a relay, the Noise channel inside it, and the bridge's tRPC router on
 * the far end. The web views keep calling `/api/…`; this host carries each
 * GET to the Mac's own web server through the bridge's `web.request`.
 *
 * The pairing link's room pairs this browser once. After that the Mac moves
 * its pairing code to a new room, so the browser asks where to come back
 * (`mobile.endpoints`) and uses that room from then on. The Mac picks a new
 * reconnect room each time its runtime starts, so before coming back the
 * browser asks the relay which room the Mac's key waits in now, as the phone
 * does.
 *
 * Live feeds ride the same channel as tRPC subscriptions: the runtime's own
 * streams through `web.subscribe`, and the web API's server-sent events
 * through `web.stream`. Each resumes on its own after the connection drops.
 *
 * Watch-only for now: anything but GET is answered here with 405.
 */
import type { KeyPair } from "@openscout/runtime/pairing-security/noise";
import type { HostClient, HostStream, HostStreamHandlers } from "../host-client.ts";
import type { HostState } from "../host-fleet.ts";
import { BridgeRpc } from "./bridge-rpc.ts";
import { base64ToBytes, hexToBytes } from "./bytes.ts";
import { hostLabel, relayClientUrl, relayResolveUrl, relayUrlsForPage, type PairingPayload } from "./pairing-payload.ts";
import { SecureChannel } from "./secure-channel.ts";
import { TunnelEventSource } from "./tunnel-event-source.ts";

/** What the bridge's `web.request` answers (server/core/pairing/runtime/bridge/web-request.ts). */
type BridgeWebResponse = { status: number; contentType: string | null; body?: string; base64?: string };

type Connection = { socket: WebSocket; channel: SecureChannel; rpc: BridgeRpc };

/** What the browser learns from the Mac once connected, worth keeping across reloads. */
export type PairedHostLearned = { reconnectRoom?: string; hostName?: string };

export interface PairedHostOptions {
  deviceKey: KeyPair;
  label?: string;
  /** Where this browser comes back once paired, learned on an earlier visit. */
  reconnectRoom?: string;
  onLearned?: (learned: PairedHostLearned) => void;
  /** `location.protocol` of the page; a secure page can only open wss:// relays. */
  pageProtocol?: string;
  WebSocketImpl?: typeof WebSocket;
  /** What asks a relay where the Mac waits now. Default: the page's fetch. */
  fetchImpl?: typeof fetch;
  handshakeTimeoutMs?: number;
  /** How often to ask whether the host's owner has let this browser in. */
  admissionPollMs?: number;
  requestTimeoutMs?: number;
  onState?: (state: HostState) => void;
}

/** Closes from the Mac that no retry can undo: what to tell the page, and the host's state. */
const FINAL_CLOSES: Record<number, { message: string; state: string }> = {
  // The Mac closes the older connection when the same device connects again (another tab).
  4001: { message: "This host is open in another tab. Reload to watch it here.", state: "Open in another tab" },
  // The Mac doesn't trust this device (relay-client.ts, RelayRoomKind).
  4003: { message: "This host doesn't trust this browser. Open a new pairing link from the host.", state: "Not paired" },
};
/** Closes the next attempt can undo, with what to tell the page meanwhile. */
const PASSING_CLOSES: Record<number, string> = {
  // The host said it was going to sleep (mesh-front-door mobile-relay.ts).
  4005: "This host is asleep. It opens again once it wakes.",
};
const MAX_RETRY_DELAY_MS = 30_000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function toResponse(result: BridgeWebResponse): Response {
  const status = Number.isInteger(result.status) && result.status >= 200 && result.status <= 599 ? result.status : 502;
  const headers = result.contentType ? { "content-type": result.contentType } : undefined;
  const noBody = status === 204 || status === 205 || status === 304;
  const body = noBody ? null : result.base64 !== undefined ? base64ToBytes(result.base64) : result.body ?? "";
  return new Response(body as BodyInit | null, { status, headers });
}

/**
 * A refused or failed call, as the response `api()` already knows how to
 * read. Not 401: that sends `api()` to refresh this page's own sign-in, which
 * can't help with a Mac that hasn't trusted this browser.
 */
function rpcErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const status = code === "UNAUTHORIZED" || code === "FORBIDDEN" ? 403 : /in time$/.test(message) ? 504 : 502;
  return jsonResponse(status, { error: message });
}

export class PairedHost implements HostClient {
  readonly id: string;
  private name: string;
  private reconnectRoom: string | undefined;
  private connection: Connection | null = null;
  private connecting: Promise<Connection> | null = null;
  private lastError: Error | null = null;
  private retryAt = 0;
  private failures = 0;
  /** Set once the Mac ends the connection for good; no retry can help. */
  private stopped: string | null = null;
  /** True while the host's owner hasn't yet allowed this browser in. */
  private awaitingApproval = false;
  private readonly awaitingListeners = new Set<() => void>();

  constructor(
    readonly payload: PairingPayload,
    private readonly options: PairedHostOptions,
  ) {
    this.id = payload.publicKey;
    this.name = options.label ?? hostLabel(payload);
    this.reconnectRoom = options.reconnectRoom;
  }

  get label(): string {
    return this.name;
  }

  async fetch(path: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      return jsonResponse(405, { error: "This browser can watch the host but not change anything yet" });
    }
    let connection: Connection | "awaiting";
    try {
      connection = await this.connectedOrAwaiting();
    } catch (error) {
      return jsonResponse(503, { error: error instanceof Error ? error.message : String(error) });
    }
    // Answer at once rather than hang, so the page can say what it's waiting for.
    if (connection === "awaiting") return jsonResponse(503, { error: this.awaitingMessage() });
    const request = connection.rpc
      .query<BridgeWebResponse>("web.request", { path, method: "GET" })
      .then(toResponse, rpcErrorResponse);
    const signal = init?.signal;
    if (!signal) return request;
    if (signal.aborted) throw new DOMException("The request was aborted", "AbortError");
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("The request was aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      request.then(resolve).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  eventSource(path: string): EventSource {
    return new TunnelEventSource(path, ({ onStarted, onText, onEnd }) =>
      this.openSubscription("web.stream", { path }, {
        onStarted,
        onData: (data) => {
          if (typeof data === "string") onText(data);
        },
        onEnd,
      })) as unknown as EventSource;
  }

  subscribe(stream: HostStream, handlers: HostStreamHandlers): () => void {
    let stopped = false;
    let stop: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let lastEventId: string | undefined;

    const resume = (error: Error, final: boolean) => {
      stop = null;
      if (stopped) return;
      handlers.onInterrupted?.(error);
      if (final) return;
      failures += 1;
      timer = setTimeout(open, Math.min(1_000 * 2 ** (failures - 1), MAX_RETRY_DELAY_MS));
    };
    const open = () => {
      timer = null;
      if (stopped) return;
      stop = this.openSubscription("web.subscribe", { stream, ...(lastEventId ? { lastEventId } : {}) }, {
        onStarted: () => {
          failures = 0;
          handlers.onStarted?.();
        },
        onData: (data, id) => {
          if (id) lastEventId = id;
          handlers.onData(data);
        },
        onEnd: (error, final) => resume(error ?? new Error("This host ended the live feed"), final),
      });
    };
    open();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stop?.();
    };
  }

  /**
   * One bridge subscription, connecting first if needed. `onEnd` says whether
   * the host is gone for good (`final`), so a caller knows not to resume.
   */
  private openSubscription(
    path: string,
    input: unknown,
    handlers: {
      onStarted: () => void;
      onData: (data: unknown, id?: string) => void;
      onEnd: (error: Error | undefined, final: boolean) => void;
    },
  ): () => void {
    let stop: (() => void) | null = null;
    let cancelled = false;
    this.ensureConnected().then(
      (connection) => {
        if (cancelled) return;
        stop = connection.rpc.subscribe(path, input, {
          onStarted: handlers.onStarted,
          onData: handlers.onData,
          onEnd: (error) => handlers.onEnd(error, this.stopped !== null),
        });
      },
      (error: Error) => {
        if (!cancelled) handlers.onEnd(error, this.stopped !== null);
      },
    );
    return () => {
      cancelled = true;
      stop?.();
    };
  }

  close(): void {
    this.connection?.socket.close(1000, "Closed by the page");
    this.connection = null;
  }

  private awaitingMessage(): string {
    return `Allow this browser on ${this.name} to continue.`;
  }

  /** The connection, or "awaiting" as soon as the host is known to be asking its owner. */
  private connectedOrAwaiting(): Promise<Connection | "awaiting"> {
    const connecting = this.ensureConnected();
    if (this.awaitingApproval) return Promise.resolve("awaiting");
    return new Promise((resolve, reject) => {
      const onAwaiting = () => resolve("awaiting");
      this.awaitingListeners.add(onAwaiting);
      connecting.then(resolve, reject).finally(() => this.awaitingListeners.delete(onAwaiting));
    });
  }

  private setAwaitingApproval(awaiting: boolean): void {
    if (this.awaitingApproval === awaiting) return;
    this.awaitingApproval = awaiting;
    if (!awaiting) return;
    this.options.onState?.({ kind: "awaiting_approval" });
    for (const listener of [...this.awaitingListeners]) listener();
  }

  /**
   * Ask the host whether this browser is in. A host reached through the
   * account asks its owner first and answers "pending" until they do; the
   * bridge refuses everything else meanwhile. A host from before admission
   * has no such procedure, and lets the browser straight in.
   */
  private async admission(rpc: BridgeRpc, open: () => boolean): Promise<void> {
    const pollMs = this.options.admissionPollMs ?? 1_500;
    while (open()) {
      let state: unknown;
      try {
        state = (await rpc.query<{ state?: unknown }>("web.admission"))?.state;
      } catch (error) {
        if ((error as { code?: unknown }).code === "NOT_FOUND") return;
        throw error;
      }
      if (state !== "pending") return;
      this.setAwaitingApproval(true);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }

  private ensureConnected(): Promise<Connection> {
    if (this.connection) return Promise.resolve(this.connection);
    if (this.stopped) return Promise.reject(new Error(this.stopped));
    if (this.connecting) return this.connecting;
    if (Date.now() < this.retryAt && this.lastError) return Promise.reject(this.lastError);

    this.options.onState?.({ kind: "connecting" });
    this.connecting = this.connectAny().then(
      (connection) => {
        this.connecting = null;
        this.connection = connection;
        this.failures = 0;
        this.lastError = null;
        this.options.onState?.({ kind: "connected" });
        void this.learn(connection);
        return connection;
      },
      (error: Error) => {
        this.connecting = null;
        this.failures += 1;
        this.lastError = error;
        this.retryAt = Date.now() + Math.min(2_000 * 2 ** (this.failures - 1), MAX_RETRY_DELAY_MS);
        this.options.onState?.({ kind: "failed", error: error.message });
        throw error;
      },
    );
    return this.connecting;
  }

  /**
   * Ask the Mac where to come back and what it's called. A Mac from before
   * the reconnect room answers without one, and its link's room keeps working.
   */
  private async learn(connection: Connection): Promise<void> {
    let manifest: { hostName?: unknown; relay?: { reconnectRoom?: unknown } } | null;
    try {
      manifest = await connection.rpc.query("mobile.endpoints");
    } catch {
      return; // asked again on the next connection
    }
    const learned: PairedHostLearned = {};
    const room = manifest?.relay?.reconnectRoom;
    if (typeof room === "string" && room && room !== this.reconnectRoom) {
      this.reconnectRoom = learned.reconnectRoom = room;
    }
    const name = typeof manifest?.hostName === "string" ? manifest.hostName.trim() : "";
    if (name && name !== this.name) this.name = learned.hostName = name;
    if (learned.reconnectRoom || learned.hostName) this.options.onLearned?.(learned);
  }

  private async connectAny(): Promise<Connection> {
    const relays = relayUrlsForPage(this.payload, this.options.pageProtocol ?? globalThis.location?.protocol ?? "https:");
    if (relays.length === 0) throw new Error("This host advertises no relay a secure page can reach");
    let lastError: Error | null = null;
    for (const relay of relays) {
      // The link's room pairs once; after that the Mac waits for this browser in its reconnect room.
      let room = this.reconnectRoom ?? this.payload.room;
      if (this.reconnectRoom) {
        const current = await this.resolveRoom(relay);
        if (current === null) {
          lastError = new Error("This host isn't connected right now. It may be asleep or offline.");
          continue;
        }
        if (current) room = current;
      }
      try {
        return await this.connectVia(relay, room);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // A room nobody answers in is just as empty on the next relay.
        if ((error as { silent?: boolean }).silent) break;
      }
    }
    throw lastError ?? new Error("Couldn't reach this host");
  }

  /**
   * The room the relay knows the Mac's key in. `null`: the relay has no Mac
   * with this key. `undefined`: it couldn't say, so the saved room is tried.
   */
  private async resolveRoom(relay: string): Promise<string | null | undefined> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    try {
      // text/plain keeps this a simple request: the relay answers without a CORS preflight.
      const response = await fetchImpl(relayResolveUrl(relay), {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ bridgePublicKey: this.payload.publicKey }),
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status === 404) return null;
      if (!response.ok) return undefined;
      const room = ((await response.json()) as { room?: unknown }).room;
      return typeof room === "string" && room ? room : undefined;
    } catch {
      return undefined;
    }
  }

  private connectVia(relay: string, room: string): Promise<Connection> {
    const WebSocketImpl = this.options.WebSocketImpl ?? WebSocket;
    const timeoutMs = this.options.handshakeTimeoutMs ?? 8_000;
    return new Promise<Connection>((resolve, reject) => {
      const socket = new WebSocketImpl(relayClientUrl(relay, room));
      // A socket that never got past the handshake closes quietly: the
      // attempt's failure is already on its way to ensureConnected.
      let phase: "handshake" | "admission" | "open" | "failed" = "handshake";
      const fail = (error: Error) => {
        if (phase !== "handshake" && phase !== "admission") return;
        this.setAwaitingApproval(false);
        phase = "failed";
        clearTimeout(timer);
        socket.close();
        reject(error);
      };
      const timer = setTimeout(
        () => fail(Object.assign(
          new Error("This host didn't answer. It may be asleep or restarted; a new pairing link from the host will reach it."),
          { silent: true },
        )),
        timeoutMs,
      );
      const channel: SecureChannel = new SecureChannel(
        (frame) => socket.send(frame),
        this.options.deviceKey,
        hexToBytes(this.payload.publicKey),
        {
          onReady: () => {
            if (phase !== "handshake") return;
            phase = "admission";
            clearTimeout(timer);
            this.admission(rpc, () => phase === "admission").then(
              () => {
                if (phase !== "admission") return;
                phase = "open";
                this.setAwaitingApproval(false);
                resolve(connection);
              },
              (error: Error) => fail(error),
            );
          },
          onMessage: (text) => rpc.handleMessage(text),
          onError: (error) => {
            if (!channel.ready) fail(error);
            else socket.close(4002, "Channel reset");
          },
        },
      );
      const rpc = new BridgeRpc((text) => channel.send(text), this.options.requestTimeoutMs ?? 30_000);
      const connection: Connection = { socket, channel, rpc };

      socket.onopen = () => channel.start();
      socket.onmessage = (event) => {
        if (typeof event.data === "string") channel.receive(event.data);
        else if (event.data instanceof ArrayBuffer) channel.receive(new TextDecoder().decode(event.data));
      };
      socket.onclose = (event) => {
        if (phase === "handshake") {
          fail(new Error(event.reason || "The relay closed the connection"));
          return;
        }
        if (phase === "admission") {
          // While the host was asking its owner, 4003 is their answer (or no answer in
          // time); asking again at once would only repeat it. Otherwise it's a close
          // like any other, before the browser was ever in.
          const final = this.awaitingApproval && event.code === 4003
            ? `${this.name} didn't allow this browser. Reload to ask again.`
            : FINAL_CLOSES[event.code]?.message;
          const message = final ?? PASSING_CLOSES[event.code] ?? (event.reason || "The connection to this host closed");
          if (final) this.stopped = final;
          rpc.failAll(new Error(message));
          fail(Object.assign(new Error(message), { silent: true }));
          return;
        }
        if (phase === "failed") return;
        const final = FINAL_CLOSES[event.code];
        // Settle the host's state first: live feeds read it to decide whether to resume.
        if (this.connection === connection) this.connection = null;
        if (final) this.stopped = final.message;
        rpc.failAll(new Error(final?.message ?? PASSING_CLOSES[event.code] ?? "The connection to this host closed"));
        this.options.onState?.(final ? { kind: "failed", error: final.state } : { kind: "idle" });
      };
    });
  }
}
