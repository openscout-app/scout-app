/*
 * Pure attention, chatter-folding, and format-native grouping helpers for the Feed stream.
 * Separates confirmed operator-waiting work, visual/substantive results, native GitHub
 * catch-up digests, and routine chatter without mutating server ranking or inventing records.
 */
import type { FeedChange, FeedPostHead, FeedPr } from "../../../shared/api/feed.ts";
import { hasLargeLead, type FeedState } from "./feed-store.ts";

const REASON_RANK: Record<NonNullable<FeedPostHead["forYou"]>["reason"], number> = {
  attention: 0,
  draft: 1,
  local_branch: 2,
};

const CHATTER_PREFIX = /^(?:i['’]ll\s+(?:inspect|check|look|review|take a look|verify|run|fix|update|handle|investigate)|checking\b|inspecting\b|looking into\b|on it\b|will (?:check|inspect|look|review)|updated (?:pr|pull request)\b|pushed (?:commit|fix|changes|update)\b|rebased\b|merged (?:pr|pull request)\b)/i;

/** True when the post carries an active, unsettled handback to the operator. */
export function isWaitingOnYou(post: Pick<FeedPostHead, "forYou" | "settled">): boolean {
  return Boolean(post.forYou && !post.settled);
}

/** Human-readable wait reason for a waiting post, falling back to its kind when label is blank. */
export function waitingReasonLabel(post: Pick<FeedPostHead, "forYou">): string {
  const label = post.forYou?.label?.trim();
  if (label) return label;
  switch (post.forYou?.reason) {
    case "attention": return "Needs your decision";
    case "draft": return "Draft pull request";
    case "local_branch": return "Unmerged branch";
    default: return "Waiting on you";
  }
}

/**
 * What is being decided, in the request's own words, when they say more than the post's title: the question an
 * agent put to the operator, or the work item handed back for review. Null when the title already says it.
 */
export function waitingDetail(post: Pick<FeedPostHead, "forYou" | "settled" | "title" | "agent">): string | null {
  if (!isWaitingOnYou(post)) return null;
  const detail = post.forYou?.detail?.replace(/\s+/g, " ").trim();
  if (!detail) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // A broker status repeats the badge; it isn't an instruction from the agent.
  const status = /^(?:(.*?)\s+)?(?:is ready|(?:is )?waiting on you)[.!]?$/i.exec(detail);
  if (status) {
    const subject = status[1] ?? "";
    if (!subject || /^session\s+\S+(?:\s+\S+)?$/i.test(subject)
      || /^(?:\[[\w.-]+\]|[\w.-]+)$/.test(subject)
      || norm(subject) === norm(post.agent.name)) return null;
  }
  const title = norm(post.title);
  const words = norm(detail);
  if (!words || words === title || title.includes(words) || (title.length > 24 && words.startsWith(title))) return null;
  return detail;
}

/** The title the server writes for a turn with no recorded outcome (server feed/post.ts). */
export const NO_OUTCOME = "No outcome recorded";

const sameWords = (a: string | null | undefined, b: string | null | undefined) => {
  const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return norm(a) !== "" && norm(a) === norm(b);
};

/**
 * A post's words and its distinct operator prompt: keep the outcome unless it is the
 * no-outcome placeholder, then the ask unless it repeats the request. A post with no decision keeps its words.
 */
export function decisionWords(post: Pick<FeedPostHead, "forYou" | "settled" | "title" | "caption" | "agent">): {
  decision: string | null;
  title: string | null;
  caption: string | null;
} {
  const decision = waitingDetail(post);
  if (!decision) return { decision: null, title: post.title, caption: post.caption };
  return {
    decision,
    title: sameWords(post.title, NO_OUTCOME) ? null : post.title,
    caption: sameWords(post.caption, decision) || sameWords(post.caption, post.title) ? null : post.caption,
  };
}

/** True when a post is low-signal status/intent chatter with no artifact, PR, decision, or milestone. */
export function isChatterPost(post: Pick<FeedPostHead, "title" | "lead" | "picture" | "prs" | "forYou" | "settled" | "agentPost">): boolean {
  if (isWaitingOnYou(post) || hasLargeLead(post) || post.prs.length > 0 || post.agentPost?.milestone) return false;
  return CHATTER_PREFIX.test(post.title.trim());
}

/**
 * True when a post shows something made: a picture, film, running output or page, a pull request, a measured
 * change, or an agent's milestone. A finished turn with only words is not a result, whatever its class: a runtime
 * can class every done turn "landed", which made Results most of the Feed.
 */
export function isVisualOrShippedResult(post: Pick<FeedPostHead, "lead" | "picture" | "prs" | "change" | "agentPost">): boolean {
  return (
    hasLargeLead(post)
    || post.prs.length > 0
    || post.change != null
    || Boolean(post.agentPost?.milestone)
  );
}

/** True when a post is a code/PR update (no visual lead or active decision) that belongs in the native GitHub catch-up card. */
export function isGitHubCatchUpCandidate(post: Pick<FeedPostHead, "lead" | "picture" | "prs" | "forYou" | "settled">): boolean {
  return post.prs.length > 0 && !hasLargeLead(post) && !isWaitingOnYou(post);
}

export type GitHubCatchUpRow = {
  pr: FeedPr;
  post: FeedPostHead;
  change: FeedChange | null;
  updates: number;
};

export type GitHubCatchUpSummary = {
  rows: GitHubCatchUpRow[];
  counts: { merged: number; open: number; draft: number; closed: number };
  additions: number;
  deletions: number;
};

/**
 * Partition a day's shown + folded posts into:
 * - `github`: deduplicated native GitHub catch-up rows (one row per PR, newest post wins)
 * - `featured`: visual, milestone, and substantive non-chatter posts
 * - `folded`: remaining updates plus demoted status chatter
 */
export function partitionDayPosts(shown: readonly FeedPostHead[], folded: readonly FeedPostHead[]): {
  github: GitHubCatchUpSummary;
  featured: FeedPostHead[];
  folded: FeedPostHead[];
} {
  const byPr = new Map<string, GitHubCatchUpRow>();
  const githubPostIds = new Set<string>();

  for (const post of [...shown, ...folded]) {
    if (!isGitHubCatchUpCandidate(post)) continue;
    githubPostIds.add(post.id);
    const pr = post.prs[0]!;
    const existing = byPr.get(pr.key);
    if (!existing) {
      byPr.set(pr.key, { pr, post, change: post.change, updates: 1 });
    } else {
      const newer = post.at >= existing.post.at;
      byPr.set(pr.key, {
        pr: newer ? pr : existing.pr,
        post: newer ? post : existing.post,
        change: (newer ? post.change : existing.change) ?? existing.change ?? post.change,
        updates: existing.updates + 1,
      });
    }
  }

  const stateOrder: Record<FeedPr["state"], number> = { open: 0, draft: 1, merged: 2, closed: 3 };
  const rows = [...byPr.values()].sort((a, b) => {
    const s = stateOrder[a.pr.state] - stateOrder[b.pr.state];
    return s !== 0 ? s : b.post.at - a.post.at;
  });

  const counts = { merged: 0, open: 0, draft: 0, closed: 0 };
  let additions = 0;
  let deletions = 0;
  for (const row of rows) {
    counts[row.pr.state] += 1;
    if (row.change?.additions) additions += row.change.additions;
    if (row.change?.deletions) deletions += row.change.deletions;
  }

  const featured: FeedPostHead[] = [];
  const nextFolded: FeedPostHead[] = [];
  for (const post of shown) {
    if (githubPostIds.has(post.id)) continue;
    if (isChatterPost(post)) nextFolded.push(post);
    else featured.push(post);
  }
  for (const post of folded) {
    if (githubPostIds.has(post.id)) continue;
    nextFolded.push(post);
  }

  return { github: { rows, counts, additions, deletions }, featured, folded: nextFolded };
}

/**
 * Collect every active waiting post across all loaded days (including folded ones so
 * an operator decision never hides behind a day fold). Confirmed attention requests
 * sort ahead of drafts/local branches, oldest first within each tier.
 */
export function collectWaitingPosts(feed: Pick<FeedState, "days" | "posts">, hidden: ReadonlySet<string>): FeedPostHead[] {
  const seen = new Set<string>();
  const out: FeedPostHead[] = [];
  for (const day of feed.days) {
    for (const id of [...day.ids, ...day.folded]) {
      if (seen.has(id) || hidden.has(id)) continue;
      seen.add(id);
      const post = feed.posts.get(id);
      if (post && isWaitingOnYou(post)) out.push(post);
    }
  }
  return out.sort((a, b) => {
    const rankDiff = REASON_RANK[a.forYou!.reason] - REASON_RANK[b.forYou!.reason];
    return rankDiff !== 0 ? rankDiff : a.at - b.at;
  });
}

/** Concise inventory for a closed day fold: "2 results · 6 updates", "3 results", or "5 updates". */
export function foldInventoryLabel(posts: readonly FeedPostHead[]): string {
  let results = 0;
  for (const post of posts) {
    if (isVisualOrShippedResult(post)) results += 1;
  }
  const updates = posts.length - results;
  if (results > 0 && updates > 0) {
    return `${results} ${results === 1 ? "result" : "results"} · ${updates} ${updates === 1 ? "update" : "updates"}`;
  }
  if (results > 0) return `${results} ${results === 1 ? "result" : "results"}`;
  return `${updates} ${updates === 1 ? "update" : "updates"}`;
}
