import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import { navigateBrowser, useBrowserLocation } from "../../lib/browser-location.ts";
import { routePath } from "../../lib/router.ts";
import type { ObserveData } from "../../lib/types.ts";
import { ScoutPageSkeleton } from "../../shell/ScoutPageSkeleton.tsx";
import { ObservedThread } from "../sessions/ObservedThread.tsx";
import { FeedStream } from "./FeedContent.tsx";

interface DiscussionMessage {
  id: string;
  actorId: string;
  actorName?: string | null;
  body: string;
  createdAt: number;
}

function ConversationExchangeView({
  conversationId,
  workId,
  onBack,
}: {
  conversationId: string;
  workId: string | null;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<DiscussionMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ conversationId });
    if (workId) params.set("workId", workId);
    api<DiscussionMessage[]>(`/api/messages?${params}`, { signal: controller.signal })
      .then((res) => {
        if (!controller.signal.aborted) setMessages(res);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Could not read conversation.");
        }
      });
    return () => controller.abort();
  }, [conversationId, workId]);

  return (
    <div className="s-standalone-record s-surface-rail" data-rail="reading">
      <div className="s-standalone-record-head">
        <button type="button" className="s-standalone-back" onClick={onBack}>
          ← Feed
        </button>
        <span className="s-standalone-meta">
          {workId ? "Recorded exchange for this Feed item" : "Conversation messages"}
        </span>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !messages ? (
        <ScoutPageSkeleton variant="feed" inline label="Loading messages" />
      ) : messages.length === 0 ? (
        <p>No messages recorded in this conversation.</p>
      ) : (
        <div className="fd-exchangeList">
          {messages.map((msg) => (
            <article key={msg.id} className="fd-exchangeMessage">
              <header className="fd-exchangeHead">
                <strong>{msg.actorName || msg.actorId}</strong>
                <time dateTime={new Date(msg.createdAt).toISOString()}>
                  {new Date(msg.createdAt).toLocaleString()}
                </time>
              </header>
              <div className="fd-exchangeBody">{msg.body}</div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function FeedSessionView({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<ObserveData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<{ observe?: { data?: ObserveData }; data?: ObserveData }>(
      `/api/session-ref/${encodeURIComponent(sessionId)}`,
      { signal: controller.signal },
    )
      .then((res) => {
        if (controller.signal.aborted) return;
        const resolved = res.observe?.data ?? res.data ?? null;
        if (!resolved) setError("No session transcript available.");
        else setData(resolved);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Could not read session.");
        }
      });
    return () => controller.abort();
  }, [sessionId]);

  return (
    <div className="s-standalone-record s-surface-rail" data-rail="reading">
      <div className="s-standalone-record-head">
        <button type="button" className="s-standalone-back" onClick={onBack}>
          ← Feed
        </button>
        <span className="s-standalone-meta">Session {sessionId.slice(0, 12)}</span>
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : !data ? (
        <ScoutPageSkeleton variant="feed" inline label="Loading session" />
      ) : (
        <ObservedThread data={data} working={false} timestamped />
      )}
    </div>
  );
}

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
      <ConversationExchangeView
        conversationId={decodeURIComponent(chatMatch[1])}
        workId={params.get("workId")}
        onBack={() => navigate("/")}
      />
    );
  }

  if (sessionMatch?.[1]) {
    return (
      <FeedSessionView
        sessionId={decodeURIComponent(sessionMatch[1])}
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
