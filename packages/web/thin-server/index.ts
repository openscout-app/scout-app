import { execFile } from "node:child_process";
import fs from "node:fs";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import {
  checkRuntime,
  discoverLocalTranscripts,
  readTranscriptContextWindow,
  resolveSessionObserve,
  runScoutSetup,
  runtimeUrl,
} from "./transcripts.ts";

export * from "./transcripts.ts";

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function isLoopbackHost(req: IncomingMessage): boolean {
  return LOCAL_HOST.test(req.headers.host || "");
}

export function isLocalRequest(req: IncomingMessage): boolean {
  const host = req.headers.host || "";
  if (!isLoopbackHost(req)) return false;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

export async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage, maxBytes = 16_384): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) throw new Error("Request body is too large.");
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {} as T;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  return parsed as T;
}

export interface ScoutThinApiContext {
  url: URL;
  pathname: string;
  runtimeBase: string;
}

export interface ScoutThinServerOptions {
  /** npm package identifier returned by `/api/identity`, e.g. `"@openscout/feed"`. */
  packageName: string;
  /** Short product noun after "Scout ", e.g. `"Feed"`, `"Sessions"`, `"Search"`. */
  product: string;
  /** Directory containing prebuilt `index.html` and static assets. */
  distDir: string;
  /** Surface-specific `/api/*` handler. Return `true` when handled. */
  apiHandler?: (req: IncomingMessage, res: ServerResponse, ctx: ScoutThinApiContext) => Promise<boolean> | boolean;
  /** Extra fields merged into `GET /api/status`. */
  getStatus?: (ctx: { runtimeUp: boolean; runtimeUrl: string }) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export function createScoutThinHttpHandler(options: Omit<ScoutThinServerOptions, "distDir">) {
  const title = options.product === "Scout" ? "Scout" : `Scout ${options.product}`;

  return async function handleThinApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/") && !pathname.startsWith("/v1/")) return false;

    if (!isLocalRequest(req)) {
      sendJson(res, 403, { error: `Open ${title} on this host.` });
      return true;
    }

    const runtimeBase = runtimeUrl();

    if (req.method === "GET" && pathname === "/api/identity") {
      sendJson(res, 200, { app: options.packageName, product: options.product });
      return true;
    }

    if (options.apiHandler) {
      const handled = await options.apiHandler(req, res, { url, pathname, runtimeBase });
      if (handled) return true;
    }

    if (req.method === "GET" && pathname === "/api/status") {
      const runtimeUp = await checkRuntime(runtimeBase);
      const extra = options.getStatus ? await options.getStatus({ runtimeUp, runtimeUrl: runtimeBase }) : {};
      sendJson(res, 200, { runtimeUp, runtimeUrl: runtimeBase, ...extra });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/setup") {
      try {
        runScoutSetup(options.packageName);
        sendJson(res, 200, { ok: true, runtimeUp: await checkRuntime(runtimeBase) });
      } catch (err) {
        sendJson(res, 503, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    if (req.method === "GET" && (pathname === "/v1/events/stream" || pathname === "/v1/tail/events")) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "connection": "keep-alive",
      });
      res.write(": connected\n\n");
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 20_000);
      req.on("close", () => clearInterval(keepAlive));
      return true;
    }

    if (req.method === "GET" && pathname === "/api/recent-sessions") {
      const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit") ?? 8)));
      const sessions = discoverLocalTranscripts({ maxPerHarness: 15 }).slice(0, limit).map((item) => ({
        sessionId: item.sessionId,
        harness: item.source,
        project: item.project,
        branch: item.branch,
        model: item.model,
        title: item.title,
        updatedAt: item.mtimeMs,
      }));
      sendJson(res, 200, { sessions });
      return true;
    }

    if (req.method === "POST" && pathname === "/api/session-context") {
      try {
        const body = await readJsonBody<{ sessionId?: string; source?: string; centerRecord?: number; radius?: number }>(req);
        const context = readTranscriptContextWindow(body);
        if (!context) {
          sendJson(res, 404, { error: "Session transcript not found." });
          return true;
        }
        sendJson(res, 200, context);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    const refMatch = /^\/api\/session-ref\/(.+)$/.exec(pathname);
    if (req.method === "GET" && refMatch?.[1]) {
      const resolved = await resolveSessionObserve(decodeURIComponent(refMatch[1]));
      if (!resolved) {
        sendJson(res, 404, { error: "Session transcript not found." });
        return true;
      }
      sendJson(res, 200, resolved);
      return true;
    }

    if (req.method === "GET" && pathname === "/api/messages") {
      const conversationId = url.searchParams.get("conversationId") || "";
      if (conversationId && (await checkRuntime(runtimeBase))) {
        try {
          const upstream = await fetch(`${runtimeBase}/v1/messages?conversationId=${encodeURIComponent(conversationId)}&limit=50`, {
            signal: AbortSignal.timeout(3000),
            redirect: "error",
          });
          if (upstream.ok) {
            const data = await upstream.json();
            sendJson(res, 200, Array.isArray(data) ? data : (data.messages || []));
            return true;
          }
        } catch {}
      }
      sendJson(res, 200, []);
      return true;
    }

    sendJson(res, 404, { error: `Unknown ${title} API route.` });
    return true;
  };
}

export function createScoutThinServer(options: ScoutThinServerOptions): Server {
  const title = options.product === "Scout" ? "Scout" : `Scout ${options.product}`;
  const distDir = path.resolve(options.distDir);
  const handleApi = createScoutThinHttpHandler(options);

  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    if (!isLoopbackHost(req)) {
      sendJson(res, 421, { error: `Open ${title} via its local loopback address.` });
      return;
    }

    try {
      if (await handleApi(req, res)) return;
    } catch (err) {
      if (!res.destroyed) {
        sendJson(res, 503, { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    const urlPath = new URL(req.url || "/", "http://127.0.0.1").pathname;
    const rel = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
    let file = path.join(distDir, rel);
    if (!file.startsWith(distDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(distDir, "index.html");
    }
    if (!fs.existsSync(file)) {
      sendJson(res, 503, { error: `${title}: dist/index.html is missing. Run npm run build first.` });
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] || "application/octet-stream",
      "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    });
    fs.createReadStream(file).pipe(res);
  });
}

export function serveScoutThinServer(createServer: () => Server, port: number, host = "127.0.0.1"): Promise<Server> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const cmdArgs = process.platform === "win32" ? ["/c", "start", url] : [url];
  execFile(cmd, cmdArgs, () => {});
}

export interface ScoutThinCliOptions {
  binName: string;
  packageName: string;
  product: string;
  defaultPort: number;
  portEnvVar: string;
  distDir: string;
  help: string;
  createServer: () => Server;
  getStatus?: () => Promise<{ json: Record<string, unknown>; lines: string[] }>;
  commands?: Record<string, (argv: string[]) => Promise<void> | void>;
}

export async function runScoutThinCli(options: ScoutThinCliOptions, argv = process.argv.slice(2)): Promise<void> {
  const title = options.product === "Scout" ? "Scout" : `Scout ${options.product}`;
  const opt = (flag: string) => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(options.help);
    return;
  }

  const sub = argv[0] && !argv[0].startsWith("-") ? argv[0] : null;

  if (sub && options.commands && Object.hasOwn(options.commands, sub)) {
    await options.commands[sub]!(argv.slice(1));
    return;
  }

  if (sub === "setup") {
    try {
      runScoutSetup(options.packageName);
      console.log(`Scout runtime is ready at ${runtimeUrl()}.`);
      return;
    } catch (err) {
      console.error(`${options.binName}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  if (sub === "status") {
    if (options.getStatus) {
      const report = await options.getStatus();
      if (argv.includes("--json")) {
        console.log(JSON.stringify(report.json, null, 2));
      } else {
        for (const line of report.lines) console.log(line);
      }
      return;
    }
    const url = runtimeUrl();
    const up = await checkRuntime(url);
    if (argv.includes("--json")) {
      console.log(JSON.stringify({ runtimeUp: up, runtimeUrl: url }, null, 2));
    } else {
      console.log(`Runtime: ${up ? `up at ${url}` : `not running (run ${options.binName} setup to start it)`}`);
    }
    return;
  }

  if (sub && sub !== "serve") {
    console.error(`${options.binName}: unknown command "${sub}". Run ${options.binName} --help.`);
    process.exit(1);
  }

  const indexHtml = path.join(path.resolve(options.distDir), "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(`${options.binName}: dist/index.html is missing. Run \`npm run build\` first.`);
    process.exit(1);
  }

  const requested = Number(opt("--port") ?? process.env[options.portEnvVar] ?? 0);
  if (opt("--port") !== undefined && (!Number.isInteger(requested) || requested < 1 || requested > 65535)) {
    console.error(`${options.binName}: use a port between 1 and 65535.`);
    process.exit(1);
  }
  const startPort = requested || options.defaultPort;
  const open = !argv.includes("--no-open");

  for (let port = startPort; port < startPort + (requested ? 1 : 10); port++) {
    try {
      await serveScoutThinServer(options.createServer, port);
      const url = `http://127.0.0.1:${port}`;
      console.log(`${title}: ${url}`);
      if (open) openBrowser(url);
      return;
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        try {
          const check = await fetch(`http://127.0.0.1:${port}/api/identity`, {
            signal: AbortSignal.timeout(800),
            redirect: "error",
          });
          if (check.ok && (await check.json()).app === options.packageName) {
            const url = `http://127.0.0.1:${port}`;
            console.log(`${title} is already running at ${url}`);
            if (open) openBrowser(url);
            return;
          }
        } catch {}
        if (!requested) continue;
      }
      console.error(`${options.binName}: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }
  console.error(`${options.binName}: ports ${startPort}-${startPort + 9} are in use. Pass --port to choose another.`);
  process.exit(1);
}
