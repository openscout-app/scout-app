import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import type { ChatApi, ChatMessage } from "./chat-api.ts";
import { chatMessagePreviewText } from "./chat-message-preview.ts";

function SearchExcerpt({ message, query }: { message: ChatMessage; query: string }) {
  const text = message.body || chatMessagePreviewText(message);
  const start = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (start < 0 || !query) return <>{text}</>;
  return <>{text.slice(0, start)}<mark>{text.slice(start, start + query.length)}</mark>{text.slice(start + query.length)}</>;
}

export function ChatSearch({ api, channelId, space, onOpen, open: controlledOpen, onOpenChange, contentHost, triggerHost }: {
  api: ChatApi; channelId: string; space: string; onOpen: (message: ChatMessage) => void;
  /** Controlled by the channel header, which keeps one inspector open at a time. */
  open?: boolean; onOpenChange?: (open: boolean) => void;
  /** The inspector hosts the trigger and content without unmounting this stateful view. */
  contentHost?: HTMLElement | null;
  triggerHost?: HTMLElement | null;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean | ((value: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (onOpenChange) onOpenChange(value); else setLocalOpen(value);
  };
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const search = async (term: string, next: string | null = null) => {
    if (!api.searchMessages || !term.trim()) return;
    const attempt = ++generation.current;
    setBusy(true); setError(null);
    if (!next) { setMessages([]); setCursor(null); setQuery(term.trim()); }
    try {
      const found = await api.searchMessages(channelId, term.trim(), next, space);
      if (generation.current !== attempt) return;
      setMessages(previous => next ? [...new Map([...previous, ...found.messages].map(message => [message.id, message])).values()] : found.messages);
      setCursor(found.nextCursor);
    } catch {
      if (generation.current === attempt) setError("Search could not be completed. Try again.");
    } finally { if (generation.current === attempt) setBusy(false); }
  };
  const content = <div id="chat-search-content" className="chat-search-content" data-layout={contentHost ? "panel" : "tray"}>
    <form onSubmit={event => { event.preventDefault(); void search(input); }}>
      <input autoFocus aria-label="Search this channel and its replies" type="search" maxLength={200} value={input} onChange={event => setInput(event.target.value)} placeholder="Search messages and replies" />
      <button type="submit" className="btn btn--sm" disabled={!input.trim() || busy}>Search</button>
    </form>
    {error ? <p className="chat-search-status" role="alert">{error} <button type="button" className="btn btn--sm" onClick={() => void search(query, cursor)}>Retry</button></p> : null}
    {busy ? <p className="chat-search-status" role="status">Searching…</p> : query && !error ? <p className="chat-search-status" role="status">{messages.length ? `${messages.length}${cursor ? "+" : ""} ${messages.length === 1 && !cursor ? "result" : "results"} for “${query}”` : `No retained messages match “${query}”.`}</p> : null}
    {!query && !busy && !error ? <div className="chat-search-intro">
      <Search size={20} strokeWidth={1.5} aria-hidden />
      <p>Find a message</p>
      <span>Search this channel and its thread replies.</span>
    </div> : null}
    <div className="chat-search-results">
      {messages.map(message => {
        const createdAt = new Date(message.createdAt);
        return <button key={message.id} type="button" className="chat-search-result" onClick={() => { setOpen(false); onOpen(message); }}>
          <span className="chat-search-meta">
            <span className="chat-search-author">{message.actorName || message.actorId}</span>
            <time dateTime={createdAt.toISOString()} title={createdAt.toLocaleString()}>{createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</time>
            {message.replyToMessageId ? <span className="chat-search-kind">Thread reply</span> : null}
          </span>
          <span className="chat-search-excerpt"><SearchExcerpt message={message} query={query} /></span>
        </button>;
      })}
    </div>
    {cursor ? <button type="button" className="btn btn--sm chat-search-more" disabled={busy} onClick={() => void search(query, cursor)}>More results</button> : null}
  </div>;
  const trigger = <button type="button" className="chat-head-tool" aria-expanded={open} aria-controls="chat-search-content" aria-label="Search this channel" title="Search this channel" onClick={() => setOpen(value => !value)}>
    <Search size={16} strokeWidth={1.8} aria-hidden />
  </button>;
  return <section className="chat-search" aria-label={triggerHost ? undefined : "Search channel messages"}>
    {triggerHost ? createPortal(trigger, triggerHost) : trigger}
    {open ? contentHost ? createPortal(content, contentHost) : content : null}
  </section>;
}
