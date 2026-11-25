// Run with HOME pointed at a scratch directory: pairing identity paths are
// fixed from homedir() at module load. Starts a real pairing runtime against a
// real local relay with an account room, and plays the host's owner through a
// second request store on the same shared file, the way the web server that
// the Scout app asks would. Prints one JSON line of what happened.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadOrCreateNodeIdentity } from "@openscout/runtime/mesh/node-identity";
import { createAccountAdmission } from "../core/pairing/runtime/account-admission.ts";
import { startPairingRuntime } from "../core/pairing/runtime/runtime.ts";
import { startRelay } from "../core/pairing/runtime/relay/relay.ts";
import {
  bytesToHex,
  generateKeyPair,
  hexToBytes,
  SecureTransport,
  type KeyPair,
} from "../core/pairing/runtime/security/index.ts";
import { createPendingPairRequestStore, pairRequestStatePath } from "../pairing-pair-requests.ts";

function freePort(): number {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  return port;
}

const wait = (ms: number) => new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));

// The pinned runtime binds trust to a host identity outside the pairing store.
// The parent fixture isolates its support directory before this process starts.
loadOrCreateNodeIdentity();
const relayPort = freePort();
const relay = startRelay(relayPort, { pairHttpOrigin: null });
process.env.OPENSCOUT_PAIRING_PORT = String(freePort());

// This host's web API, as far as web.stream reaches: one short live stream.
const webApi = Bun.serve({
  port: 0,
  fetch: (request) => request.headers.get("authorization") === "Bearer fixture-web-token"
    ? new Response("data: one\n\ndata: two\n\n", { headers: { "content-type": "text/event-stream" } })
    : new Response("no", { status: 401 }),
});
process.env.OPENSCOUT_WEB_PORT = String(webApi.port);
process.env.OPENSCOUT_WEB_AUTH_TOKEN = "fixture-web-token";

const statePath = pairRequestStatePath(join(homedir(), ".scout"));
// The owner's side: what the Scout app reaches through the web server.
const owner = createPendingPairRequestStore({ statePath });

const admissionStore = createPendingPairRequestStore({ statePath });
const loseClaim = process.argv[2] === "lose-claim";
let lostClaims = 0;
const admissionGateStore = loseClaim ? {...admissionStore, fulfill(token: string, status?: "pending" | "approved" | "denied") {
  owner.fulfill(token, "approved");
  lostClaims++;
  return admissionStore.fulfill(token, status);
}} : admissionStore;
let connected = 0;
const runtime = await startPairingRuntime({
  relayEndpoints: [{ relayUrl: `ws://127.0.0.1:${relayPort}` }],
  relayEvents: {
    onConnected() {
      connected += 1;
    },
  },
  admitAccountDevice: createAccountAdmission({
    store: admissionGateStore,
    pollMs: 25,
  }),
});
while (connected < 3) await wait(10);
const bridgeKey = hexToBytes(runtime.qrPayload!.publicKey);
const accountRoom = runtime.accountRoom!;

type Device = {
  key: KeyPair;
  /** Whether the Noise handshake finished. */
  ready: Promise<boolean>;
  /** The code the socket closed with. */
  closed: Promise<number>;
  call: (path: string) => Promise<{ data?: any; error?: any }>;
  /** Opens a subscription; resolves with every frame it got once it stops or fails. */
  subscribe: (path: string, input: unknown) => Promise<any[]>;
  close: () => void;
};

function device(room: string, key: KeyPair = generateKeyPair()): Device {
  const socket = new WebSocket(`ws://127.0.0.1:${relayPort}?room=${room}&role=client`);
  const pending = new Map<number, (reply: { data?: any; error?: any }) => void>();
  const streams = new Map<number, { frames: any[]; done: (frames: any[]) => void }>();
  let transport: SecureTransport | null = null;
  let nextId = 1;
  let markReady: (value: boolean) => void = () => {};
  const ready = new Promise<boolean>((resolve) => {
    markReady = resolve;
  });
  const closed = new Promise<number>((resolve) => {
    socket.onclose = (event) => {
      markReady(false);
      resolve(event.code);
    };
  });
  socket.onopen = () => {
    transport = new SecureTransport(
      { send: (data) => socket.send(typeof data === "string" ? data : new Uint8Array(data)) },
      "initiator",
      key,
      {
        onReady: () => markReady(true),
        onMessage: (message) => {
          const reply = JSON.parse(message) as { id?: number; result?: { type?: string; data?: unknown }; error?: unknown };
          if (typeof reply.id !== "number") return;
          const stream = streams.get(reply.id);
          if (stream) {
            stream.frames.push(reply);
            if (reply.error || reply.result?.type === "stopped") stream.done(stream.frames);
            return;
          }
          pending.get(reply.id)?.({ data: reply.result?.data, error: reply.error });
        },
      },
      // The device's own side never writes the shared scratch trust store.
      { pattern: "IK", remoteStaticKey: bridgeKey, trustOnComplete: false },
    );
  };
  socket.onmessage = (event) => transport?.receive(String(event.data));
  return {
    key,
    ready,
    closed,
    call: (path) => new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      transport!.send(JSON.stringify({ id, jsonrpc: "2.0", method: "query", params: { path } }));
    }),
    subscribe: (path, input) => new Promise((resolve) => {
      const id = nextId++;
      streams.set(id, { frames: [], done: resolve });
      transport!.send(JSON.stringify({ id, jsonrpc: "2.0", method: "subscription", params: { path, input } }));
    }),
    close: () => socket.close(),
  };
}

/** Wait for the handshake, then for the Mac to close it (or not, within a moment). */
async function settle(subject: Device): Promise<{ ready: boolean; closedWith: number | "open" }> {
  const ready = await Promise.race([subject.ready, wait(3_000).then(() => false)]);
  const closedWith = await Promise.race([subject.closed, wait(400).then(() => "open" as const)]);
  return { ready, closedWith };
}

function trusted(key: KeyPair): boolean {
  const path = join(homedir(), ".scout/pairing/trusted-peers.json");
  if (!existsSync(path)) return false;
  return readFileSync(path, "utf8").includes(bytesToHex(key.publicKey));
}

async function pendingRequest(): Promise<{ token: string; route: string | null; label: string | null } | null> {
  for (let i = 0; i < 100; i += 1) {
    const request = owner.list().find((candidate) => candidate.status === "pending");
    if (request) return { token: request.token, route: request.route, label: request.requesterLabel };
    await wait(20);
  }
  return null;
}

async function untilAdmitted(subject: Device): Promise<boolean> {
  for (let i = 0; i < 100; i += 1) {
    if ((await subject.call("web.admission")).data?.state === "admitted") return true;
    await wait(20);
  }
  return false;
}

// A browser the console sent: it shakes hands, then waits for the owner.
const browser = device(accountRoom);
const browserReady = await Promise.race([browser.ready, wait(3_000).then(() => false)]);
const whileWaiting = {
  admission: (await browser.call("web.admission")).data?.state ?? null,
  endpointsRefused: (await browser.call("mobile.endpoints")).error?.data?.code ?? null,
  trusted: trusted(browser.key),
};
const asked = await pendingRequest();
const requestedKeyMatches = Boolean(asked && owner.get(asked.token)?.requesterPublicKey === bytesToHex(browser.key.publicKey));
let prompt: {title?: string; body?: string} | undefined;
if (!loseClaim) {
  const {Hono} = await import("hono");
  const {mountPairingRoutes} = await import("../routes/pairing.ts");
  const app = new Hono();
  mountPairingRoutes(app, {currentDirectory: process.cwd(), options: {}, pendingPairRequests: owner,
    shellStateCache: {invalidate() {}} as any});
  const response = await app.request("http://localhost/api/notifications?type=pairing_request");
  const body = await response.json() as {notifications: Array<{title: string; body: string}>};
  const notification = body.notifications[0];
  prompt = notification ? {title: notification.title, body: notification.body} : undefined;
}
owner.decide(asked!.token, "approve");
if (loseClaim) {
  const admitted = await Promise.race([untilAdmitted(browser), browser.closed.then(() => false), wait(2000).then(() => false)]);
  const closed = await Promise.race([browser.closed, wait(100).then(() => "open")]);
  console.log(JSON.stringify({lostClaims, admitted, trusted: trusted(browser.key), closed}));
  browser.close(); owner.dispose(); admissionStore.dispose();
  await runtime.stop(); relay.stop(); webApi.stop(true); process.exit(0);
}
const admitted = await untilAdmitted(browser);
const afterApproval = {
  admitted,
  trusted: trusted(browser.key),
  name: JSON.parse(readFileSync(join(homedir(), ".scout/pairing/trusted-peers.json"), "utf8")).find((peer: any) => peer.publicKey === bytesToHex(browser.key.publicKey))?.name,
  endpointsServed: (await browser.call("mobile.endpoints")).data?.relay?.reconnectRoom === runtime.reconnectRoom,
  requestBuried: owner.get(asked!.token) === null,
};

// Another browser the owner turns away.
const stranger = device(accountRoom);
await Promise.race([stranger.ready, wait(3_000)]);
const strangerAsked = await pendingRequest();
owner.decide(strangerAsked!.token, "deny");
const strangerClosed = await Promise.race([stranger.closed, wait(2_000).then(() => "open" as const)]);

// A browser that leaves before anyone answers takes its question with it.
const leaver = device(accountRoom);
await Promise.race([leaver.ready, wait(3_000)]);
const leaverAsked = await pendingRequest();
leaver.close();
await wait(150);
const leaverTrusted = trusted(leaver.key);

// The approved browser comes back the way it reconnects: through the room /resolve gives.
const resolved = await fetch(`http://127.0.0.1:${relayPort}/resolve`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ bridgePublicKey: bytesToHex(bridgeKey) }),
}).then((response) => response.json() as Promise<{ room?: string }>);
const browserAgain = device(resolved.room!, browser.key);
const browserAgainResult = await settle(browserAgain);

// A live feed through the tunnel arrives as stream frames, not as one reply.
const streamFrames = await Promise.race([
  browserAgain.subscribe("web.stream", { path: "/api/broadcast/stream" }),
  wait(3_000).then(() => [] as any[]),
]);
const liveStream = {
  frames: streamFrames.map((frame) => frame.error ? "error" : frame.result?.type),
  text: streamFrames.filter((frame) => frame.result?.type === "data").map((frame) => frame.result.data).join(""),
};

console.log(JSON.stringify({
  accountRoom,
  pairingRoom: runtime.qrPayload!.room,
  reconnectRoom: runtime.reconnectRoom,
  resolvedRoom: resolved.room,
  browserReady,
  whileWaiting,
  asked: asked && { route: asked.route, label: asked.label },
  prompt,
  requestedKeyMatches,
  afterApproval,
  stranger: { closedWith: strangerClosed, trusted: trusted(stranger.key) },
  leaver: { asked: Boolean(leaverAsked), trusted: leaverTrusted },
  browserAgain: browserAgainResult,
  liveStream,
}));

for (const subject of [browser, stranger, browserAgain]) subject.close();
owner.dispose(); admissionStore.dispose();
await runtime.stop();
relay.stop();
webApi.stop(true);
process.exit(0);
