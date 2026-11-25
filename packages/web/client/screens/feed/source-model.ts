/* ──────────────────────────────────────────────────────────────────────────
   The typed pieces Home and the Feed draw from the feed's other sources
   (GET /api/feed/sources) and from a post's head: what kind of post it is,
   the providers' rows, the week by project, an outside thread's state line,
   a quota warning's curve, and where those posts sit among the Feed's days.

   Every value comes from a source. A field a source does not give is left
   out, never filled in. Pure: no DOM, no clock of its own.
   ────────────────────────────────────────────────────────────────────────── */

import type { FeedPostHead } from "../../../shared/api/feed.ts";
import type { FeedActivity, FeedOutsideThread, FeedQuotaEvent, FeedSources } from "../../../shared/api/feed-sources.ts";
import { aheadOfPace, runsOutAt, windowLength } from "../../../shared/quota-pace.ts";
import { currentWindowFill, isQuotaGauge, quotaWindows, usageWindow, type ServiceGauge } from "../home/quota-gauge.ts";

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "14:07" today, "Sun 21:32" this week, "12 Nov" before. */
export function shortWhen(ms: number, nowMs: number): string {
  const d = new Date(ms);
  const now = new Date(nowMs);
  if (d.toDateString() === now.toDateString()) return clock(ms);
  if (Math.abs(nowMs - ms) < 6 * 86_400_000) return `${WEEKDAY[d.getDay()]} ${clock(ms)}`;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** "4m", "3h", "2d": how long ago, for a waiting line. */
export function age(ms: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

/* ── a post's kind ─────────────────────────────────────────────────────── */

export type PostKind = "question" | "draft" | "merged" | "pr" | "visual" | "video" | "running" | "page" | "result" | "post" | "milestone";

export const POST_KIND_LABEL: Record<PostKind, string> = {
  question: "Question",
  draft: "Draft PR",
  merged: "Merged PR",
  pr: "Pull request",
  visual: "Visual change",
  video: "Video",
  running: "Running",
  page: "Page",
  result: "Result",
  post: "Post",
  milestone: "Milestone",
};

/**
 * What a post is, from its head: a question on its thread first, then live
 * work, then its pull request's state, then its lead. A post with none of
 * these is a result: work finished and written up.
 */
export function postKind(post: Pick<FeedPostHead, "forYou" | "lead" | "prs" | "agentPost">): PostKind {
  if (post.forYou?.reason === "attention") return "question";
  if (post.lead.kind === "live") return "running";
  // An agent's own post says what it is; a joined one leaves its task's kind alone.
  if (post.agentPost?.own) return post.agentPost.milestone ? "milestone" : "post";
  const pr = post.prs[0];
  if (pr?.state === "draft") return "draft";
  if (post.lead.kind === "video") return "video";
  if (post.lead.kind === "visual") return "visual";
  if (pr?.state === "merged") return "merged";
  if (pr) return "pr";
  if (post.lead.kind === "page") return "page";
  return "result";
}

/* ── providers ─────────────────────────────────────────────────────────── */

export const QUOTA_OVER = 0.9;

export type ProviderRow =
  | {
      id: string;
      name: string;
      kind: "quota";
      /** The window the row shows: of a day or longer, else the longest. */
      window: string;
      percent: number;
      over: boolean;
      /** The other windows, "5h 12%". */
      others: string[];
      /** When the window resets: "22:59" today, "Mon 22:59", "3 Dec"; null while it waits on its first reading. */
      reset: string | null;
      plan: string | null;
    }
  | { id: string; name: string; kind: "status"; status: string };

function resetLabel(resetAt: number, nowMs: number): string {
  const d = new Date(resetAt);
  if (d.toDateString() === new Date(nowMs).toDateString()) return clock(resetAt);
  if (resetAt - nowMs > 6 * 86_400_000) return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return `${WEEKDAY[d.getDay()]} ${clock(resetAt)}`;
}

/**
 * Whether a gauge has a usage reading to show. A quota gauge always does. A
 * status gauge does only when it carries the time its reading was taken
 * (Grok's local tokens, a Cursor dashboard capture); a status gauge with no
 * capture time only says the provider is signed in or configured.
 */
export function hasUsageReading(gauge: ServiceGauge): boolean {
  return isQuotaGauge(gauge) || Number.isFinite(gauge.capturedAt);
}

/** The providers' rows, in the runtime's order: only those with a usage reading. */
export function providerRows(gauges: readonly ServiceGauge[], nowMs: number): ProviderRow[] {
  const now = new Date(nowMs);
  return gauges.filter(hasUsageReading).map((g): ProviderRow => {
    if (!isQuotaGauge(g)) {
      return { id: g.id, name: g.label, kind: "status", status: [g.statusLabel, g.detailLabel].filter(Boolean).join(" · ") };
    }
    const windows = quotaWindows(g);
    const lead = usageWindow(windows) ?? windows[0]!;
    const fill = lead.awaitingReset ? 0 : currentWindowFill(lead, now);
    return {
      id: g.id,
      name: g.label,
      kind: "quota",
      window: lead.label,
      percent: Math.min(100, Math.round(fill * 100)),
      // Red only when the window fills faster than time passes, so it runs out before it resets.
      over: fill >= QUOTA_OVER && aheadOfPace(fill, nowMs, lead.resetAt, windowLength(lead.label, lead.windowMs)),
      others: windows.filter((w) => w !== lead).map((w) => `${w.label} ${Math.round(currentWindowFill(w, now) * 100)}%`),
      reset: lead.awaitingReset || !lead.resetAt ? null : resetLabel(lead.resetAt, nowMs),
      plan: g.plan ?? null,
    };
  });
}

/* ── the week by project ───────────────────────────────────────────────── */

export type WeekCell = { day: string; count: number; byHarness: Record<string, number>; strength: number; hot: boolean };
/** `harnesses`: the three with the most posts in the row, most first. */
export type WeekRow = { project: string; cells: WeekCell[]; harnesses: string[]; total: number };
export type WeekMap = { days: Array<{ key: string; label: string }>; rows: WeekRow[]; more: number };

/** One accent, stronger with more posts: never 0 for a day that had any, square-root so a busy day does not wash out the rest. */
export function heat(count: number, max: number): number {
  return count && max ? 0.16 + 0.84 * Math.sqrt(count / max) : 0;
}

export function weekMap(activity: FeedActivity | null, maxRows = 6): WeekMap | null {
  if (!activity?.rows.length) return null;
  const shown = activity.rows.slice(0, maxRows);
  const sum = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0);
  const max = Math.max(...shown.flatMap((r) => r.cells.map(sum)));
  return {
    days: activity.days.map((key) => ({ key, label: WEEKDAY[new Date(`${key}T12:00:00`).getDay()]! })),
    rows: shown.map((r) => {
      const harnesses = new Map<string, number>();
      for (const c of r.cells) for (const [h, n] of Object.entries(c)) harnesses.set(h, (harnesses.get(h) ?? 0) + n);
      return {
        project: r.project,
        total: r.total,
        harnesses: [...harnesses.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h).filter((h) => h !== "other").slice(0, 3),
        cells: r.cells.map((c, i) => {
          const count = sum(c);
          const strength = heat(count, max);
          return { day: activity.days[i]!, count, byHarness: c, strength, hot: strength > 0.62 };
        }),
      };
    }),
    more: activity.rows.length - shown.length,
  };
}

/* ── an outside thread ─────────────────────────────────────────────────── */

/** "seo-aeo-desk replied 3h ago", "You wrote 2d ago, no answer yet". */
export function outsideLine(thread: FeedOutsideThread, nowMs: number): string {
  if (thread.waiting === "them") return `You wrote ${age(thread.last.at, nowMs)} ago, no answer yet`;
  const who = thread.last.operator ? "You" : thread.last.who;
  return `${who} ${thread.last.operator ? "wrote" : "replied"} ${age(thread.last.at, nowMs)} ago`;
}

export function channelName(thread: FeedOutsideThread): string {
  return thread.channel.kind === "channel" ? `#${thread.channel.title}` : thread.channel.title;
}

/* ── a quota warning ───────────────────────────────────────────────────── */

/** "weekly limit", "5-hour limit": the window as a person names it. */
export function limitName(window: string, given: number | null | undefined): string {
  const windowMs = windowLength(window, given);
  if (windowMs === 7 * 86_400_000) return "weekly limit";
  if (windowMs === 86_400_000) return "daily limit";
  if (windowMs != null && windowMs >= 28 * 86_400_000 && windowMs <= 31 * 86_400_000) return "monthly limit";
  const m = /^(\d+)\s*h$/i.exec(window.trim());
  return m ? `${m[1]}-hour limit` : `${window} limit`;
}

/** A span rounded to whole hours before it is split, so 1d 23h40m reads "2 days"; under an hour, in minutes. */
export function spanWords(ms: number): string {
  const total = Math.round(Math.max(0, ms) / 3_600_000);
  if (total === 0) {
    const min = Math.max(1, Math.round(Math.max(0, ms) / 60_000));
    return `${min} ${min === 1 ? "minute" : "minutes"}`;
  }
  const days = Math.floor(total / 24);
  const hours = total % 24;
  return [days ? `${days} ${days === 1 ? "day" : "days"}` : null, hours ? `${hours} ${hours === 1 ? "hour" : "hours"}` : null].filter(Boolean).join(" ");
}

function providerName(label: string): string {
  return label ? label[0]!.toUpperCase() + label.slice(1) : label;
}

/**
 * The warning's headline, in the tense of the window:
 *   open    "Claude has used 92% of its weekly limit with 2 days left"
 *           "Claude is out of its weekly limit until Sat 22:00"
 *   reset   "Claude ran out of its weekly limit 6 hours before it reset"
 *           "Claude reached 90% of its weekly limit with 2 days left"
 */
export function quotaHeadline(event: FeedQuotaEvent, nowMs: number): string {
  const who = providerName(event.label);
  const limit = limitName(event.window, event.windowMs);
  const open = event.resetAt > nowMs;
  if (event.ranOutAt != null) {
    return open ? `${who} is out of its ${limit} until ${shortWhen(event.resetAt, nowMs)}`
      : `${who} ran out of its ${limit} ${spanWords(event.resetAt - event.ranOutAt)} before it reset`;
  }
  if (open) {
    const [, fill] = event.points.at(-1) ?? [event.crossedAt, event.threshold];
    return `${who} has used ${Math.round(fill * 100)}% of its ${limit} with ${spanWords(event.resetAt - nowMs)} left`;
  }
  return `${who} reached ${Math.round(event.threshold * 100)}% of its ${limit} with ${spanWords(event.resetAt - event.crossedAt)} left`;
}

/** The line under the headline: when an open window runs out at its pace, and when it resets; a past one, its peak and reset. */
export function quotaMeta(event: FeedQuotaEvent, nowMs: number): string {
  if (event.resetAt <= nowMs) return `Peaked at ${Math.round(event.peak * 100)}% · reset ${shortWhen(event.resetAt, nowMs)}`;
  if (event.ranOutAt != null) return `Ran out ${shortWhen(event.ranOutAt, nowMs)}`;
  const [at, fill] = event.points.at(-1) ?? [event.crossedAt, event.threshold];
  const out = runsOutAt(fill, at, event.resetAt, windowLength(event.window, event.windowMs));
  const resets = `resets ${shortWhen(event.resetAt, nowMs)}`;
  return out ? `At this pace it runs out ${shortWhen(out, nowMs)}, before it ${resets}` : `On pace now · ${resets}`;
}

export type QuotaCurve = {
  line: string;
  /** Even pace: the straight line from empty at the window's start to full at its reset, when the window's length is known. */
  pace: { x1: number; y1: number; x2: number; y2: number } | null;
  /** The time at the box's left edge (the window's start, or its first reading) and at its right (the reset). */
  from: number;
  to: number;
};

/** The window's readings across the whole window, start to reset, with the even-pace line. */
export function quotaCurve(event: Pick<FeedQuotaEvent, "points" | "resetAt" | "window" | "windowMs">, width: number, height: number): QuotaCurve | null {
  const windowMs = windowLength(event.window, event.windowMs);
  const points = event.points;
  if (points.length < 2) return null;
  const start = windowMs != null ? event.resetAt - windowMs : points[0]![0];
  const t0 = Math.min(start, points[0]![0]);
  const t1 = Math.max(event.resetAt, points[points.length - 1]![0]);
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => ((t - t0) / span) * width;
  const y = (f: number) => height - 2 - Math.min(1, Math.max(0, f)) * (height - 6);
  return {
    line: points.map(([t, f]) => `${x(t).toFixed(1)},${y(f).toFixed(1)}`).join(" "),
    pace: windowMs != null ? { x1: x(start), y1: y(0), x2: x(event.resetAt), y2: y(1) } : null,
    from: t0,
    to: t1,
  };
}

/* ── the Feed's days ───────────────────────────────────────────────────── */

export type SourcePost = { kind: "outside"; at: number; day: string; thread: FeedOutsideThread } | { kind: "quota"; at: number; day: string; event: FeedQuotaEvent };

/**
 * The outside threads and quota warnings, by working day, newest first. A
 * day older than the oldest the Feed has loaded waits until it is loaded.
 */
export function sourcePostsByDay(sources: FeedSources | null, loadedDays: readonly string[], hasOlder: boolean): Map<string, SourcePost[]> {
  const out = new Map<string, SourcePost[]>();
  if (!sources) return out;
  const oldest = loadedDays.length ? loadedDays[loadedDays.length - 1]! : null;
  const all: SourcePost[] = [
    ...sources.outside.threads.map((thread): SourcePost => ({ kind: "outside", at: thread.at, day: thread.day, thread })),
    ...sources.quota.map((event): SourcePost => ({ kind: "quota", at: event.crossedAt, day: event.day, event })),
  ];
  for (const post of all) {
    if (hasOlder && oldest && post.day < oldest) continue;
    const day = out.get(post.day) ?? [];
    day.push(post);
    out.set(post.day, day);
  }
  for (const day of out.values()) day.sort((a, b) => b.at - a.at);
  return out;
}

/** The Feed's days with the sources' days merged in, newest first. */
export function mergedDays(loadedDays: readonly string[], sourceDays: Iterable<string>): string[] {
  return [...new Set([...loadedDays, ...sourceDays])].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
