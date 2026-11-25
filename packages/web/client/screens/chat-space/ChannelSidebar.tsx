/**
 * The sidebar: channels, direct messages, and one quiet Invite action.
 *
 * No session rows, no sort chrome, no member counts — a teammate should parse
 * this in one glance. The accent appears here for exactly one reason: a row
 * holding something addressed to the viewer that is still owed. Ordinary
 * traffic reorders quietly and decorates nothing.
 *
 * Pin, archive, sort, latest-only, and a docked DM well live in the Studio
 * study `/studies/chat-space-rails`, not here, until that direction is picked.
 * Slack hide and mute are browser-local row actions, never Slack writes.
 * Collapse and resize live on the column's header band (ChatSpaceSurface),
 * the same law as Scout's Hudson rails.
 *
 * The foot carries who you are. Identity used to sit in the top bar, which put
 * it as far from the channel list as the window allows; it belongs at the
 * bottom of the column it governs.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { BellOff, Eye, EyeOff, MoreHorizontal, Plus, Search, Users } from "lucide-react";
import type { ChatReadState, ConversationDefinition } from "@openscout/protocol";
import { summarizeChatReadState } from "../../../shared/chat-read-state.ts";

import type { ScoutThemePreference } from "../../lib/theme.ts";
import { useSlashToFocus } from "../../lib/keyboard-nav.ts";
import { useChatCapabilities, useChatTransport } from "./chat-transport.tsx";
import { CaretGlyph, VercelMark } from "./rooms-glyphs.tsx";
import { MemberCoin } from "./ChatAvatar.tsx";
import { SpaceSwitcher } from "./SpaceSwitcher.tsx";
import type { ChannelFeed, ChannelMemberView, ChatChannelLastMessage, ChatSpaceView } from "./chat-api.ts";
import type { ConversationNavigationRow } from "./chat-conversation-navigation.ts";
import { readChatSidebarPrefs, toggleId, writeChatSidebarPrefs } from "./chat-sidebar-prefs.ts";
import { activityVerb, channelLabel, freshestRowPreview, isAgentMember, isStatusMessage, listTime, type ForYouItem, type RowPreview } from "./chat-space-model.ts";
import { chatMessagePreviewText } from "./chat-message-preview.ts";

const THEME_CHOICES: { value: ScoutThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

function moveFocus(container: HTMLElement | null, from: HTMLElement, delta: number) {
  if (!container) return;
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-side-row]"));
  const index = rows.indexOf(from);
  if (index < 0) return;
  const next = rows[(index + delta + rows.length) % rows.length];
  next?.focus();
}

/**
 * What the sidebar has seen of a conversation, from reads the surface already
 * made: the last message of a feed once it was opened, and the agent in a
 * direct chat once its roster was read. Nothing here is fetched per row, so a
 * room never opened this session has no preview and says so quietly.
 */
export interface SidebarRowSeen {
  preview?: RowPreview;
  harness?: string;
  working?: boolean;
}

const RECENT_MS = 15 * 60_000;

/** What the ⌘K palette shows beside a conversation: the sidebar's own facts. */
export interface ConversationFacts {
  detail: string | null;
  /** Chip text ("3", "3+"), or null when nothing is unread. */
  unread: string | null;
  mentioned: boolean;
  /** Latest activity we know of, for recency order; 0 when unknown. */
  at: number;
}

export function conversationFacts(
  conversation: ConversationDefinition,
  input: {
    readStates: Record<string, ChatReadState>;
    seen: Record<string, SidebarRowSeen>;
    lastMessages: Record<string, ChatChannelLastMessage>;
    viewerActorId: string | null;
  },
): ConversationFacts {
  const isDirect = conversation.kind === "direct" || conversation.kind === "group_direct";
  const readState = input.readStates[conversation.id];
  const attention = readState ? summarizeChatReadState(readState) : null;
  const unread = attention && (attention.unread > 0 || attention.incomplete)
    ? `${attention.unread || ""}${attention.incomplete ? "+" : ""}`
    : null;
  const facts = input.seen[conversation.id];
  const preview = freshestRowPreview(facts?.preview, input.lastMessages[conversation.id], input.viewerActorId);
  const people = conversation.participantIds?.length ?? 0;
  const detail = !isDirect
    ? people > 0 ? `${people} in the room` : null
    : conversation.kind === "group_direct"
      ? people > 0 ? `${people} in the chat` : null
      : facts?.harness ?? null;
  return { detail, unread, mentioned: Boolean(attention && attention.mentions > 0), at: preview?.at ?? 0 };
}

export function useSidebarSeen({
  channelId,
  feed,
  feedIsCurrent,
  members,
  membersAreCurrent,
  viewerActorId,
}: {
  channelId: string | null;
  feed: ChannelFeed | null;
  feedIsCurrent: boolean;
  members: ChannelMemberView[];
  membersAreCurrent: boolean;
  viewerActorId: string | null;
}): Record<string, SidebarRowSeen> {
  const [seen, setSeen] = useState<Record<string, SidebarRowSeen>>({});

  useEffect(() => {
    if (!channelId || !feed || !feedIsCurrent) return;
    const last = feed.messages
      .filter((message) => !message.replyToMessageId && !isStatusMessage(message))
      .reduce<ChannelFeed["messages"][number] | null>(
        (latest, message) => (!latest || message.createdAt >= latest.createdAt ? message : latest),
        null,
      );
    if (!last) return;
    const who = last.actorId === viewerActorId
      ? "You"
      : last.actorName?.trim()
        || members.find((member) => member.actorId === last.actorId)?.displayName
        || last.actorId;
    const preview = { who, text: chatMessagePreviewText(last), at: last.createdAt };
    setSeen((current) => {
      const before = current[channelId]?.preview;
      if (before && before.at === preview.at && before.text === preview.text && before.who === preview.who) return current;
      return { ...current, [channelId]: { ...current[channelId], preview } };
    });
  }, [channelId, feed, feedIsCurrent, members, viewerActorId]);

  useEffect(() => {
    if (!channelId || !membersAreCurrent) return;
    const agent = members.find((member) => member.actorId !== viewerActorId && isAgentMember(member));
    if (!agent) return;
    const harness = agent.harness?.trim() || undefined;
    const working = activityVerb(agent) === "working";
    setSeen((current) => {
      const before = current[channelId];
      if (before && before.harness === harness && before.working === working) return current;
      return { ...current, [channelId]: { ...before, harness, working } };
    });
  }, [channelId, members, membersAreCurrent, viewerActorId]);

  return seen;
}

type ListFilter = "all" | "direct" | "rooms";
const FILTERS: { value: ListFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "direct", label: "Direct" },
  { value: "rooms", label: "Channels" },
];

/** The rail has one glyph's worth of room: the hash, and the letter it starts with. */
function railGlyph(title: string): string {
  const name = title.replace(/^#/u, "").trim();
  return name.slice(0, 1).toLowerCase() || "?";
}


/**
 * Who you are, and the short menu behind it.
 *
 * Closes on Escape and on a pointer landing anywhere else — the surface's own
 * Escape handler closes the right panel, so this one stops the event once it
 * has used it.
 *
 * At the foot of the list the menu opens upward. In a frame's top row (Hosted
 * Chat's Scout frame) it is the coin and the name, and the menu drops down.
 */
export function SidebarIdentity({
  placement = "foot",
  viewerName,
  viewerIsHost,
  railed,
  themePreference,
  appearanceControls,
  onOpenProfile,
  onOpenPreferences,
  onThemePreference,
  onSignOut,
}: {
  placement?: "foot" | "top-row";
  viewerName: string;
  viewerIsHost: boolean;
  railed: boolean;
  themePreference: ScoutThemePreference;
  appearanceControls?: ReactNode;
  onOpenProfile: (() => void) | null;
  onOpenPreferences?: () => void;
  onThemePreference: (next: ScoutThemePreference) => void;
  onSignOut: () => void;
}) {
  const capabilities = useChatCapabilities();
  const [menuOpen, setMenuOpen] = useState(false);
  const footRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    footRef.current?.querySelector<HTMLButtonElement>(".chat-you-menu button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && footRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  const choose = useCallback((run: () => void) => {
    setMenuOpen(false);
    run();
  }, []);

  return (
    <div
      className={placement === "top-row" ? "chat-sidebar-identity chat-sidebar-identity--top-row" : "chat-sidebar-identity"}
      ref={footRef}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menuOpen) {
          event.preventDefault();
          event.stopPropagation();
          setMenuOpen(false);
          footRef.current?.querySelector<HTMLButtonElement>(".chat-you")?.focus();
        }
      }}
    >
      {menuOpen ? (
        <div className="chat-you-menu" role="group" aria-label={`${viewerName} menu`}>
          <div className="chat-you-menu-head">
            <MemberCoin name={viewerName} size={28} title={viewerName} />
            <span className="chat-you-menu-name">{viewerName}</span>
          </div>
          <div className="chat-you-menu-rule" />
          {onOpenProfile ? (
            <button
              type="button"
              className="chat-you-menu-item"
              onClick={() => choose(onOpenProfile)}
            >
              Your member card
            </button>
          ) : null}
          {onOpenPreferences ? (
            <button
              type="button"
              className="chat-you-menu-item"
              onClick={() => choose(onOpenPreferences)}
            >
              Preferences
              <span className="chat-you-menu-kbd" aria-hidden="true">⌘,</span>
            </button>
          ) : (
          <div className="chat-you-menu-group" role="group" aria-label="Appearance">
            <span className="label-sm">Appearance</span>
            <div className="chat-you-themes">
              {THEME_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className="btn btn--sm"
                  aria-pressed={themePreference === choice.value}
                  data-active={themePreference === choice.value}
                  onClick={() => onThemePreference(choice.value)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            {appearanceControls}
          </div>
          )}
          {capabilities.signOut ? (
            <>
              <div className="chat-you-menu-rule" />
              <button
                type="button"
                className="chat-you-menu-item"
                onClick={() => choose(onSignOut)}
              >
                Sign out
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        className="chat-you"
        aria-expanded={menuOpen}
        aria-label={railed || placement === "top-row" ? `${viewerName} — account menu` : undefined}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MemberCoin name={viewerName} size={24} title={viewerName} />
        {placement === "top-row" ? (
          <span className="chat-you-name">{viewerName}</span>
        ) : railed ? null : (
          <>
            <span className="chat-you-who">
              <span className="chat-you-name">{viewerName}</span>
              {viewerIsHost ? <span className="label-sm chat-you-role">Host</span> : null}
            </span>
            <span className="chat-you-caret" aria-hidden="true">{menuOpen ? "⌄" : "⌃"}</span>
          </>
        )}
      </button>
    </div>
  );
}

/** Rows shown before "For you" folds. */
const FOR_YOU_VISIBLE = 4;

/**
 * What waits on you, above the rooms: one row per open question, newest
 * first, each opening its room's questions. Absent when nothing waits.
 */
export function ForYouGroup({ items, onOpen }: { items: ForYouItem[]; onOpen: (item: ForYouItem) => void }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, FOR_YOU_VISIBLE);
  return (
    <section className="chat-foryou" aria-label="For you">
      <p className="chat-foryou-label">For you</p>
      {shown.map(item => (
        <button key={`${item.channelId}:${item.recordId}`} type="button" className="chat-foryou-row" onClick={() => onOpen(item)}>
          <span className="chat-foryou-mark" aria-hidden />
          <span className="chat-foryou-main">
            <span className="chat-foryou-title">{item.title}</span>
            <span className="chat-foryou-where">Question in #{item.channelTitle}</span>
          </span>
        </button>
      ))}
      {items.length > FOR_YOU_VISIBLE ? (
        <button type="button" className="chat-foryou-more" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
          {expanded ? "Show less" : "Show all"}
        </button>
      ) : null}
    </section>
  );
}

export function ChannelSidebar({
  channels,
  directs,
  spaces,
  activeSpace,
  selectedId,
  addressedChannelIds,
  readStates = {},
  questionCounts = {},
  forYou = [],
  onOpenForYou,
  seen = {},
  lastMessages = {},
  viewerActorId = null,
  nowMs,
  canCreate,
  viewerName,
  viewerIsHost,
  railed,
  themePreference,
  onSelect,
  onSelectSpace,
  onCreate,
  onOpenBoard,
  boardLabel,
  onCreateSpace,
  onDeleteSpace,
  spaceAccessHref,
  onInvite,
  onOpenTeam,
  teamOpen,
  onExpandRail,
  onOpenProfile,
  onThemePreference,
  onSignOut,
  appearanceControls,
  onOpenPreferences,
  structured = false,
  shellRail = false,
  onNavigationModelChange,
  onMarkRead,
}: {
  channels: ConversationDefinition[];
  directs: ConversationDefinition[];
  /** Every space this viewer can open, as the server listed them. */
  spaces: ChatSpaceView[];
  activeSpace: string;
  selectedId: string | null;
  addressedChannelIds: ReadonlySet<string>;
  readStates?: Record<string, ChatReadState>;
  questionCounts?: Record<string, number>;
  /** Questions waiting on this viewer across rooms; see `useForYouQuestions`. */
  forYou?: ForYouItem[];
  onOpenForYou?: (item: ForYouItem) => void;
  /** Previews and direct-chat facts from reads already made; see `useSidebarSeen`. */
  seen?: Record<string, SidebarRowSeen>;
  /** The server's summary of each room's last message, when it sends one. */
  lastMessages?: Record<string, ChatChannelLastMessage>;
  viewerActorId?: string | null;
  nowMs: number;
  canCreate: boolean;
  viewerName: string;
  viewerIsHost: boolean;
  railed: boolean;
  themePreference: ScoutThemePreference;
  onSelect: (id: string) => void;
  onSelectSpace: (slug: string) => void;
  onCreate: (input: { title: string; topic: string }) => Promise<void>;
  /** Opens the space's Vercel Board sheet (owners and admins): connect a team, link its channels. */
  onOpenBoard?: () => void;
  /** What the board row says: the connected team, or the way to connect one. */
  boardLabel?: string;
  onDeleteSpace: ((slug: string) => Promise<void>) | null;
  spaceAccessHref?: string;
  onCreateSpace: (input: { title: string; channel: string }) => Promise<void>;
  onInvite: () => void;
  onOpenTeam: () => void;
  teamOpen: boolean;
  onExpandRail: () => void;
  /** Null while no channel is open, because the card lives in that channel's panel. */
  onOpenProfile: (() => void) | null;
  onThemePreference: (next: ScoutThemePreference) => void;
  onSignOut: () => void;
  /** More choices under the theme row in the identity menu (Hosted Chat). */
  appearanceControls?: ReactNode;
  /** Opens the surface's preferences pop-out; replaces the menu's inline appearance rows. */
  onOpenPreferences?: () => void;
  /** Hosted Chat's search and labeled channel/DM sections. */
  structured?: boolean;
  /**
   * The list sits in the operator shell's side rail, as Chats' list does, and
   * takes that rail's toolbar, tabs, section label and rows. The shell's own
   * top row carries identity and appearance, so the identity foot drops.
   */
  shellRail?: boolean;
  onNavigationModelChange?: (rows: ConversationNavigationRow[]) => void;
  onMarkRead?: (channelId: string) => void;
}) {
  const capabilities = useChatCapabilities();
  const { source } = useChatTransport();
  // A Slack workspace's list keeps Slack's shape: Channels and Direct messages
  // as their own foldable sections, with no filter tabs over them.
  const slackSections = shellRail && source === "slack";
  const listRef = useRef<HTMLElement | null>(null);
  const queryRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  useSlashToFocus(useCallback(() => (shellRail || structured ? queryRef.current : null), [shellRail, structured]));
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<ListFilter>("all");
  // Structured sections fold to what still needs you: the open room and any
  // row with unread activity stay; the rest tuck under the heading.
  const [folded, setFolded] = useState<Record<"channels" | "directs", boolean>>({ channels: false, directs: false });
  const [sidebarPrefs, setSidebarPrefs] = useState(() => readChatSidebarPrefs(activeSpace));
  const [conversationMenu, setConversationMenu] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  useEffect(() => {
    setSidebarPrefs(readChatSidebarPrefs(activeSpace));
    setConversationMenu(null);
    setShowHidden(false);
  }, [activeSpace]);
  useEffect(() => {
    if (!conversationMenu) return;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest("[data-conversation-menu]")) setConversationMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConversationMenu(null);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [conversationMenu]);
  const updateSidebarPrefs = useCallback((kind: "hidden" | "muted", id: string) => {
    setSidebarPrefs((current) => {
      const next = { ...current, [kind]: toggleId(current[kind], id) };
      writeChatSidebarPrefs(activeSpace, next);
      return next;
    });
  }, [activeSpace]);

  const submit = useCallback(async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate({ title: name, topic: topic.trim() });
      setTitle("");
      setTopic("");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }, [busy, onCreate, title, topic]);

  const row = (conversation: ConversationDefinition, isChannel: boolean) => {
    const questionCount = questionCounts[conversation.id] ?? 0;
    const questionLabel = `${questionCount} ${questionCount === 1 ? "question needs" : "questions need"} your response`;
    const addressed = addressedChannelIds.has(conversation.id);
    const readState = readStates[conversation.id];
    const attention = readState ? summarizeChatReadState(readState) : null;
    const muted = slackSections && sidebarPrefs.muted.includes(conversation.id);
    const hidden = slackSections && sidebarPrefs.hidden.includes(conversation.id);
    const hasUnread = Boolean(attention && (attention.unread > 0 || attention.incomplete));
    const unread = hasUnread && (!muted || Boolean(attention?.mentions));
    // A Board room's count is Scout's own traffic, not the Board's: like a
    // Slack channel it marks unread by weight alone, and counts only mentions.
    const board = isChannel && conversation.metadata?.source === "vercel-board";
    const showUnreadChip = Boolean(unread && attention && (!(slackSections || board) || attention.mentions > 0 || !isChannel));
    const unreadLabel = attention
      ? `${attention.unread}${attention.incomplete ? "+" : ""} unread messages${attention.mentions ? `, ${attention.mentions} mentions` : ""}${attention.replies ? `, ${attention.replies} thread replies` : ""}`
      : undefined;
    const name = isChannel ? conversation.title.replace(/^#/u, "") : conversation.title;
    const facts = seen[conversation.id];
    const preview = freshestRowPreview(facts?.preview, lastMessages[conversation.id], viewerActorId);
    const people = conversation.participantIds?.length ?? 0;
    // A room's membership is in its header; the row keeps the name and time.
    // A Board room carries Vercel's mark where a room has "#": the mark says where it comes from.
    const hash = board ? <VercelMark size={11} /> : "#";
    const detail = isChannel
      ? null
      : conversation.kind === "group_direct"
        ? people > 0 ? `${people} in the chat` : null
        : facts?.harness ?? null;
    const lamp = facts?.working
      ? "working"
      : preview && nowMs - preview.at < RECENT_MS ? "recent" : "idle";
    const describedBy = [showUnreadChip ? `chat-unread-${conversation.id}` : "", questionCount ? `chat-questions-${conversation.id}` : ""].filter(Boolean).join(" ") || undefined;
    const onRowKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      if (slackSections && ((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu")) {
        event.preventDefault();
        setConversationMenu(conversation.id);
        requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-menu-for="${conversation.id}"] [role="menuitem"]`)?.focus());
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        moveFocus(listRef.current, event.currentTarget, 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveFocus(listRef.current, event.currentTarget, -1);
      }
    };
    if (shellRail) {
      // The shell rail's row, the one Chats draws (RailRow's markup): a hash
      // tile or a coin, the name over the last line said, the time and any
      // chips at the trailing edge.
      const current = conversation.id === selectedId;
      const menuOpen = slackSections && conversationMenu === conversation.id;
      return (
        <div
          key={conversation.id}
          className={["rr-row", current && "rr-row--active", unread && "rr-row--unread"].filter(Boolean).join(" ")}
          data-muted={muted ? "true" : undefined}
          data-hidden={hidden ? "true" : undefined}
          data-conversation-menu={slackSections ? "" : undefined}
          onContextMenu={slackSections ? (event) => {
            if ((event.target as HTMLElement).closest("[role='menu']")) return;
            event.preventDefault();
            setConversationMenu(conversation.id);
          } : undefined}
        >
          <button
            type="button"
            className="rr-row-head chat-shell-row"
            data-side-row
            data-channel-id={conversation.id}
            data-unread={unread}
            data-addressed={addressed}
            aria-label={`${isChannel ? channelLabel(conversation.title) : name}${muted ? ", muted in Scout" : ""}${hidden ? ", hidden" : ""}`}
            aria-current={current}
            title={unread ? `${name}: ${unreadLabel}` : undefined}
            aria-describedby={describedBy}
            onClick={() => { setConversationMenu(null); onSelect(conversation.id); }}
            onKeyDown={onRowKeyDown}
          >
            {isChannel ? (
              <span className="rr-row-hash" data-board={board || undefined} aria-hidden="true">{hash}</span>
            ) : (
              <span className="rr-row-avatar-wrap" aria-hidden="true">
                <MemberCoin name={name} size={20} />
                {lamp === "idle" ? null : <span className="rr-row-presence chat-shell-presence" data-state={lamp} />}
              </span>
            )}
            <span className="rr-row-body">
              <span className="rr-row-name">
                <span className="rr-row-name-text">{name}</span>
                {muted ? <BellOff className="rr-row-state" size={12} aria-label="Muted in Scout" /> : null}
                {hidden ? <EyeOff className="rr-row-state" size={12} aria-label="Hidden" /> : null}
                {detail ? <span className="chat-shell-row-detail">{detail}</span> : null}
              </span>
              {preview || conversation.topic?.trim() ? <span className="rr-row-sub" data-quiet={preview ? undefined : "true"}>
                {preview ? `${preview.who}: ${preview.text}` : conversation.topic?.trim()}
              </span> : null}
            </span>
            <span className="chat-shell-row-trail">
              {preview ? <span className="rr-row-meta">{listTime(preview.at, nowMs)}</span> : null}
              {questionCount > 0 || addressed || showUnreadChip ? (
                <span className="chat-shell-row-chips">
                  {questionCount > 0 ? <span id={`chat-questions-${conversation.id}`} className="chat-question-count" title={questionLabel} aria-label={questionLabel}>? {questionCount}</span> : null}
                  {addressed ? <span className="dot dot--accent dot--sm" aria-label="Addressed to you, unanswered" /> : null}
                  {showUnreadChip && attention ? (
                    <span id={`chat-unread-${conversation.id}`} className="chat-unread-chip" data-mentioned={attention.mentions > 0 || !isChannel} aria-label={unreadLabel}>
                      {`${attention.unread || ""}${attention.incomplete ? "+" : ""}`}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </span>
          </button>
          {slackSections ? (
            <button
              type="button"
              className="rr-row-more"
              aria-label={`Actions for ${name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setConversationMenu(menuOpen ? null : conversation.id)}
            >
              <MoreHorizontal size={15} aria-hidden="true" />
            </button>
          ) : null}
          {menuOpen ? (
            <div className="rr-row-menu" data-menu-for={conversation.id} role="menu" aria-label={`Actions for ${name}`}>
              {onMarkRead && hasUnread ? (
                <button type="button" role="menuitem" onClick={() => { onMarkRead(conversation.id); setConversationMenu(null); }}>
                  Mark as read
                </button>
              ) : null}
              <button type="button" role="menuitem" onClick={() => { updateSidebarPrefs("muted", conversation.id); setConversationMenu(null); }}>
                {muted ? "Unmute in Scout" : "Mute in Scout"}
              </button>
              <button type="button" role="menuitem" onClick={() => { updateSidebarPrefs("hidden", conversation.id); setConversationMenu(null); }}>
                {hidden ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                {hidden ? "Unhide conversation" : "Hide from sidebar"}
              </button>
              <p>Saved in this browser</p>
            </div>
          ) : null}
        </div>
      );
    }
    // Two lines, full width: who and when, then what was said last.
    const listRowBody = () => (
      <>
        <span className="chat-row-lead" aria-hidden="true">
          {isChannel ? <span className="chat-hash" data-board={board || undefined}>{hash}</span> : <span className="chat-lamp" data-state={lamp} />}
        </span>
        <span className="chat-row-main">
          <span className="chat-row-top">
            <span className="chat-row-name">{name}</span>
            <span className="chat-row-detail">{detail}</span>
            {preview ? <span className="chat-row-time">{listTime(preview.at, nowMs)}</span> : null}
          </span>
          <span className="chat-row-bottom">
            {preview ? (
              <span className="chat-row-preview">{preview.who}: {preview.text}</span>
            ) : conversation.topic?.trim() ? (
              <span className="chat-row-preview" data-quiet="true">{conversation.topic.trim()}</span>
            ) : null}
            {questionCount > 0 ? <span id={`chat-questions-${conversation.id}`} className="chat-question-count" title={questionLabel} aria-label={questionLabel}>? {questionCount}</span> : null}
            {addressed ? (
              <span className="dot dot--accent dot--sm" aria-label="Addressed to you, unanswered" />
            ) : null}
            {unread && attention ? (board && !attention.mentions ? (
              <span id={`chat-unread-${conversation.id}`} className="chat-unread-chip" data-dot aria-label="New activity" />
            ) : (
              <span id={`chat-unread-${conversation.id}`} className="chat-unread-chip" data-mentioned={attention.mentions > 0 || !isChannel} aria-label={unreadLabel}>
                {`${attention.unread || ""}${attention.incomplete ? "+" : ""}`}
              </span>
            )) : null}
          </span>
        </span>
      </>
    );
    return (
      <button
        key={conversation.id}
        type="button"
        data-side-row
        data-channel-id={conversation.id}
        data-unread={unread}
        className={railed ? "chat-rail-row" : "chat-side-row"}
        aria-label={isChannel ? channelLabel(conversation.title) : name}
        aria-current={conversation.id === selectedId}
        data-addressed={addressed}
        title={unread ? `${name}: ${unreadLabel}` : railed ? (isChannel ? channelLabel(conversation.title) : name) : undefined}
        aria-describedby={describedBy}
        onClick={() => onSelect(conversation.id)}
        onKeyDown={onRowKeyDown}
      >
        {railed ? (
          isChannel ? (
            <span className="chat-rail-glyph">
              <span className="chat-hash" data-board={board || undefined}>{hash}</span>
              {railGlyph(conversation.title)}
            </span>
          ) : (
            <MemberCoin name={name} size={22} title={name} />
          )
        ) : (
          listRowBody()
        )}
        {railed && unread && attention ? (
          <span id={`chat-unread-${conversation.id}`} className="chat-unread-count" data-mentioned={attention.mentions > 0} aria-label={unreadLabel}>
            •
          </span>
        ) : null}
        {railed && questionCount > 0 ? <span id={`chat-questions-${conversation.id}`} className="chat-question-count" title={questionLabel} aria-label={questionLabel}>?</span> : null}
        {railed && addressed ? (
          <span className="dot dot--accent dot--sm" aria-label="Addressed to you, unanswered" />
        ) : null}
      </button>
    );
  };

  const needle = shellRail || structured ? query.trim().toLowerCase() : "";
  const listFilter: ListFilter = slackSections ? "all" : filter;
  const allShown = [
    ...(listFilter === "direct" ? [] : channels.map((conversation) => ({ conversation, isChannel: true }))),
    ...(listFilter === "rooms" ? [] : directs.map((conversation) => ({ conversation, isChannel: false }))),
  ].filter(({ conversation }) => !needle || conversation.title.replace(/^#/u, "").toLowerCase().includes(needle));
  const shown = allShown.filter(({ conversation }) =>
    !slackSections || !sidebarPrefs.hidden.includes(conversation.id) || Boolean(needle) || conversation.id === selectedId);
  const hiddenShown = allShown.filter(({ conversation }) =>
    slackSections && sidebarPrefs.hidden.includes(conversation.id) && !needle && conversation.id !== selectedId);

  const spaceMenuUseful = spaces.length > 1 || (canCreate && capabilities.spaceCreate);
  const switcher = spaces.length > 0 ? (
    <SpaceSwitcher
      spaces={spaces}
      activeSlug={activeSpace}
      canCreate={canCreate && capabilities.spaceCreate}
      railed={railed}
      onSelect={onSelectSpace}
      onCreate={onCreateSpace}
      onDelete={canCreate ? onDeleteSpace : null}
      accessHref={spaceAccessHref}
      onExpandRail={onExpandRail}
    />
  ) : null;

  const identity = (
    <SidebarIdentity
      viewerName={viewerName}
      viewerIsHost={viewerIsHost}
      railed={railed}
      themePreference={themePreference}
      appearanceControls={appearanceControls}
      onOpenProfile={onOpenProfile}
      onOpenPreferences={onOpenPreferences}
      onThemePreference={onThemePreference}
      onSignOut={onSignOut}
    />
  );

  const createForm = (
    <div className="chat-create-form">
      <input
        className="chat-input"
        value={title}
        autoFocus
        placeholder="channel-name"
        aria-label="Channel name"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setCreating(false);
          }
        }}
      />
      <input
        className="chat-input"
        value={topic}
        placeholder="Topic (optional)"
        aria-label="Channel topic"
        onChange={(event) => setTopic(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="chat-create-actions">
        <button type="button" className="btn btn--sm" disabled={busy || !title.trim()} onClick={() => void submit()}>
          {busy ? "Creating…" : "Create"}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(false)}>
          Cancel
        </button>
      </div>
      {/* A board channel is a channel too: it is made here, from the board's
          own list. The sheet connects the board first when the space has none. */}
      {onOpenBoard ? (
        <button
          type="button"
          className="chat-create-alt"
          title={boardLabel}
          onClick={() => {
            setCreating(false);
            onOpenBoard();
          }}
        >
          Or link a Vercel Board channel
        </button>
      ) : null}
    </div>
  );

  const emptyText = needle
    ? "Nothing matches that filter."
    : filter === "direct"
      ? "No direct chats in this space."
      : canCreate
        ? `No channels in ${spaces.find((space) => space.slug === activeSpace)?.title ?? "this space"} yet. Create one to get started.`
        : "You are not in any channel yet. Open the invitation you were sent.";

  const foot = (
    <div className="chat-sidebar-foot">
      {capabilities.inviteList && (!capabilities.invitesRequireOwner || viewerIsHost) ? <button type="button" className="btn btn--ghost btn--sm" onClick={onInvite}>
        + Invite
      </button> : null}
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        aria-pressed={teamOpen}
        onClick={onOpenTeam}
      >
        Team
      </button>
    </div>
  );

  // Folding a section keeps what still needs you in view: the open room and
  // any row with unread activity, a question, or an unanswered address.
  const needsYou = (conversation: ConversationDefinition) => {
    if (conversation.id === selectedId) return true;
    if (addressedChannelIds.has(conversation.id) || (questionCounts[conversation.id] ?? 0) > 0) return true;
    const state = readStates[conversation.id];
    if (!state) return false;
    const attention = summarizeChatReadState(state);
    if (slackSections && sidebarPrefs.muted.includes(conversation.id) && attention.mentions === 0) return false;
    return attention.unread > 0 || attention.incomplete;
  };
  const sectionVisible = (key: "channels" | "directs", isChannel: boolean) => {
    const items = shown.filter((item) => item.isChannel === isChannel);
    return slackSections || structured
      ? folded[key] && !needle ? items.filter(({ conversation }) => needsYou(conversation)) : items
      : items;
  };
  const navigationItems = shellRail || structured
    ? [...sectionVisible("channels", true), ...sectionVisible("directs", false)]
    : shown;
  const navigationModel = JSON.stringify(navigationItems.filter(({ conversation }) =>
    !slackSections || !sidebarPrefs.hidden.includes(conversation.id) || conversation.id === selectedId).map(({ conversation }): ConversationNavigationRow => {
    const state = readStates[conversation.id];
    const attention = state ? summarizeChatReadState(state) : null;
    return {
      id: conversation.id,
      unread: Boolean(attention && (attention.unread > 0 || attention.incomplete)),
      mentioned: Boolean(attention?.mentions),
      muted: slackSections && sidebarPrefs.muted.includes(conversation.id),
    };
  }));
  useEffect(() => {
    onNavigationModelChange?.(JSON.parse(navigationModel) as ConversationNavigationRow[]);
  }, [navigationModel, onNavigationModelChange]);

  if (shellRail) {
    const slackSection = (key: "channels" | "directs", label: string, isChannel: boolean) => {
      const items = shown.filter((item) => item.isChannel === isChannel);
      if (items.length === 0) return null;
      const isFolded = folded[key] && !needle;
      const visible = sectionVisible(key, isChannel);
      return (
        <section key={key} className="ctx-panel-rail-section chat-slack-section" aria-label={label} data-folded={isFolded ? "true" : undefined}>
          <button
            type="button"
            className="chat-slack-section-head"
            aria-expanded={!isFolded}
            onClick={() => setFolded((current) => ({ ...current, [key]: !current[key] }))}
          >
            <span className="chat-slack-section-caret" aria-hidden="true"><CaretGlyph size={14} /></span>
            <span className="chat-slack-section-name">{label}</span>
          </button>
          {visible.length > 0 ? (
            <div className="ctx-panel-rail-section-body">
              {visible.map(({ conversation }) => row(conversation, isChannel))}
            </div>
          ) : null}
        </section>
      );
    };
    const sectionLabel = filter === "all"
      ? "Messages"
      : FILTERS.find((choice) => choice.value === filter)?.label ?? "Messages";
    return (
      <nav
        className="ctx-panel chat-sidebar chat-sidebar--shell"
        ref={listRef}
        aria-label="Rooms and directs"
      >
        {spaceMenuUseful ? <div className="chat-sidebar-space chat-sidebar-space--head">{switcher}</div> : null}
        <div className="ctx-panel-toolbar">
          <input
            ref={queryRef}
            type="text"
            className="ctx-panel-search-input"
            placeholder={slackSections ? "Find a conversation  (/)" : "Filter…  (/)"}
            aria-label="Filter conversations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                const first = listRef.current?.querySelector<HTMLElement>("[data-side-row]");
                if (!first) return;
                event.preventDefault();
                first.focus();
              } else if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
          {canCreate && capabilities.channelCreate ? (
            <button
              type="button"
              className="chat-shell-add"
              aria-label="Create a channel"
              title="Create a channel"
              aria-expanded={creating}
              onClick={() => setCreating((open) => !open)}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {slackSections ? null : <div className="ctx-panel-viewtoggle" role="radiogroup" aria-label="Show conversations">
          {FILTERS.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={filter === choice.value}
              className={`ctx-panel-viewtab${filter === choice.value ? " ctx-panel-viewtab--on" : ""}`}
              onClick={() => setFilter(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>}

        {creating ? <div className="chat-shell-create">{createForm}</div> : null}

        <div className="ctx-panel-list ctx-panel-list--scroll">
          {forYou.length > 0 && onOpenForYou ? <ForYouGroup items={forYou} onOpen={onOpenForYou} /> : null}
          {slackSections ? (
            <>
              {needle && shown.length === 0 ? <p className="chat-side-empty">{emptyText}</p> : null}
              {slackSection("channels", "Channels", true)}
              {slackSection("directs", "Direct messages", false)}
              {hiddenShown.length > 0 ? (
                <section className="ctx-panel-rail-section chat-slack-section chat-slack-hidden" aria-label="Hidden conversations" data-folded={!showHidden ? "true" : undefined}>
                  <button type="button" className="chat-slack-section-head" aria-expanded={showHidden} onClick={() => setShowHidden((value) => !value)}>
                    <span className="chat-slack-section-caret" aria-hidden="true"><CaretGlyph size={14} /></span>
                    <span className="chat-slack-section-name">Hidden ({hiddenShown.length})</span>
                  </button>
                  {showHidden ? (
                    <div className="ctx-panel-rail-section-body">
                      {hiddenShown.map(({ conversation, isChannel }) => row(conversation, isChannel))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : <section className="ctx-panel-rail-section" aria-label={sectionLabel}>
            <div className="ctx-panel-section-label">
              <span>{sectionLabel}</span>
              <span
                className="ctx-panel-count"
                aria-label={`${shown.length} ${shown.length === 1 ? "conversation" : "conversations"}`}
              >
                {shown.length}
              </span>
            </div>
            {shown.length === 0 ? (
              <p className="chat-side-empty">{emptyText}</p>
            ) : (
              <div className="ctx-panel-rail-section-body">
                {shown.map(({ conversation, isChannel }) => row(conversation, isChannel))}
              </div>
            )}
          </section>}
        </div>

        {foot}
      </nav>
    );
  }

  if (railed) {
    return (
      <nav
        className="chat-sidebar"
        data-railed="true"
        ref={listRef}
        aria-label="Channels and direct messages"
        onDoubleClick={(event) => {
          // Double-click on empty chrome expands, as it does on every other
          // collapsed rail in Scout. It costs no pixels.
          if ((event.target as HTMLElement).closest("button, a, [role='button']")) return;
          onExpandRail();
        }}
      >
        {switcher}
        <div className="chat-side-list">
          {channels.map((channel) => row(channel, true))}
          {directs.length > 0 ? <div className="chat-rail-rule" /> : null}
          {directs.map((direct) => row(direct, false))}
        </div>

        <div className="chat-sidebar-foot">
          {capabilities.inviteList && (!capabilities.invitesRequireOwner || viewerIsHost) ? <button type="button" className="chat-rail-row" aria-label="Invite someone" onClick={onInvite}>
            <span className="chat-rail-glyph">+</span>
          </button> : null}
          <button
            type="button"
            className="chat-rail-row"
            aria-label="Team"
            aria-pressed={teamOpen}
            onClick={onOpenTeam}
          >
            <Users size={16} aria-hidden="true" />
          </button>
        </div>
        {identity}
      </nav>
    );
  }

  if (structured) {
    // Hosted Chat: the space heads the column on the channel header's line,
    // search sits under it, and Channels and Direct messages are their own
    // foldable sections. Folding keeps whatever still needs you in view.
    const canCreateChannel = canCreate && capabilities.channelCreate;
    const section = (key: "channels" | "directs", label: string, isChannel: boolean) => {
      const items = shown.filter((item) => item.isChannel === isChannel);
      if (items.length === 0 && !(isChannel && canCreateChannel && !needle)) return null;
      const isFolded = folded[key] && !needle;
      const visible = isFolded ? items.filter(({ conversation }) => needsYou(conversation)) : items;
      const hidden = items.length - visible.length;
      return (
        <section className="chat-side-section" aria-label={label} data-folded={isFolded ? "true" : undefined}>
          <div className="chat-side-section-head">
            <button
              type="button"
              className="chat-side-section-label"
              aria-expanded={!isFolded}
              onClick={() => setFolded((current) => ({ ...current, [key]: !current[key] }))}
            >
              <span className="chat-side-caret" aria-hidden="true" />
              <span className="chat-side-section-name">{label}</span>
              {isFolded && hidden > 0 ? <span className="chat-side-section-count">{hidden} more</span> : null}
            </button>
            {isChannel && canCreateChannel ? (
              <button
                type="button"
                className="chat-side-section-add"
                aria-label="Create a channel"
                title="Create a channel"
                aria-expanded={creating}
                onClick={() => {
                  setFolded((current) => ({ ...current, channels: false }));
                  setCreating((open) => !open);
                }}
              >
                <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {isChannel && creating ? createForm : null}
          {visible.length > 0 ? (
            <div className="chat-side-rows">
              {visible.map(({ conversation }) => row(conversation, isChannel))}
            </div>
          ) : isChannel && !creating && items.length === 0 ? (
            <p className="chat-side-empty">{emptyText}</p>
          ) : null}
        </section>
      );
    };
    return (
      <nav className="chat-sidebar" data-structured="true" ref={listRef} aria-label="Channels and direct messages">
        <div className="chat-side-list">
          <div className="chat-side-head">
            {switcher ?? <span className="chat-side-head-title">Conversations</span>}
          </div>
          <label className="chat-side-search">
            <Search size={14} strokeWidth={1.8} aria-hidden="true" />
            <input
              ref={queryRef}
              type="search"
              value={query}
              placeholder="Find a conversation"
              aria-label="Find a conversation"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  const first = listRef.current?.querySelector<HTMLElement>("[data-side-row]");
                  if (!first) return;
                  event.preventDefault();
                  first.focus();
                } else if (event.key === "Escape" && query) {
                  event.preventDefault();
                  event.stopPropagation();
                  setQuery("");
                }
              }}
            />
            <kbd>/</kbd>
          </label>
          {forYou.length > 0 && onOpenForYou ? <ForYouGroup items={forYou} onOpen={onOpenForYou} /> : null}
          {needle && shown.length === 0 ? <p className="chat-side-empty">{emptyText}</p> : null}
          {section("channels", "Channels", true)}
          {section("directs", "Direct messages", false)}
        </div>
        {foot}
        {identity}
      </nav>
    );
  }

  return (
    <nav className="chat-sidebar" ref={listRef} aria-label="Channels and direct messages">
      <div className="chat-side-list">
        {forYou.length > 0 && onOpenForYou ? <ForYouGroup items={forYou} onOpen={onOpenForYou} /> : null}
        <div className="chat-side-controls">
          <div className="chat-side-filter" role="radiogroup" aria-label="Show conversations">
            {FILTERS.map((choice) => (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={filter === choice.value}
                data-active={filter === choice.value}
                onClick={() => setFilter(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <span className="chat-side-count" aria-label={`${shown.length} ${shown.length === 1 ? "conversation" : "conversations"}`}>
            {shown.length}
          </span>
          {canCreate && capabilities.channelCreate ? (
            <button
              type="button"
              className="chat-side-add"
              aria-label="Create a channel"
              aria-expanded={creating}
              onClick={() => setCreating((open) => !open)}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {creating ? createForm : null}

        {shown.length === 0 ? <p className="chat-side-empty">{emptyText}</p> : null}
        {shown.length > 0 ? <div className="chat-side-rows">
          {shown.map(({ conversation, isChannel }) => row(conversation, isChannel))}
        </div> : null}
      </div>

      {/* The list starts at the filter row. The space moved down here, and
          only when there is something to do with it — another space to
          switch to, or one to create. One space and no create: no row. */}
      {spaceMenuUseful ? <div className="chat-sidebar-space">{switcher}</div> : null}
      {foot}
      {identity}
    </nav>
  );
}
