import { afterEach, expect, test } from "bun:test";
import { generateKeyPair } from "@openscout/runtime/pairing-security/noise";

import type { Bridge } from "./bridge.ts";
import { connectToRelay } from "./relay-client.ts";

/**
 * A relay the bridge connects out to, as mobile-relay.ts is: it records what
 * the bridge sends and speaks for the clients in the room. No handshake runs
 * here, so the machine's trust store is never read or written.
 */
function fakeRelay() {
  const fromBridge: unknown[] = [];
  let bridge: { send(data: string): void } | null = null;
  let opened!: () => void;
  const ready = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const server = Bun.serve({
    port: 0,
    fetch: (request, srv) => (srv.upgrade(request) ? undefined : new Response("Expected WebSocket upgrade", { status: 426 })),
    websocket: {
      open(socket) {
        bridge = socket;
        opened();
      },
      message(_socket, message) {
        fromBridge.push(JSON.parse(String(message)));
      },
    },
  });
  return {
    url: `ws://127.0.0.1:${server.port}/v1/relay`,
    ready,
    fromBridge,
    fromClient(clientId: string, payload: string) {
      bridge?.send(JSON.stringify({ phase: "relay", event: "message", clientId, payload }));
    },
    raw(data: string) {
      bridge?.send(data);
    },
    stop: () => server.stop(true),
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function bridgeOn(relay: ReturnType<typeof fakeRelay>) {
  const connection = connectToRelay(relay.url, generateKeyPair(), {} as Bridge, { room: "room-0123456789" });
  cleanups.push(() => connection.disconnect(), relay.stop);
  return connection;
}

test("a client whose session the bridge no longer holds is told to shake hands again", async () => {
  const relay = fakeRelay();
  bridgeOn(relay);
  await relay.ready;

  // A frame from a session the bridge lost when it dropped off the relay and came back.
  relay.fromClient("client-a", JSON.stringify({ phase: "transport", payload: "AAAA" }));
  await wait(50);

  expect(relay.fromBridge).toEqual([
    { phase: "relay", event: "close", clientId: "client-a", code: 4002, reason: "Transport reset" },
  ]);
});

test("a relay without client ids gets no close it can't route", async () => {
  const relay = fakeRelay();
  bridgeOn(relay);
  await relay.ready;

  relay.raw(JSON.stringify({ phase: "transport", payload: "AAAA" }));
  await wait(50);

  expect(relay.fromBridge).toEqual([]);
});

const PING = "{\"v\":1,\"kind\":\"relay_ping\"}";
const PONG = "{\"v\":1,\"kind\":\"relay_pong\"}";

/** A relay that answers pings until told to go quiet, and counts the sockets the bridge opens. */
function heartbeatRelay() {
  const sockets: Array<{ send(data: string): void; close(): void }> = [];
  const received: string[] = [];
  let answering = true;
  const server = Bun.serve({
    port: 0,
    fetch: (request, srv) => (srv.upgrade(request) ? undefined : new Response("Expected WebSocket upgrade", { status: 426 })),
    websocket: {
      open(socket) {
        sockets.push(socket);
      },
      message(socket, message) {
        const text = String(message);
        if (text === PING) {
          if (answering) socket.send(PONG);
          return;
        }
        received.push(text);
      },
    },
  });
  cleanups.push(() => server.stop(true));
  return {
    url: `ws://127.0.0.1:${server.port}/v1/relay`,
    sockets,
    received,
    goQuiet: () => {
      answering = false;
    },
  };
}

async function until(check: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await wait(10);
  }
}

test("a bridge whose relay stops answering pings drops the line and connects again", async () => {
  const relay = heartbeatRelay();
  const connection = connectToRelay(relay.url, generateKeyPair(), {} as Bridge, {
    room: "room-0123456789",
    heartbeat: { intervalMs: 30, staleMs: 120 },
  });
  cleanups.push(() => connection.disconnect());
  await until(() => relay.sockets.length === 1);
  await wait(100);
  expect(relay.sockets).toHaveLength(1);

  relay.goQuiet();
  await until(() => relay.sockets.length === 2);
  // Pongs never reach the bridge as client traffic.
  expect(relay.received).toEqual([]);
});

test("a bridge keeps a line to a relay that never answered a ping, from before heartbeats", async () => {
  const relay = heartbeatRelay();
  relay.goQuiet();
  const connection = connectToRelay(relay.url, generateKeyPair(), {} as Bridge, {
    room: "room-0123456789",
    heartbeat: { intervalMs: 30, staleMs: 60 },
  });
  cleanups.push(() => connection.disconnect());
  await until(() => relay.sockets.length === 1);
  await wait(250);
  expect(relay.sockets).toHaveLength(1);
});

test("reconnectNow replaces the socket at once, and only the reconnect room says it is going to sleep", async () => {
  const relay = heartbeatRelay();
  const reconnect = connectToRelay(relay.url, generateKeyPair(), {} as Bridge, { room: "room-reconnect-01", kind: "reconnect" });
  const pairing = connectToRelay(relay.url, generateKeyPair(), {} as Bridge, { room: "room-pairing-0001", kind: "pairing" });
  cleanups.push(() => reconnect.disconnect(), () => pairing.disconnect());
  await until(() => relay.sockets.length === 2);
  await wait(50);

  reconnect.sayGoingToSleep();
  pairing.sayGoingToSleep();
  await until(() => relay.received.length === 1);
  await wait(50);
  expect(relay.received).toEqual(["{\"v\":1,\"kind\":\"relay_goodbye\",\"reason\":\"sleep\"}"]);

  reconnect.reconnectNow("host woke");
  await until(() => relay.sockets.length === 3);
  await wait(100);
  expect(relay.sockets).toHaveLength(3);
});
