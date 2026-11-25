import type { FeedPostHead } from "../../shared/api/feed.ts";
import type { Route } from "./types.ts";

/** Work IDs, conversation IDs and native session IDs are opaque. A later chat
 * message or the owner's current session does not identify this turn. */
export function discussionTarget(post: FeedPostHead): Extract<Route, { view: "conversation" }> | null {
  return post.conversationId && post.workId
    ? { view: "conversation", conversationId: post.conversationId, workId: post.workId } : null;
}
export function recordedSession(post: FeedPostHead): string | null {
  const id = post.owner.sessionId;
  return id && post.agent.harness ? `session:${post.agent.harness}:${id}` : null;
}
