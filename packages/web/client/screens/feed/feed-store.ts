/*
 * The Feed page's copy of the server's feed: heads by id, days in order, and
 * the version they are at. A read with `since` returns only what changed (or
 * a 304); `mergeFeed` patches it in place. Older pages append by cursor.
 * Pure, so the page and its tests share it.
 */
import type { FeedDay, FeedHome, FeedLead, FeedPostHead, FeedResponse, FeedSize, FeedViewId } from "../../../shared/api/feed.ts";

export type FeedState = {
  view: FeedViewId;
  version: number;
  posts: Map<string, FeedPostHead>;
  /** The newest page's days, then older pages' days. */
  days: FeedDay[];
  /** How many days the first page held: a patch replaces only those. */
  firstPageDays: number;
  cursor: string | null;
  size: FeedSize;
  home: FeedHome | null;
  views: FeedViewId[];
};

export function emptyFeed(view: FeedViewId): FeedState {
  return { view, version: -1, posts: new Map(), days: [], firstPageDays: 0, cursor: null, size: { posts: 0, days: 0, reviewed: 0 }, home: null, views: ["all"] };
}

/** A response for the first page, full or a patch, merged into the state. */
export function mergeFeed(state: FeedState, res: FeedResponse): FeedState {
  const posts = res.full ? new Map<string, FeedPostHead>() : new Map(state.posts);
  if (res.full) {
    // Older pages' posts survive a full first-page read, with the posts joined under them.
    for (const day of state.days.slice(state.firstPageDays)) for (const id of [...day.ids, ...day.folded]) {
      const held = state.posts.get(id);
      if (!held) continue;
      posts.set(id, held);
      for (const joined of held.joined) {
        const under = state.posts.get(joined);
        if (under) posts.set(joined, under);
      }
    }
  }
  for (const id of res.removed) posts.delete(id);
  for (const post of res.posts) posts.set(post.id, post);
  const older = state.days.slice(state.firstPageDays).filter((d) => !res.days.some((n) => n.day === d.day));
  return {
    view: res.view,
    version: res.version,
    posts,
    days: [...res.days, ...older],
    firstPageDays: res.days.length,
    cursor: older.length ? state.cursor : res.cursor,
    size: res.size,
    home: res.home,
    views: res.views,
  };
}

/** An older page, appended after the days already held. */
export function appendPage(state: FeedState, res: FeedResponse): FeedState {
  const posts = new Map(state.posts);
  for (const post of res.posts) posts.set(post.id, post);
  const seen = new Set(state.days.map((d) => d.day));
  return { ...state, posts, days: [...state.days, ...res.days.filter((d) => !seen.has(d.day))], cursor: res.cursor };
}

export function feedPath(view: FeedViewId, opts: { since?: number; cursor?: string | null } = {}): string {
  const params = new URLSearchParams({ view });
  if (opts.since !== undefined && opts.since >= 0) params.set("since", String(opts.since));
  if (opts.cursor) params.set("cursor", opts.cursor);
  return `/api/feed?${params.toString()}`;
}

/** The working day `ts` falls in, "2026-11-16": a day turns over at 4am local, as the engine's do. */
export function workingDay(ts: number): string {
  const d = new Date(ts - 4 * 3_600_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday", or nothing; the date always shows beside it. */
export function dayLabel(day: string, now: number): string {
  if (day === workingDay(now)) return "Today";
  if (day === workingDay(now - 86_400_000)) return "Yesterday";
  return "";
}

export function dayDate(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d, 12).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/**
 * What a post shows first: the engine's lead, or, when that is only words, the screenshot its pull request shows
 * (`picture`). Home's rows already lead with that screenshot; the stream leads with it too, so a change that was
 * captured is seen, not read about. The post's kind still comes from the engine's lead (postKind).
 */
export function shownLead(post: Pick<FeedPostHead, "lead" | "picture">): FeedLead {
  if (post.lead.kind !== "text" || !post.picture) return post.lead;
  const name = post.picture.alt || "Screenshot";
  return { kind: "visual", ref: { asset: post.picture.src, name, caption: post.picture.alt || null, source: "pull" } };
}

/** A post's lead takes the large slot when it is something to look at. */
export function hasLargeLead(post: Pick<FeedPostHead, "lead" | "picture">): boolean {
  return shownLead(post).kind !== "text";
}

/**
 * A day's shown and folded posts once some are hidden (placed elsewhere on
 * Home, or moved by the operator). The day keeps as many shown posts as it
 * chose: each hidden one is replaced by the newest folded post, so a
 * placement never leaves the day as one post over a long fold.
 */
export function refillDay<T extends { id: string; at: number }>(chosen: readonly string[], folded: readonly string[], hidden: ReadonlySet<string>, post: (id: string) => T | undefined): { shown: T[]; folded: T[] } {
  const keep = (ids: readonly string[]) => ids.filter((id) => !hidden.has(id)).map(post).filter((p): p is T => Boolean(p));
  const shown = keep(chosen);
  const rest = keep(folded).sort((a, b) => b.at - a.at);
  const room = Math.max(0, chosen.length - shown.length);
  const lifted = rest.slice(0, room);
  return { shown: [...shown, ...lifted].sort((a, b) => b.at - a.at), folded: rest.slice(room) };
}
