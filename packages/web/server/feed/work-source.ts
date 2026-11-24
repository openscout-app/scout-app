import type { WebFeedTask } from "../../shared/api/feed.ts";
export type FeedRead =
  | { mode: "window"; since: number; limit: number }
  | { mode: "changed"; since: number; mark: number; limit: number };

/** A work item as the runtime serves it: the Feed's task without what the Feed adds from disk and its own stores. */
export type RuntimeFeedWork = Omit<WebFeedTask, "askedByAgent" | "shows" | "media" | "studies" | "document" | "agentPost">;

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
