import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveOpenScoutSupportPaths } from "@openscout/runtime/support-paths";
import type { Hono } from "hono";
import { overviewHistoryDays } from "../../shared/world-history.ts";
import { createWorldWeekService, readQuota, worldDays } from "../world-week.ts";
import { createTeamWeekService } from "../world-team.ts";
import { createWorldStashStore, isWorldStash, WORLD_STASH_CAP } from "../world-stash.ts";
import { parseWorldContext, resolveWorldCommand, worldJevConfig } from "../world-command.ts";
import { answerWorldQuestion, WorldAskError, type WorldAskDeps } from "../world-ask.ts";
import { prepareRemarks, type RemarksDeps } from "../world-remarks.ts";
import { previewKind } from "../world-files.ts";
import { createWorldLive, LIVE_HOURS, type WorldLive } from "../world-live.ts";
import { createReviewWindowService, reviewDays, type ReviewWindowService } from "../review-window.ts";
import { byteRange, createCanvasService, videoType, type CanvasService } from "../canvas.ts";
import { createOpenInEditor, type OpenInEditor } from "../open-in-editor.ts";
import { canvasHours, canvasKindOf, isShowPath } from "../../shared/canvas.ts";
import { runtimeShowSource } from "../canvas-shows.ts";
import { loadSessionRefObservePayload } from "../core/observe/service.ts";
import { createReviewGithubService, type ReviewGithubService } from "../review-github.ts";
import { decodeOtlpRequest, encodeOtlpResponse, type OtlpEncoding } from "@openscout/runtime/otlp";
import { requestScoutBrokerJson } from "@openscout/runtime/broker-api";
import { openReadonlyDb, resolveControlHome } from "../db/internal/db.ts";
import { readOpenTroubleDelivery, type BrokerDelivery } from "../world-broker-rows.ts";

const TEXT_CAP = 400_000;
const missing = () => new Response("not found", { status: 404 });
function foreignOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host !== new URL(request.url).host; } catch { return true; }
}
async function readBoundedJson(request: Request, cap: number): Promise<{ value?: unknown; response?: Response }> {
  if (Number(request.headers.get("content-length")) > cap) return { response: new Response("body too large", { status: 413 }) };
  if (!request.body) return { response: new Response("bad JSON", { status: 400 }) };
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) { await reader.cancel(); return { response: new Response("body too large", { status: 413 }) }; }
      chunks.push(value);
    }
    return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch { return { response: new Response("bad JSON", { status: 400 }) }; }
  finally { reader.releaseLock(); }
}
/** The body, or null once it passes cap bytes (read no further). */
async function readBoundedBytes(request: Request, cap: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > cap) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch { return null; } finally { try { reader.releaseLock(); } catch {} }
}
async function openWorldFile(path: string, action: "open" | "reveal"): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("/usr/bin/open", action === "reveal" ? ["-R", path] : [path], { timeout: 5_000 }, error => error ? reject(error) : resolve());
  });
}
export type WorldRouteDeps = {
  week?: ReturnType<typeof createWorldWeekService>;
  /** ?data=team: the operator's machines as teammates, built from the snapshots world-team.ts collects */
  team?: ReturnType<typeof createTeamWeekService>;
  stash?: ReturnType<typeof createWorldStashStore>;
  openFile?: typeof openWorldFile;
  /** Words → ":" lines. Jev from the env (TYPESAFE_API_KEY) unless given; null forces the keyword parser. */
  command?: { jev?: { apiKey: string; endpoint: string } | null; fetcher?: typeof fetch };
  /** where the HUD's :tour files live (<name>.tour); default <control home>/world-tours */
  toursDir?: string;
  /** ?source=live|otlp: the World following us (world-live.ts); created on first use */
  live?: WorldLive;
  brokerUrl?: () => string;
  /** questions → a spoken answer + the moves that show it (world-ask.ts); absent: :ask says it can't */
  ask?: WorldAskDeps;
  /** shortlisted slots → prepared remarks (world-remarks.ts); Jev from the env unless given, null = rules only */
  remarks?: RemarksDeps;
  /** Review: the window's data from the same week, git and the files as they are now (review-window.ts) */
  review?: ReviewWindowService;
  /** Canvas: each agent's screenshots, films and documents, read off the Review window (canvas.ts) */
  canvas?: CanvasService;
  /** opens a file in this host's editor (open-in-editor.ts) */
  openInEditor?: OpenInEditor;
  /** Review: the pull requests behind the window, from GitHub with gh (review-github.ts) */
  reviewGithub?: ReviewGithubService;
  /** Overview › Dismiss: an open undelivered message on this host's runtime, and the runtime's status write */
  deliveries?: WorldDeliveryDeps;
};
export type WorldDeliveryDeps = {
  /** the open trouble delivery with this id, read from this host's runtime records; null when it isn't one */
  lookup(id: string): BrokerDelivery | null | Promise<BrokerDelivery | null>;
  /** POST /v1/deliveries/status on the runtime */
  setStatus(body: { deliveryId: string; status: "cancelled"; metadata: Record<string, unknown> }): Promise<unknown>;
};
const DELIVERY_ID = /^[\w.:@-]{1,240}$/;
function defaultDeliveryDeps(brokerUrl: (() => string) | undefined): WorldDeliveryDeps {
  return {
    lookup: id => { const db = openReadonlyDb(0); try { return readOpenTroubleDelivery(db, id); } finally { db.close(); } },
    setStatus: async body => {
      if (!brokerUrl) throw new Error("no runtime URL");
      return requestScoutBrokerJson(brokerUrl(), "/v1/deliveries/status", { method: "POST", body });
    },
  };
}
/** OTLP/HTTP bodies the World accepts from an exporter; anything bigger is refused, not truncated */
export const WORLD_OTLP_CAP = 4 * 1024 * 1024;
const TOUR_CAP = 64 * 1024, TOUR_NAME = /^[\w.-]{1,64}$/;
/** Mounted after installScoutApiMiddleware; all routes require operator authority. */
export function mountWorldRoutes(app: Hono, deps: WorldRouteDeps = {}) {
  const week = deps.week ?? createWorldWeekService(), stash = deps.stash ?? createWorldStashStore();
  const team = deps.team ?? createTeamWeekService({ quota: from => readQuota(resolveControlHome(), from) });
  // allow-list membership, then containment re-checked on the realpath (symlinks included) and the deny list:
  // resolves to the real file to serve, or null
  const previewable = (p: unknown): Promise<string | null> => week.previewable(p);
  let review = deps.review;
  const reviewService = () => (review ??= createReviewWindowService({ week }));
  let reviewGithub = deps.reviewGithub;
  const reviewGithubService = () => (reviewGithub ??= createReviewGithubService({ review: reviewService() }));
  app.get("/api/ops/review", async (c) => {
    try {
      return new Response(await reviewService().json(reviewDays(c.req.query("days"))), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    } catch (error) {
      console.error("[review]", error);
      return c.json({ error: "could not load the review" }, 500);
    }
  });
  // the pull requests behind the window, joined by the review's own keys; gh failing is a warning in the body, not an error
  app.get("/api/ops/review-github", async (c) => {
    try {
      return new Response(await reviewGithubService().json(reviewDays(c.req.query("days"))), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    } catch (error) {
      console.error("[review-github]", error);
      return c.json({ error: "could not load the pull requests" }, 500);
    }
  });
  // one file the last review listed, as it is now: ?as=head its first lines as JSON, ?as=text its source as JSON
  // for the code pane, ?as=raw an image's bytes
  app.get("/api/ops/review-file", async (c) => {
    const q = c.req.query("as"), as = q === "raw" ? "raw" : q === "text" ? "text" : "head";
    try {
      const hit = await reviewService().file(c.req.query("p") || "", as);
      if (!hit) return missing();
      if (hit.kind === "head" || hit.kind === "text") return c.json(hit.body, 200, { "cache-control": "no-store" });
      const st = await stat(hit.real);
      const kind = previewKind(hit.real, c.req.header("sec-fetch-dest"));
      if (!kind.binary) return missing();
      return new Response(Bun.file(hit.real), { headers: { "cache-control": "no-store", "x-mtime": String(st.mtimeMs), "x-size": String(st.size), ...kind.headers } });
    } catch { return missing(); }
  });
  let canvas = deps.canvas;
  const canvasService = () => (canvas ??= createCanvasService({
    review: reviewService(),
    // a session's own title, as the Sessions board and the companion read it (routes/sessions.ts)
    titleOf: async (ref) => (await loadSessionRefObservePayload(ref, { summary: true, turns: 0 }))?.data.summary?.title ?? null,
    // what agents chose to show (`scout show`), from the runtime's show store
    ...(deps.brokerUrl ? { shows: runtimeShowSource(deps.brokerUrl) } : {}),
  }));
  app.get("/api/ops/canvas", async (c) => {
    try {
      return c.json(await canvasService().data(canvasHours(c.req.query("hours"), c.req.query("days")), c.req.query("end")), 200, { "cache-control": "no-store" });
    } catch (error) {
      console.error("[canvas]", error);
      return c.json({ error: "could not load the canvas" }, 500);
    }
  });
  // one file the canvas listed: ?as=head a document's first lines as JSON, ?as=text a worked file's source as JSON,
  // ?as=diff&since=<commit> what changed in a worked file, as JSON (a gone copy: ?key=<key>&as=diff&since=<commit>),
  // ?as=arc an Arc diagram's source (304 when the If-None-Match version is current), ?as=raw an image or film's bytes
  // (films answer a byte range, so the player can seek)
  app.get("/api/ops/canvas-file", async (c) => {
    const p = c.req.query("p") || "";
    try {
      if (c.req.query("as") === "diff") {
        // a gone copy is named by its key and first commit instead: its session's commits on it
        const key = c.req.query("key"), since = c.req.query("since");
        const diff = p ? await canvasService().diff(p, since) : key && since ? await canvasService().commitDiff(key, since) : null;
        return diff ? c.json(diff, 200, { "cache-control": "no-store" }) : missing();
      }
      if (c.req.query("as") === "arc") {
        // an Arc diagram's source, as JSON text: a listed *.arc.json, or the newest shown version of one. The canvas
        // polls it while a diagram is on screen; an unchanged version answers 304 without the file being read
        // &follow=0: a past window's diagram, the shown version it names rather than the newest
        const arc = await canvasService().arc(p, c.req.header("if-none-match"), c.req.query("follow") !== "0");
        if (!arc) return missing();
        const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", etag: arc.version, "x-mtime": String(arc.mt) };
        if (arc.text === undefined) return new Response(null, { status: 304, headers });
        return new Response(arc.text, { headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
      }
      if (c.req.query("as") === "text") {
        const text = await canvasService().text(p);
        return text ? c.json(text, 200, { "cache-control": "no-store" }) : missing();
      }
      if (c.req.query("as") !== "raw") {
        const head = await canvasService().head(p);
        return head ? c.json(head, 200, { "cache-control": "no-store" }) : missing();
      }
      if (isShowPath(p)) {
        // a shown version: the runtime's immutable copy. It answers inline only for pictures and films; anything else
        // it would send as a download, which a card never shows
        const res = await canvasService().showBytes(p, c.req.header("range"));
        const type = res?.headers.get("content-type") ?? "";
        if (!res || (res.status !== 200 && res.status !== 206 && res.status !== 416) || (res.status !== 416 && !/^(image|video)\//.test(type))) {
          await res?.body?.cancel();
          return missing();
        }
        const headers: Record<string, string> = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
        for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "etag"]) { const v = res.headers.get(h); if (v) headers[h] = v; }
        return new Response(res.body, { status: res.status, headers });
      }
      const real = await canvasService().real(p); if (!real) return missing();
      const st = await stat(real);
      const film = videoType(real);
      const kind = previewKind(real, c.req.header("sec-fetch-dest"));
      if (!film && !(kind.binary && kind.headers["content-type"]?.startsWith("image/"))) return missing();
      const headers: Record<string, string> = {
        ...kind.headers, ...(film ? { "content-type": film } : {}),
        "cache-control": "no-store", "accept-ranges": "bytes", "x-mtime": String(st.mtimeMs),
      };
      const range = byteRange(c.req.header("range"), st.size);
      if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${st.size}` } });
      if (range) {
        return new Response(Bun.file(real).slice(range.start, range.end + 1), { status: 206, headers: {
          ...headers, "content-range": `bytes ${range.start}-${range.end}/${st.size}`, "content-length": String(range.end - range.start + 1),
        } });
      }
      return new Response(Bun.file(real), { headers: { ...headers, "content-length": String(st.size) } });
    } catch { return missing(); }
  });
  // a file the canvas listed, opened in this host's editor at a line. The /api trust gate has already refused foreign
  // origins; the path must be one a kept canvas build listed, re-checked now, and never an image or a film
  const openInEditor = deps.openInEditor ?? createOpenInEditor();
  app.post("/api/ops/canvas-file/editor", async (c) => {
    const body = await c.req.json().catch(() => null) as { p?: unknown; line?: unknown } | null;
    const p = typeof body?.p === "string" ? body.p : "";
    const line = typeof body?.line === "number" && Number.isInteger(body.line) && body.line > 0 ? body.line : undefined;
    const real = p ? await canvasService().real(p).catch(() => null) : null;
    if (!real) return missing();
    const kind = canvasKindOf(real);
    if (kind === "image" || kind === "video") return c.json({ error: "not a text file" }, 415);
    try {
      const { editor } = await openInEditor(real, line);
      return c.json({ ok: true, editor });
    } catch (error) {
      console.error("[canvas] open in editor", error);
      return c.json({ error: "the editor did not open" }, 500);
    }
  });
  app.get("/api/ops/world-week", async (c) => {
    c.header("cache-control", "no-store");
    try {
      const days = overviewHistoryDays(c.req.query("hours"));
      // ?data=team: every machine as a teammate (same schema), from the cached per-host snapshots
      if (c.req.query("data") === "team") {
        const gz = /\bgzip\b/.test(c.req.header("accept-encoding") || "");
        const body = gz ? await team.gzip(days) : await team.json(days);
        if (body == null) return c.json({ error: "no team snapshots yet: run bun design/studio/scripts/world-team.ts --hosts" }, 404);
        return new Response(body as BodyInit, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(gz ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}) } });
      }
      return new Response(await week.json(days ?? worldDays(c.req.query("days"))), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    } catch (error) {
      console.error("[world-week]", error);
      return c.json({ error: "could not load World activity" }, 500);
    }
  });
  app.get("/api/ops/world-file", async (c) => {
    const p = c.req.query("p") || "";
    try {
      const real = await previewable(p); if (!real) return missing();
      const st = await stat(real); if (!st.isFile()) return missing();
      // sandbox CSP + nosniff on every preview; an SVG opened top-level comes back as its text
      const kind = previewKind(real, c.req.header("sec-fetch-dest"));
      const headers = { "cache-control": "no-store", "x-mtime": String(st.mtimeMs), "x-size": String(st.size), ...kind.headers };
      if (kind.binary) return new Response(Bun.file(real), { headers });
      const handle = await open(real, "r");
      try {
        const buf = Buffer.alloc(Math.min(st.size, TEXT_CAP));
        const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
        return new Response(buf.subarray(0, bytesRead).toString("utf8"), {
          headers: { ...headers, "x-truncated": st.size > TEXT_CAP ? "1" : "0" },
        });
      } finally { await handle.close(); }
    } catch { return missing(); }
  });
  app.post("/api/ops/world-file", async (c) => {
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const body = await readBoundedJson(c.req.raw, 16 * 1024);
    if (body.response) return body.response;
    const value = body.value as { p?: unknown; action?: unknown } | null;
    const p = value?.p, action = value?.action;
    try {
      const real = await previewable(p); if (!real) return missing();
      if (action !== "reveal" && action !== "open") return new Response("bad action", { status: 400 });
      await (deps.openFile ?? openWorldFile)(real, action);
      return c.json({ ok: true });
    } catch { return missing(); }
  });
  // natural language → the HUD's ":" lines: { text, context? } → ok | confirm | none (see world-command.ts)
  app.post("/api/ops/world-command", async (c) => {
    c.header("cache-control", "no-store");
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const body = await readBoundedJson(c.req.raw, 32 * 1024);
    if (body.response) return body.response;
    const value = body.value as { text?: unknown; context?: unknown } | null;
    if (typeof value?.text !== "string" || !value.text.trim() || value.text.length > 600) return c.json({ error: "text is required (≤ 600 chars)" }, 400);
    const jev = deps.command?.jev !== undefined ? deps.command.jev : worldJevConfig();
    return c.json(await resolveWorldCommand(value.text, parseWorldContext(value.context), { jev, fetcher: deps.command?.fetcher }));
  });
  // a question about the view → { say, commands } (world-ask.ts); the brief is the HUD's own summary of what it shows
  app.post("/api/ops/world-ask", async (c) => {
    c.header("cache-control", "no-store");
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    if (!deps.ask) return c.json({ error: "asking the World isn't set up on this server" }, 503);
    const body = await readBoundedJson(c.req.raw, 48 * 1024);
    if (body.response) return body.response;
    const value = body.value as { text?: unknown; brief?: unknown } | null;
    if (typeof value?.text !== "string" || !value.text.trim() || value.text.length > 600) return c.json({ error: "text is required (≤ 600 chars)" }, 400);
    try {
      return c.json(await answerWorldQuestion(value.text.trim(), value.brief, deps.ask));
    } catch (error) {
      const status = error instanceof WorldAskError ? error.status : 500;
      return c.json({ error: error instanceof Error ? error.message : "the World couldn't answer" }, status as 500);
    }
  });
  // Overview › Dismiss: an undelivered message the operator gives up on. Only one that is open on this host's runtime
  // and of the kind the Overview lists (world-broker-rows.ts); the runtime records it as cancelled, by the operator.
  // Cancelled, not completed (it was never delivered) and not failed (nothing went wrong in the delivery itself).
  const deliveries = () => deps.deliveries ?? defaultDeliveryDeps(deps.brokerUrl);
  app.post("/api/ops/world-delivery/dismiss", async (c) => {
    c.header("cache-control", "no-store");
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const body = await readBoundedJson(c.req.raw, 4 * 1024);
    if (body.response) return body.response;
    const id = (body.value as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !DELIVERY_ID.test(id)) return c.json({ error: "id is required" }, 400);
    let open: BrokerDelivery | null;
    try { open = await deliveries().lookup(id); } catch { open = null; }
    if (!open) return c.json({ error: "this host's runtime has no open delivery with that id" }, 404);
    const at = Date.now();
    try {
      await deliveries().setStatus({ deliveryId: id, status: "cancelled", metadata: { cancelledBy: "operator", cancelReason: "dismissed from the Overview", statusUpdatedAt: at, ...(open.ended_at ? { targetEndedAt: open.ended_at } : {}) } });
    } catch (error) {
      console.error("[world-delivery]", error);
      return c.json({ error: "the runtime did not take the change" }, 502);
    }
    return c.json({ ok: true, id, status: "cancelled", at });
  });
  // shortlisted slots → prepared remarks, graded once per slot sig (world-remarks.ts)
  app.post("/api/ops/world-remarks", async (c) => {
    c.header("cache-control", "no-store");
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const body = await readBoundedJson(c.req.raw, 96 * 1024);
    if (body.response) return body.response;
    const value = body.value as { moments?: unknown } | null;
    if (!Array.isArray(value?.moments)) return c.json({ error: "moments is required" }, 400);
    return c.json(await prepareRemarks(value.moments, deps.remarks));
  });
  // tours: timed lists of the HUD's ":" lines, one text file each; ?name= reads one, no name lists them
  const toursDir = () => deps.toursDir ?? join(resolveOpenScoutSupportPaths().controlHome, "world-tours");
  app.get("/api/ops/world-tour", async (c) => {
    c.header("cache-control", "no-store");
    const name = c.req.query("name");
    if (name == null) {
      try { return c.json((await readdir(toursDir())).filter(f => f.endsWith(".tour")).map(f => f.slice(0, -5)).filter(n => TOUR_NAME.test(n)).sort()); }
      catch { return c.json([]); }
    }
    if (!TOUR_NAME.test(name) || name.startsWith(".")) return new Response("bad tour name", { status: 400 });
    try {
      const path = join(toursDir(), `${name}.tour`), st = await stat(path);
      if (!st.isFile() || st.size > TOUR_CAP) return missing();
      return new Response(await readFile(path, "utf8"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
    } catch { return missing(); }
  });
  // live: a seed (the engine's payload over the last hours) then deltas, as server-sent events
  let liveHub: WorldLive | null = deps.live ?? null;
  const hub = () => liveHub ??= createWorldLive({ brokerUrl: deps.brokerUrl, log: line => console.log("[world-live]", line) });
  app.get("/api/ops/world-live", async (c) => {
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const source = c.req.query("source") === "otlp" ? "otlp" : "live";
    const hours = Math.max(1, Math.min(LIVE_HOURS, Number(c.req.query("hours")) || LIVE_HOURS));
    const signal = c.req.raw.signal, enc = new TextEncoder();
    let close: (() => void) | null = null, beat: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      async start(ctl) {
        let open = true;
        const end = () => { if (!open) return; open = false; close?.(); if (beat) clearInterval(beat); try { ctl.close(); } catch {} };
        const send = (event: string, data: unknown) => { if (!open) return; try { ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { end(); } };
        signal.addEventListener("abort", end);
        ctl.enqueue(enc.encode(": world-live\n\n"));
        beat = setInterval(() => { try { ctl.enqueue(enc.encode(": keepalive\n\n")); } catch { end(); } }, 15_000);
        try { close = await hub().subscribe(source, hours, send); if (!open) close(); }
        catch (error) { console.error("[world-live]", error); send("error", { error: "could not start the live World" }); end(); }
      },
      cancel() { close?.(); if (beat) clearInterval(beat); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
  });
  app.get("/api/ops/world-live/status", (c) => { c.header("cache-control", "no-store"); return c.json(liveHub ? liveHub.status() : { started: false }); });
  // OTLP/HTTP ingest (JSON or protobuf): what an exporter sends shows up on ?source=otlp. Same trust gate as every
  // /api route; the runtime's codec decodes strictly, then fromOtlp() redacts and clips every field it keeps.
  for (const signal of ["traces", "logs", "metrics"] as const) {
    app.post(`/api/ops/world-otlp/v1/${signal}`, async (c) => {
      if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
      const type = (c.req.header("content-type") || "").split(";")[0].trim().toLowerCase();
      const encoding: OtlpEncoding | null = type === "application/json" ? "application/json" : type === "application/x-protobuf" ? "application/x-protobuf" : null;
      if (!encoding) return new Response("unsupported content-type", { status: 415 });
      if ((c.req.header("content-encoding") || "identity").toLowerCase() !== "identity") return new Response("unsupported content-encoding", { status: 415 });
      if (Number(c.req.header("content-length")) > WORLD_OTLP_CAP) return new Response("body too large", { status: 413 });
      const buf = await readBoundedBytes(c.req.raw, WORLD_OTLP_CAP);
      if (!buf) return new Response("body too large", { status: 413 });
      let req: Record<string, unknown>;
      try { req = decodeOtlpRequest(signal, buf, encoding, 32); } catch { return new Response("invalid OTLP request", { status: 400 }); }
      // metrics are accepted (an exporter that sends all three shouldn't error) and noted by name; they don't draw
      const res = hub().ingest(req as any, signal);
      return new Response(encodeOtlpResponse(signal, encoding, 0) as unknown as BodyInit, { headers: { "content-type": encoding, "x-world-used": String(res.used), "x-world-skipped": String(res.skipped) } });
    });
  }
  app.get("/api/ops/world-stash", async (c) => {
    c.header("cache-control", "no-store");
    try { return c.json(await stash.read()); }
    catch { return c.json({ error: "could not read World stash" }, 500); }
  });
  app.put("/api/ops/world-stash", async (c) => {
    c.header("cache-control", "no-store");
    if (foreignOrigin(c.req.raw)) return new Response("forbidden", { status: 403 });
    const body = await readBoundedJson(c.req.raw, WORLD_STASH_CAP);
    if (body.response) return body.response;
    if (!isWorldStash(body.value)) return c.json({ error: "stash must be an array of card objects" }, 400);
    try { await stash.write(body.value); return c.json({ ok: true }); }
    catch { return c.json({ error: "could not save World stash" }, 500); }
  });
}
