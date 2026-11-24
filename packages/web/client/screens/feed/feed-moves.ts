/*
 * The operator's latest move on a post, kept by the web server so the post
 * says what was last done on it after a reload, a restart or a rebuilt Feed
 * (POST /api/feed/moves in hosts that support writes).
 *
 * Called once a move went through: the reply, reaction, decision or
 * follow-up already reached the runtime, or the question reached Scoutbot.
 * A receipt that does not reach the server costs only the line on the post,
 * never the move, so a failure is not shown.
 */
import { api } from "../../lib/api.ts";
import { refreshPage } from "../../lib/page-refresh.ts";
import type { FeedMoveKind } from "../../../shared/api/feed-moves.ts";

export function recordMove(postId: string | null | undefined, kind: FeedMoveKind, label = ""): void {
  if (!postId) return;
  void api("/api/feed/moves", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: postId, kind, label }),
  })
    .then(() => refreshPage())
    .catch(() => undefined);
}
