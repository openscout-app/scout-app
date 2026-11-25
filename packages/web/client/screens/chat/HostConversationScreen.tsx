import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { friendlyApiError } from "../../lib/api-errors.ts";
import { hostApiPath, hostChatUrl } from "../../lib/chat-host.ts";
import { conversationDisplayTitle } from "../../lib/conversations.ts";
import { peerHostById } from "../../lib/host-conversations.ts";
import { MessageMarkup } from "../../lib/message-markup.tsx";
import { formatAbsoluteTimestamp, normalizeTimestampMs, timeAgo } from "../../lib/time.ts";
import type { Message } from "../../lib/types.ts";
import { useConversationList } from "../../lib/use-conversation-list.ts";
import "./host-conversation.css";

const PAGE = 200;
const POLL_MS = 15_000;

/**
 * A chat that lives on another host, read through the host proxy. It is
 * read-only here: replies go from that host's own page.
 */
export function HostConversationScreen({
  conversationId,
  machineId,
  hostName,
}: {
  conversationId: string;
  machineId: string;
  hostName: string;
}) {
  const { sessions } = useConversationList();
  const row = useMemo(() => sessions.find((s) => s.id === conversationId), [sessions, conversationId]);
  const peer = peerHostById(machineId);
  const openUrl = peer ? hostChatUrl(peer.machine, conversationId) : null;
  const title = row ? conversationDisplayTitle(row) : conversationId;

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const pinnedToEnd = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const query = new URLSearchParams({ conversationId, limit: String(PAGE) });
        const rows = await api<Message[]>(hostApiPath(machineId, `/api/messages?${query}`));
        if (cancelled) return;
        const list = Array.isArray(rows) ? [...rows] : [];
        list.sort((a, b) => (normalizeTimestampMs(a.createdAt) ?? 0) - (normalizeTimestampMs(b.createdAt) ?? 0));
        setMessages(list);
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(friendlyApiError(cause));
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId, machineId]);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed && pinnedToEnd.current) feed.scrollTop = feed.scrollHeight;
  }, [messages]);

  return (
    <div className="s-thread-layout host-conv">
      <div className="s-thread-center">
        <header className="s-thread-center-header host-conv-head">
          <div className="host-conv-title" title={title}>{title}</div>
          <div className="host-conv-meta">
            <span>On {hostName}</span>
            <span>Read only</span>
            {openUrl ? (
              <a href={openUrl} target="_blank" rel="noreferrer">Open on {hostName}</a>
            ) : null}
          </div>
        </header>
        <div
          className="s-thread-feed"
          ref={feedRef}
          onScroll={(event) => {
            const el = event.currentTarget;
            pinnedToEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
        >
          {error && !messages ? (
            <div className="host-conv-note">Could not read this chat from {hostName}. {error}</div>
          ) : messages == null ? (
            <div className="host-conv-note">Reading from {hostName}</div>
          ) : messages.length === 0 ? (
            <div className="host-conv-note">No messages yet.</div>
          ) : messages.map((message) => {
            const isYou = message.actorId === "operator";
            const createdAt = normalizeTimestampMs(message.createdAt);
            return (
              <article
                key={message.id}
                className={`s-thread-msg${isYou ? " s-thread-msg--you" : ""}`}
                data-class={message.class}
              >
                <div className="s-thread-msg-card">
                  <div className="s-thread-msg-card-content">
                    <div className="s-thread-msg-header">
                      <div className="s-thread-msg-meta">
                        <span className="s-thread-msg-actor">{message.actorName ?? message.actorId}</span>
                      </div>
                      <span
                        className="s-thread-msg-time"
                        title={createdAt ? formatAbsoluteTimestamp(createdAt) : undefined}
                      >
                        {timeAgo(message.createdAt)}
                      </span>
                    </div>
                    <div className="s-thread-msg-body">
                      <MessageMarkup text={message.body} />
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
