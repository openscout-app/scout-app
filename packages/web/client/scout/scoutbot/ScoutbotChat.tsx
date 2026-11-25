import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArrowUp, CheckCircle2, Copy, Loader2, Mic, Square, X } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { AgentMentionTextarea, type AgentMentionTextareaHandle } from "../../lib/agent-autocomplete.tsx";
import {
  formatAbsoluteTimestamp,
  normalizeTimestampMs,
} from "../../lib/time.ts";
import { ScoutbotMarkdown } from "../../lib/scoutbot-markdown.tsx";
import { ScoutbotThinking } from "../../components/ScoutbotThinking.tsx";
import { stripScoutbotUiFences, type ScoutbotOffer } from "../../lib/scoutbot.ts";
import { ScoutbotOfferRows, type ScoutbotAskOffer } from "./ScoutbotOffers.tsx";
import type { Agent } from "../../lib/types.ts";
import type {
  ScoutbotAssistantMessage,
  ScoutbotAssistantSessionState,
} from "./scoutbot-model.ts";

/** A thread untouched for this long gets a line saying where it picks up. */
const SCOUTBOT_THREAD_RESUME_MS = 6 * 60 * 60_000;

/**
 * Scoutbot's thread: one conversation, shown whole, that follows the operator
 * from page to page. It names no session, time or message count. Starting
 * over and the earlier conversations are one step away (the panel's menu opens
 * the list here), and a thread that has sat a while says where it picks up and
 * offers a fresh start, so the operator never has to manage it.
 *
 * A reply can carry next steps Scoutbot offers. They sit under it as rows
 * (ScoutbotOfferRows) where the host can run them.
 */
export function ChatHistory({
  state,
  sessionPickerOpen,
  onToggleSessionPicker,
  onStartNewChat,
  startingNewChat,
  onSwitchSession,
  switchingSessionId,
  sending,
  briefing,
  pendingAsk,
  onArchiveSession,
  archivingSessionId,
  onAssistantContextMenu,
  suggestedPrompts,
  onSelectPrompt,
  onRunOffer,
  onSendOffer,
}: {
  state: ScoutbotAssistantSessionState;
  sessionPickerOpen: boolean;
  onToggleSessionPicker: () => void;
  onStartNewChat: () => void;
  startingNewChat: boolean;
  onSwitchSession: (id: string) => void;
  switchingSessionId: string | null;
  sending: boolean;
  briefing: boolean;
  pendingAsk: string | null;
  onArchiveSession: (id: string) => void;
  archivingSessionId: string | null;
  onAssistantContextMenu?: (event: React.MouseEvent, body: string) => void;
  suggestedPrompts?: readonly string[];
  onSelectPrompt?: (prompt: string) => void;
  /** Runs an offered step that stays in this window. Without both offer
   * handlers the thread draws no offers. */
  onRunOffer?: (offer: Exclude<ScoutbotOffer, ScoutbotAskOffer>) => void;
  /** Sends an offered message to an agent. Rejects when it did not go out. */
  onSendOffer?: (offer: ScoutbotAskOffer) => Promise<void>;
}) {
  const messages = state.session.messages;
  const retention = state.retention;
  const isEmptySession = messages.length === 0 && !pendingAsk && !sending && !briefing;
  const chatActionsBusy = startingNewChat
    || sending
    || briefing
    || Boolean(switchingSessionId)
    || Boolean(archivingSessionId);
  const lastMessage = messages[messages.length - 1];
  const lastMessageMs = lastMessage ? normalizeTimestampMs(lastMessage.createdAt) : null;
  const resumesFrom = lastMessage
    && lastMessageMs !== null
    && !pendingAsk
    && !sending
    && !briefing
    && Date.now() - lastMessageMs >= SCOUTBOT_THREAD_RESUME_MS
    ? formatScoutbotMessageTimestamp(lastMessage.createdAt)
    : null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastMessageId = lastMessage?.id ?? null;
  const lastMessageBody = lastMessage?.body ?? "";
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastMessageId, lastMessageBody, pendingAsk, sending, state.session.id]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden font-sans text-sm text-[var(--scout-chrome-ink)]">
      {sessionPickerOpen && (
        <div className="shrink-0 border-b border-[var(--scout-chrome-border-soft)] pb-1">
          <div className="flex items-center justify-between gap-2 py-1 pr-1.5 pl-3">
            <span className="text-xs text-[var(--scout-chrome-ink-faint)]">
              Earlier conversations
              {retention && retention.archivedCount > 0 ? (
                <span className="text-[var(--scout-chrome-ink-ghost)]"> · {retention.archivedCount} archived</span>
              ) : null}
            </span>
            <span className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                title="Start a fresh conversation. This one stays here."
                aria-label="Start fresh"
                onClick={onStartNewChat}
                disabled={chatActionsBusy}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {startingNewChat ? <Loader2 size={11} className="animate-spin" /> : null}
                <span>{startingNewChat ? "Starting" : "Start fresh"}</span>
              </button>
              <button
                type="button"
                title="Close"
                aria-label="Close earlier conversations"
                onClick={onToggleSessionPicker}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
              >
                <X size={12} />
              </button>
            </span>
          </div>
          <div className="flex max-h-44 flex-col overflow-y-auto">
            {state.sessions.map((entry) => {
              const isActive = entry.id === state.session.id;
              const isBusy = switchingSessionId === entry.id;
              const isArchiving = archivingSessionId === entry.id;
              const ts = formatAbsoluteTimestamp(entry.updatedAt) || "";
              const display = entry.title && entry.title !== "New Scout Session"
                ? entry.title
                : "Untitled conversation";
              const rowBusy = Boolean(switchingSessionId) || Boolean(archivingSessionId);
              return (
                <div
                  key={entry.id}
                  className={`group/row flex items-center gap-1 pr-1.5 pl-3 transition-colors ${
                    isActive ? "bg-foreground/[0.04]" : "hover:bg-[var(--scout-chrome-hover)]"
                  }`}
                >
                  <button
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      if (isActive) return;
                      onSwitchSession(entry.id);
                    }}
                    disabled={isActive || rowBusy}
                    className={`flex min-w-0 flex-1 items-baseline gap-2 py-1.5 text-left disabled:cursor-default ${
                      !isActive && rowBusy ? "opacity-40" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--scout-chrome-ink)]">{display}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--scout-chrome-ink-ghost)]">
                      {isActive ? "Current" : ts}
                    </span>
                    {isBusy && <Loader2 size={11} className="shrink-0 animate-spin text-accent" />}
                  </button>
                  <button
                    type="button"
                    title="Archive"
                    aria-label={`Archive ${display}`}
                    onClick={() => onArchiveSession(entry.id)}
                    disabled={rowBusy}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--scout-chrome-ink-ghost)] opacity-0 transition hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)] focus-visible:opacity-100 disabled:cursor-not-allowed group-hover/row:opacity-100"
                  >
                    {isArchiving ? <Loader2 size={11} className="animate-spin" /> : <Archive size={11} />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3">
        {isEmptySession && (
          <ScoutbotZeroState
            suggestedPrompts={suggestedPrompts}
            onSelectPrompt={onSelectPrompt}
          />
        )}
        {messages.map((message, index) => {
          const showTimestamp = shouldShowScoutbotMessageTimestamp(messages[index - 1], message);
          const timestamp = formatScoutbotMessageTimestamp(message.createdAt);
          return (
            <div key={message.id} className="flex flex-col gap-2">
              {showTimestamp && (
                <div
                  className="self-center text-2xs text-[var(--scout-chrome-ink-ghost)]"
                  title={formatAbsoluteTimestamp(message.createdAt)}
                  aria-label={timestamp}
                >
                  {timestamp}
                </div>
              )}
              <ChatBubble
                role={message.role}
                body={message.body}
                onContextMenu={
                  message.role === "assistant" && onAssistantContextMenu
                    ? (event) => onAssistantContextMenu(event, message.body)
                    : undefined
                }
              />
              {message.role === "assistant" && onRunOffer && onSendOffer ? (
                <ScoutbotOfferRows
                  messageId={message.id}
                  body={message.body}
                  latest={index === messages.length - 1 && !pendingAsk && !sending}
                  onRun={onRunOffer}
                  onSend={onSendOffer}
                />
              ) : null}
            </div>
          );
        })}
        {pendingAsk && (
          <ChatBubble role="user" body={pendingAsk} pending />
        )}
        {sending && <ScoutbotThinking />}
        {briefing && (
          <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.06] px-2.5 py-2 text-xs leading-relaxed">
            <Loader2 size={12} className="shrink-0 animate-spin text-accent" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-accent">Briefing</span>
              <span className="text-[var(--scout-chrome-ink)]">
                Codex is reviewing the control-plane snapshot. Voice will pick up when it lands.
              </span>
            </div>
          </div>
        )}
        {resumesFrom && (
          <p className="flex flex-wrap items-center justify-center gap-x-1.5 pt-1 text-xs text-[var(--scout-chrome-ink-ghost)]">
            <span>Picks up from {resumesFrom}.</span>
            <button
              type="button"
              onClick={onStartNewChat}
              disabled={chatActionsBusy}
              className="rounded text-accent hover:underline disabled:cursor-not-allowed disabled:opacity-40"
            >
              Start fresh
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function ScoutbotZeroState({
  suggestedPrompts = [],
  onSelectPrompt,
}: {
  suggestedPrompts?: readonly string[];
  onSelectPrompt?: (prompt: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 pb-1">
      <div>
        <div className="text-md font-medium leading-tight text-[var(--scout-chrome-ink)]">
          Ask about what you are looking at.
        </div>
        <p className="mt-1 text-xs leading-snug text-[var(--scout-chrome-ink-faint)]">
          This page, your agents, or this host. Scoutbot keeps one conversation with you across pages.
        </p>
      </div>
      {suggestedPrompts.length > 0 ? (
        <div className="-mx-1.5 flex flex-col">
          {suggestedPrompts.slice(0, 3).map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onSelectPrompt?.(prompt)}
              className="truncate rounded px-1.5 py-1.5 text-left text-sm leading-snug text-[var(--scout-chrome-ink-faint)] transition-colors hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ChatInput({
  agents,
  draft,
  onDraftChange,
  onSubmit,
  sending,
  recording,
  voiceLabel,
  voiceBusy,
  voiceUnavailable,
  voiceHeld = false,
  onMicClick,
  prominent = false,
  autoFocus,
  focusSignal,
  placeholder,
}: {
  agents: Agent[];
  draft: string;
  onDraftChange: (next: string) => void;
  onSubmit: () => void;
  sending: boolean;
  recording: boolean;
  voiceLabel: string;
  voiceBusy: boolean;
  voiceUnavailable: boolean;
  /** Soft-hold the mic without a busy spinner (e.g. live call owns the mic). */
  voiceHeld?: boolean;
  onMicClick: () => void;
  prominent?: boolean;
  autoFocus?: boolean;
  focusSignal?: number;
  /** What the empty field says; the host names the page it is on. */
  placeholder?: string;
}) {
  const textareaRef = useRef<AgentMentionTextareaHandle>(null);
  const focusTextarea = useCallback(() => {
    const handle = textareaRef.current;
    if (!handle) return;
    if (handle.textarea) {
      handle.textarea.focus({ preventScroll: true });
    } else {
      handle.focus();
    }
  }, []);
  useEffect(() => {
    if (!autoFocus) return;
    focusTextarea();
  }, [autoFocus, focusTextarea]);
  useEffect(() => {
    if (!focusSignal) return;
    focusTextarea();
  }, [focusSignal, focusTextarea]);

  let micTitle = "Start talking";
  if (voiceUnavailable) micTitle = "Set up Scout voice";
  if (recording) micTitle = "Stop talking";
  if (voiceBusy || voiceHeld) micTitle = voiceLabel;
  const showVoiceLabel = voiceBusy || recording || voiceHeld;
  // One field: the text, and its mic and send inside the same edge.
  return (
    <form
      data-field-shell=""
      className="flex flex-col rounded-lg border border-[var(--scout-chrome-border-soft)] bg-background/50 transition-colors focus-within:border-[var(--field-focus)]"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <AgentMentionTextarea
        ref={textareaRef}
        agents={agents}
        value={draft}
        onChange={onDraftChange}
        onSubmit={() => {
          if (draft.trim() && !sending) onSubmit();
        }}
        placeholder={voiceHeld ? "Type while live voice is on" : placeholder ?? "Ask Scoutbot"}
        rows={prominent ? 3 : 2}
        disabled={sending}
        submitOnEnter
        className="min-w-0"
        textareaClassName="block max-h-[140px] min-h-[44px] w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1 font-sans text-sm leading-relaxed text-[var(--scout-chrome-ink)] placeholder:text-[var(--scout-chrome-ink-ghost)]"
      />
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
        <button
          type="button"
          title={micTitle}
          aria-label={micTitle}
          onClick={onMicClick}
          disabled={sending || voiceBusy || voiceHeld}
          className={`flex h-7 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            recording
              ? "bg-accent/10 text-accent"
              : voiceHeld
                ? "text-accent/70"
                : "text-[var(--scout-chrome-ink-faint)] hover:bg-[var(--scout-chrome-hover)] hover:text-[var(--scout-chrome-ink)]"
          } ${showVoiceLabel ? "gap-1.5 px-2 text-xs" : "w-7"}`}
        >
          {voiceBusy ? (
            <Loader2 size={13} className="animate-spin" />
          ) : recording ? (
            <Square size={12} className="fill-current" />
          ) : (
            <Mic size={13} />
          )}
          {showVoiceLabel && <span className="truncate">{voiceLabel}</span>}
        </button>
        <button
          type="submit"
          title="Send"
          aria-label="Send"
          disabled={!draft.trim() || sending}
          className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-accent-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <ArrowUp size={14} />}
        </button>
      </div>
    </form>
  );
}

/**
 * The operator's words sit right in a quiet bubble; Scoutbot's reply is plain
 * prose on the left, with Copy on hover. The side says who spoke, so there is
 * no label over each message.
 */
function ChatBubble({
  role,
  body,
  pending = false,
  onContextMenu,
}: {
  role: "user" | "assistant";
  body: string;
  pending?: boolean;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const isUser = role === "user";
  const text = isUser ? body : stripScoutbotUiFences(body);
  const [copied, setCopied] = useState(false);
  const copyMessage = useCallback(() => {
    void copyTextToClipboard(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  }, [text]);
  if (isUser) {
    return (
      <div className="flex justify-end">
        <p
          className={`max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-foreground/[0.06] px-2.5 py-1.5 text-sm leading-relaxed text-[var(--scout-chrome-ink)] ${pending ? "opacity-60" : ""}`}
        >
          <span className="sr-only">You: </span>
          {text}
        </p>
      </div>
    );
  }
  return (
    <div className="group relative" onContextMenu={onContextMenu}>
      <span className="sr-only">Scoutbot: </span>
      <div className={pending ? "opacity-60" : ""}>
        <ScoutbotMarkdown text={text} />
      </div>
      <button
        type="button"
        title={copied ? "Copied" : "Copy"}
        aria-label={copied ? "Copied" : "Copy reply"}
        disabled={pending || !text.trim()}
        onClick={copyMessage}
        className="absolute -top-1 right-0 flex h-6 w-6 items-center justify-center rounded border border-[var(--scout-chrome-border-soft)] bg-[var(--surface)] text-[var(--scout-chrome-ink-faint)] opacity-0 transition hover:text-[var(--scout-chrome-ink)] focus-visible:opacity-100 disabled:cursor-not-allowed group-hover:opacity-100"
      >
        {copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
      </button>
    </div>
  );
}

/** A pause this long between two messages gets a time between them. */
const SCOUTBOT_MESSAGE_TIMESTAMP_GAP_MS = 60 * 60_000;

function shouldShowScoutbotMessageTimestamp(
  previous: ScoutbotAssistantMessage | undefined,
  current: ScoutbotAssistantMessage,
): boolean {
  if (!previous) return true;
  if (!isSameScoutbotMessageDay(previous.createdAt, current.createdAt)) return true;
  const previousMs = normalizeTimestampMs(previous.createdAt);
  const currentMs = normalizeTimestampMs(current.createdAt);
  if (previousMs === null || currentMs === null) return true;
  return Math.abs(currentMs - previousMs) >= SCOUTBOT_MESSAGE_TIMESTAMP_GAP_MS;
}

function isSameScoutbotMessageDay(left: number, right: number): boolean {
  const leftMs = normalizeTimestampMs(left);
  const rightMs = normalizeTimestampMs(right);
  if (leftMs === null || rightMs === null) return false;
  const leftDate = new Date(leftMs);
  const rightDate = new Date(rightMs);
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function formatScoutbotMessageTimestamp(value: number): string {
  const valueMs = normalizeTimestampMs(value);
  if (valueMs === null) return "";
  const date = new Date(valueMs);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  if (isSameScoutbotMessageDay(valueMs, now.getTime())) {
    return `Today ${time}`;
  }
  if (isSameScoutbotMessageDay(valueMs, yesterday.getTime())) {
    return `Yesterday ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  }
  return `${date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} ${time}`;
}
