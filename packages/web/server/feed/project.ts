/** Write-side rules. One stable slot per session, one per unlinked work item,
 * and separate slots for agent publications no finished task covers. */
import type { WebFeedPull, WebFeedTask } from "../../shared/api/feed.ts";
import type { FeedHide } from "../../shared/api/feed-hides.ts";
import type { FeedMove } from "../../shared/api/feed-moves.ts";
import { hostKey, linkContext, slotId } from "./links.ts";
import type { FeedAttention, PostContext } from "./post.ts";

export type FeedContext = {
  pulls: readonly WebFeedPull[];
  repos: Readonly<Record<string, string>>;
  attention: readonly FeedAttention[];
  localBranches: readonly string[];
  /** What the operator hid: a covered thread leaves the projection until it has something newer. */
  hides: readonly FeedHide[];
  /** The latest move appears on each post. An answered turn leaves Back to you. */
  moves?: readonly FeedMove[];
};
export const emptyContext: FeedContext = { pulls: [], repos: {}, attention: [], localBranches: [], hides: [], moves: [] };

/**
 * One session, one session id. A session Scout starts records its routing id
 * on the first turn and the harness id on later ones, once Scout learns it; the
 * endpoint id names the routing id and stays the same. On such an endpoint,
 * turns with one unambiguous harness id share a thread, and
 * `aliases` names the routing ids each joined id took in: a move or hide made
 * on the post while it was keyed by the routing id still holds.
 *
 * An endpoint that names none of its session ids is an agent's, shared by
 * distinct sessions, and is left alone.
 */
export function joinPromotedSessions(tasks: WebFeedTask[]): { tasks: WebFeedTask[]; aliases: Map<string, string[]> } {
  const byEndpoint = new Map<string, WebFeedTask[]>();
  for (const t of tasks) {
    if (!t.endpointId || !t.sessionId) continue;
    const list = byEndpoint.get(t.endpointId);
    if (list) list.push(t);
    else byEndpoint.set(t.endpointId, [t]);
  }
  const canonical = new Map<string, string>();
  const aliases = new Map<string, string[]>();
  for (const [endpoint, turns] of byEndpoint) {
    const segments = new Set(endpoint.split("."));
    const ids = new Set(turns.map((t) => t.sessionId!));
    const routing = [...ids].filter((id) => segments.has(id));
    const native = [...ids].filter((id) => !segments.has(id));
    // An endpoint can be reused. Its identity alone cannot link two native sessions.
    if (routing.length !== 1 || native.length !== 1) continue;
    const session = native[0]!;
    canonical.set(endpoint, session);
    aliases.set(session, [...new Set([...(aliases.get(session) ?? []), routing[0]!])].sort());
  }
  if (!canonical.size) return { tasks, aliases };
  return {
    tasks: tasks.map((t) => {
      const id = t.endpointId && t.sessionId ? canonical.get(t.endpointId) : undefined;
      return id && id !== t.sessionId ? { ...t, sessionId: id } : t;
    }),
    aliases,
  };
}

export function projectThreads(originHost: string, rawTasks: WebFeedTask[], ctx: FeedContext) {
  const joined = joinPromotedSessions(rawTasks);
  const tasks = joined.tasks;
  /** A joined thread's post id, and the post ids its earlier session ids had. */
  const aliases = new Map<string, string[]>();
  for (const [session, earlier] of joined.aliases)
    aliases.set(hostKey(originHost, `thread:${session}`), earlier.map((id) => hostKey(originHost, `thread:${id}`)));
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
  return { threads, postContext, current, aliases };
}
