import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {loadOrCreateNodeIdentity} from "@openscout/runtime/mesh/node-identity";
import {pairingTrustOwner} from "@openscout/runtime/pairing-security/trust-owner";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { callTRPCProcedure, getErrorShape, TRPCError } from "@trpc/server";
import { generateKeyPair } from "@openscout/runtime/pairing-security/noise";
import { SecureTransport } from "@openscout/runtime/pairing-security/transport";

import type { Bridge } from "../../../../server/core/pairing/runtime/bridge/bridge.ts";
import { bridgeRouter } from "../../../../server/core/pairing/runtime/bridge/router.ts";
import type { HostState } from "../host-fleet.ts";
import { bytesToHex } from "./bytes.ts";
import { PairedHost, type PairedHostLearned } from "./paired-host.ts";
import type { PairingPayload } from "./pairing-payload.ts";

/**
 * A Mac waiting in a relay room. Each client socket gets its own responder,
 * the way the bridge's relay client keeps one per client, and calls run
 * through the bridge's real router. The responder never trusts on its own
 * (`trustOnComplete: false`), so the machine's trust store is never written;
 * `trusted` stands in for the bridge's verdict.
 */
class FakeMac {
  readonly key = generateKeyPair();
  readonly sockets: FakeSocket[] = [];
  trusted = true;
  /** false: the relay has no bridge for the room and closes 4004, as mobile-relay.ts does. */
  inRoom = true;
  /** false: the socket opens but the Mac never answers the handshake. */
  answers = true;
  /** false: the Mac finishes the handshake, then closes 4003, as relay-client.ts does for a device it doesn't trust. */
  admits = true;
  /** What `mobile.endpoints` answers. Canned: the real one probes this machine's voice port. */
  manifest: unknown = { hostName: "Studio Mac", relay: { reconnectRoom: "reconnect-room-0123" } };
  /** The room the relay's /resolve names for this Mac's key; null: the relay has no Mac with it. */
  current: string | null = "reconnect-room-0123";
  readonly resolveCalls: { url: string; body: unknown }[] = [];
  /** How many `web.admission` asks answer "pending" before the owner decides (account room). */
  pendingAdmissions = 0;
  /** The owner's answer once those run out: allow, or close 4003 as relay-client.ts does. */
  ownerAllows = true;
  /** What `web.subscribe` sends once started, as the runtime's tracked events. */
  feed: { id: string; data: unknown }[] = [];
  readonly subscribeInputs: unknown[] = [];
  readonly stopped: number[] = [];
  private readonly streams = new Map<number, AbortController>();

  /** The relay's /resolve, as mobile-relay.ts answers it. */
  get relayFetch(): typeof fetch {
    return (async (url: URL | RequestInfo, init?: RequestInit) => {
      this.resolveCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return this.current
        ? Response.json({ room: this.current })
        : Response.json({ error: "bridge not found" }, { status: 404 });
    }) as typeof fetch;
  }

  payload(): PairingPayload {
    return {
      v: 1,
      relay: "wss://relay.test/v1/relay",
      fallbackRelays: ["ws://192.168.1.2:43131"],
      room: "room-0123456789",
      publicKey: bytesToHex(this.key.publicKey),
      expiresAt: Date.now() + 60_000,
    };
  }

  get WebSocket(): typeof WebSocket {
    const mac = this;
    return class extends FakeSocket {
      constructor(url: string) {
        super(url, mac);
      }
    } as unknown as typeof WebSocket;
  }

  respond(socket: FakeSocket): SecureTransport {
    const transport: SecureTransport = new SecureTransport(
      { send: (data) => socket.deliver(typeof data === "string" ? data : new TextDecoder().decode(data)) },
      "responder",
      this.key,
      {
        onReady: () => {
          if (!this.admits) return socket.end(4003, "Untrusted peer");
          // The bridge greets every new peer with the sessions it has; a browser ignores them.
          transport.send(JSON.stringify({ seq: 0, event: { event: "session:update", session: {} } }));
        },
        onMessage: (message) => void this.dispatch(transport, message),
      },
      { pattern: "IK", trustOnComplete: false },
    );
    return transport;
  }

  /** Same reply shape as relay-client.ts `dispatchTRPC`. */
  private async dispatch(transport: SecureTransport, message: string): Promise<void> {
    const { id, method, params } = JSON.parse(message) as {
      id: number;
      method: "query" | "mutation" | "subscription" | "subscription.stop";
      params: { path: string; input: unknown };
    };
    if (method === "subscription.stop") {
      this.stopped.push(id);
      this.streams.get(id)?.abort();
      return;
    }
    if (method === "subscription") {
      await this.subscription(transport, id, params);
      return;
    }
    if (params.path === "web.admission" && this.pendingAdmissions > 0) {
      this.pendingAdmissions -= 1;
      transport.send(JSON.stringify({ id, jsonrpc: "2.0", result: { type: "data", data: { state: "pending" } } }));
      if (this.pendingAdmissions === 0 && !this.ownerAllows) {
        this.sockets.at(-1)!.end(4003, "Declined by the host");
      }
      return;
    }
    if (params.path === "mobile.endpoints") {
      transport.send(JSON.stringify({ id, jsonrpc: "2.0", result: { type: "data", data: this.manifest } }));
      return;
    }
    try {
      const data = await callTRPCProcedure({
        router: bridgeRouter,
        path: params.path,
        getRawInput: () => Promise.resolve(params.input),
        ctx: { bridge: {} as Bridge, cwd: "/tmp/openscout", deviceId: "browser", secureTransport: true, trustedPeer: this.trusted },
        type: method,
        signal: new AbortController().signal,
        batchIndex: 0,
      });
      transport.send(JSON.stringify({ id, jsonrpc: "2.0", result: { type: "data", data } }));
    } catch (cause) {
      const error = cause instanceof TRPCError ? cause : new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause });
      const shape = getErrorShape({
        config: bridgeRouter._def._config,
        error,
        type: method,
        path: params.path,
        input: params.input,
        ctx: undefined,
      });
      transport.send(JSON.stringify({ id, jsonrpc: "2.0", error: shape }));
    }
  }
}

interface FakeMac {
  subscription(transport: SecureTransport, id: number, params: { path: string; input: unknown }): Promise<void>;
}

/**
 * Subscriptions as server-trpc.ts sends them: `started`, `data` frames, then
 * `stopped`. `web.subscribe` plays the canned feed, since the real one needs a
 * runtime; everything else runs through the bridge's real router.
 */
FakeMac.prototype.subscription = async function (this: FakeMac, transport, id, params) {
  const reply = (body: object) => transport.send(JSON.stringify({ id, jsonrpc: "2.0", ...body }));
  const abort = new AbortController();
  (this as unknown as { streams: Map<number, AbortController> }).streams.set(id, abort);
  if (params.path === "web.subscribe") {
    this.subscribeInputs.push(params.input);
    reply({ result: { type: "started" } });
    for (const item of this.feed) reply({ result: { type: "data", id: item.id, data: item } });
    return;
  }
  const iterable = await callTRPCProcedure({
    router: bridgeRouter,
    path: params.path,
    getRawInput: () => Promise.resolve(params.input),
    ctx: { bridge: {} as Bridge, cwd: "/tmp/openscout", deviceId: "browser", secureTransport: true, trustedPeer: this.trusted },
    type: "subscription",
    signal: abort.signal,
    batchIndex: 0,
  }) as AsyncIterable<unknown>;
  reply({ result: { type: "started" } });
  try {
    for await (const data of iterable) reply({ result: { type: "data", data } });
    reply({ result: { type: "stopped" } });
  } catch (cause) {
    reply({ error: { message: cause instanceof Error ? cause.message : String(cause) } });
  }
};

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  closed = false;
  private transport: SecureTransport | null = null;

  constructor(
    readonly url: string,
    private readonly mac: FakeMac,
  ) {
    mac.sockets.push(this);
    setTimeout(() => {
      if (mac.inRoom) this.onopen?.();
      else this.end(4004, "Bridge absent");
    }, 0);
  }

  send(data: string): void {
    // A closing socket drops what's sent, as a browser's does.
    if (this.closed) return;
    if (!this.mac.answers) return;
    this.transport ??= this.mac.respond(this);
    this.transport.receive(data);
  }

  close(code = 1000, reason = ""): void {
    this.end(code, reason);
  }

  /** The relay or the Mac ends this socket. */
  end(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    setTimeout(() => this.onclose?.({ code, reason }), 0);
  }

  deliver(text: string): void {
    if (!this.closed) setTimeout(() => this.onmessage?.({ data: text }), 0);
  }
}

function setup(options: { handshakeTimeoutMs?: number; reconnectRoom?: string; relayFetch?: typeof fetch } = {}) {
  const mac = new FakeMac();
  const states: HostState["kind"][] = [];
  const learned: PairedHostLearned[] = [];
  const host = new PairedHost(mac.payload(), {
    deviceKey: generateKeyPair(),
    reconnectRoom: options.reconnectRoom,
    pageProtocol: "https:",
    WebSocketImpl: mac.WebSocket,
    fetchImpl: options.relayFetch ?? mac.relayFetch,
    handshakeTimeoutMs: options.handshakeTimeoutMs ?? 2_000,
    admissionPollMs: 10,
    onState: (state) => states.push(state.kind),
    onLearned: (detail) => learned.push(detail),
  });
  return { mac, host, states, learned };
}

const roomOf = (socket: { url: string }) => new URL(socket.url).searchParams.get("room");

function stubWebApi(response: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response();
  }) as typeof fetch;
  process.env.OPENSCOUT_WEB_AUTH_TOKEN = "test-token";
  return calls;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("PairedHost", () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.OPENSCOUT_WEB_AUTH_TOKEN;
  const authorityKeys=['OPENSCOUT_PAIRING_HOME','OPENSCOUT_SUPPORT_DIRECTORY','OPENSCOUT_INSTANCE'] as const;
  const originalAuthority=Object.fromEntries(authorityKeys.map(key=>[key,process.env[key]]));
  let authorityRoot:string|null=null;
  beforeEach(()=>{
    authorityRoot=mkdtempSync(join(tmpdir(),'paired-host-authority-'));
    process.env.OPENSCOUT_PAIRING_HOME=join(authorityRoot,'pairing');
    process.env.OPENSCOUT_SUPPORT_DIRECTORY=join(authorityRoot,'support');
    process.env.OPENSCOUT_INSTANCE='paired-host-test';
    mkdirSync(process.env.OPENSCOUT_PAIRING_HOME,{mode:0o700});
    loadOrCreateNodeIdentity(process.env.OPENSCOUT_SUPPORT_DIRECTORY);
    pairingTrustOwner().pairingAuthorityStamp();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for(const key of authorityKeys){const value=originalAuthority[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
    if(authorityRoot)rmSync(authorityRoot,{recursive:true,force:true});authorityRoot=null;
    if (originalToken === undefined) delete process.env.OPENSCOUT_WEB_AUTH_TOKEN;
    else process.env.OPENSCOUT_WEB_AUTH_TOKEN = originalToken;
  });

  test("reads the Mac's web API through its relay room and the encrypted channel", async () => {
    const calls = stubWebApi(() => Response.json({ agents: ["ada"] }));
    const { mac, host, states } = setup();

    const response = await host.fetch("/api/agents");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agents: ["ada"] });
    expect(new URL(calls[0]!.url).pathname).toBe("/api/agents");
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBe("Bearer test-token");
    // A secure page skips the plain ws:// fallback and joins the room as a client.
    const joined = new URL(mac.sockets[0]!.url);
    expect(joined.origin).toBe("wss://relay.test");
    expect(joined.searchParams.get("room")).toBe("room-0123456789");
    expect(joined.searchParams.get("role")).toBe("client");
    expect(states).toEqual(["connecting", "connected"]);
    // Until this browser has paired, the relay's /resolve would only send it to a room that refuses it.
    expect(mac.resolveCalls).toEqual([]);
  });

  test("keeps one connection for every read", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host } = setup();

    const [first, second] = await Promise.all([host.fetch("/api/agents"), host.fetch("/api/sessions")]);
    await host.fetch("/api/agents");

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(mac.sockets).toHaveLength(1);
  });

  test("carries the Mac's own refusals and binary bodies", async () => {
    stubWebApi(() => new Response(new Uint8Array([0, 1, 2, 255]), { headers: { "content-type": "image/png" } }));
    const { host } = setup();
    const image = await host.fetch("/api/avatar.png");
    expect(image.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([0, 1, 2, 255]);

    stubWebApi(() => Response.json({ error: "No such agent" }, { status: 404 }));
    const missing = await host.fetch("/api/agents/nobody");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "No such agent" });
  });

  test("answers writes itself, without reaching the Mac", async () => {
    const { mac, host } = setup();
    const response = await host.fetch("/api/messages", { method: "POST", body: "{}" });
    expect(response.status).toBe(405);
    expect(mac.sockets).toHaveLength(0);
  });

  test("a Mac that hasn't trusted this browser is a refusal, not a sign-in problem", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host } = setup();
    mac.trusted = false;

    const response = await host.fetch("/api/agents");

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/trusted/);
  });

  test("a Mac that isn't in its room fails the read, then waits before trying again", async () => {
    const { mac, host, states } = setup();
    mac.inRoom = false;

    const first = await host.fetch("/api/agents");
    const second = await host.fetch("/api/agents");

    expect(first.status).toBe(503);
    expect((await first.json()).error).toBe("Bridge absent");
    expect(second.status).toBe(503);
    expect(mac.sockets).toHaveLength(1);
    await wait(10);
    expect(states).toEqual(["connecting", "failed"]);
  });

  test("a Mac that never answers the handshake times out", async () => {
    const { mac, host } = setup({ handshakeTimeoutMs: 30 });
    mac.answers = false;

    const response = await host.fetch("/api/agents");

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/didn't answer/);
  });

  test("a dropped connection comes back on the next read", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, states } = setup();
    await host.fetch("/api/agents");

    mac.sockets[0]!.end(1006, "");
    await wait(10);
    const again = await host.fetch("/api/agents");

    expect(again.status).toBe(200);
    expect(mac.sockets).toHaveLength(2);
    expect(states).toEqual(["connecting", "connected", "idle", "connecting", "connected"]);
  });

  test("stops when another tab takes the Mac over", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, states } = setup();
    await host.fetch("/api/agents");

    mac.sockets[0]!.end(4001, "Replaced by newer connection");
    await wait(10);
    const after = await host.fetch("/api/agents");

    expect(after.status).toBe(503);
    expect((await after.json()).error).toMatch(/another tab/);
    expect(mac.sockets).toHaveLength(1);
    expect(states.at(-1)).toBe("failed");
  });

  test("says the host is asleep when the relay closes for sleep, and tries again later", async () => {
    stubWebApi(async () => {
      await wait(40);
      return Response.json({ ok: true });
    });
    const { mac, host, states } = setup();
    await host.fetch("/api/agents");

    const pending = host.fetch("/api/agents");
    await wait(5);
    mac.sockets[0]!.end(4005, "Host asleep");
    const response = await pending;
    expect((await response.json()).error).toMatch(/asleep/);
    expect(states.at(-1)).toBe("idle");

    expect((await host.fetch("/api/agents")).status).toBe(200);
    expect(mac.sockets).toHaveLength(2);
  });

  test("learns where to come back and what the Mac is called, and comes back there", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, learned } = setup();
    await host.fetch("/api/agents");
    await wait(10);

    expect(learned).toEqual([{ reconnectRoom: "reconnect-room-0123", hostName: "Studio Mac" }]);
    expect(host.label).toBe("Studio Mac");

    // The link's room paired this browser; the Mac waits for it in the reconnect room now.
    mac.sockets[0]!.end(1006, "");
    await wait(10);
    expect((await host.fetch("/api/agents")).status).toBe(200);
    expect(mac.sockets.map(roomOf)).toEqual(["room-0123456789", "reconnect-room-0123"]);
    expect(mac.resolveCalls.map((call) => call.url)).toEqual(["https://relay.test/v1/relay/resolve"]);
  });

  test("comes back to the room the relay names for the Mac's key after the Mac restarts", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, learned } = setup({ reconnectRoom: "reconnect-room-0123" });
    // A restarted runtime waits in a new room; this browser saved the old one.
    mac.current = "reconnect-room-4567";
    mac.manifest = { hostName: "Studio Mac", relay: { reconnectRoom: "reconnect-room-4567" } };

    expect((await host.fetch("/api/agents")).status).toBe(200);
    await wait(10);

    expect(mac.sockets.map(roomOf)).toEqual(["reconnect-room-4567"]);
    expect(mac.resolveCalls).toEqual([
      { url: "https://relay.test/v1/relay/resolve", body: { bridgePublicKey: mac.payload().publicKey } },
    ]);
    expect(learned).toEqual([{ reconnectRoom: "reconnect-room-4567", hostName: "Studio Mac" }]);
  });

  test("a Mac the relay doesn't have fails at once", async () => {
    const { mac, host } = setup({ reconnectRoom: "reconnect-room-0123" });
    mac.current = null;

    const response = await host.fetch("/api/agents");

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/isn't connected/);
    expect(mac.sockets).toHaveLength(0);
  });

  test("a relay that can't say where the Mac is leaves the saved room", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host } = setup({
      reconnectRoom: "reconnect-room-0123",
      relayFetch: (async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch,
    });

    expect((await host.fetch("/api/agents")).status).toBe(200);
    expect(mac.sockets.map(roomOf)).toEqual(["reconnect-room-0123"]);
  });

  test("starts in the room it learned on an earlier visit", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, learned } = setup({ reconnectRoom: "reconnect-room-0123" });
    await host.fetch("/api/agents");
    await wait(10);

    expect(mac.sockets.map(roomOf)).toEqual(["reconnect-room-0123"]);
    expect(learned).toEqual([{ hostName: "Studio Mac" }]);
  });

  test("a Mac from before the reconnect room keeps its link's room", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, learned } = setup();
    mac.manifest = { hostName: "Studio Mac" };
    await host.fetch("/api/agents");
    await wait(10);

    mac.sockets[0]!.end(1006, "");
    await wait(10);
    await host.fetch("/api/agents");
    expect(mac.sockets.map(roomOf)).toEqual(["room-0123456789", "room-0123456789"]);
    expect(learned).toEqual([{ hostName: "Studio Mac" }]);
  });

  test("stops when the Mac doesn't trust this browser", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, states } = setup();
    mac.admits = false;

    const first = await host.fetch("/api/agents");
    const again = await host.fetch("/api/agents");

    expect((await first.json()).error).toMatch(/doesn't trust this browser/);
    expect(again.status).toBe(503);
    expect((await again.json()).error).toMatch(/new pairing link/);
    // Retrying can't help, so it doesn't. The close lands before the browser is in.
    expect(mac.sockets).toHaveLength(1);
    expect(states).toEqual(["connecting", "failed"]);
  });

  test("waits for the host's owner to allow this browser, saying so, then reads", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, states } = setup();
    mac.pendingAdmissions = 4;

    const waiting = await host.fetch("/api/agents");
    expect(waiting.status).toBe(503);
    expect((await waiting.json()).error).toBe("Allow this browser on Host " + mac.payload().publicKey.slice(0, 6) + " to continue.");
    expect(states).toEqual(["connecting", "awaiting_approval"]);

    await wait(80);
    const allowed = await host.fetch("/api/agents");
    expect(allowed.status).toBe(200);
    expect(states).toEqual(["connecting", "awaiting_approval", "connected"]);
    expect(mac.sockets).toHaveLength(1);
  });

  test("stops when the host's owner declines this browser", async () => {
    stubWebApi(() => Response.json({ ok: true }));
    const { mac, host, states } = setup();
    mac.pendingAdmissions = 2;
    mac.ownerAllows = false;

    await host.fetch("/api/agents");
    await wait(80);
    const after = await host.fetch("/api/agents");

    expect(after.status).toBe(503);
    expect((await after.json()).error).toMatch(/didn't allow this browser/);
    expect(states.at(-1)).toBe("failed");
    expect(mac.sockets).toHaveLength(1);
  });

  test("carries the runtime's live feed, and resumes after the last event once the connection drops", async () => {
    const { mac, host } = setup();
    mac.feed = [{ id: "evt-1", data: { kind: "message.posted" } }, { id: "evt-2", data: { kind: "flight.updated" } }];
    const received: unknown[] = [];
    let starts = 0;
    let interruptions = 0;
    const stop = host.subscribe("control.events", {
      onStarted: () => { starts += 1; },
      onData: (data) => received.push(data),
      onInterrupted: () => { interruptions += 1; },
    });
    await wait(30);
    expect(received).toEqual([{ kind: "message.posted" }, { kind: "flight.updated" }]);
    expect(mac.subscribeInputs).toEqual([{ stream: "control.events" }]);

    mac.feed = [{ id: "evt-3", data: { kind: "agent.updated" } }];
    mac.sockets[0]!.end(1006, "");
    await wait(1_100);
    expect(interruptions).toBe(1);
    expect(mac.sockets).toHaveLength(2);
    expect(mac.subscribeInputs.at(-1)).toEqual({ stream: "control.events", lastEventId: "evt-2" });
    expect(received.at(-1)).toEqual({ kind: "agent.updated" });
    expect(starts).toBe(2);

    stop();
    await wait(10);
    expect(mac.stopped).toHaveLength(1);
  });

  test("a live feed stops for good when the Mac stops trusting this browser", async () => {
    const { mac, host } = setup();
    let interruptions = 0;
    host.subscribe("tail.events", { onData: () => {}, onInterrupted: () => { interruptions += 1; } });
    await wait(30);
    mac.sockets[0]!.end(4003, "Untrusted peer");
    await wait(1_100);
    expect(interruptions).toBe(1);
    expect(mac.sockets).toHaveLength(1);
  });

  test("carries the web API's server-sent events, and reconnects when the stream ends", async () => {
    const calls = stubWebApi(() => new Response(
      new ReadableStream({
        start(controller) {
          const encode = (text: string) => controller.enqueue(new TextEncoder().encode(text));
          encode("retry: 20\n\ndata: {\"a\":1}\n\n");
          encode("event: action\nid: 7\ndata: first\ndata: second\n\n");
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ));
    const { host } = setup();
    const source = host.eventSource("/api/voice/ambient/actions");
    const messages: string[] = [];
    const actions: { data: string; lastEventId: string }[] = [];
    let opens = 0;
    let errors = 0;
    source.onopen = () => { opens += 1; };
    source.onmessage = (event) => messages.push(event.data);
    source.addEventListener("action", (event) => {
      const message = event as MessageEvent;
      actions.push({ data: message.data, lastEventId: message.lastEventId });
    });
    source.onerror = () => { errors += 1; };

    await wait(60);
    source.close();

    expect(new URL(calls[0]!.url).pathname).toBe("/api/voice/ambient/actions");
    expect(new Headers(calls[0]!.init.headers).get("accept")).toBe("text/event-stream");
    expect(messages[0]).toBe('{"a":1}');
    expect(actions[0]).toEqual({ data: "first\nsecond", lastEventId: "7" });
    expect(opens).toBeGreaterThanOrEqual(2);
    expect(errors).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(source.readyState).toBe(2);
  });

  test("an event stream path the bridge refuses ends the stream", async () => {
    const { host } = setup();
    const source = host.eventSource("/api/pairing/state");
    let errors = 0;
    source.onerror = () => { errors += 1; };
    await wait(30);
    source.close();
    expect(errors).toBeGreaterThanOrEqual(1);
  });
});
