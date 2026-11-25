/* Pure helpers for modality-aware compact rows and reading-safe live arrivals. */
import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { hasLargeLead, type FeedState } from "./feed-store.ts";

/** Scroll depth beyond which incoming posts wait behind an explicit pull-in control. */
export const ARRIVAL_QUEUE_SCROLL_PX = 120;

/** How long a post keeps its quiet arrival settle treatment. */
export const ARRIVAL_HIGHLIGHT_MS = 2_400;

export type SmallModality = "decision" | "code" | "visual" | "page" | "milestone" | "note";

export function isWaitingOnYou(post: Pick<FeedPostHead, "forYou" | "settled">): boolean {
  return Boolean(post.forYou && !post.settled);
}

/** Classifies the strongest compact-row treatment without inventing content. */
export function smallModalityOf(
  post: Pick<FeedPostHead, "forYou" | "settled" | "lead" | "picture" | "prs" | "change" | "agentPost">,
): SmallModality {
  if (isWaitingOnYou(post)) return "decision";
  if (post.lead.kind === "page") return "page";
  if (hasLargeLead(post) || Boolean(post.picture)) return "visual";
  if (post.prs.length > 0 || post.change != null) return "code";
  if (post.agentPost?.milestone) return "milestone";
  return "note";
}

export function shouldQueueArrival(scrollTop: number): boolean {
  return scrollTop >= ARRIVAL_QUEUE_SCROLL_PX;
}

/** IDs present in the next state but not the reader's current state, newest first. */
export function diffNewPostIds(seenIds: ReadonlySet<string>, next: Pick<FeedState, "posts">): string[] {
  const arrived: FeedPostHead[] = [];
  for (const post of next.posts.values()) {
    if (!seenIds.has(post.id)) arrived.push(post);
  }
  arrived.sort((a, b) => b.at - a.at);
  return arrived.map((post) => post.id);
}

/** A compact, bounded description of queued posts, such as “3 new · 1 waiting, 1 PR”. */
export function pendingArrivalSummary(posts: readonly FeedPostHead[]): string {
  if (posts.length === 0) return "";
  const waiting = posts.filter(isWaitingOnYou).length;
  const prs = posts.filter((post) => !isWaitingOnYou(post) && post.prs.length > 0).length;
  const visuals = posts.filter((post) => !isWaitingOnYou(post) && (hasLargeLead(post) || Boolean(post.picture))).length;
  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (prs > 0) parts.push(prs === 1 ? "1 PR" : `${prs} PRs`);
  if (visuals > 0 && parts.length < 2) parts.push(visuals === 1 ? "1 visual" : `${visuals} visuals`);
  return `${posts.length} new${parts.length ? ` · ${parts.join(", ")}` : ""}`;
}
