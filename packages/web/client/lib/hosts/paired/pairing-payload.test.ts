import { describe, expect, test } from "bun:test";

import {
  hostLabel,
  pairingPayloadFromUrl,
  parsePairingPayload,
  relayClientUrl,
  relayResolveUrl,
  relayUrlsForPage,
} from "./pairing-payload.ts";

const key = "ab".repeat(32);
const payload = {
  v: 1,
  relay: "wss://mesh.oscout.net/v1/relay",
  fallbackRelays: ["ws://192.168.18.22:43131", "nonsense"],
  room: "0c9d4b4e-2f43-4b1e-9c55-0f6f2c3e8a10",
  publicKey: key.toUpperCase(),
  expiresAt: 1_800_000_000_000,
};

describe("parsePairingPayload", () => {
  test("keeps the relays, room and key, with the key lowercased", () => {
    expect(parsePairingPayload(JSON.stringify(payload))).toEqual({
      v: 1,
      relay: "wss://mesh.oscout.net/v1/relay",
      fallbackRelays: ["ws://192.168.18.22:43131"],
      room: payload.room,
      publicKey: key,
      expiresAt: 1_800_000_000_000,
    });
  });

  test("keeps a name the link carries, printable and short", () => {
    expect(parsePairingPayload({ ...payload, name: "  dev-host\n" })?.name).toBe("dev-host");
    expect(parsePairingPayload({ ...payload, name: "x".repeat(100) })?.name).toHaveLength(64);
    expect(parsePairingPayload({ ...payload, name: 42 })).not.toHaveProperty("name");
    expect(parsePairingPayload({ ...payload, name: "\u0007 " })).not.toHaveProperty("name");
  });

  test("refuses payloads that can't name a reachable Mac", () => {
    expect(parsePairingPayload("not json")).toBeNull();
    expect(parsePairingPayload({ ...payload, v: 2 })).toBeNull();
    expect(parsePairingPayload({ ...payload, relay: "https://mesh.oscout.net" })).toBeNull();
    expect(parsePairingPayload({ ...payload, room: "short" })).toBeNull();
    expect(parsePairingPayload({ ...payload, room: "has spaces in it" })).toBeNull();
    expect(parsePairingPayload({ ...payload, publicKey: "ab".repeat(31) })).toBeNull();
  });
});

describe("pairingPayloadFromUrl", () => {
  const encoded = encodeURIComponent(JSON.stringify(payload));

  test("reads the phone's QR link and the shorter #pair= link", () => {
    expect(pairingPayloadFromUrl(`https://openscout.app/pair#payload=${encoded}`)?.room).toBe(payload.room);
    expect(pairingPayloadFromUrl(`http://127.0.0.1:43122/#pair=${encoded}`)?.room).toBe(payload.room);
    expect(pairingPayloadFromUrl(`http://127.0.0.1:43122/?payload=${encoded}`)?.room).toBe(payload.room);
  });

  test("ignores pages without a pairing link", () => {
    expect(pairingPayloadFromUrl("http://127.0.0.1:43122/agents#section")).toBeNull();
    expect(pairingPayloadFromUrl("not a url")).toBeNull();
  });
});

describe("relays", () => {
  const parsed = parsePairingPayload(payload)!;

  test("a secure page can only open wss:// relays", () => {
    expect(relayUrlsForPage(parsed, "https:")).toEqual(["wss://mesh.oscout.net/v1/relay"]);
    expect(relayUrlsForPage(parsed, "http:")).toEqual(["wss://mesh.oscout.net/v1/relay", "ws://192.168.18.22:43131"]);
  });

  test("joins the room as a client", () => {
    const url = new URL(relayClientUrl(parsed.relay, parsed.room));
    expect(url.pathname).toBe("/v1/relay");
    expect(url.searchParams.get("room")).toBe(parsed.room);
    expect(url.searchParams.get("role")).toBe("client");
  });

  test("asks the relay where the Mac waits over plain HTTP(S)", () => {
    expect(relayResolveUrl(parsed.relay)).toBe("https://mesh.oscout.net/v1/relay/resolve");
    expect(relayResolveUrl("ws://192.168.18.22:43131")).toBe("http://192.168.18.22:43131/resolve");
  });
});

describe("hostLabel", () => {
  test("calls a host by the name its link carries, else by its key", () => {
    const parsed = parsePairingPayload(payload)!;
    expect(hostLabel({ ...parsed, name: "dev-host" })).toBe("dev-host");
    expect(hostLabel(parsed)).toBe(`Host ${key.slice(0, 6)}`);
  });
});
