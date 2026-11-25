/**
 * Paired Macs this browser remembers, and the boot hook that adds them to
 * the page's host fleet. A pairing link (the phone's QR link works:
 * `#payload=…`, or `#pair=…`) adds that Mac and makes it the focused host,
 * so every view reads from it. `#unpair` forgets them all.
 *
 * The crypto (device key, Noise channel) loads only when there is a Mac to
 * reach, so a page with nothing paired never fetches it.
 *
 * The link's room pairs this browser once. Each Mac's reconnect room and
 * name, learned once connected, are kept beside its link for the next visit.
 */
import { hostFleet, type HostFleet } from "../host-fleet.ts";
import type { HostClient } from "../host-client.ts";
import type { PairedHostLearned } from "./paired-host.ts";
import { hostLabel, pairingPayloadFromUrl, parsePairingPayload, type PairingPayload } from "./pairing-payload.ts";

const STORE_KEY = "openscout.web.paired-hosts.v1";

type SavedHost = { payload: PairingPayload; label: string; pairedAt: number; reconnectRoom?: string };

/** The parts of `window` this reads, so a test can pass its own. */
export type PairingPage = {
  location: Pick<Location, "href" | "hash" | "protocol"> & Partial<Pick<Location, "reload">>;
  history: Pick<History, "state" | "replaceState">;
  localStorage?: Pick<Storage, "getItem" | "setItem">;
  addEventListener?: (type: "hashchange", listener: () => void) => void;
};

function storageOf(page: PairingPage): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return page.localStorage ?? null;
  } catch {
    return null;
  }
}

function loadSaved(page: PairingPage): SavedHost[] {
  try {
    const raw = JSON.parse(storageOf(page)?.getItem(STORE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      const record = entry as Partial<SavedHost> | null;
      const payload = parsePairingPayload(record?.payload);
      if (!payload) return [];
      const reconnectRoom = typeof record?.reconnectRoom === "string" && record.reconnectRoom ? record.reconnectRoom : undefined;
      return [{
        payload,
        label: record?.label || hostLabel(payload),
        pairedAt: record?.pairedAt ?? 0,
        ...(reconnectRoom ? { reconnectRoom } : {}),
      }];
    });
  } catch {
    return [];
  }
}

function save(page: PairingPage, hosts: SavedHost[]): void {
  try {
    storageOf(page)?.setItem(STORE_KEY, JSON.stringify(hosts));
  } catch {
    /* remembered for this page only */
  }
}

/** Keep what a Mac told this browser, read fresh so another tab's pairings survive. */
function remember(page: PairingPage, publicKey: string, learned: PairedHostLearned): void {
  save(page, loadSaved(page).map((host) => host.payload.publicKey !== publicKey ? host : {
    ...host,
    ...(learned.hostName ? { label: learned.hostName } : {}),
    ...(learned.reconnectRoom ? { reconnectRoom: learned.reconnectRoom } : {}),
  }));
}

/** Drop the pairing link from the address bar so it doesn't stay in history or get copied along. */
function stripPairingLink(page: PairingPage): void {
  const url = new URL(page.location.href);
  url.hash = "";
  url.searchParams.delete("payload");
  page.history.replaceState(page.history.state, "", url.toString());
}

export async function initPairedHosts(
  fleet: HostFleet = hostFleet,
  page: PairingPage | undefined = globalThis.window,
): Promise<HostClient[]> {
  if (!page) return [];
  // A link pasted into a tab that is already open changes only the fragment,
  // which doesn't run this hook again. Reload so it does.
  page.addEventListener?.("hashchange", () => {
    if (page.location.hash === "#unpair" || pairingPayloadFromUrl(page.location.href)) page.location.reload?.();
  });
  if (page.location.hash === "#unpair") {
    save(page, []);
    stripPairingLink(page);
    return [];
  }

  let saved = loadSaved(page);
  const fresh = pairingPayloadFromUrl(page.location.href);
  if (fresh) {
    const known = saved.find((host) => host.payload.publicKey === fresh.publicKey);
    // A new link may come from a Mac that restarted, so the room it names wins
    // over a reconnect room learned before. The same link again changes nothing.
    const reconnectRoom = known?.payload.room === fresh.room ? known.reconnectRoom : undefined;
    saved = [
      {
        payload: fresh,
        // A link that names the host wins over a label saved before it had a name.
        label: fresh.name ?? known?.label ?? hostLabel(fresh),
        pairedAt: Date.now(),
        ...(reconnectRoom ? { reconnectRoom } : {}),
      },
      ...saved.filter((host) => host !== known),
    ];
    save(page, saved);
    stripPairingLink(page);
  }
  if (saved.length === 0) return [];

  const [{ loadOrCreateDeviceKey }, { PairedHost }] = await Promise.all([
    import("./device-key.ts"),
    import("./paired-host.ts"),
  ]);
  const deviceKey = loadOrCreateDeviceKey(storageOf(page));
  const hosts = saved.map((entry) => {
    const host: HostClient = new PairedHost(entry.payload, {
      deviceKey,
      label: entry.label,
      reconnectRoom: entry.reconnectRoom,
      pageProtocol: page.location.protocol,
      onState: (state) => fleet.setState(host.id, state),
      onLearned: (learned) => remember(page, entry.payload.publicKey, learned),
    });
    fleet.add(host, { kind: "idle" });
    return host;
  });
  fleet.focus(hosts[0]!.id);
  return hosts;
}
