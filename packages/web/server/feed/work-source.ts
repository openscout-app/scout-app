/**
 * The Feed's work items, read from the runtime (`GET /v1/feed/work`) instead
 * of its database: the runtime owns those tables, so the Feed needs only its
 * HTTP API and runs wherever that answers. A runtime from before the route
 * answers 404; then the Feed reads the database itself (db/feed.ts) and asks
 * the runtime again a while later, so a restart onto a newer core is picked up.
 */
import type { WebFeedTask } from "../../shared/api/feed.ts";
import type { FeedRead } from "../db/feed.ts";

/** A work item as the runtime serves it: the Feed's task without what the Feed adds from disk and its own stores. */
export type RuntimeFeedWork = Omit<WebFeedTask, "askedByAgent" | "shows" | "media" | "studies" | "document" | "agentPost">;

export type FeedWorkPage = { tasks: WebFeedTask[]; gone: string[] };
export type FeedWorkQuery = (read: FeedRead) => FeedWorkPage | Promise<FeedWorkPage>;

/** How long a runtime without the route is read around before it is asked again. */
export const WORK_ROUTE_RECHECK_MS = 10 * 60_000;

/**
 * A window is asked for a day at a time: the runtime runs each slice as its own
 * short query (a whole 14-day window is a few hundred milliseconds on its thread).
 */
export const WORK_SLICE_MS = 86_400_000;

/** One request: a read, or a slice of a window read (`until`). */
type WorkRequest = FeedRead | { mode: "window"; since: number; until: number; limit: number };

export function feedWorkUrl(read: WorkRequest, baseUrl: string): URL {
  const url = new URL("/v1/feed/work", baseUrl);
  const ms = (value: number) => String(Math.max(0, Math.floor(value)));
  url.searchParams.set("since", ms(read.mode === "window" ? read.since : read.since ?? 0));
  if (read.mode === "window" && "until" in read) url.searchParams.set("until", ms(read.until));
  if (read.mode === "changed") url.searchParams.set("mark", ms(read.mark));
  if (read.limit > 0) url.searchParams.set("limit", String(read.limit));
  return url;
}

export function taskFromRuntimeWork(work: RuntimeFeedWork): WebFeedTask {
  // Read from disk with the other file checks (routes/feed.ts enrich).
  return { ...work, askedByAgent: false, shows: [], media: [], studies: [] };
}

/** A whole window, newest slice first, so the tasks come newest change first as one query gives them. */
export function workSlices(read: Extract<FeedRead, { mode: "window" }>, now: number): WorkRequest[] {
  // The newest slice is open-ended, so an item changed while the read runs is still in it.
  let from = Math.max(read.since, now - WORK_SLICE_MS);
  const slices: WorkRequest[] = [{ mode: "window", since: from, limit: -1 }];
  let until = from;
  while (until > read.since) {
    from = Math.max(read.since, until - WORK_SLICE_MS);
    slices.push({ mode: "window", since: from, until, limit: -1 });
    until = from;
  }
  return slices;
}

export function runtimeWorkSource(
  baseUrl: () => string,
  fallback: FeedWorkQuery,
  options: { timeoutMs?: number; now?: () => number; fetch?: typeof fetch } = {},
): FeedWorkQuery {
  const { timeoutMs = 15_000, now = Date.now, fetch: get = fetch } = options;
  let missingUntil = 0;
  /** One request's page, or null when this runtime has no route to read. */
  const page = async (request: WorkRequest): Promise<FeedWorkPage | null> => {
    const res = await get(feedWorkUrl(request, baseUrl()), { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404 || res.status === 503) {
      // 404: a runtime from before the route. 503: one that keeps no database of its own to read.
      await res.body?.cancel();
      missingUntil = now() + WORK_ROUTE_RECHECK_MS;
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`runtime feed work answered ${res.status}`);
    }
    const body = (await res.json()) as { tasks?: RuntimeFeedWork[]; gone?: string[] };
    return {
      tasks: Array.isArray(body.tasks) ? body.tasks.map(taskFromRuntimeWork) : [],
      gone: Array.isArray(body.gone) ? body.gone : [],
    };
  };
  return async (read) => {
    if (now() < missingUntil) return fallback(read);
    // A limited read takes its newest rows in one query; only an unbounded window is sliced.
    const requests = read.mode === "window" && read.limit < 0 ? workSlices(read, now()) : [read];
    const whole: FeedWorkPage = { tasks: [], gone: [] };
    for (const request of requests) {
      const part = await page(request);
      if (!part) return fallback(read);
      whole.tasks.push(...part.tasks);
      whole.gone.push(...part.gone);
    }
    return whole;
  };
}
