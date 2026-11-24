import type { FeedPostHead } from "../../../shared/api/feed.ts";
import { discussionTarget, recordedSession } from "../../lib/post-record-routes.ts";
import { RouteLink, type Navigate } from "./post-parts.tsx";

export function ReadOnlyPostActions({ post, navigate }: { post: FeedPostHead; navigate: Navigate }) {
  const session = recordedSession(post);
  const route = discussionTarget(post) ?? (session ? { view: "sessions" as const, sessionId: session } : null);
  return route ? <div className="pa-strip"><div className="pa-row">
    <RouteLink className="pa-act" route={route} navigate={navigate}>{route.view === "conversation" ? "Open in Chat" : "Open session"}</RouteLink>
  </div></div> : null;
}
