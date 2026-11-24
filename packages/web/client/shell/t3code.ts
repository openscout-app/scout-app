/**
 * T3 Code as a connected tool. T3 Code (https://github.com/pingdotgg/t3code,
 * MIT) is a separate app the operator runs on their own machine. Scout App
 * does not bundle, fork or restyle it: it names it, links to it, and frames
 * the operator's own loopback server when that server allows framing.
 *
 * This module has no React or DOM dependency, so the preview host reads the
 * same rules the client does.
 */

export const T3CODE_CONNECT_COMMAND = "SCOUT_T3CODE_URL=http://127.0.0.1:3773 bun run start";

/** What the host knows about the operator's T3 Code server. `url` is a loopback origin and nothing more. */
export type T3CodeStatus =
  | { configured: false }
  | { configured: true; url: string; reachable: false }
  | { configured: true; url: string; reachable: true; frameBlocked: false }
  | { configured: true; url: string; reachable: true; frameBlocked: true; blockedBy: "x-frame-options" | "frame-ancestors" };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Returns the origin of a loopback `http:` URL with an explicit port, or null.
 * Credentials, a query, a fragment or a path other than `/` make it invalid:
 * none of them belong in a display-only address.
 */
export function loopbackOrigin(raw: unknown, { allowWs = false }: { allowWs?: boolean } = {}): string | null {
  if (typeof raw !== "string" || raw.length > 256) return null;
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (url.protocol !== "http:" && !(allowWs && url.protocol === "ws:")) return null;
  if (!LOOPBACK.has(url.hostname) || !url.port || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && !(allowWs && url.protocol === "ws:" && url.pathname === "/ws")) return null;
  return `http://${url.hostname}:${url.port}`;
}

/**
 * The T3 Code origin for this run: `SCOUT_T3CODE_URL`, else the first loopback
 * entry in the broker's `OPENSCOUT_T3_CONNECTIONS`. Only the origin is kept;
 * `tokenEnv`, ids and every other field are dropped and never read.
 * An invalid `SCOUT_T3CODE_URL` throws, so a typo does not silently fall back.
 */
export function t3CodeOriginFromEnv(env: Record<string, string | undefined>): string | null {
  const explicit = env.SCOUT_T3CODE_URL?.trim();
  if (explicit) {
    const origin = loopbackOrigin(explicit);
    if (!origin) throw new Error("SCOUT_T3CODE_URL must be a loopback address such as http://127.0.0.1:3773");
    return origin;
  }
  let connections: unknown;
  try { connections = JSON.parse(env.OPENSCOUT_T3_CONNECTIONS || "[]"); } catch { return null; }
  if (!Array.isArray(connections)) return null;
  for (const entry of connections.slice(0, 32)) {
    const url = entry && typeof entry === "object" ? (entry as { url?: unknown }).url : undefined;
    const origin = loopbackOrigin(url, { allowWs: true });
    if (origin) return origin;
  }
  return null;
}

export type FramingVerdict = { blocked: false } | { blocked: true; by: "x-frame-options" | "frame-ancestors" };

/**
 * Whether a browser would let `parent` frame a response from `frame`, judged
 * from the response's headers. A `frame-ancestors` directive in any enforced
 * Content-Security-Policy replaces `X-Frame-Options`, as browsers do.
 */
export function framingVerdict(headers: Pick<Headers, "get">, parent: string, frame: string): FramingVerdict {
  const policies = (headers.get("content-security-policy") ?? "").split(",");
  const ancestors = policies
    .map(policy => policy.split(";").map(d => d.trim().split(/\s+/)).find(([name]) => name?.toLowerCase() === "frame-ancestors"))
    .filter((d): d is string[] => Boolean(d));
  if (ancestors.length) {
    return ancestors.every(([, ...sources]) => sources.some(s => sourceAllows(s, parent, frame)))
      ? { blocked: false }
      : { blocked: true, by: "frame-ancestors" };
  }
  const xfo = (headers.get("x-frame-options") ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (xfo.includes("deny") || (xfo.includes("sameorigin") && parent !== frame)) return { blocked: true, by: "x-frame-options" };
  return { blocked: false };
}

/** One `frame-ancestors` source expression against the framing origin. `'none'` matches nothing. */
function sourceAllows(source: string, parent: string, frame: string): boolean {
  const s = source.toLowerCase();
  const p = new URL(parent);
  if (s === "'self'") return parent === frame;
  if (s === "*") return p.protocol === "http:" || p.protocol === "https:";
  if (/^[a-z][a-z0-9+.-]*:$/.test(s)) return s === p.protocol || (s === "http:" && p.protocol === "https:");
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*|(?:\*\.)?[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::(\*|\d{1,5}))?(?:\/.*)?$/.exec(s);
  if (!m) return false;
  const [, scheme, host, port] = m;
  const fromScheme = scheme ? `${scheme}:` : new URL(frame).protocol;
  if (!(fromScheme === p.protocol || (fromScheme === "http:" && p.protocol === "https:"))) return false;
  const hostOk = host === "*" || host === p.hostname || (host!.startsWith("*.") && p.hostname.endsWith(host!.slice(1)));
  if (!hostOk) return false;
  const actual = p.port || (p.protocol === "https:" ? "443" : "80");
  const wanted = port ?? (fromScheme === "https:" ? "443" : "80");
  return port === "*" || wanted === actual;
}

/** Reads `<meta name="scout-t3code-url">`, display-only and loopback-only. */
export function readT3CodeUrl(doc: Pick<Document, "querySelector"> | undefined = globalThis.document): string | null {
  return loopbackOrigin(doc?.querySelector<HTMLMetaElement>('meta[name="scout-t3code-url"]')?.content);
}

/** Accepts only the shapes this module defines, with a loopback origin. Anything else reads as not configured. */
export function parseT3CodeStatus(value: unknown): T3CodeStatus {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || v.configured !== true) return { configured: false };
  const url = loopbackOrigin(v.url);
  if (!url) return { configured: false };
  if (v.reachable !== true) return { configured: true, url, reachable: false };
  if (v.frameBlocked === true) {
    return { configured: true, url, reachable: true, frameBlocked: true, blockedBy: v.blockedBy === "x-frame-options" ? "x-frame-options" : "frame-ancestors" };
  }
  return { configured: true, url, reachable: true, frameBlocked: false };
}
