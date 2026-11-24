import type { Route } from "./types.ts";

/** The full app owns navigation; keep real hrefs for copying and modified clicks. */
export function routePath(route: Route): string {
  switch (route.view) {
    case "feed": return "/feed";
    case "inbox": return `/?${new URLSearchParams({ post: route.post })}`;
    case "sessions": return `/sessions/${encodeURIComponent(route.sessionId)}`;
    case "conversation": return `/c/${encodeURIComponent(route.conversationId)}${route.workId ? "?" + new URLSearchParams({ workId: route.workId }) : ""}`;
    case "work": return `/work/${encodeURIComponent(route.workId)}`;
  }
}
