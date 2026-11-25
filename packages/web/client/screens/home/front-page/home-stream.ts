/* ──────────────────────────────────────────────────────────────────────────
   Home is the Feed. Its three panes, placed by rule rather than by a fixed
   layout.

   Centre: the feed's stream (FeedStream), every post kind in its own
   presentation, in the engine's order by working day. Above it, placements.
   A thing earns a placement in the stream only when it asks something of
   you, so the habit is: open Scout, clear what waits on you, then read on.
   Anything that only informs goes to the right pane; everything else keeps
   its place in the feed, by day.

   The one placement today, "Back to you", at the top. Its rows come from:
     - Asks from the runtime's queue: an agent is blocked on you.
     - Questions on a thread the queue does not hold.
     - Slack threads where a person wrote to you last, or named you: someone
       waits on your reply, but no agent is blocked. At most three.
     - Finished turns: a session ended its turn on work you asked for and
       waits for your next move (FeedPostHead.backToYou). Led by what the
       turn produced; a pull request is one of its references. A turn you
       opened or steered from here leaves at once (back-to-you-seen.ts);
       the runtime drops it when you write on it or a new task starts.
   Each row says why it waits on you (home-why.ts), and that orders them:
   questions, permissions, turns to steer, replies, then drafts to review,
   pull requests to merge and branches to push. Within one, the newest
   first. A draft pull request or an unpushed branch is not a reason on its
   own: it shows here when its turn is back to you, else in the stream.

   Nothing shows twice: a post, thread or quota warning shown in any
   placement (Waiting on you, the quota warning, Waiting on others) is left
   out of the stream below.

   Right: what changes with the moment.
     - Providers and quota, always when the runtime reports any.
     - A quota warning, only while its crossing is under two days old.
     - This week by project, when there are posts in it.
     - Running now.
     - Threads waiting on the other side ("you wrote, no answer yet").

   Left: static anchors that never move (Search and the places), drawn by
   FrontPage.tsx; nothing here decides them.

   Pure: no DOM, no clock of its own.
   ────────────────────────────────────────────────────────────────────────── */

import type { FeedOutsideThread, FeedQuotaEvent } from "../../../../shared/api/feed-sources.ts";
import type { HomeForYou, HomeTurn } from "./front-page-model.ts";
import { replyWhy, whyRank, type HomeWhy } from "./home-why.ts";

export type HomeStreamItem = { id: string; at: number; why: HomeWhy } & (
  | { kind: "ask"; row: Extract<HomeForYou, { source: "request" }> }
  | { kind: "question"; row: Extract<HomeForYou, { source: "post" }> }
  | { kind: "outside"; thread: FeedOutsideThread }
  | { kind: "turn"; turn: HomeTurn }
);

export const HOME_OUTSIDE_LIMIT = 3;

/** The "Back to you" placement, in its order; empty when nothing is back. `seen` holds turn keys opened or steered from Home. */
export function homeWaiting(input: {
  forYou: readonly HomeForYou[];
  backToYou?: readonly HomeTurn[];
  outside: readonly FeedOutsideThread[];
  seen?: ReadonlySet<string>;
}): HomeStreamItem[] {
  const asks: HomeStreamItem[] = input.forYou.flatMap((row) => (row.source === "request" ? [{ kind: "ask" as const, id: row.id, at: row.at, why: row.why, row }] : []));
  const questions = input.forYou.flatMap((row) => (row.source === "post" && row.reason.reason === "attention" ? [{ kind: "question" as const, id: row.id, at: row.at, why: row.why, row }] : []));
  const outside: HomeStreamItem[] = input.outside.filter((t) => t.waiting === "you").sort((a, b) => b.at - a.at).slice(0, HOME_OUTSIDE_LIMIT)
    .map((thread) => ({ kind: "outside" as const, id: thread.id, at: thread.at, why: replyWhy(), thread }));
  const shown = new Set(questions.map((q) => q.id));
  const turns: HomeStreamItem[] = (input.backToYou ?? [])
    .filter((turn) => !shown.has(turn.id) && !input.seen?.has(turn.turnKey))
    .map((turn) => ({ kind: "turn" as const, id: turn.id, at: turn.at, why: turn.why, turn }));
  return [...asks, ...questions, ...outside, ...turns].sort((a, b) => whyRank(a.why.kind) - whyRank(b.why.kind) || b.at - a.at);
}

export type HomeContext = {
  /** A provider window that passed the line in the last two days, newest first. */
  quota: FeedQuotaEvent | null;
  /** Threads where you wrote last and nobody has answered, newest first. */
  waitingOnThem: FeedOutsideThread[];
};

export function homeContext(input: { quota: readonly FeedQuotaEvent[]; outside: readonly FeedOutsideThread[]; nowMs: number }): HomeContext {
  // A warning is Home's only while its window is open; once the window resets it is history, and stays in the Feed.
  const quota = [...input.quota].sort((a, b) => b.crossedAt - a.crossedAt).find((e) => e.resetAt > input.nowMs) ?? null;
  const waitingOnThem = input.outside.filter((t) => t.waiting === "them").sort((a, b) => b.at - a.at).slice(0, HOME_OUTSIDE_LIMIT);
  return { quota, waitingOnThem };
}

/** Every post, thread and quota warning a placement shows, for the stream to leave out. Asks are not stream posts. */
export function placedIds(waiting: readonly HomeStreamItem[], context?: HomeContext): Set<string> {
  const ids = waiting.filter((i) => i.kind !== "ask").map((i) => i.id);
  if (context?.quota) ids.push(context.quota.id);
  for (const t of context?.waitingOnThem ?? []) ids.push(t.id);
  return new Set(ids);
}
