import type { Hono } from "hono";
import { performance } from "node:perf_hooks";
import type { Context } from "hono";
import { relayEventStream } from "../server-core.ts";
import { resolveScoutBrokerUrl } from "../core/broker/service.ts";
import { scoutBrokerPaths } from "../core/broker/paths.ts";
import type { DiscoverySnapshot, TailDiscoveryScope } from "@openscout/runtime/tail";
import { snapshotRecentBroadcasts, subscribeBroadcast } from "../core/broadcast/service.ts";
import { createSignedScoutServicesRestartUrl, parseScoutServicesRestartTarget } from "../scout-services-deeplink.ts";
import { parseOptionalPositiveInt } from "../http-helpers.ts";
import { TailRecentPayload, BrokerJsonCache } from "../broker-json-cache.ts";

import { joinHerdrTailAttention, readBlockedHerdrPanes } from "../core/attention/herdr-host-attention.ts";
import { createRefreshingRead } from "../core/attention/refreshing-read.ts";
import { parseTailUsageSessionIds } from "./tail-usage-query.ts";

/**
 * herdr's blocked panes, for the discovery join. Reading them shells out to
 * `herdr session list` and then one topology read per session, so a poll
 * must not trigger it: every discovery request shares this read, refreshed
 * in the background at most once per window. Answering a permission prompt
 * (herdr-permission-answer.ts) reads herdr live, not this.
 */
const HERDR_BLOCKED_MAX_AGE_MS = 10_000;

type ServerTimingMetric = {
  name: string;
  dur?: number;
  desc?: string;
};

const MAX_SERVER_TIMING_HEADER_LENGTH = 2048;

const TRUNCATED_SERVER_TIMING_HEADER = 'server-timing-truncated;desc="oversize"';

function serverTimingToken(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9!#$%&'*+.^_`|~-]+/g, "-") || "metric";
}

function serverTimingDescription(value: string): string {
  return value.replace(/["\\]/g, "");
}

function formatServerTiming(metrics: ServerTimingMetric[]): string {
  return metrics
    .filter((metric) => metric.name.trim())
    .map((metric) => {
      const parts = [serverTimingToken(metric.name)];
      if (metric.dur !== undefined && Number.isFinite(metric.dur)) {
        parts.push(`dur=${Math.max(0, metric.dur).toFixed(1)}`);
      }
      if (metric.desc?.trim()) {
        parts.push(`desc="${serverTimingDescription(metric.desc.trim())}"`);
      }
      return parts.join(";");
    })
    .join(", ");
}

function boundedServerTimingHeader(value: string): string {
  const trimmed = value.replace(/[\r\n]+/g, " ").trim();
  return trimmed.length <= MAX_SERVER_TIMING_HEADER_LENGTH
    ? trimmed
    : TRUNCATED_SERVER_TIMING_HEADER;
}

function appendServerTimingHeader(
  upstream: string | null,
  metrics: ServerTimingMetric[],
): string {
  const local = formatServerTiming(metrics);
  return boundedServerTimingHeader([
    upstream ? boundedServerTimingHeader(upstream) : null,
    local || null,
  ].filter(Boolean).join(", "));
}

const TAIL_DISCOVERY_SCOPES = new Set<TailDiscoveryScope>(["hot", "shallow", "deep"]);

function parseTailDiscoveryScope(value: string | undefined): TailDiscoveryScope | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return TAIL_DISCOVERY_SCOPES.has(normalized as TailDiscoveryScope)
    ? (normalized as TailDiscoveryScope)
    : undefined;
}

function tailDiscoveryProcessKey(source: string, cwd: string | null | undefined): string | null {
  const cleanCwd = cwd?.trim();
  return cleanCwd ? `${source}\u0000${cleanCwd}` : null;
}

function limitTailDiscoverySnapshot(
  snapshot: DiscoverySnapshot,
  limit: number | undefined,
): DiscoverySnapshot {
  if (!limit || limit <= 0) return snapshot;
  const transcripts = snapshot.transcripts.slice(0, limit);
  const transcriptProcessKeys = new Set(
    transcripts
      .map((transcript) => tailDiscoveryProcessKey(transcript.source, transcript.cwd))
      .filter((key): key is string => Boolean(key)),
  );
  const processIds = new Set<string>();
  const processes: DiscoverySnapshot["processes"] = [];
  for (const process of snapshot.processes) {
    const key = tailDiscoveryProcessKey(process.source, process.cwd);
    if (!key || !transcriptProcessKeys.has(key)) continue;
    const processId = `${process.source}\u0000${process.pid}`;
    if (processIds.has(processId)) continue;
    processIds.add(processId);
    processes.push(process);
    if (processes.length >= limit) break;
  }
  for (const process of snapshot.processes) {
    if (processes.length >= limit) break;
    const processId = `${process.source}\u0000${process.pid}`;
    if (processIds.has(processId)) continue;
    processIds.add(processId);
    processes.push(process);
  }
  return {
    ...snapshot,
    processes,
    transcripts,
  };
}

/**
 * The runtime's per-session usage read. Not in `scoutBrokerPaths` until the
 * core change that adds it lands; a runtime before it answers 404.
 */
const TAIL_USAGE_PATH = "/v1/tail/usage";

type TailUsagePayload = { generatedAt: number; sessions: unknown[]; missing: string[] };

function createBrokerJsonCache<T>(): BrokerJsonCache<T> {
  return {
    data: null,
    inFlight: null,
    lastError: null,
    serverTiming: null,
    refreshedAt: null,
  };
}

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, 180);
}

function scheduleBrokerJsonRefresh<T>(
  cache: BrokerJsonCache<T>,
  url: URL,
  label: string,
): Promise<void> {
  if (cache.inFlight) return cache.inFlight;
  const fetchStart = performance.now();
  cache.inFlight = (async () => {
    let upstreamTiming: string | null = null;
    const metrics: ServerTimingMetric[] = [];
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      upstreamTiming = res.headers.get("server-timing");
      metrics.push({ name: "web-broker-fetch", dur: performance.now() - fetchStart });
      if (!res.ok) {
        throw new Error(`${label} unavailable (${res.status})`);
      }
      const parseStart = performance.now();
      const data = await res.json() as T;
      metrics.push({ name: "web-json", dur: performance.now() - parseStart });
      cache.data = data;
      cache.lastError = null;
      cache.refreshedAt = Date.now();
      cache.serverTiming = appendServerTimingHeader(upstreamTiming, metrics);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cache.lastError = message;
      metrics.push({
        name: "web-broker-fetch",
        dur: performance.now() - fetchStart,
        desc: "error",
      });
      cache.serverTiming = appendServerTimingHeader(upstreamTiming, metrics);
    } finally {
      cache.inFlight = null;
    }
  })();
  return cache.inFlight;
}

function cachedBrokerJsonState<T>(cache: BrokerJsonCache<T>): string {
  if (cache.data) {
    if (cache.lastError) return cache.inFlight ? "stale-retrying" : "stale";
    return cache.inFlight ? "hit-refreshing" : "hit";
  }
  if (cache.lastError) return cache.inFlight ? "empty-retrying" : "empty-error";
  return cache.inFlight ? "empty-refreshing" : "empty";
}

async function serveCachedBrokerJson<T>(
  c: Context,
  cache: BrokerJsonCache<T>,
  url: URL,
  label: string,
  options: { forceRefresh?: boolean; transform?: (data: T) => T | Promise<T> } = {},
): Promise<Response> {
  const start = performance.now();
  if (options.forceRefresh) {
    if (cache.inFlight) {
      await cache.inFlight;
    }
    await scheduleBrokerJsonRefresh(cache, url, label);
  } else {
    const refresh = scheduleBrokerJsonRefresh(cache, url, label);
    if (cache.data === null) {
      await refresh;
    }
  }
  const state = cachedBrokerJsonState(cache);
  c.header("Cache-Control", "no-store");
  c.header("X-OpenScout-Tail-State", state);
  if (cache.lastError) {
    c.header("X-OpenScout-Tail-Warning", headerSafe(cache.lastError));
  }
  c.header("Server-Timing", appendServerTimingHeader(cache.serverTiming, [{
    name: "web-tail-cache",
    dur: performance.now() - start,
    desc: state,
  }]));
  if (cache.data === null) {
    return c.json({
      error: `${label} unavailable`,
      ...(cache.lastError ? { detail: cache.lastError } : {}),
    }, 502);
  }
  const data = options.transform ? await options.transform(cache.data) : cache.data;
  return c.json(data);
}

export function mountStreamRoutes(app: Hono) {
  const tailDiscoveryCaches = new Map<string, BrokerJsonCache<DiscoverySnapshot>>();
  const tailRecentCaches = new Map<string, BrokerJsonCache<TailRecentPayload>>();
  const tailUsageCaches = new Map<string, BrokerJsonCache<TailUsagePayload>>();
  const blockedHerdrPanes = createRefreshingRead(
    ({ fresh }) => readBlockedHerdrPanes({ uniqueSessions: true, fresh }),
    { maxAgeMs: HERDR_BLOCKED_MAX_AGE_MS },
  );

  app.get("/api/events", async (c) => {
    const brokerUrl = resolveScoutBrokerUrl();
    try {
      return await relayEventStream(`${brokerUrl}/v1/events/stream`, {
        signal: c.req.raw.signal,
      });
    } catch {
      return c.text("Broker unreachable", 502);
    }
  });

  app.get("/api/tail/discover", async (c) => {
    const url = new URL(scoutBrokerPaths.v1.tailDiscover, resolveScoutBrokerUrl());
    const forceRefresh = ["force", "fresh"].some((key) => ["1", "true"].includes(c.req.query(key) ?? ""));
    const scope = parseTailDiscoveryScope(c.req.query("scope"));
    const limitParam = parseOptionalPositiveInt(c.req.query("limit"));
    // parentChain=0: the process list with parent chains left empty, for a
    // table that polls (Ops › Processes). pid: one process with its chain, for
    // its detail. A runtime without the options ignores them and sends the
    // whole list, which the client reads the same way.
    const slim = ["0", "false"].includes(c.req.query("parentChain") ?? "");
    const pid = parseOptionalPositiveInt(c.req.query("pid"));
    if (forceRefresh) {
      url.searchParams.set("force", "1");
    }
    if (slim) {
      url.searchParams.set("parentChain", "0");
    }
    if (pid !== undefined) {
      url.searchParams.set("pid", String(pid));
    }
    if (scope) {
      url.searchParams.set("scope", scope);
    }
    if (limitParam !== undefined) {
      url.searchParams.set("limit", String(limitParam));
    }
    const cacheKey = `scope=${scope ?? "default"};limit=${limitParam ?? "all"};slim=${slim ? "1" : "0"};pid=${pid ?? "all"}`;
    let cache = tailDiscoveryCaches.get(cacheKey);
    if (!cache) {
      cache = createBrokerJsonCache<DiscoverySnapshot>();
      tailDiscoveryCaches.set(cacheKey, cache);
      // one key per opened process: bound them
      while (tailDiscoveryCaches.size > 32) tailDiscoveryCaches.delete(tailDiscoveryCaches.keys().next().value!);
    }
    return serveCachedBrokerJson(
      c,
      cache,
      url,
      "broker tail discovery",
      {
        forceRefresh,
        // the slim list's and one process's readers don't show attention: they skip the herdr join
        transform: slim || pid !== undefined
          ? (data) => limitTailDiscoverySnapshot(data, limitParam)
          : async (data) => joinHerdrTailAttention(
            limitTailDiscoverySnapshot(data, limitParam),
            await blockedHerdrPanes.get({ fresh: forceRefresh }).catch(() => []),
          ),
      },
    );
  });

  // Lifetime tokens, model and last turn for up to TAIL_USAGE_SESSION_LIMIT
  // sessions: read apart from discovery so a discovery run doesn't scan
  // transcripts. A runtime without the read answers 404, served as a 502.
  app.get("/api/tail/usage", async (c) => {
    const sessionIds = parseTailUsageSessionIds(c.req.queries("sessionId") ?? []);
    if (sessionIds.length === 0) {
      return c.json({ generatedAt: Date.now(), sessions: [], missing: [] } satisfies TailUsagePayload);
    }
    const url = new URL(TAIL_USAGE_PATH, resolveScoutBrokerUrl());
    for (const id of sessionIds) url.searchParams.append("sessionId", id);
    const cacheKey = [...sessionIds].sort().join("\u0000");
    let cache = tailUsageCaches.get(cacheKey);
    if (!cache) {
      cache = createBrokerJsonCache<TailUsagePayload>();
      tailUsageCaches.set(cacheKey, cache);
      while (tailUsageCaches.size > 16) tailUsageCaches.delete(tailUsageCaches.keys().next().value!);
    }
    return serveCachedBrokerJson(c, cache, url, "broker tail usage");
  });

  app.get("/api/repo-watch", async (c) => {
    const url = new URL(scoutBrokerPaths.v1.repoWatchSnapshot, resolveScoutBrokerUrl());
    for (const key of ["force", "includeTail", "includeDiff", "includeLastCommit", "native"]) {
      const value = c.req.query(key);
      if (value === "1" || value === "true") url.searchParams.set(key, "1");
    }
    for (const key of ["maxRoots", "maxWorktrees", "maxFilesPerWorktree", "scanBudgetMs"]) {
      const value = parseOptionalPositiveInt(c.req.query(key));
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    try {
      const res = await fetch(url, { signal: c.req.raw.signal });
      if (!res.ok) {
        return c.json({ error: `broker repo-watch unavailable (${res.status})` }, 502);
      }
      return c.json(await res.json());
    } catch {
      return c.json({ error: "broker repo-watch unavailable" }, 502);
    }
  });

  app.post("/api/scout-services/restart-link", async (c) => {
    let target = parseScoutServicesRestartTarget(c.req.query("target"));
    if (!target) {
      try {
        const body = await c.req.json<{ target?: string }>();
        target = parseScoutServicesRestartTarget(body.target);
      } catch {
        // Body is optional; query-string target is enough.
      }
    }

    if (!target) {
      return c.json({ error: "unsupported Scout Services restart target" }, 400);
    }

    return c.json(createSignedScoutServicesRestartUrl(target));
  });

  app.get("/api/tail/recent", async (c) => {
    const forceRefresh = ["force", "fresh"].some((key) => ["1", "true"].includes(c.req.query(key) ?? ""));
    const limitParam = parseOptionalPositiveInt(c.req.query("limit"), 500) ?? 500;
    const includeTranscripts = c.req.query("transcripts") === "true" || c.req.query("transcripts") === "1";
    const mode = c.req.query("mode") === "assistant-replies" ? "assistant-replies" : null;
    const sessionId = c.req.query("sessionId")?.trim() || undefined;
    const requestedWindowMs = parseOptionalPositiveInt(c.req.query("windowMs"));
    const windowMs = requestedWindowMs === undefined
      ? undefined
      : Math.min(requestedWindowMs, 24 * 60 * 60 * 1_000);
    const url = new URL(scoutBrokerPaths.v1.tailRecent, resolveScoutBrokerUrl());
    url.searchParams.set("limit", String(limitParam));
    if (includeTranscripts) {
      url.searchParams.set("transcripts", "true");
    }
    if (mode) {
      url.searchParams.set("mode", mode);
    }
    if (sessionId) url.searchParams.set("sessionId", sessionId);
    if (windowMs !== undefined) {
      url.searchParams.set("windowMs", String(windowMs));
    }
    const cacheKey = `limit=${limitParam};transcripts=${includeTranscripts ? "1" : "0"};mode=${mode ?? "all"};window=${windowMs ?? "all"};session=${JSON.stringify(sessionId ?? null)}`;
    let cache = tailRecentCaches.get(cacheKey);
    if (!cache) {
      cache = createBrokerJsonCache<TailRecentPayload>();
      tailRecentCaches.set(cacheKey, cache);
      // Session-specific histories add one key per visited task. Bound the
      // retained snapshots just as the client bounds its request cache.
      while (tailRecentCaches.size > 64) tailRecentCaches.delete(tailRecentCaches.keys().next().value!);
    }
    return serveCachedBrokerJson(
      c,
      cache,
      url,
      "broker tail",
      { forceRefresh },
    );
  });

  // /api/tail/stream removed — clients now subscribe to broker tail.events
  // directly via tRPC over WebSocket. See packages/web/client/lib/tail-events.ts.

  app.get("/api/broadcast/recent", (c) => {
    const limitParam = parseOptionalPositiveInt(c.req.query("limit"), 50) ?? 50;
    return c.json({ broadcasts: snapshotRecentBroadcasts(limitParam) });
  });

  app.get("/api/broadcast/stream", (c) => {
    const encoder = new TextEncoder();
    const signal = c.req.raw.signal;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const safeEnqueue = (chunk: Uint8Array) => {
          if (closed) return;
          try {
            controller.enqueue(chunk);
          } catch {
            closed = true;
          }
        };

        const recent = snapshotRecentBroadcasts(50);
        for (const broadcast of recent) {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify(broadcast)}\n\n`));
        }
        safeEnqueue(
          encoder.encode(`event: ready\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`),
        );

        const unsubscribe = subscribeBroadcast((broadcast) => {
          safeEnqueue(encoder.encode(`data: ${JSON.stringify(broadcast)}\n\n`));
        });

        const heartbeat = setInterval(() => {
          safeEnqueue(encoder.encode(`: keep-alive ${Date.now()}\n\n`));
        }, 15_000);

        const close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };

        signal.addEventListener("abort", close, { once: true });
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });
}
