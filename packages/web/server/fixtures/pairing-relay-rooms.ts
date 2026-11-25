// Run with HOME pointed at a scratch directory: pairing identity paths are
// fixed from homedir() at module load. Starts a real pairing runtime against
// a real local relay and drives devices through its two rooms; prints one
// JSON line of what happened.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadOrCreateNodeIdentity } from "@openscout/runtime/mesh/node-identity";
import { startPairingRuntime } from "../core/pairing/runtime/runtime.ts";
import { startRelay } from "../core/pairing/runtime/relay/relay.ts";
import {
  bytesToHex,
  generateKeyPair,
  hexToBytes,
  SecureTransport,
  type KeyPair,
} from "../core/pairing/runtime/security/index.ts";

function freePort(): number {
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = reservation.port!;
  reservation.stop(true);
  return port;
}

const wait = (ms: number) => new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms));

// Production trust now requires the independent host identity. The parent
// directs all state, including that identity, into its scratch home.
loadOrCreateNodeIdentity();
const relayPort = freePort();
const relay = startRelay(relayPort, { pairHttpOrigin: null });
process.env.OPENSCOUT_PAIRING_PORT = String(freePort());

let connected = 0;
const pairingRooms: string[] = [];
const runtime = await startPairingRuntime({
  relayEndpoints: [{ relayUrl: `ws://127.0.0.1:${relayPort}` }],
  relayEvents: {
    onConnected() {
      connected += 1;
    },
  },
  onPairingPayloadChanged(payload) {
    pairingRooms.push(payload.room);
  },
});
pairingRooms.unshift(runtime.qrPayload!.room);
const untilConnected = async (count: number) => {
  while (connected < count) await wait(10);
};
await untilConnected(2);
const bridgeKey = hexToBytes(runtime.qrPayload!.publicKey);

type Device = {
  key: KeyPair;
  /** Whether the Noise handshake finished. */
  ready: Promise<boolean>;
  /** The code the socket closed with. */
  closed: Promise<number>;
  call: (path: string) => Promise<{ data?: any; error?: any }>;
  close: () => void;
};

function device(room: string, key: KeyPair = generateKeyPair()): Device {
  const socket = new WebSocket(`ws://127.0.0.1:${relayPort}?room=${room}&role=client`);
  const pending = new Map<number, (reply: { data?: any; error?: any }) => void>();
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
          const reply = JSON.parse(message) as { id?: number; result?: { data?: unknown }; error?: unknown };
          if (typeof reply.id === "number") pending.get(reply.id)?.({ data: reply.result?.data, error: reply.error });
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

const resolved = await fetch(`http://127.0.0.1:${relayPort}/resolve`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ bridgePublicKey: bytesToHex(bridgeKey) }),
}).then((response) => response.json() as Promise<{ room?: string }>);

// A stranger who looked the Mac up by its key.
const stranger = device(resolved.room!);
const strangerResult = await settle(stranger);

// A new device with the pairing code.
const phone = device(pairingRooms[0]!);
const phoneResult = await settle(phone);
const endpoints = phoneResult.ready ? await phone.call("mobile.endpoints") : null;
await untilConnected(3);

// Someone else with a photo of the code the phone used.
const latecomer = device(pairingRooms[0]!);
const latecomerResult = await settle(latecomer);
const phoneStillServed = (await phone.call("bridgeStatus")).data !== undefined;

// The phone coming back the way it reconnects: through the room /resolve gives.
const phoneAgain = device(resolved.room!, phone.key);
const phoneAgainResult = await settle(phoneAgain);

// A second new device with the code now on the Mac's screen.
const tablet = device(pairingRooms[1]!);
const tabletResult = await settle(tablet);
await untilConnected(4);

// Once the phone leaves, the spent room closes: nobody answers there anymore.
phone.close();
await wait(200);
const afterSpent = device(pairingRooms[0]!);
const afterSpentReady = await Promise.race([afterSpent.ready, wait(1_000).then(() => false)]);

console.log(JSON.stringify({
  resolvedRoom: resolved.room,
  reconnectRoom: runtime.reconnectRoom,
  pairingRooms,
  stranger: { ...strangerResult, trusted: trusted(stranger.key) },
  phone: { ...phoneResult, trusted: trusted(phone.key), toldReconnectRoom: endpoints?.data?.relay?.reconnectRoom ?? null },
  latecomer: { ...latecomerResult, trusted: trusted(latecomer.key) },
  phoneStillServed,
  phoneAgain: phoneAgainResult,
  tablet: { ...tabletResult, trusted: trusted(tablet.key) },
  currentPairingRoom: runtime.qrPayload!.room,
  afterSpentReady,
}));

for (const subject of [stranger, latecomer, phoneAgain, tablet, afterSpent]) subject.close();
await runtime.stop();
relay.stop();
process.exit(0);
