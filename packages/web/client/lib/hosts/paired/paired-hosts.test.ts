import { describe, expect, test } from "bun:test";

import { HostFleet } from "../host-fleet.ts";
import { sameOriginHost } from "../host-client.ts";
import type { PairedHostOptions } from "./paired-host.ts";
import { initPairedHosts, type PairingPage } from "./paired-hosts.ts";

const keyA = "aa".repeat(32);
const keyB = "bb".repeat(32);

function pairingLink(publicKey: string, room = `room-${publicKey.slice(0, 8)}`, name?: string): string {
  const payload = { v: 1, relay: "wss://mesh.oscout.net/v1/relay", room, publicKey, expiresAt: 0, ...(name ? { name } : {}) };
  return `#pair=${encodeURIComponent(JSON.stringify(payload))}`;
}

function page(href: string, items = new Map<string, string>()) {
  const url = new URL(href);
  const replaced: string[] = [];
  const fake: PairingPage = {
    location: { href: url.toString(), hash: url.hash, protocol: url.protocol },
    history: { state: null, replaceState: (_state, _unused, next) => void replaced.push(String(next)) },
    localStorage: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
    },
  };
  return { fake, items, replaced };
}

function fleet() {
  const hosts = new HostFleet();
  hosts.add(sameOriginHost());
  return hosts;
}

describe("initPairedHosts", () => {
  test("a pairing link adds that Mac, focuses it, and leaves the address bar", async () => {
    const hosts = fleet();
    const { fake, replaced } = page(`http://127.0.0.1:43122/${pairingLink(keyA)}`);

    const added = await initPairedHosts(hosts, fake);

    expect(added.map((host) => host.id)).toEqual([keyA]);
    expect(hosts.focused().id).toBe(keyA);
    expect(hosts.state(keyA).kind).toBe("idle");
    expect(replaced).toEqual(["http://127.0.0.1:43122/"]);
  });

  test("remembers paired Macs across reloads, newest first", async () => {
    const items = new Map<string, string>();
    await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyA)}`, items).fake);
    await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyB)}`, items).fake);

    const hosts = fleet();
    const added = await initPairedHosts(hosts, page("http://127.0.0.1:43122/agents", items).fake);

    expect(added.map((host) => host.id)).toEqual([keyB, keyA]);
    expect(hosts.focused().id).toBe(keyB);
  });

  test("#unpair forgets them, and a page with nothing paired stays on this Mac", async () => {
    const items = new Map<string, string>();
    await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyA)}`, items).fake);

    const unpair = page("http://127.0.0.1:43122/#unpair", items);
    expect(await initPairedHosts(fleet(), unpair.fake)).toEqual([]);
    expect(unpair.replaced).toEqual(["http://127.0.0.1:43122/"]);

    const hosts = fleet();
    expect(await initPairedHosts(hosts, page("http://127.0.0.1:43122/", items).fake)).toEqual([]);
    expect(hosts.focused().id).toBe("local");
  });

  test("a link pasted into an open tab reloads it so the link takes", async () => {
    const { fake } = page("http://127.0.0.1:43122/agents");
    const listeners: (() => void)[] = [];
    let reloads = 0;
    fake.addEventListener = (_type, listener) => void listeners.push(listener);
    fake.location.reload = () => void (reloads += 1);
    await initPairedHosts(fleet(), fake);

    const changeFragment = (hash: string) => {
      fake.location.href = `http://127.0.0.1:43122/agents${hash}`;
      fake.location.hash = hash;
      for (const listener of listeners) listener();
    };
    changeFragment("#section");
    expect(reloads).toBe(0);
    changeFragment(pairingLink(keyA));
    changeFragment("#unpair");
    expect(reloads).toBe(2);
  });

  test("calls a host by the name its link carries, else by its key, while it waits", async () => {
    const [named] = await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyA, undefined, "dev-host")}`).fake);
    expect(named!.label).toBe("dev-host");
    const [unnamed] = await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyB)}`).fake);
    expect(unnamed!.label).toBe(`Host ${keyB.slice(0, 6)}`);
  });

  test("a new link's name replaces a label saved before the host had one", async () => {
    const items = new Map<string, string>();
    await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyA)}`, items).fake);
    const [host] = await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyA, undefined, "dev-host")}`, items).fake);
    expect(host!.label).toBe("dev-host");
  });

  test("keeps what a Mac said about itself for the next visit, until a new link", async () => {
    const items = new Map<string, string>();
    const saved = () => JSON.parse(items.get("openscout.web.paired-hosts.v1")!)[0];
    const [host] = await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyA)}`, items).fake);
    // What PairedHost reports once connected; paired-host.test.ts covers the asking.
    (host as unknown as { options: PairedHostOptions }).options.onLearned?.({
      reconnectRoom: "reconnect-a",
      hostName: "Studio Mac",
    });

    const [again] = await initPairedHosts(fleet(), page("http://127.0.0.1:43122/", items).fake);
    expect(again!.label).toBe("Studio Mac");
    expect(saved().reconnectRoom).toBe("reconnect-a");

    // The same link again changes nothing. A new one may come from a Mac that
    // restarted, so it starts from its own room and keeps the name.
    await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyA)}`, items).fake);
    expect(saved().reconnectRoom).toBe("reconnect-a");
    await initPairedHosts(fleet(), page(`http://127.0.0.1:43122/${pairingLink(keyA, "room-new")}`, items).fake);
    expect(saved()).toMatchObject({ label: "Studio Mac", payload: { room: "room-new" } });
    expect(saved().reconnectRoom).toBeUndefined();
  });

  test("ignores a broken saved list", async () => {
    const items = new Map([["openscout.web.paired-hosts.v1", "{not json"]]);
    expect(await initPairedHosts(fleet(), page("http://127.0.0.1:43122/", items).fake)).toEqual([]);
  });
});
