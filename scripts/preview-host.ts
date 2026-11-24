import { join } from "node:path";
import { isShellPath, resolveShellRoute } from "../packages/web/client/shell/routes.ts";
import { framingVerdict, loopbackOrigin, type T3CodeStatus } from "../packages/web/client/shell/t3code.ts";
import { createFeedApi } from "../packages/web/server/routes/feed.ts";

const attr = (value: string) => value.replace(/[&"<>]/g, c => `&#${c.charCodeAt(0)};`);
/**
 * One document for every shell route. The meta tags tell the app which runtime it reads; they are display-only.
 * `extra` carries app-only tags, so the embed document stays exactly as it was.
 */
const page = (brokerUrl: string, runtime: "temporary" | "existing", extra = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="scout-runtime-url" content="${attr(new URL(brokerUrl).origin)}"><meta name="scout-runtime-kind" content="${runtime}">${extra}
<title>Scout App</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/assets/preview.css">
</head><body><div id="root"></div><noscript>Enable JavaScript to open Scout App.</noscript><script type="module" src="/assets/preview.js"></script></body></html>`;
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; media-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const policy = {
  "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
  "content-security-policy": csp,
};

/**
 * Asks the operator's T3 Code server for its front page, once, with no
 * cookies, credentials or forwarded headers, and reads only the status and the
 * two headers that decide whether a browser would frame it here.
 */
export async function probeT3Code(origin: string, parent: string, timeoutMs = 1500): Promise<T3CodeStatus> {
  try {
    const res = await fetch(origin + "/", { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { accept: "text/html" } });
    await res.body?.cancel();
    const verdict = framingVerdict(res.headers, parent, origin);
    return verdict.blocked
      ? { configured: true, url: origin, reachable: true, frameBlocked: true, blockedBy: verdict.by }
      : { configured: true, url: origin, reachable: true, frameBlocked: false };
  } catch {
    return { configured: true, url: origin, reachable: false };
  }
}

/**
 * Serves the app shell at `/` and each surface route, and the chrome-free Feed at `/embed/feed`.
 * `t3code` is the operator's T3 Code loopback origin, if any: app pages may frame it, the embed never does.
 */
export async function servePreview(brokerUrl: string, port: number, { runtime = "existing", t3code = null }: {
  runtime?: "temporary" | "existing";
  t3code?: string | null;
} = {}) {
  const t3 = t3code === null ? null : loopbackOrigin(t3code);
  if (t3code !== null && !t3) throw new Error("T3 Code address must be a loopback http origin");
  const html = page(brokerUrl, runtime);
  const appHtml = t3 ? page(brokerUrl, runtime, `<meta name="scout-t3code-url" content="${attr(t3)}">`) : html;
  const appPolicy = t3 ? { ...policy, "content-security-policy": csp.replace("default-src 'none';", `default-src 'none'; frame-src ${t3};`) } : policy;
  const bundle = await Bun.build({
    entrypoints: [join(import.meta.dir, "../packages/web/client/preview.tsx")],
    target: "browser", minify: true, sourcemap: "none",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
  });
  if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
  const assets = new Map(bundle.outputs.map(file => ["/assets/" + file.path.split("/").at(-1), file]));
  if (!assets.has("/assets/preview.js") || !assets.has("/assets/preview.css")) throw new Error("Missing Feed bundle");
  const api = createFeedApi({ brokerUrl });
  const server = Bun.serve({
    hostname: "127.0.0.1", port, development: false,
    async fetch(req, server) {
      const u = new URL(req.url);
      if (req.headers.get("host") !== `127.0.0.1:${server.port}` || u.origin !== `http://127.0.0.1:${server.port}` ||
          (req.headers.has("origin") && req.headers.get("origin") !== u.origin) || req.headers.get("sec-fetch-site") === "cross-site")
        return new Response("Local requests only", { status: 403 });
      if (req.method !== "GET") return Response.json({ error: "Read-only preview" }, { status: 405, headers: { allow: "GET" } });
      if (u.pathname === "/api/t3code") {
        const status: T3CodeStatus = t3 ? await probeT3Code(t3, u.origin) : { configured: false };
        return Response.json(status, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      }
      if (u.pathname.startsWith("/api/")) return await api.handle(req) ?? Response.json({ error: "Not available in this preview" }, { status: 404 });
      const file = assets.get(u.pathname);
      if (file) return new Response(file, { headers: { ...policy, "content-type": file.type } });
      if (isShellPath(u.pathname) || /^\/(c|sessions)\/[^/]+$/.test(u.pathname)) {
        try { decodeURIComponent(u.pathname); } catch { return new Response("Invalid path", { status: 400 }); }
        const app = resolveShellRoute(u)?.mode !== "embed";
        return new Response(app ? appHtml : html, { headers: { ...(app ? appPolicy : policy), "content-type": "text/html; charset=utf-8" } });
      }
      return new Response("Not found", { status: 404 });
    },
  });
  return { url: server.url, async close() { await server.stop(true); await api.close(); } };
}
