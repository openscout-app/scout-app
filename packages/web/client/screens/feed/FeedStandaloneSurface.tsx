import { navigateBrowser, useBrowserLocation } from "../../lib/browser-location.ts";
import { routePath } from "../../lib/router.ts";
import {
  StandaloneConversationExchange,
  StandaloneSessionDetail,
} from "../../shell/StandaloneRecordViews.tsx";
import { FeedStream } from "./FeedContent.tsx";

export function FeedStandaloneSurface({
  navigate = navigateBrowser,
}: {
  navigate?: (href: string) => void;
}) {
  const { pathname, searchStr } = useBrowserLocation();
  const params = new URLSearchParams(searchStr);
  const chatMatch = /^\/c\/([^/]+)$/.exec(pathname);
  const sessionMatch = /^\/sessions\/([^/]+)$/.exec(pathname);

  if (chatMatch?.[1]) {
    return (
      <StandaloneConversationExchange
        conversationId={decodeURIComponent(chatMatch[1])}
        workId={params.get("workId")}
        backLabel="Feed"
        rail="reading"
        onBack={() => navigate("/")}
      />
    );
  }

  if (sessionMatch?.[1]) {
    return (
      <StandaloneSessionDetail
        sessionId={decodeURIComponent(sessionMatch[1])}
        backLabel="Feed"
        rail="reading"
        skeletonVariant="feed"
        onBack={() => navigate("/")}
      />
    );
  }

  return (
    <div className="s-feed-standalone s-surface-rail" data-rail="reading">
      <FeedStream
        layout="hosted"
        sources={null}
        expand={params.get("post") ?? undefined}
        navigate={(route) => navigate(routePath(route))}
      />
    </div>
  );
}
