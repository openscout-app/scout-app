/** The writer's row shapes. Details and evidence stay off the list path. */
import type { FeedLiveSession, FeedPostHead, WebFeedTask } from "../../shared/api/feed.ts";
import { answersTurn, type FeedMove } from "../../shared/api/feed-moves.ts";
import { dayKey } from "./days.ts";
import { leadFiles } from "./leads.ts";
import { hostKey, taskBranch, taskPulls, taskRepo } from "./links.ts";
import { buildPost, type PostContext } from "./post.ts";
import { agentOf, feedLine, firstSentence, taskTitle } from "./text.ts";

export type Slot = {
  id: string;
  kind: "result" | "pr" | "visual" | "film" | "page" | "running" | "waits" | "post" | "quota";
  placement: "stream" | "back_to_you" | "landed" | "for_you";
  state: string;
  title: string;
  caption: string | null;
  refs: string;
  at: number;
  day: string;
  reviewed: number;
  candidate: string | null;
  head: string;
  detail: string | null;
  files: string | null;
};
const channel = {
  placement: "stream",
  reviewed: 0,
  candidate: null,
  detail: null,
  files: null,
} as const;
const json = JSON.stringify;

export function runningSlot(originHost: string, t: WebFeedTask, postId: string | null): Slot {
  const title = taskTitle(feedLine(t.title)),
    snippet = firstSentence(t.reply),
    at = Math.max(t.updatedAt, t.finishedAt);
  const live: Omit<FeedLiveSession, "version"> = { workId: t.id, postId, title, agent: agentOf(t), snippet, at };
  return {
    ...channel,
    id: hostKey(originHost, "running:" + t.id),
    kind: "running",
    state: "working",
    title,
    caption: snippet,
    at,
    day: dayKey(at),
    refs: "[]",
    head: json(live),
  };
}

/** Only facts that can affect this thread. A change elsewhere doesn't rewrite its words. */
export function threadSignature(thread: WebFeedTask[], ctx: PostContext, current: (t: WebFeedTask) => boolean, move: FeedMove | null = null) {
  const inputs = thread.map((t) => {
    const repo = taskRepo(t, ctx.repos),
      branch = taskBranch(t, ctx.repos);
    return [
      t,
      current(t),
      repo,
      branch,
      ctx.localBranches.has(`${repo}:${branch}`),
      ctx.attentionByKey.get("work:" + t.id),
      taskPulls(t, ctx).map((k) => ctx.pulls.get(k)),
    ];
  });
  return Bun.hash(json(move ? [ctx.mainRepo, inputs, move] : [ctx.mainRepo, inputs])).toString(16);
}

function kindOf(h: Omit<FeedPostHead, "version" | "selected">): Slot["kind"] {
  if (h.class === "for_you") return "waits";
  if (h.agentPost?.own) return "post";
  if (h.lead.kind === "video") return "film";
  if (h.lead.kind === "visual" || h.lead.kind === "page") return h.lead.kind;
  return h.prs.length ? "pr" : "result";
}

export function finishedSlot(
  thread: WebFeedTask[],
  ctx: PostContext,
  current: (t: WebFeedTask) => boolean,
  move: FeedMove | null = null,
) {
  const post = buildPost(thread, ctx)!; // caller has at least one finished turn
  const task = thread.find((t) => t.id === post.leadTask)!;
  const h = post.head;
  if (!current(task)) {
    h.backToYou = false;
    h.settled = null;
  }
  // The operator's latest move from the Feed or Home: the post says it, and a turn it answered no longer waits.
  if (move) h.move = move;
  if (answersTurn(move, h.at)) {
    h.backToYou = false;
    h.reviewed = true;
  }
  const { title, caption, id, at, day, prs, backToYou, ...head } = h;
  const placement =
    h.class === "for_you"
      ? "for_you"
      : backToYou
        ? "back_to_you"
        : h.settled?.state === "merged"
          ? "landed"
          : "stream";
  const row: Slot = {
    id,
    kind: kindOf(h),
    placement,
    state: h.settled?.state ?? h.state,
    title,
    caption,
    at,
    day,
    refs: json(prs),
    reviewed: Number(h.reviewed),
    candidate: json(post.candidate),
    head: json(head),
    detail: json(post.detail),
    files: json(Object.fromEntries(leadFiles(task))),
  };
  return row;
}
