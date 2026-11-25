/*
 * Why a row in "Back to you" waits on you, read from records, never from
 * words: a short label before the title, what happens when you act, and the
 * row's place in the order.
 *
 *   question    a task or session asks you something (the runtime's queue,
 *               or a question on the thread)
 *   permission  a permission or approval request
 *   ready       a task you asked to hear about is done (core Ready):
 *               Continue or Hold, never an answer
 *   steer       the turn ended on work you asked for, nothing else open
 *   reply       a person wrote to you last on a Slack thread
 *   draft       the turn's pull request is a draft
 *   merge       the turn's pull request is open and not a draft
 *   push        the turn left a branch with no pull request
 *
 * When several apply, the one that blocks the agent wins: a question or a
 * permission is a row of its own and covers its thread's turn
 * (homeView, requestCovers). A finished turn has nothing blocking it, so its
 * open pull request or unpushed branch names the move; with neither, it is
 * a turn to steer.
 *
 * Pure.
 */
import type { FeedPostHead } from "../../../../shared/api/feed.ts";
import type { OperatorAttentionItem } from "../../../lib/types.ts";

export type HomeWhyKind = "question" | "permission" | "ready" | "steer" | "reply" | "draft" | "merge" | "push";

export type HomeWhy = {
  kind: HomeWhyKind;
  /** The label before the title. */
  label: string;
  /** What happens when you act, in a line. */
  then: string;
};

/** The order of the placement: what blocks an agent, then turns to steer, then people, then reviews, merges and pushes. */
export const WHY_ORDER: readonly HomeWhyKind[] = ["question", "permission", "ready", "steer", "reply", "draft", "merge", "push"];

export function whyRank(kind: HomeWhyKind): number {
  return WHY_ORDER.indexOf(kind);
}

/**
 * The label a row shows before its title, or null. A turn to steer is what
 * Back to you holds by default, so it goes unlabelled; every other reason
 * names a different move and keeps its label.
 */
export function shownLabel(why: Pick<HomeWhy, "kind" | "label">): string | null {
  return why.kind === "steer" ? null : why.label;
}

/** The steer field's placeholder: where the words go. */
export function steerHint(agent: string): string {
  return `Next turn for ${agent}`;
}

const LABEL: Record<HomeWhyKind, string> = {
  question: "Question to answer",
  permission: "Permission to grant",
  ready: "Ready",
  steer: "Turn to steer",
  reply: "Reply to send",
  draft: "Draft to review",
  merge: "Ready to merge",
  push: "Branch to push",
};

function why(kind: HomeWhyKind, then: string): HomeWhy {
  return { kind, label: LABEL[kind], then };
}

/** Whether a request asks to be allowed to do something, as the runtime records it. */
export function isPermissionRequest(item: Pick<OperatorAttentionItem, "kind" | "permission" | "approval" | "pane">): boolean {
  return item.kind === "approval" || item.kind === "configuration" || Boolean(item.permission || item.approval || item.pane?.prompt?.kind === "permission");
}

/** A request from the runtime's queue: a permission to grant, else a question to answer. */
export function requestWhy(item: OperatorAttentionItem): HomeWhy {
  const agent = item.agentName?.trim() || "The agent";
  // Ready is its own reason: the task is done, and nothing is being asked.
  if (item.kind === "ready" && item.ready) return why("ready", `Continue hands the next move back to ${agent}; Hold takes it off your list.`);
  return isPermissionRequest(item)
    ? why("permission", `${agent} goes ahead once you allow it.`)
    : why("question", `${agent} carries on with your answer.`);
}

/** A question on a thread the queue does not hold. */
export function questionWhy(post: FeedPostHead): HomeWhy {
  return why("question", `${post.agent.name?.trim() || "The agent"} carries on with your answer.`);
}

/** A Slack thread where someone waits on your reply. */
export function replyWhy(): HomeWhy {
  return why("reply", "Your reply goes to the thread.");
}

/** A finished turn: its open pull request or unpushed branch names the move; else it waits to be steered. */
export function turnWhy(post: FeedPostHead): HomeWhy {
  const agent = post.agent.name?.trim() || "the session";
  const draft = post.prs.find((p) => p.state === "draft");
  if (draft) return why("draft", `Your review goes back to ${agent}; ${draft.label} stays a draft until it is marked ready.`);
  const open = post.prs.find((p) => p.state === "open");
  if (open) return why("merge", `Merging lands ${open.label}.`);
  if (post.forYou?.reason === "local_branch") return why("push", `Pushing it lets ${agent} open a pull request.`);
  return why("steer", `What you send goes to ${agent} as its next turn.`);
}
