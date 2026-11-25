import { Bell } from "lucide-react";
import { ChatMessagePreview } from "./ChatMessagePreview.tsx";
import { useState } from "react";
import { createPortal } from "react-dom";
import { readChatAttentionPreferences, type ChatAttentionPreferences, type ChatReadState, type ConversationDefinition } from "@openscout/protocol";
import type { ChatMessage } from "./chat-api.ts";

import { attentionMessageCount } from "./chat-attention-model.ts";

interface ChatAttentionProps {
  channels: ConversationDefinition[];
  channelId: string;
  states: Record<string, ChatReadState>;
  messages: ChatMessage[];
  questionCounts?: Record<string, number>;
  actorNames?: Record<string, string>;
  busy: boolean;
  error: string | null;
  onUnpin?: (messageId: string) => void;
  onUnsave: (channelId: string, messageId: string) => void;
  onOpenSaved: (channelId: string, messageId: string) => void;
  onMode: (mode: ChatAttentionPreferences["notificationMode"]) => void;
  onOpen: (channelId: string, rootId?: string) => void;
  onUnfollow: (channelId: string, rootId: string) => void;
  /** Controlled by the channel header, which keeps one inspector open at a time. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The inspector renders the content separately and can host the trigger. */
  showContent?: boolean;
  triggerHost?: HTMLElement | null;
}

const ATTENTION_MODES: ReadonlyArray<{ value: ChatAttentionPreferences["notificationMode"]; label: string; hint: string }> = [
  { value: "all", label: "All", hint: "Every new message here counts as activity." },
  { value: "mentions", label: "Mentions", hint: "Only mentions of you and replies in threads you follow count." },
  { value: "muted", label: "Muted", hint: "Nothing from this channel counts as activity." },
];

export function ChatAttentionContent({
  channels,
  channelId,
  states,
  messages,
  questionCounts,
  actorNames = {},
  busy,
  error,
  onMode,
  onOpen,
  onUnfollow,
  onUnsave,
  onOpenSaved,
  onUnpin,
  onClose,
  layout = "tray",
}: Omit<ChatAttentionProps, "open" | "onOpenChange" | "showContent" | "triggerHost"> & {
  onClose: () => void;
  /**
   * "panel" is the shared right inspector: only sections that hold something,
   * "Nothing new." when none do, and the channel's mode as a small segmented
   * choice at the foot. "tray" preserves the inline fallback for callers
   * without an inspector host.
   */
  layout?: "tray" | "panel";
}) {
  const selected = states[channelId];
  const preferences = readChatAttentionPreferences(selected?.preferences);
  const active = channels.filter(channel => states[channel.id] && attentionMessageCount(states[channel.id]!) > 0);
  const followed = channels.flatMap(channel => readChatAttentionPreferences(states[channel.id]?.preferences).followedThreadIds.map(rootId => ({ channel, rootId })));
  const saved = channels.flatMap(channel => (readChatAttentionPreferences(states[channel.id]?.preferences).savedMessageIds ?? []).map(messageId => ({ channel, messageId })));
  const missing = channels.some(channel => !states[channel.id]);
  const incomplete = channels.some(channel => states[channel.id]?.lanes.some(lane => lane.incomplete));

  const panel = layout === "panel";
  const channelName = (channel: ConversationDefinition) => `#${channel.title.replace(/^#/, "")}`;

  if (panel) {
    // The panel lists what waits, and nothing else: a section appears only
    // when it holds something, and the channel's setting sits at the foot.
    const asked = questionCounts ? channels.filter(channel => (questionCounts[channel.id] ?? 0) > 0) : [];
    const pins = selected?.pins ?? [];
    const nothing = Boolean(selected) && !asked.length && !active.length && !pins.length && !saved.length && !followed.length;
    const mode = ATTENTION_MODES.find(choice => choice.value === preferences.notificationMode);
    return <div id="chat-attention-content" className="chat-attention-content" data-layout="panel">
      {error ? <p role="alert" className="chat-feed-notice">{error}</p> : null}
      {!selected ? <p className="chat-attention-quiet">Loading…</p> : null}
      {asked.length ? <section className="chat-attention-section">
        <h3>Questions</h3>
        {asked.map(channel => <button type="button" className="chat-attention-row" key={`question-${channel.id}`} onClick={() => { onClose(); onOpen(channel.id); }}>
          <span>{channelName(channel)}</span><span className="chat-attention-count" data-tone="ask">{questionCounts![channel.id]}</span>
        </button>)}
      </section> : null}
      {active.length ? <section className="chat-attention-section">
        <h3>Unread</h3>
        {active.map(channel => <button type="button" className="chat-attention-row" key={channel.id} onClick={() => { onClose(); onOpen(channel.id); }}>
          <span>{channelName(channel)}</span><span className="chat-attention-count">{attentionMessageCount(states[channel.id]!)}</span>
        </button>)}
      </section> : null}
      {followed.length ? <section className="chat-attention-section">
        <h3>Followed threads</h3>
        {followed.map(({ channel, rootId }) => {
          const root = channel.id === channelId ? messages.find(message => message.id === rootId) : undefined;
          const unread = states[channel.id]?.lanes.find(lane => lane.rootMessageId === rootId)?.unreadMessageIds.length ?? 0;
          return <div className="chat-attention-follow" key={`${channel.id}:${rootId}`}>
            <button type="button" className="chat-attention-row" onClick={() => { onClose(); onOpen(channel.id, rootId); }}>
              <span><ChatMessagePreview channelId={channel.id} messageId={rootId} message={root} fallback="Followed discussion" /></span>
              {unread ? <span className="chat-attention-count">{unread}</span> : <span className="chat-attention-where">{channelName(channel)}</span>}
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onUnfollow(channel.id, rootId)} aria-label={`Unfollow thread in ${channel.title}`}>Unfollow</button>
          </div>;
        })}
      </section> : null}
      {pins.length ? <section className="chat-attention-section">
        <h3>Pinned</h3>
        {pins.map(pin => {
          const message = messages.find(item => item.id === pin.messageId);
          return <div className="chat-attention-follow" key={`pin:${pin.messageId}`}>
            <button type="button" className="chat-attention-row" onClick={() => { onClose(); onOpenSaved(channelId, pin.messageId); }}>
              <span><ChatMessagePreview channelId={channelId} messageId={pin.messageId} message={message} fallback="Pinned message" /></span>
              <span className="chat-attention-where" title={new Date(pin.pinnedAt).toLocaleString()}>{actorNames[pin.pinnedBy] || pin.pinnedBy}</span>
            </button>
            {onUnpin ? <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onUnpin(pin.messageId)} aria-label="Unpin shared message">Unpin</button> : null}
          </div>;
        })}
      </section> : null}
      {saved.length ? <section className="chat-attention-section">
        <h3>Saved</h3>
        {saved.map(({ channel, messageId }) => {
          const message = channel.id === channelId ? messages.find(item => item.id === messageId) : undefined;
          return <div className="chat-attention-follow" key={`saved:${channel.id}:${messageId}`}>
            <button type="button" className="chat-attention-row" onClick={() => { onClose(); onOpenSaved(channel.id, messageId); }}>
              <span><ChatMessagePreview channelId={channel.id} messageId={messageId} message={message} fallback="Saved message" /></span>
              <span className="chat-attention-where">{channelName(channel)}</span>
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onUnsave(channel.id, messageId)} aria-label={`Remove saved message in ${channel.title}`}>Remove</button>
          </div>;
        })}
      </section> : null}
      {nothing ? <p className="chat-attention-quiet">Nothing new.</p> : null}
      <div className="chat-attention-mode">
        <span id="chat-attention-mode-label">This channel</span>
        <div className="chat-attention-modes" role="radiogroup" aria-labelledby="chat-attention-mode-label">
          {ATTENTION_MODES.map(choice => <button key={choice.value} type="button" role="radio" title={choice.hint} aria-checked={preferences.notificationMode === choice.value}
            disabled={busy || !selected} onClick={() => { if (preferences.notificationMode !== choice.value) onMode(choice.value); }}>
            {choice.label}
          </button>)}
        </div>
        {mode && mode.value !== "all" ? <p className="chat-attention-quiet">{mode.hint}</p> : null}
      </div>
    </div>;
  }

  return <div id="chat-attention-content" className="chat-attention-content" data-layout={layout}>
    <div className="chat-attention-preferences">
      <label className="chat-attention-setting">Activity notifications for this channel
        <select aria-label="Activity notifications for this channel" value={preferences.notificationMode} disabled={busy || !selected} onChange={event => onMode(event.target.value as ChatAttentionPreferences["notificationMode"])}>
          <option value="all">All messages</option>
          <option value="mentions">Mentions and followed replies</option>
          <option value="muted">Muted</option>
        </select>
      </label>
      <p className="chat-attention-hint">Controls this activity view. Channel unread counts stay visible. No desktop notifications are sent.</p>
    </div>
    {error ? <p role="alert" className="chat-feed-notice">{error}</p> : null}
    {questionCounts ? <section className="chat-attention-section">
      <h3>Questions for you</h3>
      <p className="chat-attention-hint">Assigned questions stay visible regardless of message notification preferences.</p>
      {channels.some(channel => (questionCounts[channel.id] ?? 0) > 0) ? channels.filter(channel => (questionCounts[channel.id] ?? 0) > 0).map(channel => <button type="button" className="chat-attention-row" key={`question-${channel.id}`} onClick={() => { onClose(); onOpen(channel.id); }}>
        <span>#{channel.title.replace(/^#/, "")}</span><span>{questionCounts[channel.id]} awaiting your response</span>
      </button>) : <p>No questions awaiting your response.</p>}
    </section> : null}
    <section className="chat-attention-section">
      <h3>Needs attention</h3>
      {missing ? <p>Some channel activity is not available yet.</p> : incomplete ? <p>Counts cover the available history; older unread activity may be missing.</p> : null}
      {!selected ? <p>Loading activity…</p> : !active.length ? <p>No new activity matching your preferences.</p> : active.map(channel => <button type="button" className="chat-attention-row" key={channel.id} onClick={() => { onClose(); onOpen(channel.id); }}>
        <span>#{channel.title.replace(/^#/, "")}</span><span>{attentionMessageCount(states[channel.id]!)} unread</span>
      </button>)}
    </section>
    <section className="chat-attention-section">
      <h3>Pinned in this channel · <span>Everyone</span></h3>
      {!selected?.pins?.length ? <p>No pinned messages in this channel.</p> : selected.pins.map(pin => {
        const message = messages.find(item => item.id === pin.messageId);
        return <div className="chat-attention-follow" key={`pin:${pin.messageId}`}>
          <button type="button" className="chat-attention-row" onClick={() => { onClose(); onOpenSaved(channelId, pin.messageId); }}>
            <ChatMessagePreview channelId={channelId} messageId={pin.messageId} message={message} fallback="Pinned message" />
            <span title={new Date(pin.pinnedAt).toLocaleString()}>Pinned by {actorNames[pin.pinnedBy] || pin.pinnedBy}</span>
          </button>
          {onUnpin ? <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onUnpin(pin.messageId)} aria-label="Unpin shared message">Unpin</button> : null}
        </div>;
      })}
    </section>
    <section className="chat-attention-section">
      <h3>Saved messages <span>Only you</span></h3>
      {!saved.length ? <p>Save useful messages to return to them here.</p> : saved.map(({ channel, messageId }) => {
        const message = channel.id === channelId ? messages.find(item => item.id === messageId) : undefined;
        return <div className="chat-attention-follow" key={`saved:${channel.id}:${messageId}`}>
          <button type="button" className="chat-attention-row" onClick={() => { onClose(); onOpenSaved(channel.id, messageId); }}>
            <span>#{channel.title.replace(/^#/, "")} · <ChatMessagePreview channelId={channel.id} messageId={messageId} message={message} fallback="Saved message" /></span>
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onUnsave(channel.id, messageId)} aria-label={`Remove saved message in ${channel.title}`}>Remove</button>
        </div>;
      })}
    </section>
    <section className="chat-attention-section">
      <h3>Followed threads</h3>
      {!followed.length ? <p>Follow a thread to keep it here and include its replies in your activity.</p> : followed.map(({ channel, rootId }) => {
        const root = channel.id === channelId ? messages.find(message => message.id === rootId) : undefined;
        const unread = states[channel.id]?.lanes.find(lane => lane.rootMessageId === rootId)?.unreadMessageIds.length ?? 0;
        return <div className="chat-attention-follow" key={`${channel.id}:${rootId}`}>
          <button type="button" className="chat-attention-row" onClick={() => { onClose(); onOpen(channel.id, rootId); }}>
            <span>#{channel.title.replace(/^#/, "")} · <ChatMessagePreview channelId={channel.id} messageId={rootId} message={root} fallback="Followed discussion" /></span>
            {unread ? <span>{unread} new</span> : null}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => onUnfollow(channel.id, rootId)} aria-label={`Unfollow thread in ${channel.title}`}>Unfollow</button>
        </div>;
      })}
    </section>
  </div>;
}

export function ChatAttention(props: ChatAttentionProps) {
  const { open: controlledOpen, onOpenChange, showContent = true, triggerHost, ...contentProps } = props;
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean | ((value: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    if (onOpenChange) onOpenChange(value); else setLocalOpen(value);
  };
  const total = props.channels.reduce((sum, channel) => {
    const state = props.states[channel.id];
    return sum + (state ? attentionMessageCount(state) : 0);
  }, 0);
  const trigger = <button type="button" className="chat-head-tool" aria-expanded={open} aria-controls="chat-attention-content"
    aria-label={`Activity and notifications${total ? `, ${total} new` : ""}`} title="Activity and notifications" onClick={() => setOpen(value => !value)}>
    <Bell size={16} strokeWidth={1.8} aria-hidden />
    {total ? <span className="chat-head-tool-count">{total}</span> : null}
  </button>;

  return <section className="chat-attention" aria-label={triggerHost ? undefined : "Conversation activity"}>
    {triggerHost ? createPortal(trigger, triggerHost) : trigger}
    {open && showContent ? <ChatAttentionContent {...contentProps} onClose={() => setOpen(false)} /> : null}
  </section>;
}
