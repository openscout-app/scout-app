/**
 * What a Mac advertises for pairing: the same JSON the phone's QR code and
 * the openscout.app/pair link carry (packages/web/shared/pairing-link.js),
 * and the `mobile_pairing` entrypoint the Mac publishes to the account
 * rendezvous. It names the relay, the room the Mac's bridge waits in, and the
 * bridge's static public key.
 */
export interface PairingPayload {
  v: 1;
  relay: string;
  fallbackRelays?: string[];
  room: string;
  /** The bridge's static X25519 public key, lowercase hex. */
  publicKey: string;
  expiresAt: number;
  /** The host's name as the link's sender knows it, shown until the host says its own. */
  name?: string;
}

const MAX_NAME_LENGTH = 64;

/** A name a link may carry: printable, trimmed, and short enough for a label. */
function linkName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, MAX_NAME_LENGTH).trim();
  return name || undefined;
}

/** What to call a host before it says its own name. */
export function hostLabel(payload: PairingPayload): string {
  return payload.name ?? `Host ${payload.publicKey.slice(0, 6)}`;
}

function isRelayUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "wss:" || protocol === "ws:";
  } catch {
    return false;
  }
}

export function parsePairingPayload(value: unknown): PairingPayload | null {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.v !== 1 || !isRelayUrl(record.relay)) return null;
  if (typeof record.room !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(record.room)) return null;
  if (typeof record.publicKey !== "string" || !/^[0-9a-f]{64}$/i.test(record.publicKey)) return null;
  const fallbackRelays = Array.isArray(record.fallbackRelays) ? record.fallbackRelays.filter(isRelayUrl) : [];
  const name = linkName(record.name);
  return {
    v: 1,
    relay: record.relay,
    ...(fallbackRelays.length > 0 ? { fallbackRelays } : {}),
    room: record.room,
    publicKey: record.publicKey.toLowerCase(),
    expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : 0,
    ...(name ? { name } : {}),
  };
}

/** A payload from a pairing link: `#pair=`, `#payload=` or `?payload=`. */
export function pairingPayloadFromUrl(href: string): PairingPayload | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const encoded = fragment.get("pair") ?? fragment.get("payload") ?? url.searchParams.get("payload");
  return encoded ? parsePairingPayload(encoded) : null;
}

/** The relays this page can open, in the Mac's order. A secure page can only open wss://. */
export function relayUrlsForPage(payload: PairingPayload, pageProtocol: string): string[] {
  const urls = [...new Set([payload.relay, ...(payload.fallbackRelays ?? [])])];
  return pageProtocol === "https:" ? urls.filter((url) => url.startsWith("wss:")) : urls;
}

/** Where a client joins the Mac's room on a relay. */
export function relayClientUrl(relay: string, room: string): string {
  const url = new URL(relay);
  url.searchParams.set("room", room);
  url.searchParams.set("role", "client");
  return url.toString();
}

/** Where a relay says which room the Mac with a given key waits in now (the phone's `/resolve`). */
export function relayResolveUrl(relay: string): string {
  const url = new URL(relay);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/resolve`;
  url.search = "";
  return url.toString();
}
