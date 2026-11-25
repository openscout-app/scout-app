import { ChatAudioNote } from "./ChatAudioNote.tsx";
import { voiceNoteTranscriptions } from "../../../shared/voice-note-transcription.ts";
import { canonicalImageUrl } from "../../../shared/canonical-attachments.ts";
import { ChatStopControl } from "./ChatExecutionControls.tsx";
import { ChatApprovalPrompts, useChatApprovals } from "./ChatApprovalControls.tsx";
import { ChatQuestionControls } from "./ChatQuestionControls.tsx";
import { ChatRequestApprovalControls } from "./ChatRequestApprovalControls.tsx";
import { readChatMessageCorrection } from "@openscout/protocol";
import { ChatMessageCorrectionControls, type CorrectChatMessage } from "./ChatMessageCorrectionControls.tsx";
/**
 * The small shared parts of the chat surface: copy affordances, the turn, the
 * tracked-ask card, and the connection block.
 *
 * They live together because they are the pieces that must say the same thing
 * in the feed, the thread panel, and the member card. A rule enforced in one
 * place and re-implemented in another is a rule that drifts.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Bookmark, Ellipsis, ExternalLink, MessageSquare, Pin, SmilePlus } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { useContextMenu } from "../../components/ContextMenu.tsx";
import { messageMenuItems } from "./ChatContextMenu.tsx";
import {
  REACTION_EMOJI_MORE,
  REACTION_EMOJI_QUICK,
  type MessageAttachment,
} from "@openscout/protocol";
import { sameOriginBlobUrl } from "../../components/MessageEmbeds.tsx";

import {
  CHAT_LINK_PREVIEW_PATH,
  ChatApiError,
  type ChannelMemberView,
  type ChatMessage,
  type TrackedRequest,
} from "./chat-api.ts";
import { ChatMessageMarkup } from "./chat-message-markup.tsx";
import { ChatRichContent } from "./ChatRichContent.tsx";
import { ChevronGlyph, ExternalGlyph, MoreGlyph, ReactGlyph, ThreadGlyph, ViaGlyph } from "./rooms-glyphs.tsx";
import { useChatCapabilities, useChatTransport } from "./chat-transport.tsx";
import { MemberAvatar, useMemberHarnessLabel } from "./ChatAvatar.tsx";
import {
  askChip,
  askHeadline,
  askTag,
  clockTime,
  slackClockTime,
  memberDisplayName,
  memberOrFallback,
  reactionReactorNames,
  memberReceptionView,
  relativeTime,
  threadStubLabel,
} from "./chat-space-model.ts";

/** Copy, then say so for 1.5s. The existing pattern; no toast system exists. */
export function CopyAction({
  value,
  label,
  className = "btn btn--sm",
  copiedLabel = "Copied",
  onCopyFailed,
}: {
  value: string;
  label: string;
  className?: string;
  copiedLabel?: string;
  onCopyFailed?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = useCallback(() => {
    const done = (ok: boolean) => {
      setCopied(ok);
      setFailed(!ok);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setCopied(false);
        setFailed(false);
      }, 1500);
    };
    void copyTextToClipboard(value).then((ok) => {
      done(ok);
      if (!ok) onCopyFailed?.();
    }).catch(() => { done(false); onCopyFailed?.(); });
  }, [value, onCopyFailed]);

  return (
    <button type="button" className={className} onClick={onClick} aria-live="polite">
      {failed ? "Copy failed — select the text" : copied ? copiedLabel : label}
    </button>
  );
}

export function TrackedAskCard({
  request,
  target,
  withTarget,
  onStop,
  onOpenThread,
  replyCount,
}: {
  request: TrackedRequest;
  target: ChannelMemberView | null;
  withTarget: boolean;
  onStop?: (flightId: string) => void | Promise<void>;
  /** The task's record lives in its thread; the card's foot opens it. */
  onOpenThread?: () => void;
  replyCount?: number;
}) {
  const [stopping, setStopping] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const stop = async () => {
    if (!onStop || inFlight.current) return;
    inFlight.current = true;
    setStopping(true);
    setStopError(null);
    try { await onStop(request.flightId); }
    catch (error) {
      setStopError(error instanceof ChatApiError && error.status > 0 && error.status < 500
        ? error.message : "Could not confirm cancellation. Check your connection and try again.");
    } finally { inFlight.current = false; setStopping(false); }
  };
  const chip = askChip(
    request,
    target ? { label: memberDisplayName(target), reception: target.reception } : null,
  );
  const agentLabel = target ? memberDisplayName(target) : request.targetName ?? request.targetActorId;
  const active = ["running", "waiting", "blocked", "needs_input"].includes(chip.state);
  const approvals = useChatApprovals(request.flightId, active);
  const responsibility = request.responsibility;
  const requestApprovalCount = active ? (request.approvals ?? []).filter(approval => approval.state === "pending").length : 0;
  const approvalsForYou = active ? approvals.pending.length + requestApprovalCount : 0;
  const headline = askHeadline({
    state: request.state,
    source: request.source,
    fetchedAt: request.fetchedAt,
    cancelRequestedAt: request.cancelRequestedAt,
    agent: withTarget ? agentLabel : null,
    responsibility,
    approvalsForYou,
  });
  const failed = chip.tone === "failed";
  const tag = askTag({ state: request.state, source: request.source, fetchedAt: request.fetchedAt, cancelRequestedAt: request.cancelRequestedAt, responsibility, approvalsForYou });
  const requester = request.requesterName || request.requesterActorId;
  const output = request.output ?? "";
  const outcomeLong = output.length > 320 || output.split("\n").length > 4;
  const outputPreviewNote = <>
    Preview limited to 4,000 characters. {request.outputUrl?.startsWith("/api/channels/") && !request.outputUrl.includes("\\")
      ? <a href={request.outputUrl} target="_blank" rel="noopener noreferrer">Read full outcome</a> : null}
  </>;
  return (
    <div
      className="chat-ask-card"
      data-tone={chip.tone}
      data-state={chip.state}
      data-needs-you={headline.needsYou || undefined}
      role="group"
      aria-label={chip.ariaLabel}
    >
      <div className="chat-ask-head">
        <span className="chat-ask-kicker">{responsibility?.kind === "question" ? "Question" : "Task"}</span>
        <p className="chat-ask-headline">{headline.text}</p>
        <span className="chat-ask-tag" data-yours={tag.yours || undefined}>{tag.text}</span>
      </div>
      <p className="chat-ask-who">
        {target ? <MemberAvatar member={target} size={16} className="chat-ask-face" /> : null}
        <span className="chat-ask-owner">{agentLabel}</span>
        {requester ? <span>asked by {requester}</span> : null}
        {request.startedAt != null ? (
          <time className="chat-ask-when" dateTime={new Date(request.startedAt).toISOString()}>started {clockTime(request.startedAt)}</time>
        ) : null}
      </p>
      {request.summary ? <p className="chat-ask-summary">{request.summary}</p> : null}
      {request.source === "external_agent" && active && request.lastUpdateAt ? <p className="chat-ask-trail">Last recorded change {relativeTime(request.lastUpdateAt, Date.now())}.</p> : null}

      {active ? <ChatApprovalPrompts approvals={approvals} /> : null}
      <ChatRequestApprovalControls request={request} />

      {responsibility ? <div className="chat-ask-slot">
        <p className="chat-ask-slot-label">
          {responsibility.kind === "question" ? "Question" : "Work"}{responsibility.settled ? ` · ${responsibility.state}` : ""}
        </p>
        <p className="chat-ask-quote">{responsibility.title}</p>
        {responsibility.answer ? <>
          <p className="chat-ask-slot-label">Answer</p>
          <pre className="chat-ask-answer">{responsibility.answer}</pre>
        </> : null}
        <ChatQuestionControls question={responsibility} />
      </div> : chip.state === "waiting" && !approvals.pending.length && requestApprovalCount === 0 ? (
        <p className="chat-ask-trail">The next actor is not available in this view.</p>
      ) : null}

      {failed && request.error ? <div className="chat-ask-error" role="alert">
        <p className="chat-ask-error-label">Error</p>
        <pre>{request.error}</pre>
      </div> : null}

      {request.output && chip.state === "completed" ? (
        // The outcome leads a finished task. Four lines, then the reader asks
        // for the rest; the full text past the preview opens on its own.
        <div className="chat-ask-out" data-clamped={outcomeLong && !outcomeOpen ? "" : undefined}>
          <p className="chat-ask-slot-label">Outcome{request.outputTruncated ? " (preview)" : ""}</p>
          <div className="chat-ask-out-text">{request.output}</div>
          {outcomeLong ? (
            <button type="button" className="chat-ask-link" aria-expanded={outcomeOpen} onClick={() => setOutcomeOpen(open => !open)}>
              {outcomeOpen ? "Show less" : "Show the whole outcome"}
            </button>
          ) : null}
          {request.outputTruncated ? <p className="chat-ask-out-note">{outputPreviewNote}</p> : null}
        </div>
      ) : request.output ? <details className="chat-ask-outcome">
        <summary>Recorded output{request.outputTruncated ? " (preview)" : ""}</summary>
        <pre>{request.output}</pre>
        {request.outputTruncated ? <p>{outputPreviewNote}</p> : null}
      </details> : null}
      {chip.state === "completed" && !request.output && !request.summary && !(responsibility && !responsibility.settled) ? <p className="chat-ask-trail">Completed without a recorded outcome.</p> : null}

      <details className="chat-ask-more">
        <summary>Details</summary>
        <dl>
          <dt>Agent</dt><dd>{agentLabel}</dd>
          <dt>State</dt><dd>{chip.state}</dd>
          {request.requesterActorId ? <><dt>Requested by</dt><dd>{request.requesterName || request.requesterActorId}</dd></> : null}
          {request.startedAt != null ? <><dt>Started</dt><dd><time dateTime={new Date(request.startedAt).toISOString()}>{new Date(request.startedAt).toLocaleString()}</time></dd></> : null}
          {request.completedAt != null ? <><dt>Finished</dt><dd><time dateTime={new Date(request.completedAt).toISOString()}>{new Date(request.completedAt).toLocaleString()}</time></dd></> : null}
          {!failed && request.error ? <><dt>Error</dt><dd>{request.error}</dd></> : null}
        </dl>
      </details>

      <div className="chat-ask-foot">
        {onOpenThread ? (
          <button type="button" className="chat-ask-link" data-on="" onClick={onOpenThread}>
            {replyCount && replyCount > 0 ? `Thread, ${replyCount} ${replyCount === 1 ? "reply" : "replies"}` : "Thread"}
          </button>
        ) : null}
        {chip.state === "running" ? <ChatStopControl flightId={request.flightId} /> : null}
        {chip.canStop && stopError ? <p className="chat-ask-trail" role="alert">{stopError}</p> : null}
        {chip.canStop && onStop ? (
          <button
            type="button"
            className="chat-ask-stop"
            disabled={stopping}
            onClick={() => void stop()}
          >
            {stopping ? "Cancelling…" : stopError ? "Retry cancellation" : "Cancel request"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const BODY_URL_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/giu;

function extractBodyUrls(body: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of body.matchAll(BODY_URL_PATTERN)) {
    const cleaned = match[0]?.replace(/[.,;:!?)]+$/u, "") ?? "";
    if (!cleaned.startsWith("http") || cleaned.includes("/api/blobs/") || seen.has(cleaned)) continue;
    seen.add(cleaned);
    urls.push(cleaned);
    if (urls.length >= 3) break;
  }
  return urls;
}

export function MessageBody({
  message,
  fallbackLabels,
}: {
  message: ChatMessage;
  fallbackLabels?: string[];
}) {
  const { source } = useChatTransport();
  const urls = source === "slack" ? [] : extractBodyUrls(message.body);
  return (
    <>
      {message.body ? <div className="chat-turn-body">
        <ChatMessageMarkup message={message} fallbackLabels={fallbackLabels} />
      </div> : null}
      {urls.map((url) => <ChatLinkCard key={url} url={url} />)}
      <ChatRichContent message={message} />
    </>
  );
}

type LinkPreviewPayload = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

const linkPreviewCache = new Map<string, LinkPreviewPayload | null>();
const linkPreviewInflight = new Map<string, Promise<LinkPreviewPayload | null>>();

function loadLinkPreview(url: string): Promise<LinkPreviewPayload | null> {
  if (linkPreviewCache.has(url)) return Promise.resolve(linkPreviewCache.get(url) ?? null);
  const pending = linkPreviewInflight.get(url);
  if (pending) return pending;
  const request = fetch(`${CHAT_LINK_PREVIEW_PATH}?url=${encodeURIComponent(url)}`, { credentials: "include" })
    .then(async (response) => {
      if (!response.ok) return null;
      const payload = await response.json() as { preview?: LinkPreviewPayload };
      return payload.preview ?? null;
    })
    .catch(() => null)
    .then((preview) => {
      linkPreviewCache.set(url, preview);
      linkPreviewInflight.delete(url);
      return preview;
    });
  linkPreviewInflight.set(url, request);
  return request;
}

function ChatLinkCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreviewPayload | null>(() => linkPreviewCache.get(url) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    void loadLinkPreview(url).then((next) => {
      if (!cancelled) setPreview(next);
    });
    return () => { cancelled = true; };
  }, [preview, url]);
  if (!preview) return null;
  return (
    <a className="chat-link-card" href={preview.url} target="_blank" rel="noreferrer">
      {preview.imageUrl && !failed ? (
        <img
          className="chat-link-card-image"
          src={preview.imageUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : null}
      <span className="chat-link-card-copy">
        {preview.siteName ? <span className="chat-link-card-site">{preview.siteName}</span> : null}
        <span className="chat-link-card-title">{preview.title}</span>
        {preview.description ? <span className="chat-link-card-desc">{preview.description}</span> : null}
      </span>
    </a>
  );
}

/** Interactive bits inside a turn keep their own click. The rest starts a reply. */
const REPLY_CLICK_SKIP =
  "a, button, input, textarea, select, video, audio, label, summary, [contenteditable='true'], [role='button'], [role='link']";

export function messageClickStartsReply(
  target: EventTarget | null,
  selectedText: string,
): boolean {
  if (selectedText.trim()) return false;
  const node = target as { closest?: (selector: string) => unknown; parentElement?: { closest: (selector: string) => unknown } | null } | null;
  const element = node && typeof node.closest === "function" ? node : node?.parentElement ?? null;
  if (!element || typeof element.closest !== "function") return false;
  return element.closest(REPLY_CLICK_SKIP) == null;
}

/**
 * One avatar-led turn. Flat by design: the card is reserved for the tracked
 * ask, and there are no delivery ticks anywhere on a message.
 */
export function Turn({
  message,
  members,
  nowMs,
  request,
  replyCount,
  lastReplyAt,
  onOpenThread,
  onReply,
  onOpenMember,
  onReact,
  onCopyLink,
  saved,
  saveBusy,
  onSave,
  pinned,
  onPin,
  viewerActorId,
  viewerIsOperator,
  onCorrect,
  onStopAsk,
  focused = false,
  threadOpen = false,
  continues = false,
  withTargetOnChip = true,
  avatarSize = 36,
}: {
  message: ChatMessage;
  members: Map<string, ChannelMemberView>;
  nowMs: number;
  request?: TrackedRequest | null;
  replyCount?: number;
  lastReplyAt?: number | null;
  onOpenThread?: () => void;
  /** Click on the message body. Defaults to opening the thread when that is all the caller passed. */
  onReply?: () => void;
  onOpenMember?: (actorId: string) => void;
  onReact?: (messageId: string, emoji: string, remove: boolean) => void;
  onCopyLink?: (messageId: string) => void;
  saved?: boolean;
  saveBusy?: boolean;
  onSave?: (messageId: string, saved: boolean) => void;
  pinned?: boolean;
  onPin?: (messageId: string, pinned: boolean) => void;
  viewerActorId?: string;
  viewerIsOperator?: boolean;
  onCorrect?: CorrectChatMessage;
  onStopAsk?: (flightId: string) => void | Promise<void>;
  focused?: boolean;
  threadOpen?: boolean;
  /**
   * Same author, moments after the turn above. The header is already on
   * screen, so this one shows only its body — with the clock moved into the
   * avatar gutter, where it stays reachable without repeating a name.
   */
  continues?: boolean;
  withTargetOnChip?: boolean;
  /** The face beside a turn's first line; the page's grid sets its column. */
  avatarSize?: number;
}) {
  const capabilities = useChatCapabilities();
  const { source } = useChatTransport();
  const openMenu = useContextMenu();
  const correction = readChatMessageCorrection(message.metadata);
  const deleted = correction?.deletedAt != null;
  const authored = message.actorId === viewerActorId || (viewerIsOperator === true && message.actorId === "owner");
  const [pickerPinned, setPickerPinned] = useState(false);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const swallowClick = useRef(false);
  // The Slack place speaks Slack's grammar: 12-hour clocks, Slack's three
  // quick reactions, its glyphs in the hover bar, and a facepile on the
  // thread bar. The Scout place is untouched by every branch on `slack`.
  const slack = source === "slack";
  const startReply = slack ? undefined : onReply ?? onOpenThread;
  const author = memberOrFallback(members, message.actorId, message.actorName, message.actorAvatarUrl);
  const target = request ? members.get(request.targetActorId) ?? null : null;
  const name = memberDisplayName(author);
  const harness = useMemberHarnessLabel(author);
  const canReact =!deleted && capabilities.reactions && Boolean(onReact);
  const threadFaces = slack ? message.threadSummary?.participants ?? [] : [];

  const clearPress = () => {
    if (press.current) {
      window.clearTimeout(press.current.timer);
      press.current = null;
    }
  };

  // The same stamp serves both shapes: beside the name when the block opens,
  // in the gutter where the avatar would be when it continues. A continued
  // turn never loses its clock, it only stops shouting it.
  const clockText = slack ? slackClockTime(message.createdAt, continues === true) : clockTime(message.createdAt);
  const clock = (
    <time className="chat-when" dateTime={new Date(message.createdAt).toISOString()}>
      {clockText}
    </time>
  );
  const stamp = onCopyLink
    ? (
      <button
        type="button"
        className="chat-when-link"
        title="Copy link to this message"
        aria-label={`Copy link to this message, sent ${slack ? slackClockTime(message.createdAt) : clockTime(message.createdAt)}`}
        onClick={() => onCopyLink(message.id)}
      >
        {clock}
      </button>
    )
    : clock;
  const picker = canReact
    ? (
      <ReactionPicker
        message={message}
        onReact={onReact!}
        pinned={pickerPinned}
        onDismiss={() => setPickerPinned(false)}
        quick={slack ? SLACK_QUICK_REACTIONS : undefined}
      />
    )
    : null;

  // Everything you can do to a message, in one floating strip that appears on
  // hover, keyboard focus or a long press. It used to be a row of words under
  // every message, which made a quiet feed read like a form.
  const toolButtons = [
    onOpenThread ? (
      <button key="reply" type="button" className="chat-turn-tool" onClick={onOpenThread}
        aria-label={`Reply in thread to ${name}`} title="Reply in thread">
        {slack ? <ThreadGlyph size={16} /> : <MessageSquare size={15} strokeWidth={1.8} aria-hidden />}
      </button>
    ) : null,
    message.externalUrl ? (
      <a key="external" className="chat-turn-tool" href={message.externalUrl} target="_blank" rel="noreferrer"
        aria-label="Open message in Slack" title="Open in Slack" onClick={(event) => event.stopPropagation()}>
        {slack ? <ExternalGlyph size={16} /> : <ExternalLink size={15} strokeWidth={1.8} aria-hidden />}
      </a>
    ) : null,
    onSave && (!deleted || saved) ? (
      <button key="save" type="button" className="chat-turn-tool" aria-pressed={saved === true}
        disabled={saveBusy} onClick={() => onSave(message.id, !saved)}
        aria-label={saved ? "Remove from saved messages" : "Save message privately"}
        title={saved ? "Saved — remove" : "Save for later"}>
        <Bookmark size={15} strokeWidth={1.8} aria-hidden />
      </button>
    ) : null,
    onPin && (!deleted || pinned) ? (
      <button key="pin" type="button" className="chat-turn-tool" aria-pressed={pinned === true}
        disabled={saveBusy} onClick={() => onPin(message.id, !pinned)}
        aria-label={pinned ? "Unpin from channel" : "Pin for everyone in channel"}
        title={pinned ? "Pinned — unpin" : "Pin to channel"}>
        <Pin size={15} strokeWidth={1.8} aria-hidden />
      </button>
    ) : null,
  ].filter(Boolean);
  const tools = picker || toolButtons.length ? <>{picker}{toolButtons}</> : null;
  // The top-right hover bar is how these get used. Right-click opens the same
  // list; this button opens it without that gesture.
  const more = (
    <button
      type="button"
      className="chat-turn-tool"
      aria-label="More actions"
      title="More actions"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        openMenu(
          { preventDefault() {}, stopPropagation() {}, clientX: rect.left, clientY: rect.bottom + 4 },
          messageMenuItems(event.currentTarget),
        );
      }}
    >
      {slack ? <MoreGlyph size={16} /> : <Ellipsis size={15} strokeWidth={1.8} aria-hidden />}
    </button>
  );

  return (
    <article
      className="chat-turn"
      data-message-id={message.id}
      data-continues={continues ? "true" : undefined}
      data-focused={focused ? "true" : undefined}
      data-thread-open={threadOpen ? "true" : undefined}
      data-reacting={pickerPinned ? "true" : undefined}
      data-replyable={startReply ? "true" : undefined}
      data-threaded={onOpenThread && replyCount && replyCount > 0 && !request ? "true" : undefined}
      onClick={(event) => {
        if (!startReply || event.defaultPrevented) return;
        // A long-press opens the reaction picker; that gesture is not a reply.
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        const selected = typeof window !== "undefined" ? window.getSelection?.()?.toString() ?? "" : "";
        if (!messageClickStartsReply(event.target, selected)) return;
        startReply();
      }}
      onPointerDown={(event) => {
        if (!canReact) return;
        if (event.pointerType === "mouse") return;
        if ((event.target as HTMLElement | null)?.closest("button")) return;
        clearPress();
        const x = event.clientX;
        const y = event.clientY;
        press.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            press.current = null;
            swallowClick.current = true;
            setPickerPinned(true);
          }, 450),
        };
      }}
      onPointerUp={clearPress}
      onPointerCancel={clearPress}
      onPointerMove={(event) => {
        if (!press.current) return;
        const dx = event.clientX - press.current.x;
        const dy = event.clientY - press.current.y;
        if (dx * dx + dy * dy > 64) clearPress();
      }}
      onContextMenu={(event) => {
        // Option-click and Shift-click keep the browser menu (Inspect Element).
        // A normal right-click is the chat menu, so a long-press must not also
        // pin the reaction picker on top of it.
        if (event.altKey || event.shiftKey) return;
        clearPress();
        if (pickerPinned) setPickerPinned(false);
      }}
    >
      {continues ? (
        <span className="chat-turn-gutter">{stamp}</span>
      ) : onOpenMember ? (
        <button
          type="button"
          onClick={() => onOpenMember(author.actorId)}
          aria-label={`Open ${name}'s member card`}
        >
          <MemberAvatar member={author} size={avatarSize} />
        </button>
      ) : (
        <MemberAvatar member={author} size={avatarSize} />
      )}
      <div>
        {continues ? null : (
          <div className="chat-turn-meta">
            <span className="chat-who">{name}</span>
            {/* Slack marks an app's own posts beside the name. */}
            {slack && message.class === "agent" ? <span className="chat-who-app">App</span> : null}
            {harness ? <span className="chat-who-harness">{harness}</span> : null}
            {message.viaName ? (
              // A person posting through an app (every Rooms post is one). The
              // mark stays; the words unfold when the turn is under the pointer
              // or focus, so a run of your own posts does not repeat them.
              <span className="chat-who-via" title={`Posted through ${message.viaName}`}>
                <ViaGlyph size={13} />
                <span className="chat-who-via-text">via {message.viaName}</span>
              </span>
            ) : null}
            {stamp}
            {pinned ? <span className="chat-turn-mark">Pinned</span> : null}
            {saved ? <span className="chat-turn-mark">Saved</span> : null}
            {onOpenThread ? <button type="button" className="chat-turn-reply" onClick={(event) => { event.stopPropagation(); onOpenThread(); }}>Reply</button> : null}
          </div>
        )}
        {!deleted && viewerActorId && message.mentions?.some(mention => mention.actorId === viewerActorId) ? <span className="chat-message-mention">Mentions you</span> : null}
        {deleted ? <p className="chat-message-deleted">Message deleted</p> : <MessageBody message={message} />}
        {!deleted && correction?.editedAt != null ? <span className="chat-message-edited" title={new Date(correction.editedAt).toLocaleString()}>Edited</span> : null}
        {onCorrect
          ? <ChatMessageCorrectionControls key={`${viewerActorId}:${message.id}`} message={message} canEdit={authored} canDelete={authored || (!slack && viewerIsOperator === true)} onCorrect={onCorrect} tools={tools} more={more} />
          : <div className="chat-turn-tools" role="toolbar" aria-label="Message actions">{tools}{more}</div>}
        <ChatAttachments message={message} attachments={deleted ? [] : message.attachments ?? []} />
        {request ? (
          <TrackedAskCard
            request={request}
            target={target}
            withTarget={withTargetOnChip}
            onStop={onStopAsk}
            onOpenThread={onOpenThread}
            replyCount={replyCount}
          />
        ) : null}
        {capabilities.reactions && !deleted ? (
          <ReactionChips message={message} members={members} viewerActorId={viewerActorId} onReact={canReact ? onReact : undefined} />
        ) : null}
        {onOpenThread && replyCount && replyCount > 0 && !request ? (
          // A thread that exists is part of the conversation and stays on the
          // page. Starting one is an action, so it lives in the hover toolbar
          // and costs the feed no reserved row under every message.
          <button
            type="button"
            className="chat-thread-stub"
            onClick={onOpenThread}
            aria-label={`Open thread, ${threadStubLabel(replyCount, lastReplyAt ?? null, nowMs)}`}
          >
            {slack ? (
              <>
                {threadFaces.length > 0 ? (
                  <span className="chat-thread-stub-faces" aria-hidden="true">
                    {threadFaces.map((face) => (
                      <MemberAvatar key={face.actorId} member={memberOrFallback(members, face.actorId, face.name, face.avatarUrl)} size={24} />
                    ))}
                  </span>
                ) : null}
                <span className="chat-thread-stub-count">{replyCount} {replyCount === 1 ? "reply" : "replies"}</span>
                {lastReplyAt ? <span className="chat-thread-stub-last">Last reply {relativeTime(lastReplyAt, nowMs)}</span> : null}
                <span className="chat-thread-stub-view">View thread</span>
                <span className="chat-thread-stub-chevron"><ChevronGlyph size={14} /></span>
              </>
            ) : (
              <>
                <span className="chat-thread-stub-label">{threadStubLabel(replyCount, lastReplyAt ?? null, nowMs)}</span>
                <span className="chat-thread-stub-view">View thread</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * An image's real shape is not known until its bytes arrive, and a guessed
 * `width`/`height` pair reserves the wrong box and then jumps to the right one.
 * Remember the ratio the browser reports the first time, keyed by URL: the same
 * capture shown again — a poll re-render, the thread panel, a scroll back —
 * reserves its true shape with no extra request. Until then the stylesheet
 * supplies a neutral band, and nothing is ever fetched to learn a size.
 */
const knownImageRatios = new Map<string, number>();

function ChatImageAttachment({ href, name }: { href: string; name: string }) {
  const [ratio, setRatio] = useState(() => knownImageRatios.get(href) ?? null);
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="chat-attach-file">{name} — Preview unavailable</span>;
  return (
    <figure className="chat-image">
      <a className="chat-attach-image" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${name} in a new tab`}>
        <img
          src={href}
          onError={() => setFailed(true)}
          alt={name}
          loading="lazy"
          decoding="async"
          // The feed's own reads come first; a screenshot can arrive after them.
          fetchPriority="low"
          style={ratio ? { aspectRatio: String(ratio) } : undefined}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (!naturalWidth || !naturalHeight) return;
            const next = naturalWidth / naturalHeight;
            knownImageRatios.set(href, next);
            setRatio((current) => (current === next ? current : next));
          }}
        />
      </a>
      <figcaption><span>{name}</span><span>Open image</span></figcaption>
    </figure>
  );
}

function ChatDiffAttachment({ href, name }: { href: string; name: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSource(null);
    setFailed(false);
    void fetch(href, { credentials: "same-origin", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("diff unavailable");
        const text = await response.text();
        if (!controller.signal.aborted) setSource(text.slice(0, 200_000));
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [href]);
  return (
    <figure className="chat-diff">
      <figcaption><span>{name}</span><a href={href} target="_blank" rel="noreferrer">Raw diff</a></figcaption>
      {failed ? <p className="chat-diff-status">Preview unavailable. Open the raw diff to read it.</p> : source === null
        ? <p className="chat-diff-status">Loading diff…</p>
        : <pre>{source.split("\n").map((line, index) => <span key={index} className="chat-diff-line" data-kind={line.startsWith("+++") || line.startsWith("---") ? "file" : line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : line.startsWith("@@") ? "hunk" : "context"}>{line || " "}</span>)}</pre>}
    </figure>
  );
}

type WorkSessionStep = { label: string; state: "done" | "active" | "pending" };
type WorkSession = {
  title: string;
  detail?: string;
  state: "running" | "completed" | "blocked";
  steps: WorkSessionStep[];
};

function readWorkSession(value: unknown): WorkSession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.title !== "string" || !candidate.title.trim()) return null;
  if (candidate.state !== "running" && candidate.state !== "completed" && candidate.state !== "blocked") return null;
  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0 || candidate.steps.length > 12) return null;
  const steps: WorkSessionStep[] = [];
  for (const item of candidate.steps) {
    if (!item || typeof item !== "object") return null;
    const step = item as Record<string, unknown>;
    if (typeof step.label !== "string" || !step.label.trim()) return null;
    if (step.state !== "done" && step.state !== "active" && step.state !== "pending") return null;
    steps.push({ label: step.label.trim().slice(0, 160), state: step.state });
  }
  return {
    title: candidate.title.trim().slice(0, 160),
    ...(typeof candidate.detail === "string" && candidate.detail.trim() ? { detail: candidate.detail.trim().slice(0, 240) } : {}),
    state: candidate.state,
    steps,
  };
}

function ChatWorkSessionAttachment({ href }: { href: string }) {
  const [session, setSession] = useState<WorkSession | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSession(null);
    setFailed(false);
    void fetch(href, { credentials: "same-origin", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("work session unavailable");
        const body = await response.text();
        if (body.length > 64_000) throw new Error("work session too large");
        return readWorkSession(JSON.parse(body));
      })
      .then(next => {
        if (controller.signal.aborted) return;
        if (!next) setFailed(true);
        else setSession(next);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [href]);
  const completed = session?.steps.filter(step => step.state === "done").length ?? 0;
  return (
    <section className="chat-work-session" data-state={session?.state ?? "loading"} aria-label="Work session">
      <header className="chat-work-head">
        <span className="chat-work-label">Work session</span>
        <span className="chat-work-state">{session ? session.state === "running" ? "In progress" : session.state === "completed" ? "Complete" : "Blocked" : failed ? "Unavailable" : "Loading"}</span>
      </header>
      {session ? <>
        <div className="chat-work-title-row">
          <h3>{session.title}</h3>
          <span>{completed} of {session.steps.length} steps</span>
        </div>
        {session.detail ? <p className="chat-work-detail">{session.detail}</p> : null}
        <progress value={completed} max={session.steps.length} aria-label={`${completed} of ${session.steps.length} steps complete`} />
        <ol className="chat-work-steps">
          {session.steps.map((step, index) => <li key={`${index}:${step.label}`} data-state={step.state} aria-label={`${step.label}, ${step.state === "done" ? "complete" : step.state === "active" ? "in progress" : "not started"}`}>
            <span className="chat-work-step-mark" aria-hidden="true" />
            <span>{step.label}</span>
          </li>)}
        </ol>
      </> : <p className="chat-work-detail">{failed ? <>This session could not be read. <a href={href} target="_blank" rel="noreferrer">Open the source data</a>.</> : "Reading the latest session state…"}</p>}
    </section>
  );
}

function ChatAttachments({ attachments, message }: { attachments: MessageAttachment[]; message: ChatMessage }) {
  if (attachments.length === 0) return null;
  return (
    <div className="chat-attach">
      {attachments.map((attachment) => {
        const href = canonicalImageUrl(message, attachment) ?? (attachment.url ? sameOriginBlobUrl(attachment.url) : null);
        const name = attachment.fileName?.trim() || "Attachment";
        const type = attachment.mediaType.toLowerCase();
        const fileName = name.toLowerCase();
        const video = href && !type.startsWith("audio/") && (
          type.startsWith("video/")
          || /\.(mp4|webm|mov|m4v)$/u.test(fileName)
        );
        const image = href && type.startsWith("image/") && type !== "image/svg+xml" && !video;
        if (image) {
          return <ChatImageAttachment key={attachment.id} href={href} name={name} />;
        }
        if (video) {
          return (
            <video
              key={attachment.id}
              className="chat-attach-video"
              src={href}
              controls
              playsInline
              preload="metadata"
            >
              {name}
            </video>
          );
        }
        const audio = href && (
          type.startsWith("audio/")
          || /\.(mp3|wav|m4a|aac|ogg|oga)$/u.test(fileName)
        );
        if (audio) {
          return <ChatAudioNote key={attachment.id} href={href} name={name} transcription={voiceNoteTranscriptions(message.metadata)[attachment.id]} />;
        }
        if (href && type === "application/vnd.scout.work-session+json") {
          return <ChatWorkSessionAttachment key={attachment.id} href={href} />;
        }
        if (href && (type === "text/x-diff" || type === "text/x-patch" || /\.(diff|patch)$/u.test(fileName))) {
          return <ChatDiffAttachment key={attachment.id} href={href} name={name} />;
        }
        if (href && (type === "text/html" || type === "application/xhtml+xml")) {
          return (
            <iframe
              key={attachment.id}
              className="chat-attach-html"
              title={name}
              src={href}
              sandbox=""
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          );
        }
        return href ? (
          <a key={attachment.id} className="chat-attach-file" href={href} target="_blank" rel="noreferrer">
            {name}
          </a>
        ) : (
          <span key={attachment.id} className="chat-attach-file">{name}</span>
        );
      })}
    </div>
  );
}

function toggleReaction(
  message: ChatMessage,
  emoji: string,
  onReact: (messageId: string, emoji: string, remove: boolean) => void,
) {
  const mine = message.reactions?.find((chip) => chip.emoji === emoji)?.me === true;
  onReact(message.id, emoji, mine);
}

function ReactionChips({
  message,
  members,
  viewerActorId,
  onReact,
}: {
  message: ChatMessage;
  members: Map<string, ChannelMemberView>;
  viewerActorId?: string;
  onReact?: (messageId: string, emoji: string, remove: boolean) => void;
}) {
  const chips = message.reactions ?? [];
  if (chips.length === 0) return null;
  return (
    <div className="chat-reaction-row">
      {chips.map((chip) => {
        // Names ride on hover and in the accessible label; the click stays a
        // toggle. A server that sends no reactor list gets the count alone.
        const reactors = reactionReactorNames(chip.actorIds, members, viewerActorId);
        const who = reactors ? ` from ${reactors}` : "";
        const label = chip.me
          ? `${chip.emoji} ${chip.count}${who}, including you. Remove your reaction.`
          : `${chip.emoji} ${chip.count}${who}. React with ${chip.emoji}.`;
        return (
          <button
            type="button"
            key={chip.emoji}
            className="chat-reaction"
            data-me={chip.me ? "true" : undefined}
            data-reactors={reactors ?? undefined}
            aria-pressed={chip.me}
            aria-label={label}
            onClick={() => onReact && toggleReaction(message, chip.emoji, onReact)}
          >
            <span aria-hidden="true">{chip.emoji}</span>
            <span>{chip.count}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One reaction action opens the full allowlist in a stable, dismissable sheet. */
/**
 * Slack's own one-click reactions in its hover bar: done, looking, nicely
 * done. Each has a Slack name in the bridge's emoji map, so a click posts the
 * same reaction Slack would.
 */
const SLACK_QUICK_REACTIONS = ["✅", "👀", "🙌"] as const;

function ReactionPicker({
  message,
  onReact,
  pinned,
  onDismiss,
  quick,
}: {
  message: ChatMessage;
  onReact: (messageId: string, emoji: string, remove: boolean) => void;
  pinned: boolean;
  onDismiss: () => void;
  /** One-click reactions shown in the bar itself, before Add reaction. */
  quick?: readonly string[];
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const visible = [...REACTION_EMOJI_QUICK, ...REACTION_EMOJI_MORE];

  const close = useCallback(() => {
    setExpanded(false);
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (pinned) setExpanded(true);
  }, [pinned]);

  useEffect(() => {
    if (!expanded) return;
    const onPointer = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node | null)) return;
      close();
    };
    window.addEventListener("pointerdown", onPointer);
    return () => window.removeEventListener("pointerdown", onPointer);
  }, [expanded, close]);

  const onPickerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setFocusIndex((current) => (current + delta + visible.length) % visible.length);
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const emoji = visible[focusIndex];
      if (emoji) {
        toggleReaction(message, emoji, onReact);
        close();
      }
    }
  };

  const option = (emoji: string, index: number) => (
    <button
      type="button"
      key={emoji}
      role="option"
      tabIndex={index === focusIndex ? 0 : -1}
      aria-label={`React with ${emoji}`}
      aria-selected={index === focusIndex}
      aria-pressed={message.reactions?.some((chip) => chip.emoji === emoji && chip.me) === true}
      onClick={() => {
        toggleReaction(message, emoji, onReact);
        close();
      }}
    >
      {emoji}
    </button>
  );

  return (
    <div ref={pickerRef} className="chat-reaction-picker" data-expanded={expanded ? "true" : undefined} onKeyDown={onPickerKey}>
      {quick?.map((emoji) => {
        const mine = message.reactions?.some((chip) => chip.emoji === emoji && chip.me) === true;
        return (
          <button
            key={emoji}
            type="button"
            className="chat-turn-tool chat-reaction-quick"
            aria-label={mine ? `Remove your ${emoji} reaction` : `React with ${emoji}`}
            aria-pressed={mine}
            title={mine ? `Remove ${emoji}` : `React with ${emoji}`}
            onClick={() => toggleReaction(message, emoji, onReact)}
          >
            {emoji}
          </button>
        );
      })}
      <button
        type="button"
        className="chat-turn-tool chat-reaction-trigger"
        aria-label="Add reaction"
        aria-expanded={expanded}
        aria-haspopup="listbox"
        title="Add reaction"
        onClick={() => setExpanded((open) => !open)}
      >
        {quick ? <ReactGlyph size={16} /> : <SmilePlus size={16} strokeWidth={1.8} aria-hidden />}
      </button>
      {expanded ? (
        <div className="chat-reaction-sheet" role="listbox" aria-label="React to this message">
          {visible.map(option)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The connection plane, rendered from the protocol's own words.
 *
 * `summary` and `detail` come off the wire; the dot appears only when a live
 * process is attached, and a wake-on-delivery route says so in a sentence
 * rather than being demoted to a colour. An API participant renders its
 * declared mode instead — its endpoint-derived reading describes a session
 * this membership can never have.
 */
export function ReceptionBlock({
  member,
  nowMs,
}: {
  member: ChannelMemberView;
  nowMs: number;
}) {
  const view = memberReceptionView(member, nowMs);
  if (!view) return null;
  return (
    <div className="chat-conn" aria-label={view.ariaLabel}>
      <span className="chat-conn-state">
        {view.showDot ? <span className="dot dot--neutral" aria-hidden="true" /> : null}
        {view.summary}
      </span>
      <span className="chat-conn-detail">{view.detail}</span>
      {view.routeNote ? <span className="chat-conn-detail">{view.routeNote}</span> : null}
      {view.evidence ? <span className="chat-conn-evidence">{view.evidence}</span> : null}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="chat-k">{label}</span>
      <span className="chat-v">{children}</span>
    </>
  );
}

export function TimeAgo({ at, nowMs }: { at: number; nowMs: number }) {
  return (
    <time className="chat-when" dateTime={new Date(at).toISOString()}>
      {relativeTime(at, nowMs)}
    </time>
  );
}
