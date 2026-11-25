/** Write-side rules. One stable slot per session, one per unlinked work item,
 * and separate slots for agent publications no finished task covers. */
import type { WebFeedPull, WebFeedTask } from "../../shared/api/feed.ts";
import type { FeedHide } from "../../shared/api/feed-hides.ts";
import type { FeedMove } from "../../shared/api/feed-moves.ts";
import { linkContext, slotId } from "./links.ts";
import type { FeedAttention, PostContext } from "./post.ts";

export type FeedContext = {
  pulls: readonly WebFeedPull[];
  repos: Readonly<Record<string, string>>;
  attention: readonly FeedAttention[];
  localBranches: readonly string[];
  /** What the operator hid (server/feed/hides.ts): a thread it covers leaves the projection until it has something newer. */
  hides: readonly FeedHide[];
  /** The operator's latest move on each post (server/feed/moves.ts): the post shows it, and an answered turn leaves Back to you. */
  moves?: readonly FeedMove[];
};
export const emptyContext: FeedContext = { pulls: [], repos: {}, attention: [], localBranches: [], hides: [], moves: [] };

export function projectThreads(originHost: string, tasks: WebFeedTask[], ctx: FeedContext) {
  const threads = new Map<string, WebFeedTask[]>();
  const lastInChat = new Map<string, WebFeedTask>();
  const lastUnlinked = new Map<string, WebFeedTask>();
  const runningChats = new Set<string>(),
    unlinkedRunning = new Set<string>();
  const chatOf = (t: WebFeedTask) => (t.ownerId && t.conversationId ? JSON.stringify([t.ownerId, t.conversationId]) : null);
  for (const t of tasks) {
    const key = slotId(originHost, t);
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key)!.push(t);
    const chat = chatOf(t);
    if (chat && t.state === "working") {
      runningChats.add(chat);
      if (!t.sessionId) unlinkedRunning.add(chat);
    } else if (chat && !t.sessionId) {
      const prior = lastUnlinked.get(chat);
      if (!prior || t.finishedAt > prior.finishedAt || (t.finishedAt === prior.finishedAt && t.id < prior.id))
        lastUnlinked.set(chat, t);
    }
    const prior = t.conversationId && lastInChat.get(t.conversationId);
    if (t.conversationId && (!prior || t.createdAt > prior.createdAt || (t.createdAt === prior.createdAt && t.id < prior.id)))
      lastInChat.set(t.conversationId, t);
  }

  const attentionByKey = new Map<string, FeedAttention>();
  for (const a of ctx.attention) {
    const work = a.workId ?? (a.conversationId && lastInChat.get(a.conversationId)?.id);
    if (work && !attentionByKey.has(`work:${work}`)) attentionByKey.set(`work:${work}`, a);
  }
  const counts = new Map<string, number>();
  for (const p of ctx.pulls) counts.set(p.repo, (counts.get(p.repo) ?? 0) + 1);
  const mainRepo = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  const postContext: PostContext = {
    originHost,
    ...linkContext(ctx.pulls, ctx.repos),
    attentionByKey,
    mainRepo,
    localBranches: new Set(ctx.localBranches),
  };
  function current(task: WebFeedTask) {
    const chat = chatOf(task);
    return (
      !chat || (task.sessionId ? !unlinkedRunning.has(chat) : !runningChats.has(chat) && lastUnlinked.get(chat)?.id === task.id)
    );
  }
  return { threads, postContext, current };
}
