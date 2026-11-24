import { useEffect, useState, type ReactNode } from "react";
import type { DiscussionMessage } from "../shared/api/feed-discussion.ts";
import { api } from "./lib/api.ts";
import type { ObserveData } from "./lib/types.ts";

function useRead<T>(path: string) {
  const [state, set] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    api<T>(path, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) set({ data }); },
      err => { if (!controller.signal.aborted) set({ error: err instanceof Error ? err.message : "Local read failed." }); },
    );
    return () => controller.abort();
  }, [path]);
  return state;
}

function Chat({ id, workId }: { id: string; workId: string | null }) {
  const q = new URLSearchParams({ conversationId: id });
  if (workId) q.set("workId", workId);
  const { data, error } = useRead<DiscussionMessage[]>("/api/messages?" + q);
  return <section className="record"><a href="/embed/feed">← Feed</a><h1>Chat</h1>
    <p className="context">{workId ? "The recorded exchange for this Feed item." : "Messages in this conversation."}</p>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Reading messages…</p> : data.length ? <ol>{data.map(m => (
      <li key={m.id} data-message-id={m.id}><header><strong>{m.actorName || m.actorId}</strong>
        <time dateTime={new Date(m.createdAt).toISOString()}>{new Date(m.createdAt).toLocaleString()}</time></header><p>{m.body}</p></li>
    ))}</ol> : <p>No messages in this conversation.</p>}
  </section>;
}

function Session({ id }: { id: string }) {
  const { data, error } = useRead<{ observe: { data: ObserveData } }>("/api/session-ref/" + encodeURIComponent(id));
  return <section className="record"><a href="/embed/feed">← Feed</a><h1>Session</h1>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Reading session…</p> :
      <ol>{data.observe.data.events.map(e => <li key={e.id}><strong>{e.kind}</strong><p>{e.text}</p></li>)}</ol>}
  </section>;
}

/** Preview-only chrome and the recorded destinations for the Feed's links. */
export function PreviewShell({ url, children }: { url: URL; children: ReactNode }) {
  const match = /^\/(c|sessions)\/([^/]+)$/.exec(url.pathname);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const [dark, setDark] = useState(media.matches);
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return <div className="scout-feed-embed preview" data-scout-theme={dark ? "dark" : "light"}>
    <header className="mast"><a href="/embed/feed">Scout</a><span>App Preview</span><small>Local · Read only</small></header>
    <main>{match ? (match[1] === "c" ? <Chat id={decodeURIComponent(match[2]!)} workId={url.searchParams.get("workId")} /> :
      <Session id={decodeURIComponent(match[2]!)} />) :
      <><h1 className="feed-heading">Feed</h1>{children}</>}</main>
  </div>;
}
