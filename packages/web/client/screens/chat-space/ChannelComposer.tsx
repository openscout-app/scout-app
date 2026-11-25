import { composerFileId } from "../../lib/composer-file-recovery.ts";
import { REACTION_EMOJI_MORE, REACTION_EMOJI_QUICK, type ConversationDefinition, type MessageMention } from "@openscout/protocol";
import { SLACK_EMOJI_SHORTCODES } from "../../../shared/slack-emoji-shortcodes.ts";
/**
 * The composer, and with it the boundary this feature turns on.
 *
 * One Send action. An untargeted send posts a channel update and invokes
 * nobody. Work is created only by an explicitly selected agent — picked from
 * the mention list or the ask selector — and the selection carries an actor
 * id. A display name typed into the body routes nothing: names are not
 * addresses, and parsing one would be the "fake participant" bug wearing a
 * different hat.
 *
 * Shape: a roomy rich field over a quiet toolbar, closed by a round send.
 * The ten formatting marks live above the field; the wire remains markdown
 * with explicit safe underline and strike encodings. `@` opens the real member list,
 * the selector opens the real agent list, and send sends.
 */

import { ArrowUp, Loader2, Mic, Plus, Square, Video, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { useComposerAttachments } from "../../components/MessageComposer/ComposerAttachments.tsx";

import { FORMATS, ComposerIcon, TOOL_PATHS, formatShortcut, type ComposerFormat } from "./composer-formats.tsx";
import { filterShortcuts, type COMPOSER_SHORTCUTS } from "./composer-shortcuts.ts";
import { ChatRichInput, type ChatRichInputHandle } from "./ChatRichInput.tsx";
import type { ChannelMemberView } from "./chat-api.ts";
import { useChatCapabilities, useChatTransport } from "./chat-transport.tsx";
import { MemberAvatar } from "./ChatAvatar.tsx";
import { SendGlyph } from "./rooms-glyphs.tsx";
import { clipElapsed } from "./chat-media-clip.ts";
import { VoiceNoteDraft, type VoiceNoteTranscriber } from "./VoiceNoteDraft.tsx";
import { useMediaClip } from "./use-media-clip.ts";

/** The composer's emoji set is the reaction set: one list, already vetted. */
const COMPOSER_EMOJI = [...REACTION_EMOJI_QUICK, ...REACTION_EMOJI_MORE] as const;
import {
  composerHint,
  isAgentMember,
  isApiParticipant,
  isAskableMember,
  memberDisplayName,
} from "./chat-space-model.ts";

export interface ComposerAutocompleteQuery {
  kind: "mention" | "channel" | "emoji";
  start: number;
  text: string;
}

export function readComposerAutocomplete(value: string, caret: number): ComposerAutocompleteQuery | null {
  const upToCaret = value.slice(0, Math.max(0, Math.min(caret, value.length)));
  const candidates: ComposerAutocompleteQuery[] = [];
  for (const candidate of [
    { kind: "mention", token: "@" },
    { kind: "channel", token: "#" },
    { kind: "emoji", token: ":" },
  ] as const) {
    const start = upToCaret.lastIndexOf(candidate.token);
    if (start < 0 || (start > 0 && !/\s/u.test(upToCaret[start - 1] ?? ""))) continue;
    const text = upToCaret.slice(start + 1);
    if (/\n/u.test(text)) continue;
    if (candidate.kind === "mention" && text.split(" ").length <= 3) candidates.push({ kind: candidate.kind, start, text });
    if (candidate.kind !== "mention" && !/\s/u.test(text) && (candidate.kind !== "emoji" || text.length >= 2)) {
      candidates.push({ kind: candidate.kind, start, text });
    }
  }
  return candidates.sort((left, right) => right.start - left.start)[0] ?? null;
}

/**
 * Where an `@` lands when the toolbar button types it instead of the person.
 * A mention token is only recognised at a word boundary (`readComposerAutocomplete`),
 * so the button has to supply the space the typist would have.
 */
export function mentionInsertion(draft: string, caret: number): { next: string; caret: number } {
  const clamped = Math.max(0, Math.min(caret, draft.length));
  const before = draft.slice(0, clamped);
  const spacer = before.length > 0 && !/\s$/u.test(before) ? " " : "";
  const head = `${before}${spacer}@`;
  return { next: `${head}${draft.slice(clamped)}`, caret: head.length };
}

export function ChannelComposer({
  members,
  conversationSuggestions = [],
  mentions = [],
  onMentionsChange,
  draft,
  onDraftChange,
  askTargetId,
  onAskTargetChange,
  onSend,
  sending,
  error,
  placeholder,
  variant = "channel",
  attachmentScope,
  autoFocus = false,
  request = null,
  onInvite,
  onDirect,
  formattingDefault = "on",
  voiceNoteTranscriber,
  destination,
}: {
  /**
   * Where a send goes, said under the box: for a foreign place, the
   * workspace, channel and the identity it posts as. Replaces the return hint
   * line, which then moves to the line's end.
   */
  destination?: ReactNode;
  voiceNoteTranscriber?: VoiceNoteTranscriber;
  onInvite?: (name: string) => void;
  onDirect?: (name: string) => void;
  members: ChannelMemberView[];
  conversationSuggestions?: ConversationDefinition[];
  mentions?: MessageMention[];
  onMentionsChange?: (mentions: MessageMention[]) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  askTargetId: string | null;
  onAskTargetChange: (actorId: string | null) => void;
  onSend: (files: File[], transcribeFiles?: File[]) => void | boolean | Promise<boolean | void>;
  sending: boolean;
  error: string | null;
  placeholder: string;
  variant?: "channel" | "thread";
  attachmentScope?: string;
  autoFocus?: boolean;
  /** A one-shot nudge from outside the composer; `at` makes each one distinct. */
  request?: { kind: "focus" | "ask"; at: number } | null;
  /** Whether the marks row starts open. A viewer's own Aa choice, once made, wins. */
  formattingDefault?: "on" | "off";
}) {
  const inputRef = useRef<ChatRichInputHandle | null>(null);
  const pickerButtonRef = useRef<HTMLButtonElement | null>(null);
  const [query, setQuery] = useState<ComposerAutocompleteQuery | null>(() => readComposerAutocomplete(draft, draft.length));
  const [activeIndex, setActiveIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The surface picks whether formatting starts open; a viewer's own Aa
  // choice, once stored, wins over that default.
  const formattingKey = useMemo(() => {
    try { const scope = JSON.parse(attachmentScope ?? "[]"); return `scout.chat.formatting:${scope[0] ?? "local"}`; }
    catch { return "scout.chat.formatting:local"; }
  }, [attachmentScope]);
  const readMarksOpen = useCallback(() => {
    const fallback = formattingDefault !== "off";
    try {
      const stored = localStorage.getItem(formattingKey);
      return stored === "on" ? true : stored === "off" ? false : fallback;
    } catch { return fallback; }
  }, [formattingKey, formattingDefault]);
  const [marksOpen, setMarksOpen] = useState(readMarksOpen);
  useEffect(() => { setMarksOpen(readMarksOpen()); }, [readMarksOpen]);
  const [activeMarks, setActiveMarks] = useState<ComposerFormat[]>([]);
  const [shortcutsOpen, setShortcutsOpen] = useState(draft.startsWith("/"));
  const [shortcutIndex, setShortcutIndex] = useState(0);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const shortcuts = filterShortcuts(draft.startsWith("/") ? draft : "");
  useEffect(() => { setShortcutIndex(0); }, [draft]);
  const marksId = useId();
  const capabilities = useChatCapabilities();
  const { source } = useChatTransport();
  const attachments = useComposerAttachments(attachmentScope, Boolean(attachmentScope));
  const [voiceReview, setVoiceReview] = useState(false);
  const [transcribeFiles, setTranscribeFiles] = useState<Set<string>>(() => new Set());
  const [voiceNote, setVoiceNote] = useState<{ file: File; scope: string | undefined; durationSeconds?: number } | null>(null);
  const reviewedNote = voiceNote && voiceNote.scope === attachmentScope && attachments.files.includes(voiceNote.file) ? voiceNote : null;
  const clip = useMediaClip((file, durationMs) => {
    if (attachments.stage([file], "Recorded") && file.type.startsWith("audio/") && voiceNoteTranscriber) {
      setVoiceReview(false); setVoiceNote({ file, scope: attachmentScope, durationSeconds: durationMs / 1000 });
      if (voiceNoteTranscriber.afterSend) setTranscribeFiles(previous => new Set([...previous, composerFileId(file)]));
    }
  }, attachmentScope);
  const canRecord = capabilities.attachments && clip.supported;
  const recordingBusy = clip.state.phase === "requesting" || clip.state.phase === "recording";
  const clipKind = clip.state.phase === "idle" ? null : clip.state.kind;
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const emojiRef = useRef<HTMLDivElement | null>(null);
  const addMenuId = useId();
  const emojiId = useId();
  const previewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = clip.stream;
  }, [clip.stream]);

  // The two popovers close on a press anywhere outside them or their button.
  useEffect(() => {
    if (!addMenuOpen && !emojiOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (addMenuOpen && !addMenuRef.current?.contains(target) && !addButtonRef.current?.contains(target)) setAddMenuOpen(false);
      if (emojiOpen && !emojiRef.current?.contains(target) && !emojiButtonRef.current?.contains(target)) setEmojiOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [addMenuOpen, emojiOpen]);

  // Opening either popover from the keyboard lands on its first item.
  useEffect(() => {
    if (addMenuOpen) addMenuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [addMenuOpen]);
  useEffect(() => {
    if (emojiOpen) emojiRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [emojiOpen]);

  const closeAddMenu = useCallback((returnFocus: boolean) => {
    setAddMenuOpen(false);
    if (returnFocus) addButtonRef.current?.focus();
  }, []);
  const closeEmoji = useCallback((returnFocus: boolean) => {
    setEmojiOpen(false);
    if (returnFocus) emojiButtonRef.current?.focus();
  }, []);

  /** Arrow keys walk a popover's items; Escape closes it and hands focus back. */
  const popoverKeys = useCallback((
    event: ReactKeyboardEvent<HTMLDivElement>,
    selector: string,
    close: (returnFocus: boolean) => void,
    columns = 1,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    const step = event.key === "ArrowDown" ? columns
      : event.key === "ArrowUp" ? -columns
        : event.key === "ArrowRight" && columns > 1 ? 1
          : event.key === "ArrowLeft" && columns > 1 ? -1
            : 0;
    if (!step) return;
    event.preventDefault();
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>(selector)];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(index + step + items.length) % items.length];
    next?.focus();
  }, []);

  const insertEmoji = useCallback((emoji: string) => {
    const editor = inputRef.current;
    if (editor) editor.insertText(emoji);
    else onDraftChange(`${draft}${emoji}`);
    setEmojiOpen(false);
  }, [draft, onDraftChange]);

  // The picker offers only members the roster declares askable. An unaskable API
  // participant stays visible in an inert explanation rather than disappearing
  // from the room. Where the server has no asks, the control is not offered.
  const askable = useMemo(
    () => (capabilities.asks ? members.filter(isAskableMember) : []),
    [capabilities.asks, members],
  );
  const apiParticipants = useMemo(() => members.filter(member => isApiParticipant(member) && !isAskableMember(member)), [members]);
  const target = useMemo(
    () => members.find((member) => member.actorId === askTargetId) ?? null,
    [members, askTargetId],
  );
  // A recovered draft must never silently become an ordinary post just
  // because its selected agent has left, is still loading, or cannot be asked.
  const targetUnavailable = Boolean(askTargetId)
    && (!capabilities.asks || !target || !isAskableMember(target));

  const matches = useMemo(() => {
    if (query?.kind !== "mention") return [];
    const needle = query.text.trim().toLowerCase();
    const ranked = members.filter((member) =>
      memberDisplayName(member).toLowerCase().includes(needle)
      || member.displayName.toLowerCase().includes(needle));
    return [...ranked].sort((left, right) =>
      Number(isAgentMember(right)) - Number(isAgentMember(left)),
    ).slice(0, 8);
  }, [members, query]);
  const channelMatches = useMemo(() => {
    if (query?.kind !== "channel") return [];
    const needle = query.text.toLowerCase();
    return conversationSuggestions.filter(channel => channel.title.toLowerCase().includes(needle)).slice(0, 8);
  }, [conversationSuggestions, query]);
  const emojiMatches = useMemo(() => {
    if (query?.kind !== "emoji" || (source !== "slack" && conversationSuggestions.length === 0)) return [];
    const needle = query.text.toLowerCase();
    return SLACK_EMOJI_SHORTCODES.filter(item => `${item.name} ${item.keywords}`.toLowerCase().includes(needle)).slice(0, 8);
  }, [query, source, conversationSuggestions]);
  const autocompleteCount = query?.kind === "mention" ? matches.length : query?.kind === "channel" ? channelMatches.length : emojiMatches.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query?.kind, query?.text]);

  useEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!request) return;
    if (request.kind === "ask" && capabilities.asks) setPickerOpen(true);
    else inputRef.current?.focus();
    // Only a new request acts; the capability read is not a trigger.
  }, [request]);

  const closePicker = useCallback((returnFocus: "toggle" | "input") => {
    setPickerOpen(false);
    if (returnFocus === "toggle") pickerButtonRef.current?.focus();
    else inputRef.current?.focus();
  }, []);

  const applyMention = useCallback(
    (member: ChannelMemberView) => {
      if (mentions.length >= 20 && !mentions.some(mention => mention.actorId === member.actorId)) return;
      const editor = inputRef.current;
      const before = editor?.textBeforeCaret() ?? draft;
      const detected = query ?? readComposerAutocomplete(before, before.length);
      const active = detected?.kind === "mention" ? detected : null;
      const label = memberDisplayName(member);
      if (!editor) {
        onDraftChange(`${draft}${draft.endsWith(" ") || draft === "" ? "" : " "}@${label} `);
      } else if (!active) {
        editor.insertText(`${before.endsWith(" ") || before === "" ? "" : " "}@${label} `);
      } else {
        editor.replaceToken(active.start, `@${label} `);
      }
      if (!mentions.some(mention => mention.actorId === member.actorId)) {
        onMentionsChange?.([...mentions, { actorId: member.actorId, label }]);
      }
      // Mentions never choose work routing; the Ask picker owns that decision.
      setQuery(null);
    },
    [draft, mentions, onMentionsChange, onDraftChange, query],
  );

  const applyAutocomplete = useCallback(() => {
    if (!query) return;
    if (query.kind === "mention") {
      const picked = matches[activeIndex];
      if (picked) applyMention(picked);
      return;
    }
    if (query.kind === "channel") {
      const picked = channelMatches[activeIndex];
      if (picked) inputRef.current?.replaceToken(query.start, `#${picked.title} `);
    } else {
      const picked = emojiMatches[activeIndex];
      if (picked) inputRef.current?.replaceToken(query.start, `${picked.emoji} `);
    }
    setQuery(null);
  }, [activeIndex, applyMention, channelMatches, emojiMatches, matches, query]);

  /**
   * The `@` button is the pointer route into the same mention list the keyboard
   * opens: it types the `@` the person would have typed, at their caret, and
   * leaves the query open on an empty needle so the whole roster is showing.
   */
  const openMentionList = useCallback(() => {
    const editor = inputRef.current;
    const before = editor?.textBeforeCaret() ?? draft;
    const spacer = before.length > 0 && !/\s$/u.test(before) ? " " : "";
    editor?.insertText(`${spacer}@`);
    if (!editor) {
      const { next, caret } = mentionInsertion(draft, draft.length);
      onDraftChange(next);
      setQuery({ kind: "mention", start: caret - 1, text: "" });
    } else {
      const nextBefore = editor.textBeforeCaret();
      setQuery({ kind: "mention", start: Math.max(0, nextBefore.length - 1), text: "" });
    }
    setPickerOpen(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [draft, onDraftChange]);

  const needsAskInstructions = Boolean(askTargetId) && draft.trim().length === 0;
  const canSend = !sending && !recordingBusy && !(reviewedNote && voiceReview) && !attachments.recoveryPending && !targetUnavailable && !needsAskInstructions && (draft.trim().length > 0 || attachments.hasFiles);
  const submit = useCallback(() => {
    if (!canSend) return;
    const files = attachments.files;
    void attachments.waitForRecovery().then(() => onSend(files, files.filter(file => transcribeFiles.has(composerFileId(file))))).then((sent) => {
      if (sent !== false) attachments.clear(files);
    });
  }, [attachments, canSend, draft, onSend, transcribeFiles]);

  const runShortcut = (command: typeof COMPOSER_SHORTCUTS[number]) => {
    if (!command.action || sending) return;
    const args = draft.startsWith(command.name) ? draft.slice(command.name.length).trim() : "";
    if (command.action === "ask") {
      const match = /^@([^ ]+)\s*(.*)$/s.exec(args);
      const agent = askable.find(member => (member.displayName.toLowerCase() === match?.[1]?.toLowerCase() || member.actorId === match?.[1] || memberDisplayName(member).toLowerCase() === match?.[1]?.toLowerCase()));
      if (match && agent) { onAskTargetChange(agent.actorId); onDraftChange(match[2] ?? ""); }
      else if (!args) { setPickerOpen(true); onDraftChange(""); }
      else { setShortcutError("Choose an askable agent in this room: /ask @agent question"); return; }
    } else if (command.action === "invite" && onInvite) { onInvite(args.replace(/^@/, "")); onDraftChange(""); }
    else if (command.action === "dm" && onDirect) { onDirect(args.replace(/^@/, "")); onDraftChange(""); }
    else return;
    setShortcutsOpen(false); setQuery(null); inputRef.current?.focus();
  };

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // IME confirmation belongs to the text input, including while a mention
      // list is open. Some WebKit versions expose only the legacy 229 code.
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (shortcutsOpen) {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setShortcutsOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setShortcutIndex(index => (index + (event.key === "ArrowDown" ? 1 : -1) + shortcuts.length) % Math.max(1, shortcuts.length)); return; }
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const command = shortcuts[shortcutIndex]; if (command) runShortcut(command); return; }
      }
      if (query && autocompleteCount > 0) {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setQuery(null);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((index) => (index + 1) % autocompleteCount);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((index) => (index - 1 + autocompleteCount) % autocompleteCount);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          applyAutocomplete();
          return;
        }
      }
      // Our own open list closes before Esc reaches the surface's panel handler.
      if (event.key === "Escape" && pickerOpen) {
        event.preventDefault();
        event.stopPropagation();
        setPickerOpen(false);
        return;
      }
      const format = formatShortcut(event);
      if (format) { event.preventDefault(); inputRef.current?.applyFormat(format); return; }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (canSend) submit();
      }
    },
    [applyAutocomplete, autocompleteCount, canSend, pickerOpen, query, submit, shortcutsOpen, shortcuts, shortcutIndex, runShortcut],
  );

  const hint = composerHint(target ? memberDisplayName(target) : null);
  const sendTitle = target
    ? `Ask ${memberDisplayName(target)} — creates a tracked request`
    : variant === "thread"
      ? "Send reply"
      : "Send to the channel";

  return (
    <>
    <div
      className="chat-composer"
      data-variant={variant}
      data-drag={capabilities.attachments && attachments.dragActive ? "true" : undefined}
      {...(capabilities.attachments ? attachments.dropHandlers : {})}
    >
      {mentions.length > 0 ? <div className="chat-mention-recipients" aria-label="Mention recipients">
        <span>Mention attention{mentions.length >= 20 ? " (20 maximum)" : ""}:</span>
        {mentions.map(mention => <button key={mention.actorId} type="button"
          onClick={() => onMentionsChange?.(mentions.filter(item => item.actorId !== mention.actorId))}
          aria-label={`Remove mention for ${mention.label || mention.actorId}`}>
          {mention.label || mention.actorId} ×
        </button>)}
      </div> : null}
      {/* Who is being asked is stated once, on the control beside Send. What
          remains here is the part that control cannot say: what pressing it
          will actually create. */}
      {targetUnavailable ? (
        <div className="chat-ask-target" role="status">
          <span className="chat-composer-hint">The selected agent is unavailable. Choose another agent or post to the channel.</span>
          <button type="button" className="chat-ask-target-clear" onClick={() => onAskTargetChange(null)}>
            {variant === "thread" ? "Post reply instead" : "Post to channel instead"}
          </button>
        </div>
      ) : target && hint ? (
        <div className="chat-ask-target">
          <span className="chat-composer-hint" role="status">{needsAskInstructions ? "Add instructions for the agent before sending. Attachments can accompany your request." : hint}</span>
          <button
            type="button"
            className="chat-ask-target-clear"
            onClick={() => onAskTargetChange(null)}
            aria-label="Clear ask target — send as a channel update instead"
          >
            ×
          </button>
        </div>
      ) : null}

      {attachments.recoveryPending ? <p className="chat-composer-hint" role="status">Restoring attachments…</p> : null}
      {attachments.recoveryError ? <p className="chat-send-error" role="alert">{attachments.recoveryError}</p> : null}
      {marksOpen ? (
        <div className="chat-composer-marks" id={marksId} role="toolbar" aria-label="Formatting">
          {FORMATS.map((format, index) => <span className="chat-format-slot" key={format.id}>
            {/* Slack groups the marks as B I U S | link | lists | quote and code. */}
            {index === 4 || index === 7 || (source === "slack" && index === 5) ? <span className="chat-composer-divider" aria-hidden="true" /> : null}
            <button type="button" className="chat-composer-tool chat-composer-tool--icon" disabled={sending}
              aria-label={format.label} title={format.label} aria-pressed={activeMarks.includes(format.id)} data-active={activeMarks.includes(format.id)}
              onMouseDown={event => event.preventDefault()} onClick={() => inputRef.current?.applyFormat(format.id)}>
              <ComposerIcon paths={format.svg} />
            </button>
          </span>)}
        </div>
      ) : null}
      <ChatRichInput
        ref={inputRef}
        value={draft}
        onFormatsChange={setActiveMarks}
        placeholder={placeholder}
        disabled={sending}
        onChange={(markdown) => {
          onDraftChange(markdown);
          setShortcutsOpen(markdown.startsWith("/"));
          setShortcutError(null);
          const before = inputRef.current?.textBeforeCaret() ?? markdown;
          setQuery(readComposerAutocomplete(before, before.length));
        }}
        onKeyDown={onKeyDown}
        onPaste={capabilities.attachments ? attachments.onPaste : undefined}
        onDragOver={capabilities.attachments ? attachments.dropHandlers.onDragOver : undefined}
        onDrop={capabilities.attachments ? attachments.dropHandlers.onDrop : undefined}
        onBlur={() => setQuery(null)}
      />
      {reviewedNote && voiceNoteTranscriber ? <VoiceNoteDraft key={attachmentScope + reviewedNote.file.name + reviewedNote.file.lastModified} file={reviewedNote.file} transcriber={voiceNoteTranscriber}
        durationHint={reviewedNote.durationSeconds}
        afterSend={transcribeFiles.has(composerFileId(reviewedNote.file))}
        onAfterSendChange={enabled => setTranscribeFiles(previous => { const next = new Set(previous); if (enabled) next.add(composerFileId(reviewedNote.file)); else next.delete(composerFileId(reviewedNote.file)); return next; })}
        onReviewChange={setVoiceReview}
        onUse={(text, keepAudio) => { setTranscribeFiles(previous => { const next = new Set(previous); next.delete(composerFileId(reviewedNote.file)); return next; }); onDraftChange([draft.trimEnd(), text].filter(Boolean).join("\n\n")); if (!keepAudio) attachments.remove(reviewedNote.file); setVoiceReview(false); setVoiceNote(null); }}
        onKeepAudio={() => { setTranscribeFiles(previous => { const next = new Set(previous); next.delete(composerFileId(reviewedNote.file)); return next; }); setVoiceReview(false); }} onDiscard={() => { setTranscribeFiles(previous => { const next = new Set(previous); next.delete(composerFileId(reviewedNote.file)); return next; }); attachments.remove(reviewedNote.file); setVoiceReview(false); setVoiceNote(null); }} /> : null}
      {capabilities.attachments ? (
        <>
          <input
            ref={attachments.inputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,.mp4,.webm,.mov,.mp3,.wav,.m4a,.html,.htm,text/html,text/markdown,.md,.markdown,text/plain,.txt"
            className="chat-composer-file-input"
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => {
              attachments.stage([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          {attachments.files.length > 0 ? (
            <div className="chat-composer-files" aria-label="Attached files">
              {attachments.files.filter(file => file !== reviewedNote?.file).map((file) => (
                <span key={`${file.name}:${file.size}:${file.lastModified}`} className="chat-composer-file">
                  <span>{file.name}</span>
                  {voiceNoteTranscriber && file.type.startsWith("audio/") ? <button type="button" onClick={() => { setVoiceReview(false); setVoiceNote({ file, scope: attachmentScope }); }}>Review transcript</button> : null}
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => attachments.remove(file)}
                  >
                    <X size={12} strokeWidth={2} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {attachments.error ? (
            <p className="chat-send-error" role="alert">{attachments.error}</p>
          ) : null}
        </>
      ) : null}

      {query?.kind === "mention" && matches.length > 0 ? (
        <div className="chat-mention-popup" role="listbox" aria-label="Mention a member">
          {matches.map((member, index) => (
            <button
              key={member.actorId}
              type="button"
              role="option"
              disabled={mentions.length >= 20 && !mentions.some(mention => mention.actorId === member.actorId)}
              aria-selected={index === activeIndex}
              data-active={index === activeIndex}
              className="chat-mention-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyMention(member)}
            >
              <MemberAvatar member={member} size={18} />
              {memberDisplayName(member)}
              <span className="chat-mention-kind">
                {isApiParticipant(member) ? "via API" : isAgentMember(member) ? "agent" : "person"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {query?.kind === "channel" && channelMatches.length > 0 ? (
        <div className="chat-mention-popup" role="listbox" aria-label="Link a channel">
          {channelMatches.map((channel, index) => (
            <button key={channel.id} type="button" role="option" aria-selected={index === activeIndex} data-active={index === activeIndex} className="chat-mention-option"
              onMouseDown={event => event.preventDefault()} onClick={() => { inputRef.current?.replaceToken(query.start, `#${channel.title} `); setQuery(null); }}>
              <span className="chat-mention-kind" aria-hidden="true">#</span>
              {channel.title}
              <span className="chat-mention-kind">channel</span>
            </button>
          ))}
        </div>
      ) : null}
      {query?.kind === "emoji" && emojiMatches.length > 0 ? (
        <div className="chat-mention-popup" role="listbox" aria-label="Insert an emoji shortcode">
          {emojiMatches.map((item, index) => (
            <button key={item.name} type="button" role="option" aria-selected={index === activeIndex} data-active={index === activeIndex} className="chat-mention-option"
              onMouseDown={event => event.preventDefault()} onClick={() => { inputRef.current?.replaceToken(query.start, `${item.emoji} `); setQuery(null); }}>
              <span aria-hidden="true">{item.emoji}</span>
              <span>:{item.name}:</span>
              <span className="chat-mention-kind">{item.keywords.split(" ")[0]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {pickerOpen && capabilities.asks ? (
        <div
          className="chat-mention-popup"
          role="listbox"
          aria-label="Choose an agent to ask"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            closePicker("toggle");
          }}
        >
          {askable.length === 0 && apiParticipants.length === 0 ? (
            <div className="chat-side-empty">
              No agent has joined this channel yet. Invite one from the Invite sheet.
            </div>
          ) : (
            <>
              {/* Disarming has to be reachable from the same list that armed
                  it — the `×` on the banner is a pointer-only route. */}
              {target ? (
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="chat-mention-option"
                  onClick={() => {
                    onAskTargetChange(null);
                    closePicker("input");
                  }}
                >
                  Send to the channel
                  <span className="chat-mention-kind">asks nobody</span>
                </button>
              ) : null}
              {askable.map((member) => (
                <button
                  key={member.actorId}
                  type="button"
                  role="option"
                  aria-selected={member.actorId === askTargetId}
                  data-active={member.actorId === askTargetId}
                  className="chat-mention-option"
                  onClick={() => {
                    onAskTargetChange(member.actorId);
                    closePicker("input");
                  }}
                >
                  <MemberAvatar member={member} size={18} />
                  {memberDisplayName(member)}
                  <span className="chat-mention-kind">{member.reception.summary.toLowerCase()}</span>
                </button>
              ))}
              {/* Present but not selectable: the roster has not made these API
                  members askable, so a post is the way to reach them. */}
              {apiParticipants.map((member) => (
                <button
                  key={member.actorId}
                  type="button"
                  role="option"
                  aria-selected={false}
                  aria-disabled="true"
                  disabled
                  className="chat-mention-option"
                >
                  <MemberAvatar member={member} size={18} />
                  {memberDisplayName(member)}
                  <span className="chat-mention-kind">via API — post to reach it</span>
                </button>
              ))}
              {askable.length === 0 ? (
                <div className="chat-side-empty">
                  API participants read posts when they poll. Send a channel message instead.
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {shortcutsOpen ? <div className="chat-composer-shortcuts" role="listbox" aria-label="Shortcuts">
        <div className="chat-shortcuts-label">Shortcuts</div>
        {shortcuts.map((command, index) => {
          const available = Boolean(command.action && (command.action === "ask" ? capabilities.asks : command.action === "invite" ? onInvite : onDirect));
          return <button key={command.name} type="button" role="option" aria-selected={index === shortcutIndex} disabled={!available} data-active={index === shortcutIndex} className="chat-shortcut-row"
            onMouseDown={event => event.preventDefault()} onClick={() => runShortcut(command)}>
            <strong>{command.name}</strong><code>{command.args}</code><span>{command.description}</span>
            {!command.action ? <small>Soon</small> : index === shortcutIndex ? <kbd>↵</kbd> : null}
          </button>;
        })}
        {!shortcuts.length ? <p className="chat-side-empty">No matching shortcuts</p> : null}
        <footer>↑↓ navigate · ↵ run · esc close · type to filter</footer>
      </div> : null}
      {shortcutError ? <p className="chat-send-error" role="alert">{shortcutError}</p> : null}
      {error ? <p className="chat-send-error" role="alert">{error}</p> : null}

      {addMenuOpen && capabilities.attachments ? (
        <div
          ref={addMenuRef}
          id={addMenuId}
          className="chat-composer-menu"
          role="menu"
          aria-label="Add to message"
          onKeyDown={(event) => popoverKeys(event, "[role=menuitem]", closeAddMenu)}
        >
          <button type="button" role="menuitem" className="chat-composer-menu-item"
            onClick={() => { closeAddMenu(false); attachments.openPicker(); }}>
            <Plus size={16} strokeWidth={1.8} aria-hidden />
            Upload a file
          </button>
          {canRecord ? (
            <>
              <button type="button" role="menuitem" className="chat-composer-menu-item" disabled={recordingBusy}
                onClick={() => { closeAddMenu(false); clip.start("audio"); }}>
                <Mic size={16} strokeWidth={1.8} aria-hidden />
                Record audio clip
              </button>
              <button type="button" role="menuitem" className="chat-composer-menu-item" disabled={recordingBusy}
                onClick={() => { closeAddMenu(false); clip.start("video"); }}>
                <Video size={16} strokeWidth={1.8} aria-hidden />
                Record video clip
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {emojiOpen ? (
        <div
          ref={emojiRef}
          id={emojiId}
          className="chat-composer-emoji"
          role="dialog"
          aria-label="Insert emoji"
          onKeyDown={(event) => popoverKeys(event, "button", closeEmoji, 6)}
        >
          {COMPOSER_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="chat-composer-emoji-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertEmoji(emoji)}
              aria-label={`Insert ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}

      {recordingBusy ? (
        <div className="chat-composer-recording" role="status" aria-live="polite">
          {clip.state.phase === "recording" && clip.state.kind === "video" ? (
            <video ref={previewRef} className="chat-composer-recording-preview" autoPlay muted playsInline aria-hidden="true" />
          ) : null}
          <span className="chat-composer-recording-dot" data-live={clip.state.phase === "recording" ? "true" : undefined} aria-hidden="true" />
          <span className="chat-composer-recording-label">
            {clip.state.phase === "requesting"
              ? `Waiting for the ${clip.state.kind === "audio" ? "microphone" : "camera"}…`
              : `Recording ${clipKind === "audio" ? "audio" : "video"}`}
          </span>
          {clip.state.phase === "recording" ? (
            <span className="chat-composer-recording-time">{clipElapsed(clip.elapsedMs)}</span>
          ) : null}
          <span className="chat-composer-recording-actions">
            <button type="button" className="chat-composer-recording-cancel" onClick={clip.discard} aria-label="Cancel recording" title="Cancel recording">
              <X size={16} strokeWidth={1.8} aria-hidden />
            </button>
            <button type="button" className="chat-composer-recording-stop" onClick={clip.stop}
              disabled={clip.state.phase !== "recording"} aria-label="Stop recording" title="Stop recording">
              <Square size={12} fill="currentColor" strokeWidth={1.8} aria-hidden />
              Stop
            </button>
          </span>
        </div>
      ) : null}
      {clip.state.phase === "error" ? (
        <p className="chat-send-error chat-composer-clip-error" role="alert">
          {clip.state.message}
          <button type="button" className="chat-ask-target-clear" onClick={clip.dismissError} aria-label="Dismiss">×</button>
        </p>
      ) : null}

      <div className="chat-composer-foot">
        <span className="chat-composer-tools">
          {capabilities.attachments ? (
            <button
              ref={addButtonRef}
              type="button"
              className="chat-composer-tool chat-composer-tool--icon chat-composer-add"
              data-active={addMenuOpen}
              aria-haspopup="menu"
              aria-expanded={addMenuOpen}
              aria-controls={addMenuOpen ? addMenuId : undefined}
              onClick={() => { setEmojiOpen(false); setAddMenuOpen((open) => !open); }}
              disabled={sending}
              aria-label={canRecord ? "Attach a file or record a clip" : "Attach a file"}
              title={canRecord ? "Attach a file or record a clip" : "Attach a file"}
            >
              <ComposerIcon paths={TOOL_PATHS.plus} />
            </button>
          ) : null}
          <button
            type="button"
            className="chat-composer-tool chat-composer-tool--icon"
            data-active={marksOpen}
            aria-expanded={marksOpen}
            aria-controls={marksOpen ? marksId : undefined}
            disabled={sending}
            aria-label={marksOpen ? "Hide formatting" : "Show formatting"}
            title={marksOpen ? "Hide formatting" : "Show formatting"}
            onClick={() => setMarksOpen(open => { const next = !open; try { localStorage.setItem(formattingKey, next ? "on" : "off"); } catch {} return next; })}
          >
            <span className="chat-composer-aa">Aa</span>
          </button>
          <button
            ref={emojiButtonRef}
            type="button"
            className="chat-composer-tool chat-composer-tool--icon"
            data-active={emojiOpen}
            aria-haspopup="dialog"
            aria-expanded={emojiOpen}
            aria-controls={emojiOpen ? emojiId : undefined}
            // Keep the caret where it is in the field; the emoji goes there.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => { setAddMenuOpen(false); setEmojiOpen((open) => !open); }}
            disabled={sending}
            aria-label="Insert emoji"
            title="Emoji"
          >
            <ComposerIcon paths={TOOL_PATHS.emoji} />
          </button>
          <button
            type="button"
            className="chat-composer-tool chat-composer-tool--icon"
            disabled={sending}
            onClick={openMentionList}
            aria-label="Mention a member"
            title="Mention a member"
          >
            <ComposerIcon paths={TOOL_PATHS.at} />
          </button>
          {canRecord ? (
            <>
              <span className="chat-composer-divider" aria-hidden="true" />
              <button
                type="button"
                className="chat-composer-tool chat-composer-tool--icon"
                data-active={recordingBusy && clipKind === "video"}
                onClick={() => clip.start("video")}
                disabled={sending || recordingBusy}
                aria-label="Record a video clip"
                title="Record video clip"
              >
                <ComposerIcon paths={TOOL_PATHS.video} />
              </button>

            </>
          ) : null}
          {capabilities.asks ? <>
            <span className="chat-composer-divider" aria-hidden="true" />
            <button type="button" className="chat-composer-tool chat-composer-tool--icon" aria-label="Run a shortcut" title="Run a shortcut" data-active={shortcutsOpen} aria-expanded={shortcutsOpen} disabled={sending}
              onMouseDown={event => event.preventDefault()} onClick={() => { if (!shortcutsOpen && !draft) inputRef.current?.insertText("/"); setShortcutsOpen(open => !open); inputRef.current?.focus(); }}>
              <ComposerIcon paths={TOOL_PATHS.slash} />
            </button>
          </> : null}
        </span>
        <span className="chat-composer-right">
          {/* Ask-an-agent is an icon like the rest: a robot unarmed, the
              agent's face once armed. The hint line above says what it does;
              the tooltip says who. */}
          {capabilities.asks ? (
            <button
              ref={pickerButtonRef}
              type="button"
              className="chat-composer-tool chat-composer-tool--icon chat-composer-ask"
              data-armed={target ? "true" : undefined}
              data-active={pickerOpen}
              aria-expanded={pickerOpen}
              aria-haspopup="listbox"
              disabled={sending}
              aria-label={target ? `Change agent — currently asking ${memberDisplayName(target)}` : "Ask an agent"}
              title={target
                ? `Change agent — currently asking ${memberDisplayName(target)}`
                : "Ask an agent — turns this message into a tracked request"}
              onClick={() => setPickerOpen((open) => !open)}
            >
              {target ? <MemberAvatar member={target} size={18} /> : <ComposerIcon paths={TOOL_PATHS.robot} />}
            </button>
          ) : null}
          {canRecord ? <>
              <button
                type="button"
                className="chat-composer-tool chat-composer-tool--icon chat-composer-mic"
                data-active={recordingBusy && clipKind === "audio"}
                onClick={() => clip.start("audio")}
                disabled={sending || recordingBusy}
                aria-label="Record an audio clip"
                title="Record audio clip"
              >
                <ComposerIcon paths={TOOL_PATHS.mic} />
              </button>
          </> : null}
          <button
            type="button"
            className="chat-composer-send"
            data-mode={target ? "ask" : undefined}
            onClick={submit}
            disabled={!canSend}
            aria-label={sending ? "Sending…" : sendTitle}
            title={sending ? "Sending…" : sendTitle}
          >
            {sending
              ? <Loader2 size={15} strokeWidth={2.2} className="chat-composer-spin" aria-hidden />
              : source === "slack" ? <SendGlyph size={16} /> : <ArrowUp size={16} strokeWidth={2.2} aria-hidden />}
          </button>
        </span>
      </div>
    </div>
    {destination ? (
      <div className="chat-composer-destination">
        <p className="chat-composer-destination-line">{destination}</p>
        <p className="chat-composer-destination-keys" aria-hidden="true"><kbd>Shift</kbd><kbd>Return</kbd> new line</p>
      </div>
    ) : (
      <p className="chat-composer-return-hint" aria-hidden="true"><b>Shift + Return</b> to add a new line</p>
    )}
    </>
  );
}
