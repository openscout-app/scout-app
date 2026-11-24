import { useEffect, useState } from "react";
import type { DiscussionMessage } from "../../shared/api/feed-discussion.ts";
import { api } from "../lib/api.ts";
import type { ObserveData } from "../lib/types.ts";
import { onAppLinkClick } from "./navigation.ts";

function useRead<T>(path: string) {
  const [state, set] = useState<{ path: string; data?: T; error?: string }>({ path });
  useEffect(() => {
    const controller = new AbortController();
    set({ path });
    api<T>(path, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) set({ path, data }); },
      err => { if (!controller.signal.aborted) set({ path, error: err instanceof Error ? err.message : "Local read failed." }); },
    );
    return () => controller.abort();
  }, [path]);
  return state.path === path ? state : { path };
}

const back = <a className="record-back" href="/feed" onClick={onAppLinkClick}>← Feed</a>;

/** The recorded exchange behind a Feed item. It follows the work id, so a newer message does not replace it. */
export function RecordedChat({ id, workId }: { id: string; workId: string | null }) {
  const q = new URLSearchParams({ conversationId: id });
  if (workId) q.set("workId", workId);
  const { data, error } = useRead<DiscussionMessage[]>("/api/messages?" + q);
  return <section className="record">{back}<h1>Chat</h1>
    <p className="context">{workId ? "The recorded exchange for this Feed item." : "Messages in this conversation."}</p>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Reading messages…</p> : data.length ? <ol>{data.map(m => (
      <li key={m.id} data-message-id={m.id}><header><strong>{m.actorName || m.actorId}</strong>
        <time dateTime={new Date(m.createdAt).toISOString()}>{new Date(m.createdAt).toLocaleString()}</time></header><p>{m.body}</p></li>
    ))}</ol> : <p>No messages in this conversation.</p>}
  </section>;
}

/** The harness session a standalone Feed item names. */
export function RecordedSession({ id }: { id: string }) {
  const { data, error } = useRead<{ observe: { data: ObserveData } }>("/api/session-ref/" + encodeURIComponent(id));
  return <section className="record">{back}<h1>Session</h1>
    {error ? <p role="alert">{error}</p> : !data ? <p role="status">Reading session…</p> :
      <ol>{data.observe.data.events.map(e => <li key={e.id}><strong>{e.kind}</strong><p>{e.text}</p></li>)}</ol>}
  </section>;
}
