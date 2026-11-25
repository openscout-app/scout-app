import { createChatSendLedger } from "./chat-send-ledger.ts";
import { useChatPresence, chatPresenceText } from "./use-chat-presence.ts";
import { ChatExecutionAccess } from "./ChatExecutionControls.tsx";
import { ChatApprovalAccess } from "./ChatApprovalControls.tsx";
import { ChatRequestApprovalAccess } from "./ChatRequestApprovalControls.tsx";
import { ChatQuestions } from "./ChatQuestions.tsx";
import { ChatOpenWork } from "./ChatOpenWork.tsx";
import { useForYouQuestions } from "./use-for-you.ts";
import { ChatQuestionResponder } from "./ChatQuestionControls.tsx";
import type { ChatQuestionChange } from "./chat-api.ts";
import { ChatCorrectionScope } from "./chat-correction-draft.ts";
import type { ChatMessage } from "./chat-api.ts";
import { mergeChatMessageRevisions, newestChatMessage } from "./chat-message-revisions.ts";
import { applyFeedRead, FEED_FULL_READ_MS, feedPosition } from "./feed-reads.ts";
import type { CorrectChatMessage } from "./ChatMessageCorrectionControls.tsx";
import { ChatSearch } from "./ChatSearch.tsx";
import { compareMessagesAsc } from "../../../shared/message-pagination.ts";
import { readCursorForSeenMessages } from "./chat-seen-read.ts";
import { useReportSeenMessages } from "./use-seen-read.ts";
import { useChatMessageContext } from "./use-chat-message-context.ts";
import { ChatAttention, ChatAttentionContent } from "./ChatAttention.tsx";
/**
 * Scout Chat — the standalone channel surface at `/chat`.
 *
 * A member-scoped room: it renders what the signed-in member belongs to, and
 * nothing else. It does not mount the operator shell, and it makes no operator
 * API calls — a teammate holding a channel credential can open this page and
 * every request it fires is one their credential is allowed to make.
 *
 * Three truths this component is responsible for keeping:
 *
 *  - **Nothing is invented.** Every member, message, state, and invitation on
 *    screen came off the wire. Where the server sends nothing, the surface
 *    says so rather than filling the gap.
 *  - **Polling is the reader of record.** This surface re-reads at a modest
 *    interval and says "reconnecting" when a read fails. Where the server
 *    offers a change stream it takes the nudge and re-reads sooner, but a
 *    notification only ever triggers the same `/feed` read the poll makes —
 *    nothing on screen came off a stream instead of the canonical endpoint,
 *    and a stream that is absent or broken costs latency, never correctness.
 *  - **Drafts survive.** A poll replaces server state only. What you were
 *    typing is client state and is never touched by a refresh.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bot, MessageSquare, UserPlus } from "lucide-react";
import type { ChannelInvitePublicView, ConversationDefinition, MessageAttachment } from "@openscout/protocol";

import {
  ChatApiError,
  DEFAULT_CHAT_SPACE,
  type ChannelFeed,
  type ChannelMemberView,
  type ChatBootstrap,
  type ChatSpaceView,
} from "./chat-api.ts";
import { ChatTransportProvider, useChatAddress, useChatApi, useChatCapabilities, useChatTransport } from "./chat-transport.tsx";
import { PlaceTile } from "./rooms-place.tsx";
import { RoomsAggregateSidebar, type RoomsListView } from "./RoomsAggregateSidebar.tsx";
import type { RoomsCatalog } from "./rooms-catalog.ts";
import type { RoomsDirect } from "./rooms-directs.ts";
import { ROOMS_DIRECT_QUERY_KEY, type RoomSource } from "./rooms-navigation.ts";
import { ExternalGlyph, ThreadGlyph, VercelMark } from "./rooms-glyphs.tsx";
import { RailToggle } from "../../components/RailToggle.tsx";
import {
  SIDEBAR_EXPANDED_WIDTH,
  SLACK_SIDEBAR_COLLAPSED_WIDTH,
  useSidebarCollapse,
  type SidebarWidthBounds,
} from "../../scout/sidebar/useSidebarCollapse.ts";

import { ChatSpaceTheme, useScoutStandaloneAppearance } from "./ChatSpaceTheme.tsx";
import type { ScoutThemePreference } from "../../lib/theme.ts";
import { useRoomsRailSlot } from "./rooms-rail-slot.tsx";
import {
  chatSpacesMessage,
  nativeSpacesHost,
  NATIVE_SPACE_EVENT,
  parseNativeSpaceCommand,
  postToApp,
  takePendingNativeSpaceCommand,
  type ChatSpacesMessage,
  type NativeSpaceCommand,
} from "./native-spaces.ts";
import { spaceIdentity } from "./space-identity.ts";
import { useTopRowIdentitySlot, useTopRowSearchSlot } from "./chat-top-row-slots.tsx";
import { SearchGlyph } from "../../components/ScoutGlyph.tsx";
import { ChannelSidebar, SidebarIdentity, conversationFacts, useSidebarSeen, type ConversationFacts } from "./ChannelSidebar.tsx";
import { ChannelComposer } from "./ChannelComposer.tsx";
import { ChatRightPanel, type PanelView } from "./ChatRightPanel.tsx";
import { ChatAvatarModeContext, Facepile } from "./ChatAvatar.tsx";
import { ScoutMark } from "../../components/ScoutMark.tsx";
import { companionHostAvailable } from "../../lib/companion-host.ts";
import { Turn } from "./ChatBits.tsx";
import { ChatContextMenu } from "./ChatContextMenu.tsx";
import { VercelBoardConnect } from "./VercelBoardConnect.tsx";
import { InviteSheet } from "./InviteSheet.tsx";
import { JumpPalette } from "./JumpPalette.tsx";
import { TeamPanel } from "./TeamPanel.tsx";
import { createSelectionGuard, subscribeChannelChanges } from "./chat-live.ts";
import { usePoll } from "./use-poll.ts";
import { useSpaceTeam } from "./useSpaceTeam.ts";
import {
  BOOTSTRAP_POLL_MS,
  FEED_POLL_MS,
  ROSTER_POLL_MS,
  channelHasOwedAttention,
  channelLabel,
  isAskableMember,
  memberDisplayName,
  applyOptimisticReaction,
  mergeChannelRoster,
  newRequestId,
  peopleAgentLabel,
  projectFeed,
  roomFallback,
  sortChannels,
  hasOwnRoomTitle,
  openWork,
  roomTitle,
  shortRoomId,
} from "./chat-space-model.ts";
import { boardRoomReads, viewedThreadReads } from "./chat-attention-model.ts";
import { conversationStep, type ConversationNavigationRow } from "./chat-conversation-navigation.ts";
import { uploadMediaFiles } from "../../lib/media-blobs.ts";
import { copyTextToClipboard } from "../../lib/clipboard.ts";
import { chatMessageHref } from "./chat-address.ts";
import { useChatDraft } from "./use-chat-draft.ts";
import { useChatReadingPosition } from "./use-chat-reading-position.ts";
import { useChatReadState } from "./use-chat-read-state.ts";
import { chatPanelDefaultWidth, clampChatPanelWidth, parseStoredChatPanelWidth } from "./chat-panel-width.ts";
import { useVercelBoardRoom, VercelBoardRoomSource, VercelBoardTasks, type VercelBoardRoomReader } from "./VercelBoardTasks.tsx";
import { useVercelBoardRooms, VERCEL_BOARD_SOURCE, type VercelBoardRoomRef, type VercelBoardRooms } from "./vercel-board-rooms.ts";
import { VercelBoardConversation } from "./VercelBoardConversation.tsx";
import { vercelBoardDefaultView, type VercelBoardView } from "../../../shared/vercel-board-jobs.ts";

/**
 * The space rides in the URL beside the channel, so a link carries the whole
 * address. It is a selector, not a credential: pasting a link to a space you
 * are not in lands on a 404 from the server, never on somebody else's room.
 *
 * How it is spelled belongs to the transport (`chat-address.ts`): local Scout
 * puts both selectors in the query string, hosted Chat gives the space its own
 * `/c/<slug>` path. This component only ever asks for them and sets them.
 */

/**
 * Chat defaults the column open. Scout's shared hook defaults it railed.
 * Seed the persisted key once from the old `openscout.chat.rail` flag so the
 * first paint matches what this surface used to do.
 */
const CHAT_SIDEBAR_COLLAPSE_KEY = "appshell.chat.sidebar.manualCollapsed";
/**
 * Chat's list is two-line rows (board N1), so its column opens at 320, wider
 * than the shared 260. The hook persists whatever width it renders, so every
 * earlier visit stored the old default; that exact value is moved to the new
 * one once. A width somebody dragged to is left alone.
 */
const CHAT_SIDEBAR_WIDTH = 320;
const CHAT_SIDEBAR_WIDTH_KEY = "appshell.chat.sidebar.width";
const CHAT_SIDEBAR_WIDTH_SEEDED_KEY = "openscout.chat.sidebar.width.v320";
const CHAT_PANEL_WIDTH_KEY = "openscout.chat.panel.width";

function seedChatSidebarCollapse(): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem(CHAT_SIDEBAR_WIDTH_SEEDED_KEY) == null) {
      const stored = window.localStorage.getItem(CHAT_SIDEBAR_WIDTH_KEY);
      if (stored == null || Number(JSON.parse(stored)) === SIDEBAR_EXPANDED_WIDTH) {
        window.localStorage.setItem(CHAT_SIDEBAR_WIDTH_KEY, JSON.stringify(CHAT_SIDEBAR_WIDTH));
      }
      window.localStorage.setItem(CHAT_SIDEBAR_WIDTH_SEEDED_KEY, "1");
    }
  } catch {
    // Storage unavailable: the hook's default below still opens at 320.
  }
  try {
    if (window.localStorage.getItem(CHAT_SIDEBAR_COLLAPSE_KEY) != null) return;
    const railed = window.localStorage.getItem("openscout.chat.rail") === "1";
    window.localStorage.setItem(CHAT_SIDEBAR_COLLAPSE_KEY, JSON.stringify(railed));
  } catch {
    // First paint uses the hook default when storage is unavailable.
  }
}

/** The width somebody dragged the panel to, or null: the panel then keeps its share of the window. */
function readPanelWidth(): number | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredChatPanelWidth(window.localStorage.getItem(CHAT_PANEL_WIDTH_KEY));
  } catch {
    return null;
  }
}

function writePanelWidth(width: number | null): void {
  if (typeof window === "undefined") return;
  try {
    if (width == null) window.localStorage.removeItem(CHAT_PANEL_WIDTH_KEY);
    else window.localStorage.setItem(CHAT_PANEL_WIDTH_KEY, String(width));
  } catch {
    // Width holds for this visit when device storage is unavailable.
  }
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/**
 * The server's change stream for one channel, when it serves one.
 *
 * It carries no content: every notification becomes the same feed read the
 * poll makes. Enabled/channel changes tear the subscription down, so a
 * notification for a channel you have left cannot reach the surface.
 */
function useChannelLive(
  channelId: string | null,
  enabled: boolean,
  invalidate: () => Promise<void>,
  space: string,
) {
  const chatApi = useChatApi();
  const invalidateRef = useRef(invalidate);
  invalidateRef.current = invalidate;
  useEffect(() => {
    if (!enabled || !channelId) return;
    return subscribeChannelChanges({
      channelId,
      space,
      eventsSpace: chatApi.eventsSpace,
      onInvalidate: () => invalidateRef.current(),
    });
  }, [channelId, enabled, space, chatApi]);
}

type Phase = "loading" | "ready" | "gate" | "error";

/**
 * What a signed-out visitor is shown, when the deployment wants its own door.
 *
 * Hosted Chat passes this to mount its own entrance; local `/chat` omits it and
 * keeps the card it has always had. `signInHref` arrives already carrying the
 * return address, so the sign-in grammar is composed in exactly one place.
 */
export interface ChatSpaceSignedOutView {
  signInHref: string;
  signInLabel: string;
  note: string | null;
  message: string | null;
}

export interface ChatSpaceSurfaceProps {
  /** Rendered instead of the default gate when the visitor has no session. */
  signedOut?: (view: ChatSpaceSignedOutView) => ReactNode;
  /**
   * Mounted inside the operator shell (the Rooms page) rather than as the
   * standalone `/chat` page. The shell names the page, owns ⌘K and ⌘B, and
   * gives the surface a pane to fill instead of the whole window.
   */
  inShell?: boolean;
  /** Rooms places channel families in the shell and its room list beside the conversation. */
  roomListInPage?: boolean;
  /** Real provider catalogs for the optional aggregate; records remain source- and space-scoped. */
  roomsCatalog?: RoomsCatalog[];
  /**
   * Which of Scout's rooms this tab lists: "board" lists only the Vercel Board
   * rooms (the Vercel tab), "scout" leaves them out (the Scout tab). Omitted,
   * every room is listed.
   */
  roomKind?: "board" | "scout";
  /** The Board rooms, when the host reads them once for every tab; otherwise the surface reads them. */
  vercelBoardRooms?: VercelBoardRooms;
  catalogLoading?: boolean;
  catalogErrors?: string[];
  onRetryCatalog?: () => void;
  onSelectCatalogRoom?: (source: RoomSource, space: string, channelId: string) => void;
  /**
   * Scout DMs listed with Scout's rooms. Scout's room API serves channels
   * only, so selecting one asks the host to open it (`onSelectDirect`) and
   * the host's `directPane` takes the conversation's place.
   */
  directRows?: ConversationDefinition[];
  /** All's DMs, Scout's and those only All may list; see rooms-directs.ts. */
  catalogDirects?: RoomsDirect[];
  /** A list the operator made: the catalog and DMs above already hold only its members. */
  roomsList?: RoomsListView | null;
  activeDirectId?: string | null;
  onSelectDirect?: (id: string) => void;
  directPane?: ReactNode;
  /** The open DM's name, for its head and the pane's accessible name. */
  directTitle?: string | null;
  /** Use Hosted Chat's grouped threads and structured sidebar conventions. */
  activityInPanel?: boolean;
  /**
   * The expanded sidebar's own floor and ceiling. Omitted, the shared band
   * applies. Pass a stable (module-level) object.
   */
  sidebarWidthBounds?: SidebarWidthBounds;
  /** More appearance choices in the identity menu, under light and dark. */
  appearanceControls?: ReactNode;
  /**
   * A preferences pop-out at the top bar's trailing edge (Hosted Chat). The
   * surface owns whether it is open, so the account menu and ⌘, open the same
   * one; given this, the account menu offers "Preferences" instead of its
   * inline appearance rows. Local Scout passes nothing and keeps its menu.
   */
  preferences?: (context: ChatSurfacePreferences) => ReactNode;
}

export interface ChatSurfacePreferences {
  open: boolean;
  setOpen: (open: boolean) => void;
  themePreference: ScoutThemePreference;
  setThemePreference: (next: ScoutThemePreference) => void;
}

type StagedOutgoing = MessageAttachment & { localPath?: string; transcribeAfterSend?: boolean };

async function outgoingChatAttachments(
  files: File[],
  uploadRemote: (files: File[]) => Promise<StagedOutgoing[]>,
): Promise<StagedOutgoing[]> {
  // Browser File objects always upload. A Finder path is often Desktop/Downloads,
  // which is outside Scout's trusted roots — sending it as localPath 403s and
  // looks like "attach did nothing".
  if (files.length === 0) return [];
  return uploadRemote(files);
}


/** The operator's last view of a Board room, kept on this browser. */
const VERCEL_BOARD_VIEW_KEY = "openscout.chat.vercelBoardView";

function readVercelBoardView(channelId: string): VercelBoardView | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(VERCEL_BOARD_VIEW_KEY) ?? "{}") as Record<string, unknown>;
    const view = stored[channelId];
    return view === "conversation" || view === "tasks" ? view : null;
  } catch {
    return null;
  }
}

function writeVercelBoardView(channelId: string, view: VercelBoardView): void {
  try {
    const stored = JSON.parse(window.localStorage.getItem(VERCEL_BOARD_VIEW_KEY) ?? "{}") as Record<string, unknown>;
    window.localStorage.setItem(VERCEL_BOARD_VIEW_KEY, JSON.stringify({ ...stored, [channelId]: view }));
  } catch {
    // a browser without storage keeps the pick for this visit only
  }
}

export function ChatSpaceSurface({
  signedOut,
  inShell = false,
  roomListInPage = false,
  roomsCatalog,
  roomKind,
  vercelBoardRooms: hostBoardRooms,
  catalogLoading = false,
  catalogErrors = [],
  onRetryCatalog,
  onSelectCatalogRoom,
  directRows,
  catalogDirects,
  roomsList = null,
  activeDirectId = null,
  onSelectDirect,
  directPane,
  directTitle = null,
  activityInPanel = false,
  sidebarWidthBounds,
  appearanceControls,
  preferences,
}: ChatSpaceSurfaceProps = {}) {
  // Which server this surface is talking to. Absent a provider it is the local
  // Scout server, which is what `/chat` has always mounted.
  const chatApi = useChatApi();
  const capabilities = useChatCapabilities();
  const { source } = useChatTransport();
  const address = useChatAddress();

  const {
    theme,
    preference: themePreference,
    setPreference: setThemePreference,
  } = useScoutStandaloneAppearance();

  const [phase, setPhase] = useState<Phase>("loading");
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [bootstrap, setBootstrap] = useState<ChatBootstrap | null>(null);
  // The space the loaded list answers for. It trails `space` while a switch loads.
  const [bootstrapFor, setBootstrapFor] = useState<string | null>(null);
  const [channelId, setChannelId] = useState<string | null>(() => address.read().channelId);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(() => address.read().messageId);
  // An absent selector means "whichever space the server answers for"; the
  // local default is named so that links predating spaces stay byte-identical.
  const [space, setSpace] = useState<string>(() => address.read().space ?? DEFAULT_CHAT_SPACE);
  const voiceNoteTranscriber = useMemo(() => channelId && chatApi.voiceNoteCapabilities && chatApi.transcribeVoiceNote ? {
    afterSend: chatApi.voiceNotesAfterSend,
    capabilities: (signal: AbortSignal) => chatApi.voiceNoteCapabilities!(channelId, space, signal),
    transcribe: (payload: { audio: string }, signal: AbortSignal) => chatApi.transcribeVoiceNote!(channelId, payload, space, signal),
  } : undefined, [chatApi, channelId, space]);
  const [feed, setFeed] = useState<ChannelFeed | null>(null);
  // The feed as last rendered, for reads that start between renders. Every
  // optimistic write goes through setFeed, so the next render brings it here.
  const feedRef = useRef<ChannelFeed | null>(null);
  feedRef.current = feed;
  const [members, setMembers] = useState<ChannelMemberView[]>([]);
  const [invites, setInvites] = useState<ChannelInvitePublicView[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [panel, setPanel] = useState<PanelView>({ kind: "none" });
  const [closingPanel, setClosingPanel] = useState<PanelView | null>(null);
  const visiblePanel = closingPanel ?? panel;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [boardSheetOpen, setBoardSheetOpen] = useState(false);
  useEffect(() => {
    if (panel.kind !== "none") setClosingPanel(null);
  }, [panel.kind]);
  // Search and questions stay mounted beside the channel; the inspector hosts
  // their triggers and content through portals without resetting drafts.
  const [channelToolContentHost, setChannelToolContentHost] = useState<HTMLDivElement | null>(null);
  const [channelToolTriggersHost, setChannelToolTriggersHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => setClosingPanel(null), [channelId, space]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  // A frame with no operator of its own (Hosted Chat's Scout frame) marks
  // spots in its top row; this surface fills them with its jump field and its
  // account menu, and keeps ⌘K and ⌘, for itself.
  const topRowSearch = useTopRowSearchSlot(inShell);
  const topRowIdentity = useTopRowIdentitySlot(inShell);
  const ownsTopRow = topRowIdentity !== null;
  const hasPreferences = Boolean(preferences) && (!inShell || ownsTopRow);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [threadSending, setThreadSending] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [compactView, setCompactView] = useState<"list" | "channel" | "panel">(
    () => (address.read().channelId ? "channel" : "list"),
  );
  seedChatSidebarCollapse();
  const viewportWidth = useViewportWidth();
  // Hosted Chat portals its room list into its frame. Rooms instead gives the
  // shell rail to channel families and keeps its room list beside the feed.
  const railSlot = useRoomsRailSlot(inShell && !roomListInPage);
  const shellRail = railSlot !== null;
  const isCompact = useMediaQuery("(max-width: 899px)") && !shellRail;
  // Rooms below 900px: the top band has no name, no toggle, and its jump button
  // is hidden, so it would be an empty strip over the list. It goes.
  const showTopbar = !shellRail && !(roomListInPage && isCompact);
  const isMidWidth = useMediaQuery("(max-width: 1199px)");
  const sidebarCollapse = useSidebarCollapse(
    "chat",
    isCompact ? 1600 : viewportWidth,
    SLACK_SIDEBAR_COLLAPSED_WIDTH,
    CHAT_SIDEBAR_WIDTH,
    sidebarWidthBounds,
  );
  const sidebarDragTargetRef = useRef(sidebarCollapse.width);
  const [draggedPanelWidth, setPanelWidth] = useState(readPanelWidth);
  const panelWidth = draggedPanelWidth ?? chatPanelDefaultWidth(viewportWidth);
  const panelDragTargetRef = useRef(panelWidth);
  const [panelDragWidth, setPanelDragWidth] = useState<number | null>(null);

  const sendLedger = useRef(createChatSendLedger(newRequestId));
  const feedScrollRef = useRef<HTMLDivElement | null>(null);
  const feedContentRef = useRef<HTMLDivElement | null>(null);
  // Which channel the feed currently in state was read for. The state itself
  // cannot say: a feed has no channel id on it, and it survives one commit
  // past the selection change that invalidated it.
  const feedChannel = useRef<string | null>(null);
  const feedReadGeneration = useRef(0);
  const lastFullFeedRead = useRef(0);
  const emptyFullFeedReads = useRef(0);
  const rosterForChannel = useRef<string | null>(null);
  const rosterReadGeneration = useRef(0);
  // A panel view that must survive the channel switch it triggered: the
  // channel-change effect applies it instead of closing the panel.
  const pendingPanel = useRef<PanelView | null>(null);
  // Every channel read is stamped with the selection that started it. A
  // response that outlives its selection is dropped rather than applied —
  // including the A→B→A case, where the channel id alone would look current
  // again while the reading is from the previous visit.
  const [selection] = useState(createSelectionGuard);
  const [bootstrapSelection] = useState(createSelectionGuard);
  const bootstrapSpace = useRef(space);
  if (bootstrapSpace.current !== space) {
    bootstrapSpace.current = space;
    bootstrapSelection.reset();
  }

  /* ── identity and channel list ─────────────────────────────────────────── */

  const loadBootstrap = useCallback(async (initial: boolean) => {
    const isCurrent = bootstrapSelection.begin();
    try {
      const next = await chatApi.bootstrap({
        recoverSession: !new URLSearchParams(window.location.search).has("signedOut"),
        space,
      });
      if (!isCurrent()) return;
      setBootstrap(next);
      setBootstrapFor(next.space ?? space);
      // Adopt the space the server answered for rather than the one we asked
      // about. A member whose credential names one space is answered for that
      // space whatever the URL said, and the switcher must show where they
      // actually are.
      if (next.space && next.space !== space) setSpace(next.space);
      setPhase("ready");
      setGateMessage(null);
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ChatApiError && error.isUnauthenticated) {
        // A later poll 401 must not kick a working room to the login gate.
        // That is how a cookie blip turned a multiplayer channel into an
        // empty solo view.
        if (!initial && phase === "ready") {
          setStale(true);
          return;
        }
        setPhase("gate");
        setGateMessage(error.message);
        return;
      }
      if (initial) {
        setPhase("error");
        setGateMessage(
          error instanceof Error ? error.message : "Scout Chat could not be reached.",
        );
      } else {
        setStale(true);
      }
    }
  }, [bootstrapSelection, chatApi, phase, space]);

  useEffect(() => {
    void loadBootstrap(true);
  }, [loadBootstrap]);

  usePoll(() => loadBootstrap(false), BOOTSTRAP_POLL_MS, phase === "ready");

  // Rooms made through the API carry their id as a title; every place that
  // draws a room reads this list, so the readable name is settled here once.
  const untitledRoomIds = useMemo(
    () => new Set((bootstrap?.channels ?? []).filter((item) => item.kind === "channel" && !hasOwnRoomTitle(item)).map((item) => item.id)),
    [bootstrap],
  );
  // A Vercel Board room is named by its Board channel, marked as Board's in
  // the room list, and keeps where it comes from for its room details: the
  // runtime's own title and topic for it spell out the board's API address.
  // Where the server reads the board itself (hosted chat), a channel says
  // which board channel it shows, and the local runtime is never asked.
  const serverBoardRooms = capabilities.vercelBoardChannels === true;
  const ownBoardRooms = useVercelBoardRooms(source === "scout" && !hostBoardRooms && !serverBoardRooms);
  const channelBoardRooms = useMemo<VercelBoardRooms>(() => {
    const rooms = new Map<string, VercelBoardRoomRef>();
    for (const item of bootstrap?.channels ?? []) {
      const boardChannel = item.metadata?.vercelBoardChannel;
      if (typeof boardChannel === "string") rooms.set(item.id, { conversationId: item.id, connectionId: "hosted", channel: boardChannel, mirror: "mirrored" });
    }
    return { rooms, ready: true };
  }, [bootstrap]);
  const { rooms: vercelBoardRooms, ready: vercelBoardRoomsReady } = hostBoardRooms ?? (serverBoardRooms ? channelBoardRooms : ownBoardRooms);
  const boardReader = useMemo<VercelBoardRoomReader | undefined>(
    () => serverBoardRooms && chatApi.vercelBoardRoom ? (id) => chatApi.vercelBoardRoom!(id) : undefined,
    [chatApi, serverBoardRooms],
  );
  // The open board room's reload, for the board composer, which is declared before the room is read.
  const boardRoomReload = useRef<(() => Promise<void>) | null>(null);
  // In a board room the server holds, the composer posts text to the board: no asks, no files.
  const boardComposerCapabilities = useMemo(() => ({ ...capabilities, asks: false, attachments: false }), [capabilities]);
  const channels = useMemo(
    () => sortChannels((bootstrap?.channels ?? [])
      .filter((item) => item.kind === "channel")
      // The Scout tab keeps a Board room that is open, so a link to one is not
      // sent elsewhere; the host moves it to the Vercel tab.
      .filter((item) => roomKind === "board" ? vercelBoardRooms.has(item.id)
        : roomKind === "scout" ? !vercelBoardRooms.has(item.id) || item.id === channelId
          : true)
      .map((item) => {
        const board = vercelBoardRooms.get(item.id);
        if (board) return { ...item, title: board.channel, topic: undefined, metadata: { ...item.metadata, source: VERCEL_BOARD_SOURCE } };
        return untitledRoomIds.has(item.id) ? { ...item, title: roomTitle(item) } : item;
      })),
    [bootstrap, channelId, roomKind, untitledRoomIds, vercelBoardRooms],
  );
  const directs = useMemo(
    () => roomKind === "board" ? [] :
      (bootstrap?.channels ?? []).filter(
        (item) => item.kind === "direct" || item.kind === "group_direct",
      ),
    [bootstrap, roomKind],
  );

  const selectableIds = useMemo(
    () => new Set([...channels, ...directs].map((item) => item.id)),
    [channels, directs],
  );

  // Never invented. A server that sends no space list is a server that predates
  // spaces, and the surface renders exactly one: the one it is in.
  const spaces = useMemo<ChatSpaceView[]>(
    () => bootstrap?.spaces?.length
      ? bootstrap.spaces
      : [{
          slug: space,
          title: space === DEFAULT_CHAT_SPACE ? "Home" : space,
          conversationId: null,
          isDefault: space === DEFAULT_CHAT_SPACE,
          channelCount: channels.length,
        }],
    [bootstrap, channels.length, space],
  );
  // The team switcher heads the list. A switch drops the bootstrap while the
  // next one loads; the switcher keeps the last list the server sent, so the
  // head does not blink out under it.
  const knownSpaces = useRef<ChatSpaceView[] | null>(null);
  if (bootstrap?.spaces?.length) knownSpaces.current = bootstrap.spaces;
  const stripSpaces = bootstrap?.spaces?.length ? bootstrap.spaces : knownSpaces.current ?? spaces;

  // Land on something real: a link to a channel we cannot see falls back to
  // the first one rather than rendering an empty room.
  // An open DM is the selection: no room is owed a fallback under it.
  const directActive = Boolean(activeDirectId && directPane);
  useEffect(() => {
    if (phase !== "ready" || directActive) return;
    // The Vercel tab knows its rooms only once the Board rooms are read.
    if (roomKind === "board" && !vercelBoardRoomsReady) return;
    const fallback = roomFallback({
      listSpace: bootstrap ? bootstrapFor : null,
      space,
      channelId,
      selectableIds,
      firstId: channels[0]?.id ?? directs[0]?.id ?? null,
    });
    if (fallback === undefined) return;
    setChannelId(fallback);
    address.write({ channelId: fallback, space, messageId: null }, true);
  }, [address, bootstrap, bootstrapFor, channelId, channels, directActive, directs, phase, roomKind, selectableIds, space, vercelBoardRoomsReady]);

  useEffect(() => {
    const onPopState = () => {
      const here = address.read();
      setChannelId(here.channelId);
      setSpace(here.space ?? DEFAULT_CHAT_SPACE);
      setFocusMessageId(here.messageId);
      setPanel({ kind: "none" });
      // A host that opens DMs beside the rooms keeps an open DM in view.
      const directOpen = Boolean(onSelectDirect)
        && Boolean(new URLSearchParams(window.location.search).get(ROOMS_DIRECT_QUERY_KEY));
      setCompactView(here.channelId || directOpen ? "channel" : "list");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [address, onSelectDirect]);

  const channel = useMemo(
    () => directActive ? null : [...channels, ...directs].find((item) => item.id === channelId) ?? null,
    [channels, channelId, directActive, directs],
  );
  useEffect(() => {
    if (directActive) setCompactView((view) => (view === "list" ? "channel" : view));
  }, [activeDirectId, directActive]);
  const directRowIds = useMemo(() => new Set((directRows ?? []).map((row) => row.id)), [directRows]);

  /* ── channel contents ──────────────────────────────────────────────────── */

  const readState = useChatReadState({
    api: chatApi,
    actorId: bootstrap?.viewer.actorId ?? null,
    space,
    channelIds: (source === "slack" ? [...channels, ...directs] : channels).map((item) => item.id),
    activeChannelId: channelId,
    enabled: phase === "ready" && capabilities.readState === true,
    ...(source === "slack" ? { backgroundIntervalMs: 15 * 60_000, backgroundBatchSize: 1, backgroundBatchDelayMs: 3_000 } : {}),
  });

  // Polls, live events and sends catch up from the newest message on screen;
  // the room is read in full when it opens, every FEED_FULL_READ_MS, and after
  // an edit or reaction (see feed-reads.ts).
  const loadFeed = useCallback(async (mode: "catch-up" | "full" = "catch-up"): Promise<number | void> => {
    if (!channelId) return;
    const isCurrent = selection.begin();
    const readGeneration = ++feedReadGeneration.current;
    const held = feedChannel.current === channelId ? feedRef.current : null;
    const after = mode === "catch-up" && held && Date.now() - lastFullFeedRead.current < FEED_FULL_READ_MS
      ? feedPosition(held.messages)
      : null;
    try {
      const next = await chatApi.feed(channelId, space, after ? { after } : undefined);
      if (!isCurrent() || readGeneration !== feedReadGeneration.current) return;
      const result = applyFeedRead(feedChannel.current === channelId ? feedRef.current : null, next, emptyFullFeedReads.current);
      if (typeof next.caughtUp !== "boolean") {
        lastFullFeedRead.current = Date.now();
        emptyFullFeedReads.current = next.messages.length === 0 ? emptyFullFeedReads.current + 1 : 0;
      }
      feedChannel.current = channelId;
      feedRef.current = result.feed;
      setFeed(result.feed);
      setFeedError(null);
      setStale(false);
      if (result.readRoomAgain) return loadFeed("full");
    } catch (error) {
      // Keep the last good feed on screen and say the reading is stale. An
      // empty channel and an unreachable one must never look the same.
      if (!isCurrent() || readGeneration !== feedReadGeneration.current) return;
      if (error instanceof ChatApiError && error.isUnauthenticated) {
        setFeedError(error.message);
        return;
      }
      setStale(true);
      if (error instanceof ChatApiError && error.status === 429) return error.retryAfterSeconds ?? 60;
    }
  }, [channelId, chatApi, selection, space]);
  const loadFullFeed = useCallback(() => loadFeed("full"), [loadFeed]);

  const loadRoster = useCallback(async () => {
    if (!channelId) return;
    const isCurrent = selection.begin();
    const readGeneration = ++rosterReadGeneration.current;
    try {
      const next = await chatApi.members(channelId, space);
      if (!isCurrent() || readGeneration !== rosterReadGeneration.current) return;
      setMembers((current) => {
        const incoming = next.members ?? [];
        if (incoming.length === 0 && !next.authoritative) return current;
        // First successful read for this channel may replace. Every later
        // read merges partial snapshots; complete rosters remove departed members.
        if (rosterForChannel.current !== channelId) {
          rosterForChannel.current = channelId;
          return incoming;
        }
        return mergeChannelRoster(current, incoming, next.authoritative);
      });
    } catch {
      if (!isCurrent() || readGeneration !== rosterReadGeneration.current) return;
      setStale(true);
    }
  }, [channelId, chatApi, selection, space]);

  const loadInvites = useCallback(async () => {
    // A server that does not list invitations is not a server with none. The
    // panel says so; this read is simply not made.
    if (!channelId || !capabilities.inviteList) return;
    const isCurrent = selection.begin();
    try {
      const next = await chatApi.invites(channelId, space);
      if (!isCurrent()) return;
      setInvites(next.invites ?? []);
      setInviteError(null);
    } catch (error) {
      if (!isCurrent()) return;
      setInvites([]);
      setInviteError(
        error instanceof ChatApiError && error.isUnauthenticated
          ? "Only members of this channel can manage its invitations."
          : error instanceof Error
            ? error.message
            : "Invitations could not be read.",
      );
    }
  }, [capabilities.inviteList, channelId, chatApi, selection, space]);

  useEffect(() => {
    // Wipe feed/invites on channel change, but keep the last roster until
    // the new one arrives so the facepile does not collapse to nobody.
    selection.reset();
    feedChannel.current = null;
    feedRef.current = null;
    lastFullFeedRead.current = 0;
    emptyFullFeedReads.current = 0;
    setFeed(null);
    setInvites([]);
    setFeedError(null);
    setPanel(pendingPanel.current ?? { kind: "none" });
    if (pendingPanel.current) setCompactView("panel");
    pendingPanel.current = null;
    if (rosterForChannel.current !== channelId) {
      rosterForChannel.current = null;
    }
  }, [channelId, selection]);

  useEffect(() => {
    // Hosted channel reads need the space map established by bootstrap.
    if (!channelId || phase !== "ready") return;
    void loadFeed();
    void loadRoster();
    void loadInvites();
  }, [channelId, phase, loadFeed, loadInvites, loadRoster]);

  usePoll(() => loadFeed(), FEED_POLL_MS, phase === "ready" && Boolean(channelId));
  usePoll(loadRoster, ROSTER_POLL_MS, phase === "ready" && Boolean(channelId));
  usePoll(loadInvites, ROSTER_POLL_MS, phase === "ready" && Boolean(channelId) && capabilities.inviteList && panel.kind === "members");
  useEffect(() => {
    if (phase === "ready" && panel.kind === "members") void loadInvites();
  }, [phase, panel.kind, loadInvites]);
  // A redeemed invitation arrives as a new roster member; re-read the list
  // then instead of leaving a spent "Invited" row until the next slow poll.
  const rosterKey = useMemo(() => members.map(member => member.actorId).sort().join("\n"), [members]);
  useEffect(() => {
    if (phase === "ready" && panel.kind === "members" && rosterKey) void loadInvites();
  }, [rosterKey]);

  // The stream only shortens the wait for a posted message. The polls above
  // stay exactly as they were: they remain the fallback when no stream is
  // served, and they are still the only reader of roster and reception, which
  // the current stream contract says nothing about.
  useChannelLive(
    channelId,
    phase === "ready" && capabilities.liveStream,
    () => loadFeed().then(() => {}),
    space,
  );

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const membersById = useMemo(() => {
    const map = new Map<string, ChannelMemberView>();
    for (const member of members) map.set(member.actorId, member);
    return map;
  }, [members]);

  const projection = useMemo(
    () => projectFeed({
      messages: feed?.messages ?? [],
      requests: feed?.requests ?? [],
      nowMs,
    }),
    [feed, nowMs],
  );

  const forYou = useForYouQuestions(chatApi, bootstrap?.questionCounts, bootstrap?.channels ?? [], space);
  const openWorkItems = useMemo(
    () => openWork(feed?.requests ?? [], feed?.messages ?? []),
    [feed],
  );

  const viewer = bootstrap?.viewer ?? null;
  const sidebarSeen = useSidebarSeen({
    channelId,
    feed,
    feedIsCurrent: feedChannel.current === channelId,
    members,
    membersAreCurrent: rosterForChannel.current === channelId,
    viewerActorId: viewer?.actorId ?? null,
  });

  // ⌘K shows the sidebar's own facts per conversation; computed only while open.
  const paletteFacts = useMemo<Record<string, ConversationFacts>>(() => {
    if (!paletteOpen) return {};
    const input = {
      readStates: readState.states,
      seen: sidebarSeen,
      lastMessages: bootstrap?.lastMessages ?? {},
      viewerActorId: viewer?.actorId ?? null,
    };
    return Object.fromEntries([...channels, ...directs].map((conversation) => [conversation.id, conversationFacts(conversation, input)]));
  }, [bootstrap?.lastMessages, channels, directs, paletteOpen, readState.states, sidebarSeen, viewer?.actorId]);

  const addressedChannelIds = useMemo(() => {
    const ids = new Set<string>();
    // Attention is only claimed for the channel whose feed we actually hold.
    // There is no unread projection on the wire, so no other row gets a dot.
    if (!channelId || !viewer) return ids;
    if (channelHasOwedAttention({ projection, viewerActorId: viewer.actorId, members })) {
      ids.add(channelId);
    }
    return ids;
  }, [channelId, members, projection, viewer]);

  const draftScope = viewer && channelId ? { actorId: viewer.actorId, space, channelId } : null;
  const visibleRootMessages = useMemo(
    () => projection.entries.flatMap((entry) => entry.kind === "turn"
      ? [{ id: entry.message.id, createdAt: entry.message.createdAt }]
      : []),
    [projection.entries],
  );
  const visibleMessageIds = useMemo(
    () => visibleRootMessages.map((message) => message.id),
    [visibleRootMessages],
  );
  // A Vercel Board room is the board channel itself: one room per channel,
  // drawn from the runtime's copy of the board. Conversation and Tasks are two
  // views of one read. A channel that is mostly tasks opens on Tasks, a
  // channel of talk (or decisions) on Conversation; the operator's last pick
  // for the room wins. Scout's own messages in the room (asks dispatched
  // there, posts from the composer) follow the board's in Conversation.
  const vercelBoardRoom = channelId ? vercelBoardRooms.get(channelId) ?? null : null;
  const isVercelBoardRoom = Boolean(vercelBoardRoom);
  const boardRoom = useVercelBoardRoom(isVercelBoardRoom ? channelId : null, boardReader);
  boardRoomReload.current = boardRoom.reload ?? null;
  const [vercelBoardPick, setVercelBoardPick] = useState<{ channelId: string; view: VercelBoardView } | null>(null);
  // A room the operator has not picked a view for opens on the one its read
  // suggests. Until that read lands no tab is marked, so the room does not
  // open on one view and jump to the other; a failed read falls back to
  // Conversation, where the Scout room still works.
  const vercelBoardTab: VercelBoardView | null = (vercelBoardPick?.channelId === channelId ? vercelBoardPick.view : null)
    ?? (channelId ? readVercelBoardView(channelId) : null)
    ?? (boardRoom.data ? vercelBoardDefaultView(boardRoom.data.channel, boardRoom.data.messages) : boardRoom.error || boardRoom.unheld ? "conversation" : null);
  const pickVercelBoardView = (view: VercelBoardView) => {
    if (!channelId) return;
    setVercelBoardPick({ channelId, view });
    writeVercelBoardView(channelId, view);
  };
  const vercelBoardTasksOpen = isVercelBoardRoom && vercelBoardTab === "tasks";
  const vercelBoardPending = isVercelBoardRoom && vercelBoardTab === null;
  const selectedReadState = channelId ? readState.states[channelId] : undefined;
  const readPositionIsLocal = source === "slack"
    && (selectedReadState as (typeof selectedReadState & { positionScope?: string }) | undefined)?.positionScope === "local";
  const rootReadLane = selectedReadState?.lanes.find((lane) => lane.rootMessageId === null);
  const reading = useChatReadingPosition({
    scope: draftScope,
    ready: Boolean(feed && channel && feedChannel.current === channelId
      && (!capabilities.readState || selectedReadState || readState.error)),
    messageIds: visibleMessageIds,
    focusMessageId,
    initialUnreadMessageId: rootReadLane?.unreadMessageIds.find((id) => visibleMessageIds.includes(id)),
    scroller: feedScrollRef,
    content: feedContentRef,
  });
  const latestVisibleRootId = visibleMessageIds.at(-1) ?? null;
  const unreadArrival = useRef<{ key: string; messageId: string | null } | null>(null);
  const unreadVisitKey = JSON.stringify([viewer?.actorId, space, channelId]);
  if (unreadArrival.current?.key !== unreadVisitKey) unreadArrival.current = null;
  if (!unreadArrival.current && rootReadLane) {
    unreadArrival.current = { key: unreadVisitKey, messageId: rootReadLane.unreadMessageIds[0] ?? null };
  }

  const threadRootId = visiblePanel.kind === "thread" ? visiblePanel.rootMessageId : null;
  const seenFeedIds = useRef<string[]>([]);
  const seenThreadIds = useRef<string[]>([]);
  const threadSeenFor = useRef<string | null>(null);
  if (threadSeenFor.current !== threadRootId) {
    threadSeenFor.current = threadRootId;
    seenThreadIds.current = [];
  }
  const channelFeedOnScreen = Boolean(channelId && selectedReadState && feedChannel.current === channelId
    && (!isCompact || compactView === "channel"));
  // Replies live in the channel read lane. The feed only shows roots, so a
  // reply counts as read when the open thread actually has it on screen.
  const acknowledgeSeen = () => {
    if (!channelId || !selectedReadState || !feed || feedChannel.current !== channelId) return;
    const messageId = readCursorForSeenMessages({
      messages: feed.messages.map((message) => ({ id: message.id, createdAt: message.createdAt })),
      seenIds: new Set([...seenFeedIds.current, ...seenThreadIds.current]),
      lastReadMessageId: rootReadLane?.lastReadMessageId ?? null,
      unreadMessageIds: rootReadLane?.unreadMessageIds,
    });
    if (messageId) void readState.markRead(channelId, messageId);
  };
  useReportSeenMessages(feedScrollRef, channelFeedOnScreen, `${phase}:${latestVisibleRootId ?? ""}`, (seenIds) => {
    seenFeedIds.current = seenIds;
    acknowledgeSeen();
  });

  // Replies under a root the viewer is looking at arrive as a reply count on
  // that root; they must not leave the channel badged while it is on screen.
  const openThreadRootId = visiblePanel.kind === "thread" ? visiblePanel.rootMessageId : null;
  const viewedThreads = useMemo(() => viewedThreadReads(selectedReadState, visibleMessageIds, openThreadRootId), [openThreadRootId, selectedReadState, visibleMessageIds]);
  useEffect(() => {
    if (!channelId || !viewedThreads.length || reading.away || feedChannel.current !== channelId
      || (isCompact && compactView !== "channel")) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible" || !feedScrollRef.current?.getClientRects().length) return;
      for (const read of viewedThreads) void readState.markRead(channelId, read.messageId, read.rootMessageId);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [channelId, compactView, isCompact, reading.away, readState.markRead, viewedThreads]);

  // A Board room reads itself while it is open, on Tasks as well as Conversation.
  const boardReads = useMemo(() => (isVercelBoardRoom ? boardRoomReads(selectedReadState) : []), [isVercelBoardRoom, selectedReadState]);
  useEffect(() => {
    if (!channelId || !boardReads.length || reading.away || (isCompact && compactView !== "channel")) return;
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      for (const read of boardReads) void readState.markRead(channelId, read.messageId, read.rootMessageId);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [boardReads, channelId, compactView, isCompact, reading.away, readState.markRead]);

  /* ── sending ───────────────────────────────────────────────────────────── */

  const channelDraft = useChatDraft(draftScope);
  const messageContext = useChatMessageContext(chatApi, bootstrap?.viewer.actorId ?? null, space, channelId, focusMessageId ?? threadRootId);
  const onQuestionResponse = async (questionId: string, change: ChatQuestionChange) => {
    if (!channelId || !chatApi.respondQuestion) throw new Error("Question responses are unavailable.");
    const isCurrent = selection.begin();
    try {
      const result = await chatApi.respondQuestion(channelId, questionId, change, space);
      if (!isCurrent()) return;
      void loadBootstrap(false);
      setFeed(previous => previous ? { ...previous, requests: previous.requests.map(item => item.responsibility?.recordId === questionId
        ? { ...item, responsibility: result.responsibility } : item) } : previous);
    } catch (error) {
      if (isCurrent() && error instanceof ChatApiError && error.status === 409) await loadFeed("full");
      throw error;
    }
  };
  const onCorrect: CorrectChatMessage = async (messageId, change) => {
    if (!channelId || !chatApi.correctMessage) throw new Error("Message corrections are unavailable.");
    const isCurrent = selection.begin();
    const install = (message: ChatMessage) => {
      if (!isCurrent()) return;
      setFeed(previous => previous ? { ...previous, messages: previous.messages.map(item => item.id === messageId ? newestChatMessage(item, message) : item) } : previous);
      messageContext.replaceMessage(message);
    };
    try {
      const result = await chatApi.correctMessage(channelId, messageId, change, space);
      install(result.message);
      if (isCurrent()) void loadFeed("full");
      return result.message;
    } catch (error) {
      if (error instanceof ChatApiError && error.status === 409 && chatApi.messageContext) {
        const latest = await chatApi.messageContext(channelId, messageId, space).catch(() => null);
        const message = latest?.messages.find(item => item.id === messageId);
        if (message) install(message);
      }
      throw error;
    }
  };

  useEffect(() => {
    if (focusMessageId && messageContext.context && ((panel.kind === "thread" && panel.rootMessageId !== messageContext.context.rootMessageId) || (panel.kind !== "thread" && !feed?.messages.some(message => message.id === focusMessageId)))) {
      setPanel({ kind: "thread", rootMessageId: messageContext.context.rootMessageId });
      setCompactView("panel");
    }
  }, [feed, focusMessageId, messageContext.context, panel]);
  useEffect(() => {
    if (!focusMessageId || !messageContext.context) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector(`.chat-rpanel [data-message-id="${CSS.escape(focusMessageId)}"]`)?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusMessageId, messageContext.context?.rootMessageId]);
  const replyDraft = useChatDraft(threadRootId ? draftScope : null, threadRootId);
  const draft = channelDraft.draft.body;
  const askTargetId = channelDraft.draft.targetActorId;
  const threadDraft = replyDraft.draft.body;

  const presence = useChatPresence(chatApi, channelId, viewer?.actorId, space, phase === "ready" && panel.kind !== "team" && (!isCompact || compactView !== "list"));
  const typingText = chatPresenceText(presence);
  const hereActorIds = useMemo(() => new Set(presence.people.map(person => person.actorId)), [presence.people]);

  const setDraft = useCallback(
    (value: string) => {
      presence.edited();
      channelDraft.store.update((current) => ({ ...current, body: value }));
    },
    [channelDraft.store, presence.edited],
  );

  // The intro's starters nudge the composer; they never post or ask by themselves.
  const [composerRequest, setComposerRequest] = useState<{ kind: "focus" | "ask"; at: number } | null>(null);
  // Set only when a message click (or the reply control) should put the caret
  // in the thread composer. Cleared once that thread is no longer open, so a
  // later deep link does not steal focus.
  const [threadReplyFocus, setThreadReplyFocus] = useState<{ kind: "focus"; at: number } | null>(null);
  useEffect(() => {
    if (panel.kind !== "thread") setThreadReplyFocus(null);
  }, [panel.kind]);
  const channelHasAskable = capabilities.asks && members.some(isAskableMember);

  const setAskTarget = useCallback(
    (actorId: string | null) => {
      channelDraft.store.update((current) => ({ ...current, targetActorId: actorId }));
    },
    [channelDraft.store],
  );

  const send = useCallback(
    async (input: {
      body: string;
      replyToMessageId: string | null;
      targetActorId: string | null;
      files?: File[];
      transcribeFiles?: File[];
      mentionActorIds?: string[];
      onMessage?: (message: ChatMessage) => void;
    }) => {
      if (!channelId || !viewer) return false;
      const body = input.body.trim();
      const files = input.files ?? [];
      const mentionActorIds = [...new Set(input.mentionActorIds ?? [])].sort();
      if (!body && files.length === 0) return false;

      const pending = sendLedger.current.begin({
        actorId: viewer.actorId, space, channelId, body,
        replyToMessageId: input.replyToMessageId,
        targetActorId: input.targetActorId, files, mentionActorIds,
      });
      const requestId = pending.requestId;
      const attachments = pending.attachments ?? (files.length > 0
        ? await outgoingChatAttachments(files, (remote) =>
          chatApi.uploadAttachments
            ? chatApi.uploadAttachments(channelId, remote, space, input.targetActorId ? [] : input.transcribeFiles)
            : uploadMediaFiles(remote))
        : undefined);
      sendLedger.current.prepared(pending, attachments);

      const posted = input.targetActorId
        ? await chatApi.postAsk(channelId, {
            requestId,
            body,
            targetActorId: input.targetActorId,
            ...(attachments?.length ? { attachments } : {}),
            mentionActorIds,
            space,
            ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
          })
        : await chatApi.postMessage(channelId, {
            requestId,
            body,
            mentionActorIds,
            space,
            ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
          });
      input.onMessage?.(posted.message);
      // A late success acknowledges only this logical send.
      sendLedger.current.acknowledge(pending);
      await loadFeed();
      void loadRoster();
      return true;
    },
    [channelId, chatApi, loadFeed, loadRoster, space, viewer],
  );

  const onReact = useCallback((messageId: string, emoji: string, remove: boolean) => {
    if (!channelId) return;
    const previous = feed;
    setFeed((current) => {
      if (!current) return current;
      return {
        ...current,
        messages: current.messages.map((message) =>
          message.id === messageId
            ? { ...message, reactions: applyOptimisticReaction(message.reactions, emoji, remove, viewer?.actorId) }
            : message),
      };
    });
    const requestId = newRequestId();
    const write = remove ? chatApi.removeReaction : chatApi.addReaction;
    void write(channelId, { messageId, emoji, requestId, space })
      .then(() => {
        void loadFeed("full");
      })
      .catch((error: unknown) => {
        setFeed(previous);
        setFeedError(
          error instanceof ChatApiError
            ? error.message
            : "That reaction did not save.",
        );
      });
  }, [channelId, chatApi, feed, loadFeed, space, viewer?.actorId]);

  const onStopAsk = useCallback(async (flightId: string) => {
    if (!channelId) return;
    const isCurrent = selection.begin();
    const result = await chatApi.cancelAsk(channelId, flightId, space);
    if (!isCurrent()) return;
    setFeed(current => current ? {
      ...current,
      requests: current.requests.map(item => item.flightId === flightId ? { ...item, state: result.request.state } : item),
    } : current);
    void loadFeed();
  }, [channelId, chatApi, loadFeed, selection, space]);

  const onSendChannel = useCallback((files: File[] = [], transcribeFiles: File[] = []) => {
    if (!channelId || sending) return Promise.resolve(false);
    setSendError(null);
    setSending(true);
    return send({ body: draft, replyToMessageId: null, targetActorId: askTargetId, files, transcribeFiles, mentionActorIds: channelDraft.draft.mentions?.map(mention => mention.actorId) })
      .then((sent) => {
        if (sent) {
          channelDraft.store.clearIfUnchanged(channelDraft.draft);
        }
        return sent;
      })
      .catch((error: unknown) => {
        setSendError(
          error instanceof ChatApiError
            ? error.message
            : "That did not send. The text is still here — try again.",
        );
        return false;
      })
      .finally(() => setSending(false));
  }, [askTargetId, channelId, channelDraft.draft, channelDraft.store, draft, send, sending]);

  /**
   * The composer in a board room the server holds (hosted chat): the text
   * posts to the board channel, under the poster's own name there, and the
   * room reads again so it shows. Nothing is kept in this space's own feed.
   */
  const boardRequest = useRef<{ text: string; requestId: string } | null>(null);
  const onSendBoard = useCallback((files: File[] = []) => {
    if (!channelId || sending || !chatApi.vercelBoardPost) return Promise.resolve(false);
    const text = draft.trim();
    if (files.length > 0) {
      setSendError("Board rooms take text only. Remove the file to post.");
      return Promise.resolve(false);
    }
    if (!text) return Promise.resolve(false);
    setSendError(null);
    setSending(true);
    // A retry of the same text reuses its request ID, so the board posts it once.
    const requestId = boardRequest.current?.text === text ? boardRequest.current.requestId : newRequestId();
    boardRequest.current = { text, requestId };
    return chatApi.vercelBoardPost(channelId, { requestId, text })
      .then(() => {
        boardRequest.current = null;
        channelDraft.store.clearIfUnchanged(channelDraft.draft);
        setDraft("");
        void boardRoomReload.current?.();
        return true;
      })
      .catch((error: unknown) => {
        setSendError(error instanceof ChatApiError ? error.message : "That did not post to the board. The text is still here. Try again.");
        return false;
      })
      .finally(() => setSending(false));
  }, [channelDraft.draft, channelDraft.store, channelId, chatApi, draft, sending]);

  const onSendThreadReply = useCallback((files: File[] = [], transcribeFiles: File[] = []) => {
    if (!threadRootId || threadSending) return Promise.resolve(false);
    setThreadError(null);
    setThreadSending(true);
    return send({
      body: threadDraft,
      replyToMessageId: threadRootId,
      targetActorId: replyDraft.draft.targetActorId,
      files,
      transcribeFiles,
      mentionActorIds: replyDraft.draft.mentions?.map(mention => mention.actorId),
      onMessage: messageContext.replaceMessage,
    })
      .then((sent) => {
        if (sent) replyDraft.store.clearIfUnchanged(replyDraft.draft);
        return sent;
      })
      .catch((error: unknown) => {
        setThreadError(
          error instanceof ChatApiError ? error.message : "That reply did not send.",
        );
        return false;
      })
      .finally(() => setThreadSending(false));
  }, [send, threadDraft, threadRootId, threadSending, replyDraft.draft, replyDraft.store, messageContext]);

  /* ── navigation ────────────────────────────────────────────────────────── */

  const conversationNavigation = useRef<ConversationNavigationRow[]>([]);
  const updateConversationNavigation = useCallback((rows: ConversationNavigationRow[]) => {
    conversationNavigation.current = rows;
  }, []);

  const selectDirect = useCallback((id: string) => {
    setChannelId(null);
    feedChannel.current = null;
    setFeed(null);
    setFocusMessageId(null);
    setPanel({ kind: "none" });
    setCompactView("channel");
    onSelectDirect?.(id);
  }, [onSelectDirect]);

  const selectChannel = useCallback((id: string) => {
    setChannelId(id);
    address.write({ channelId: id, space, messageId: null }, false);
    setFocusMessageId(null);
    setPanel({ kind: "none" });
    setCompactView("channel");
  }, [address, space]);

  /**
   * Switch spaces.
   *
   * The channel is dropped, not carried: a channel id belongs to exactly one
   * space, so keeping it across the switch would ask the server for a room
   * that is not in the space we just moved to — and be answered, correctly,
   * with a 404. The next bootstrap lands on that space's first channel.
   */
  const selectSpace = useCallback((slug: string) => {
    if (slug === space) return;
    setSpace(slug);
    setChannelId(null);
    setBootstrap(null);
    feedChannel.current = null;
    setFeed(null);
    setMembers([]);
    setInvites([]);
    setPanel({ kind: "none" });
    setCompactView("list");
    address.write({ channelId: null, space: slug, messageId: null }, false);
    setFocusMessageId(null);
  }, [address, space]);

  const onCopyLink = useCallback((messageId: string) => {
    if (!channelId) return;
    const href = chatMessageHref(window.location.href, {
      channelId,
      messageId,
      space,
    });
    address.write({ channelId, space, messageId }, true);
    setFocusMessageId(messageId);
    void copyTextToClipboard(href);
  }, [address, channelId, space]);

  const openPanel = useCallback((next: PanelView) => {
    setClosingPanel(null);
    setFocusMessageId(null);
    setPanel(next);
    setCompactView(next.kind === "none" ? "channel" : "panel");
  }, []);

  const beginReply = useCallback((rootMessageId: string) => {
    openPanel({ kind: "thread", rootMessageId });
    setThreadReplyFocus({ kind: "focus", at: Date.now() });
  }, [openPanel]);

  const focusThreadReply = useCallback(() => {
    setThreadReplyFocus({ kind: "focus", at: Date.now() });
  }, []);

  const scrolledToMessage = useRef<string | null>(null);
  useEffect(() => {
    if (!focusMessageId || !feed) return;
    const target = feed.messages.find((message) => message.id === focusMessageId);
    if (!target) return;
    if (target.replyToMessageId) {
      setPanel({ kind: "thread", rootMessageId: target.replyToMessageId });
      setCompactView("panel");
    }
    if (scrolledToMessage.current === focusMessageId) return;
    scrolledToMessage.current = focusMessageId;
    const frame = window.requestAnimationFrame(() => {
      const node = document.querySelector(`[data-message-id="${CSS.escape(focusMessageId)}"]`);
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [feed, focusMessageId]);

  const closePanel = useCallback(() => {
    const closing = panel.kind === "none" ? null : panel;
    setClosingPanel(closing);
    setFocusMessageId(null);
    setPanel({ kind: "none" });
    if (!closing) setCompactView("channel");
  }, [panel]);

  const finishClosePanel = useCallback(() => {
    setClosingPanel(null);
    setCompactView("channel");
  }, []);

  const toggleTeam = useCallback(() => {
    if (panel.kind === "team") closePanel();
    else openPanel({ kind: "team" });
  }, [panel.kind, closePanel, openPanel]);

  // A team row opens the member card in the first channel that listed them.
  const openTeamMember = useCallback(
    (actorId: string, targetChannelId: string) => {
      // Crossing channels: the change effect would close the panel, so the
      // card is staged for it to apply instead.
      if (targetChannelId !== channelId) {
        pendingPanel.current = { kind: "member", actorId };
      }
      selectChannel(targetChannelId);
      openPanel({ kind: "member", actorId });
    },
    [channelId, openPanel, selectChannel],
  );

  // Inviting names a channel: the selected one, or the space's first.
  const inviteFromTeam = useCallback(() => {
    if (!channelId && channels[0]) {
      // Selecting the fallback channel fires the change effect; keep the
      // team panel open behind the sheet.
      pendingPanel.current = { kind: "team" };
      selectChannel(channels[0].id);
    }
    setSheetOpen(true);
  }, [channelId, channels, selectChannel]);

  const toggleRail = useCallback(() => {
    sidebarCollapse.toggleCollapsed();
  }, [sidebarCollapse]);

  const handleSidebarResizePointerDown = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startedCollapsed = sidebarCollapse.effectiveCollapsed;
    const startX = event.clientX;
    const startWidth = startedCollapsed
      ? SLACK_SIDEBAR_COLLAPSED_WIDTH
      : sidebarCollapse.expandedWidth;
    sidebarDragTargetRef.current = startWidth;
    sidebarCollapse.beginResize(startWidth, startedCollapsed);
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
    };
    const onMove = (ev: PointerEvent) => {
      const raw = startWidth + (ev.clientX - startX);
      sidebarDragTargetRef.current = raw;
      sidebarCollapse.updateResize(raw);
    };
    const onUp = () => {
      sidebarCollapse.commitDrag(sidebarDragTargetRef.current ?? startWidth, startedCollapsed);
      cleanup();
    };
    const onCancel = () => {
      sidebarCollapse.clearDrag();
      cleanup();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
  }, [sidebarCollapse]);

  const handlePanelResizePointerDown = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = panelWidth;
    panelDragTargetRef.current = startWidth;
    setPanelDragWidth(startWidth);
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
    };
    const clamp = clampChatPanelWidth;
    const onMove = (ev: PointerEvent) => {
      const raw = clamp(startWidth - (ev.clientX - startX));
      panelDragTargetRef.current = raw;
      setPanelDragWidth(raw);
    };
    const onUp = () => {
      const next = clamp(panelDragTargetRef.current ?? startWidth);
      setPanelWidth(next);
      writePanelWidth(next);
      setPanelDragWidth(null);
      cleanup();
    };
    const onCancel = () => {
      setPanelDragWidth(null);
      cleanup();
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", onCancel);
  }, [panelWidth]);

  const signOut = useCallback(() => {
    void (async () => {
      try {
        await chatApi.signOut();
        const target = new URL(window.location.href);
        target.searchParams.set("signedOut", "1");
        window.location.assign(target.pathname + target.search);
      } catch (error) {
        setFeedError(error instanceof Error ? error.message : "Could not sign out. Try again.");
      }
    })();
  }, [chatApi]);

  const createChannel = useCallback(
    async (input: { title: string; topic: string }) => {
      const created = await chatApi.createChannel({
        title: input.title,
        ...(input.topic ? { topic: input.topic } : {}),
        // Created into the space the operator is looking at, never into a
        // default the sidebar is not showing.
        space,
      });
      await loadBootstrap(false);
      selectChannel(created.conversation.id);
    },
    [chatApi, loadBootstrap, selectChannel, space],
  );

  /**
   * Create a space and land in it.
   *
   * Its first channel is created with it — a space with no room in it is a
   * dead end — and the surface moves there in one step rather than leaving the
   * operator on an empty switcher entry to work out themselves.
   */
  const createSpace = useCallback(
    async (input: { title: string; channel: string }) => {
      const created = await chatApi.createSpace({
        title: input.title,
        ...(input.channel ? { channel: input.channel } : {}),
      });
      setSpace(created.space.slug);
      setBootstrap(null);
      setFeed(null);
      setMembers([]);
      setInvites([]);
      setChannelId(created.channel?.id ?? null);
      setPanel({ kind: "none" });
      setCompactView(created.channel ? "channel" : "list");
      address.write(
        { channelId: created.channel?.id ?? null, space: created.space.slug, messageId: null },
        false,
      );
    },
    [address, chatApi],
  );

  // Inside the Mac app the app's sidebar lists the spaces (native-spaces.ts):
  // tell it what the server answered, and take its select and create.
  const appListsSpaces = nativeSpacesHost();
  const canCreateSpace = viewer?.isOperator === true && capabilities.spaceCreate;
  const spacesReport = phase === "ready"
    ? JSON.stringify(chatSpacesMessage({ spaces: stripSpaces, current: space, signedIn: Boolean(viewer), canCreate: canCreateSpace }))
    : phase === "gate"
      ? JSON.stringify(chatSpacesMessage({ spaces: [], current: null, signedIn: false, canCreate: false }))
      : null;
  useEffect(() => {
    if (!appListsSpaces || !spacesReport) return;
    postToApp(JSON.parse(spacesReport) as ChatSpacesMessage);
  }, [appListsSpaces, spacesReport]);
  const nativeCommand = useRef<(command: NativeSpaceCommand) => void>(() => {});
  nativeCommand.current = (command) => {
    if (command.type === "select") {
      selectSpace(command.slug);
      return;
    }
    void createSpace({ title: command.title, channel: command.channel })
      .then(() => postToApp({ kind: "chat-space-created", requestId: command.requestId, ok: true, slug: null, error: null }))
      .catch((cause: unknown) => postToApp({
        kind: "chat-space-created",
        requestId: command.requestId,
        ok: false,
        slug: null,
        // The server's refusal, verbatim, as the page's own menu shows it.
        error: cause instanceof Error ? cause.message : "That space could not be created.",
      }));
  };
  useEffect(() => {
    if (!appListsSpaces) return;
    const pending = takePendingNativeSpaceCommand();
    if (pending) nativeCommand.current(pending);
    const onCommand = (event: Event) => {
      // Handled here, so the copy the app left for a late listener goes too.
      takePendingNativeSpaceCommand();
      const command = parseNativeSpaceCommand((event as CustomEvent).detail);
      if (command) nativeCommand.current(command);
    };
    window.addEventListener(NATIVE_SPACE_EVENT, onCommand);
    return () => window.removeEventListener(NATIVE_SPACE_EVENT, onCommand);
  }, [appListsSpaces]);

  /**
   * Delete a space.
   *
   * Irreversible, and the server owns the refusal — a space that is not yours
   * fails there, not here. Afterwards the surface drops everything it was
   * holding for that space and re-bootstraps onto whatever is left, rather than
   * rendering a room the server has just destroyed.
   */
  const deleteSpace = useMemo(
    () =>
      capabilities.spaceDelete && chatApi.deleteSpace
        ? async (slug: string) => {
            await chatApi.deleteSpace!(slug);
            setBootstrap(null);
            setFeed(null);
            setMembers([]);
            setInvites([]);
            setChannelId(null);
            setPanel({ kind: "none" });
            setCompactView("list");
            setSpace(DEFAULT_CHAT_SPACE);
            address.write({ channelId: null, space: DEFAULT_CHAT_SPACE, messageId: null }, false);
            await loadBootstrap(true);
          }
        : null,
    [address, capabilities.spaceDelete, chatApi, loadBootstrap],
  );

  // The Team panel reads across every channel in the space — an aggregation
  // of the same per-channel reads, only while the panel is open.
  const teamOpen = visiblePanel.kind === "team";
  const {
    team: spaceTeam,
    loading: spaceTeamLoading,
    reload: reloadSpaceTeam,
  } = useSpaceTeam({
    api: chatApi,
    capabilities,
    channels,
    space,
    enabled: phase === "ready" && teamOpen,
    viewerActorId: viewer?.actorId ?? "",
  });

  const revokeInvite = useCallback(
    async (inviteId: string, targetChannelId?: string) => {
      const target = targetChannelId ?? channelId;
      if (!target || !viewer) return;
      setRevokingInviteId(inviteId);
      setInviteError(null);
      const isCurrent = selection.begin();
      try {
        const result = await chatApi.revokeInvite(target, inviteId, viewer.actorId, space);
        if (!isCurrent()) return;
        if (target === channelId) setInvites(current => current.map(invite => invite.id === inviteId ? result.invite : invite));
        await reloadSpaceTeam();
        if (target === channelId) await loadInvites();
      } catch (error) {
        if (!isCurrent()) return;
        setInviteError(error instanceof ChatApiError && (error.status === 0 || error.status >= 500)
          ? "Could not confirm the revocation. Check your connection and try again."
          : error instanceof Error ? error.message : "That invitation could not be revoked.");
      } finally {
        setRevokingInviteId(null);
      }
    },
    [channelId, chatApi, loadInvites, reloadSpaceTeam, selection, space, viewer],
  );

  const mentionMember = useCallback(
    (actorId: string) => {
      const member = membersById.get(actorId);
      if (!member || !channelId) return;
      const selected = channelDraft.store.read().mentions ?? [];
      if (selected.length >= 20 && !selected.some(mention => mention.actorId === actorId)) {
        setSendError("A message can mention up to 20 people. Remove a recipient before adding another.");
        closePanel();
        return;
      }
      const label = memberDisplayName(member);
      channelDraft.store.update((current) => {
        const existing = current.body;
        const separator = existing.length === 0 || existing.endsWith(" ") ? "" : " ";
        return { ...current, body: `${existing}${separator}@${label} `, mentions: [...(current.mentions ?? []).filter(mention => mention.actorId !== actorId), { actorId, label }] };
      });
      // Work routing is chosen explicitly in the Ask picker.
      closePanel();
    },
    [channelId, channelDraft.store, closePanel, membersById],
  );

  /* ── keyboard (§11) ────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && !event.metaKey && !event.ctrlKey && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        if (event.isComposing || paletteOpen || sheetOpen || preferencesOpen
          || (document.activeElement instanceof HTMLElement && document.activeElement.closest("[role='menu']"))) return;
        event.preventDefault();
        const next = conversationStep(
          conversationNavigation.current,
          channelId,
          event.key === "ArrowDown" ? 1 : -1,
          event.shiftKey,
        );
        if (next) {
          selectChannel(next);
          setComposerRequest({ kind: "focus", at: Date.now() });
        }
        return;
      }
      // Inside the shell, ⌘K is the shell's command palette and ⌘B its
      // sidebar; the rail's filter (or the jump bar) stands in for this one.
      // A frame that leaves the top row to this surface leaves ⌘K to it too.
      const shellKeys = ownsTopRow ? ["b"] : ["k", "b"];
      if (inShell && (event.metaKey || event.ctrlKey) && shellKeys.includes(event.key.toLowerCase())) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      // ⌘, is Preferences in every Mac app; only a surface that has them claims it.
      if (hasPreferences && (event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setPreferencesOpen((open) => !open);
        return;
      }
      // ⌘B is the sidebar chord everywhere else in Scout. Leave it to the
      // browser while text is being edited, where it means bold.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        const active = document.activeElement;
        const typing = active instanceof HTMLElement
          && (active.tagName === "TEXTAREA"
            || active.tagName === "INPUT"
            || active.isContentEditable);
        if (typing) return;
        event.preventDefault();
        toggleRail();
        return;
      }
      if (event.key === "Escape") {
        if (paletteOpen || sheetOpen) return;
        if (preferencesOpen) {
          event.preventDefault();
          setPreferencesOpen(false);
          return;
        }
        if (panel.kind !== "none") {
          event.preventDefault();
          closePanel();
          return;
        }
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.tagName === "TEXTAREA") active.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [channelId, closePanel, hasPreferences, inShell, ownsTopRow, panel.kind, paletteOpen, preferencesOpen, selectChannel, sheetOpen, toggleRail]);

  /* ── gates ─────────────────────────────────────────────────────────────── */

  if (phase === "loading") {
    return (
      <ChatSpaceTheme theme={theme} className="chat-centered" source={source}>
        <ChatContextMenu>
          <p className="chat-card-meta">{source === "slack" ? "Loading Slack…" : "Loading Scout Chat…"}</p>
        </ChatContextMenu>
      </ChatSpaceTheme>
    );
  }

  // The deployment's own entrance, when it has one. Only the gate takes this
  // path: an error is a failure to report, not a door to open.
  if (phase === "gate" && signedOut) {
    return signedOut({
      signInHref: `${capabilities.signIn.startPath}?${capabilities.signIn.returnToParam}=${
        encodeURIComponent(window.location.pathname + window.location.search)
      }`,
      signInLabel: capabilities.signIn.label,
      note: capabilities.signIn.note ?? null,
      message: gateMessage,
    });
  }

  if (phase === "gate" || phase === "error") {
    const isGate = phase === "gate";
    return (
      <ChatSpaceTheme theme={theme} className="chat-centered" source={source}>
        <ChatContextMenu>
          <section className="chat-notice" aria-labelledby="chat-notice-title">
            <span className="chat-notice-mark" aria-hidden="true">
              <ScoutMark />
            </span>
            <h1 id="chat-notice-title">{isGate ? "You are not signed in" : source === "slack" ? "Slack is unavailable" : "Scout Chat is unavailable"}</h1>
            {isGate ? (
              <p className="chat-notice-body">{capabilities.signIn.prompt}</p>
            ) : (
              <p className="chat-notice-status">
                <span className="dot dot--sm dot--warning" aria-hidden="true" />
                {gateMessage ?? (source === "slack" ? "Slack did not answer." : "The chat service did not answer.")}
              </p>
            )}
            {isGate ? (
              <>
                {/* The door belongs to the deployment: local Scout's own login,
                    hosted Chat's GitHub OAuth. Both come off the transport so the
                    sentence beside the button is true of the door it opens. */}
                <a
                  className="btn btn--accent"
                  href={`${capabilities.signIn.startPath}?${capabilities.signIn.returnToParam}=${
                    encodeURIComponent(window.location.pathname + window.location.search)
                  }`}
                >
                  {capabilities.signIn.label}
                </a>
                {capabilities.signIn.note ? (
                  <p className="chat-notice-note">{capabilities.signIn.note}</p>
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={retrying}
                onClick={() => {
                  setRetrying(true);
                  void loadBootstrap(true).finally(() => setRetrying(false));
                }}
              >
                {retrying ? "Trying…" : "Try again"}
              </button>
            )}
            {isGate && gateMessage ? <p className="chat-notice-note">{gateMessage}</p> : null}
          </section>
        </ChatContextMenu>
      </ChatSpaceTheme>
    );
  }

  const viewerName = viewer?.displayName ?? "you";
  // A roster that has not come back yet is not a roster of nobody. The viewer
  // is always in their own channel, so an empty list can only mean the first
  // read is still out — say so rather than asserting "0 people · 0 agents" and
  // then correcting it a beat later.
  const countLabel = members.length > 0 ? peopleAgentLabel(members) : "reading…";
  // A Slack workspace names itself in the header link, the origin line, and the
  // composer's destination line, so the operator always knows where a post goes.
  const slackWorkspace = source === "slack" && bootstrap?.source?.kind === "slack" ? bootstrap.source : null;
  const slackChannelUrl = slackWorkspace?.url && channelId
    ? `${slackWorkspace.url.endsWith("/") ? slackWorkspace.url : `${slackWorkspace.url}/`}archives/${encodeURIComponent(channelId)}`
    : null;
  // Under 900 the sidebar IS the screen; there is no column left to collapse.
  const railed = sidebarCollapse.effectiveCollapsed && !isCompact && !shellRail;
  const sidebarWidth = railed ? SLACK_SIDEBAR_COLLAPSED_WIDTH : sidebarCollapse.width;
  const livePanelWidth = panelDragWidth ?? panelWidth;
  const chromeStyle = {
    "--sidebar-w": `${sidebarWidth}px`,
    "--panel-w": `${livePanelWidth}px`,
    // The open space's ink (space-identity.ts): its mark, and the strip on the
    // selected room, so two spaces never look like the same place.
    "--space-ink-light": spaceIdentity(space).hue.light,
    "--space-ink-dark": spaceIdentity(space).hue.dark,
  } as CSSProperties;
  const panelOpen = visiblePanel.kind !== "none";
  const threadRoot = threadRootId
    ? [...(feed?.messages ?? []), ...(messageContext.context?.messages ?? [])].filter(message => message.id === threadRootId)
      .reduce<ChatMessage | null>((latest, message) => newestChatMessage(latest ?? undefined, message), null)
    : null;
  const threadReplyList = threadRootId ? [...new Map([
    ...(messageContext.context?.messages.filter(message => message.replyToMessageId === threadRootId) ?? []),
    ...mergeChatMessageRevisions(messageContext.context?.messages ?? [], projection.repliesByRoot.get(threadRootId) ?? []),
  ].map(message => [message.id, message])).values()].sort(compareMessagesAsc) : [];
  const threadRequest = threadRootId
    ? projection.requestsByMessage.get(threadRootId) ?? null
    : null;

  const attentionProps: ComponentProps<typeof ChatAttention> = {
    channels,
    channelId: channelId!,
    states: readState.states,
    messages: feed?.messages ?? [],
    actorNames: Object.fromEntries(members.map(member => [member.actorId, memberDisplayName(member)])),
    questionCounts: bootstrap?.questionCounts,
    busy: readState.attentionBusy,
    error: readState.attentionError,
    onUnpin: chatApi.updatePins ? (messageId) => void readState.updatePins(channelId!, messageId, false) : undefined,
    onUnsave: (id, messageId) => void readState.updateAttention(id, { messageId, saved: false }),
    onOpenSaved: (id, messageId) => {
      const rootMessageId = id === channelId ? feed?.messages.find(message => message.id === messageId)?.replyToMessageId ?? messageId : messageId;
      if (id !== channelId) pendingPanel.current = { kind: "thread", rootMessageId };
      selectChannel(id);
      setPanel({ kind: "thread", rootMessageId });
      setFocusMessageId(messageId);
      setCompactView("panel");
      address.write({ channelId: id, space, messageId }, false);
    },
    onMode: notificationMode => void readState.updateAttention(channelId!, { notificationMode }),
    onUnfollow: (id, threadId) => void readState.updateAttention(id, { threadId, following: false }),
    onOpen: (id, rootMessageId) => {
      if (rootMessageId && id !== channelId) pendingPanel.current = { kind: "thread", rootMessageId };
      selectChannel(id);
      if (rootMessageId) openPanel({ kind: "thread", rootMessageId });
    },
  };

  const sidebar = (
    <ChannelSidebar
      structured={activityInPanel}
      channels={channels}
      directs={source !== "slack" && directRows?.length ? [...directs, ...directRows] : directs}
      spaces={stripSpaces}
      activeSpace={space}
      selectedId={directActive ? activeDirectId : channelId}
      addressedChannelIds={addressedChannelIds}
      readStates={readState.states}
      questionCounts={bootstrap?.questionCounts}
      forYou={forYou}
      onOpenForYou={item => {
        if (item.channelId === channelId) { openPanel({ kind: "questions" }); return; }
        pendingPanel.current = { kind: "questions" };
        selectChannel(item.channelId);
      }}
      seen={sidebarSeen}
      lastMessages={bootstrap?.lastMessages}
      viewerActorId={viewer?.actorId ?? null}
      nowMs={nowMs}
      canCreate={viewer?.isOperator === true}
      viewerName={viewerName}
      viewerIsHost={viewer?.isOperator === true}
      railed={railed}
      themePreference={themePreference}
      onSelect={(id) => (directRowIds.has(id) ? selectDirect(id) : selectChannel(id))}
      onSelectSpace={selectSpace}
      onCreate={createChannel}
      {...(capabilities.vercelBoardChannels === true && bootstrap?.vercelBoard ? {
        onOpenBoard: () => setBoardSheetOpen(true),
        boardLabel: bootstrap.vercelBoard.connected ? `Connected to ${bootstrap.vercelBoard.connected.teamName}` : "Connect a Vercel team's board",
      } : {})}
      onCreateSpace={createSpace}
      onDeleteSpace={deleteSpace}
      spaceAccessHref={bootstrap?.spaceAccessHref}
      onInvite={() => setSheetOpen(true)}
      onOpenTeam={toggleTeam}
      teamOpen={teamOpen}
      onExpandRail={toggleRail}
      onOpenProfile={channel && viewer
        ? () => openPanel({ kind: "member", actorId: viewer.actorId })
        : null}
      onThemePreference={setThemePreference}
      onSignOut={signOut}
      appearanceControls={appearanceControls}
      onOpenPreferences={hasPreferences ? () => setPreferencesOpen(true) : undefined}
      shellRail={shellRail}
      onNavigationModelChange={updateConversationNavigation}
      onMarkRead={source === "slack" ? (id) => {
        const latest = readState.states[id]?.lanes.find((lane) => lane.rootMessageId === null)?.latestMessageId;
        if (latest) void readState.markRead(id, latest);
      } : undefined}
    />
  );
  const roomSidebar = roomsCatalog ? (
    <RoomsAggregateSidebar
      places={roomsCatalog}
      loading={catalogLoading}
      errors={catalogErrors}
      onRetry={onRetryCatalog ?? (() => undefined)}
      activeSource={source ?? "scout"}
      activeSpace={space}
      activeChannelId={directActive ? null : channelId}
      readStates={readState.states}
      directs={catalogDirects ?? []}
      list={roomsList}
      activeDirectId={directActive ? activeDirectId : null}
      onSelectDirect={(id) => (source === "scout" ? selectDirect(id) : onSelectDirect?.(id))}
      boardRooms={vercelBoardRooms}
      onSelect={(nextSource, nextSpace, nextChannelId) => {
        if (nextSource === source && nextSpace === space && !directActive) selectChannel(nextChannelId);
        else onSelectCatalogRoom?.(nextSource, nextSpace, nextChannelId);
      }}
    />
  ) : sidebar;

  return (
    <ChatCorrectionScope.Provider value={draftScope}>
    <ChatExecutionAccess.Provider value={viewer?.isOperator && channelId && chatApi.execution && chatApi.interruptExecution ? {
      scope: JSON.stringify([viewer.actorId, space, channelId]),
      load: flightId => chatApi.execution!(channelId, flightId, space),
      interrupt: (flightId, input) => chatApi.interruptExecution!(channelId, flightId, input, space),
    } : null}>
    <ChatApprovalAccess.Provider value={viewer?.isOperator && channelId && chatApi.approvals && chatApi.decideApproval ? {
      scope: JSON.stringify([viewer.actorId, space, channelId]),
      load: flightId => chatApi.approvals!(channelId, flightId, space),
      decide: (flightId, decision) => chatApi.decideApproval!(channelId, flightId, decision, space),
    } : null}>
    <ChatRequestApprovalAccess.Provider value={viewer?.isOperator && channelId && chatApi.decideRequestApproval ? {
      scope: JSON.stringify([viewer.actorId, space, channelId]),
      decide: async (flightId, decision) => {
        const result = await chatApi.decideRequestApproval!(channelId, flightId, decision, space);
        await loadFeed();
        return result;
      },
    } : null}>
    <ChatQuestionResponder.Provider value={chatApi.respondQuestion ? onQuestionResponse : null}>
    <ChatSpaceTheme
      theme={theme}
      className={inShell ? `chat-space chat-space--in-shell${shellRail ? " chat-space--shell-rail" : ""}${showTopbar ? "" : " chat-space--no-topbar"}` : "chat-space"}
      compactView={shellRail ? "channel" : compactView}
      railed={railed}
      source={source}
      style={chromeStyle}
    >
      <ChatAvatarModeContext.Provider value="harness">
      <ChatContextMenu>
      {topRowSearch
        ? createPortal(
          <button
            type="button"
            className="scout-top-row-search chat-top-row-jump"
            aria-keyshortcuts="Meta+K"
            onClick={() => setPaletteOpen(true)}
          >
            <SearchGlyph size={14} aria-hidden="true" />
            <span className="chat-top-row-jump-label">Jump to a room or person</span>
            <kbd className="chat-top-row-jump-kbd">⌘K</kbd>
          </button>,
          topRowSearch,
        )
        : null}
      {topRowIdentity
        ? createPortal(
          <div className="chat-top-row-host" data-scout-theme={theme}>
            {hasPreferences && preferences
              ? preferences({
                open: preferencesOpen,
                setOpen: setPreferencesOpen,
                themePreference,
                setThemePreference,
              })
              : null}
            <SidebarIdentity
              placement="top-row"
              viewerName={viewerName}
              viewerIsHost={viewer?.isOperator === true}
              railed={false}
              themePreference={themePreference}
              appearanceControls={appearanceControls}
              onOpenProfile={channel && viewer
                ? () => openPanel({ kind: "member", actorId: viewer.actorId })
                : null}
              onOpenPreferences={hasPreferences ? () => setPreferencesOpen(true) : undefined}
              onThemePreference={setThemePreference}
              onSignOut={signOut}
            />
          </div>,
          topRowIdentity,
        )
        : null}
      {showTopbar ? (
      <header className="chat-topbar">
        {/* The sidebar's header band. One chevron, the same cell in both states:
            tucked against the column's inner edge when it is open, centred when
            it is a rail — so collapse happens in place and nothing jumps. */}
        <div className="chat-topbar-band">
          {/* The brand, not the space: the space lives in the sidebar's
              switcher when there is a choice to make (ChannelSidebar). */}
          {/* Inside the shell its top row already names the page; the empty
              cell keeps the chevron against the column's inner edge. */}
          {inShell ? <div className="chat-space-name" aria-hidden="true" /> : (
            <div className="chat-space-name chat-brand">
              {/* Inside the Scout app the window's own rail already carries the
                  mark, so the lockup drops it rather than showing it twice. */}
              {companionHostAvailable() ? null : <ScoutMark className="chat-brand-mark" />}
              <b>Chat</b>
            </div>
          )}
          {isCompact ? null : (
            <RailToggle
              side="left"
              collapsed={railed}
              label="Sidebar"
              onToggle={toggleRail}
              className="chat-band-toggle"
            />
          )}
        </div>
        <button type="button" className="chat-jump" onClick={() => setPaletteOpen(true)}>
          <span className="chat-jump-glyph" aria-hidden="true">⌕</span>
          <span className="chat-jump-label">Jump to a channel or person</span>
          {inShell ? null : <span className="chat-kbd">⌘K</span>}
        </button>
        {hasPreferences && preferences ? (
          <div className="chat-topbar-end">
            {preferences({
              open: preferencesOpen,
              setOpen: setPreferencesOpen,
              themePreference,
              setThemePreference,
            })}
          </div>
        ) : null}
      </header>
      ) : null}

      <div
        className="chat-body"
        data-panel={panelOpen && !isMidWidth ? "open" : "closed"}
      >
        {/* Hosted Chat portals the list into its frame. Rooms keeps the list
            here, after the shell's channel-family rail. */}
        {railSlot
          ? createPortal(<div className="chat-rail-host" data-scout-theme={theme} data-chat-source={source}>{roomSidebar}</div>, railSlot)
          : roomSidebar}

        {directActive ? (
          // A Scout DM, drawn by the conversation's own screen and composer:
          // the agent is asked as it is from anywhere else in Scout.
          <main className="chat-channel chat-channel--direct" aria-label={directTitle ? `Direct message with ${directTitle}` : "Direct message"}>
            <header className="chat-chan-head chat-direct-head">
              <button
                type="button"
                className="chat-compact-back"
                onClick={() => setCompactView("list")}
                aria-label="Back to conversations"
              >
                ‹
              </button>
              <div className="chat-chan-title">
                <span className="chat-chan-name">{directTitle ?? "Direct message"}</span>
              </div>
            </header>
            {directPane}
          </main>
        ) : channel ? (
          <main className="chat-channel" aria-label={channelLabel(channel.title)}>
            <header className="chat-chan-head">
              <button
                type="button"
                className="chat-compact-back"
                onClick={() => setCompactView("list")}
                aria-label="Back to channels"
              >
                ‹
              </button>
              {/* The header reads left to right as three things: which room,
                  who is in it, and what you can do here. Name and topic are
                  one group; the topic is the only elastic part, so a narrow
                  window eats it before anything else. */}
              <div className="chat-chan-title">
                {/* The room says what it is: # and its name, then its topic
                    after a hairline. The top bar already names the page. */}
                <span className="chat-chan-name">
                  {vercelBoardRoom ? (
                    // a Board room: Vercel's mark, the board, then its channel
                    <>
                      <span className="chat-hash" data-board aria-hidden><VercelMark size={13} /></span>
                      {vercelBoardRoom.board?.name ? (
                        <>
                          <span className="chat-chan-board" title={vercelBoardRoom.board.url}>{vercelBoardRoom.board.name}</span>
                          <span className="chat-chan-board-sep" aria-hidden>›</span>
                        </>
                      ) : null}
                    </>
                  ) : <span className="chat-hash">#</span>}
                  {channel.title.replace(/^#/u, "")}
                </span>
                {untitledRoomIds.has(channel.id) ? (
                  <span className="chat-chan-id" title={channel.id}>{shortRoomId(channel.id)}</span>
                ) : null}
                {channel.topic && channel.topic.trim() !== channel.title ? <span className="chat-topic">{channel.topic}</span> : null}
              </div>
              {source === "slack" ? null : <Facepile
                members={members}
                countLabel={countLabel}
                hereActorIds={hereActorIds}
                onOpen={() => openPanel({ kind: "members" })}
                triggerHost={channelToolTriggersHost}
              />}
              <span className="chat-chan-divider" aria-hidden hidden={Boolean(channelToolTriggersHost)} />
              <div className="chat-chan-tools" role={channelToolTriggersHost ? undefined : "toolbar"} aria-label={channelToolTriggersHost ? undefined : "Channel tools"}>
                {chatApi.searchMessages ? <ChatSearch key={JSON.stringify([viewer?.actorId, space, channelId])}
                  open={visiblePanel.kind === "search"}
                  onOpenChange={open => {
                    if (open) openPanel({ kind: "search" });
                    else if (panel.kind === "search") closePanel();
                  }}
                  contentHost={visiblePanel.kind === "search" ? channelToolContentHost : null}
                  triggerHost={channelToolTriggersHost}
                  api={chatApi} channelId={channelId!} space={space}
                  onOpen={message => {
                    openPanel({ kind: "thread", rootMessageId: message.replyToMessageId ?? message.id });
                    setFocusMessageId(message.id);
                    address.write({ channelId, space, messageId: message.id }, false);
                  }} /> : null}

                {chatApi.questions ? <ChatQuestions key={JSON.stringify(["questions", viewer?.actorId, space, channelId])}
                  open={visiblePanel.kind === "questions"}
                  onOpenChange={open => {
                    if (open) openPanel({ kind: "questions" });
                    else if (panel.kind === "questions") closePanel();
                  }}
                  contentHost={visiblePanel.kind === "questions" ? channelToolContentHost : null}
                  triggerHost={channelToolTriggersHost}
                  api={chatApi} channelId={channelId!} space={space}
                  onChanged={() => { void loadFeed("full"); void loadBootstrap(false); }} /> : null}

                {capabilities.readState && chatApi.updateAttention ? <ChatAttention
                  {...attentionProps}
                  showContent={false}
                  open={visiblePanel.kind === "activity"}
                  onOpenChange={open => {
                    if (open) openPanel({ kind: "activity" });
                    else if (panel.kind === "activity") closePanel();
                  }}
                  triggerHost={channelToolTriggersHost}
                /> : null}
              </div>
              {slackChannelUrl && channel ? (
                <a
                  className="chat-chan-open"
                  href={slackChannelUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${channelLabel(channel.title)} in Slack`}
                >
                  <span>Open in Slack</span>
                  <ExternalGlyph size={14} />
                </a>
              ) : null}
            </header>
            {/* Slack's second header line: the tab you are reading. Messages is
                the only view a Slack channel has here, so it is a label, not a
                control. */}
            {source === "slack" ? (
              <div className="chat-chan-tabs">
                <span className="chat-chan-tab" aria-current="page">
                  <ThreadGlyph size={14} />
                  Messages
                </span>
              </div>
            ) : null}
            {isVercelBoardRoom && vercelBoardRoom ? (
              <div className="chat-chan-tabs vbt-tabs" role="tablist" aria-label={`Views of ${vercelBoardRoom.channel}`}>
                <button type="button" role="tab" className="chat-chan-tab" aria-selected={vercelBoardTab === "conversation"} aria-current={vercelBoardTab === "conversation" ? "page" : undefined} onClick={() => pickVercelBoardView("conversation")}>
                  <ThreadGlyph size={14} />
                  Conversation
                </button>
                <button type="button" role="tab" className="chat-chan-tab" aria-selected={vercelBoardTasksOpen} aria-current={vercelBoardTasksOpen ? "page" : undefined} onClick={() => pickVercelBoardView("tasks")}>
                  Tasks
                </button>
              </div>
            ) : null}

            {vercelBoardPending ? <div className="vbt" data-loading><p className="vbt-notice">Loading the board…</p></div>
              : vercelBoardTasksOpen && channelId ? <VercelBoardTasks room={boardRoom} reviewEnabled={source === "scout" && !serverBoardRooms && boardRoom.data?.conversationId === channelId} /> : <>
            <ChatOpenWork
              key={channelId}
              items={openWorkItems}
              ownerName={item => {
                const member = membersById.get(item.targetActorId);
                return member ? memberDisplayName(member) : item.targetName ?? item.targetActorId;
              }}
              onOpen={item => {
                if (!item.rootMessageId) return;
                openPanel({ kind: "thread", rootMessageId: item.rootMessageId });
                if (item.messageId) setFocusMessageId(item.messageId);
              }}
            />

            <div className="chat-feed" ref={feedScrollRef} onScroll={reading.onScroll} role="log" aria-label="Channel messages">
              {/* The scroller and the column it scrolls are separate elements
                  on purpose: only a box of its own can be measured, and the
                  tail-pin below needs to know when this column grows. */}
              <div className="chat-feed-inner" ref={feedContentRef}>
              {stale ? (
                <p className="chat-feed-notice">
                  Reconnecting — this is the last reading that came back.
                </p>
              ) : null}
              {feedError ? (
                <p className="chat-feed-notice" data-tone="error">{feedError}</p>
              ) : null}
              {readState.attentionError ? <p className="chat-feed-notice" role="alert">{readState.attentionError}</p> : null}
              {readState.error ? <p className="chat-feed-notice" role="status">{readState.error}</p> : null}
              {readPositionIsLocal ? <p className="chat-feed-notice" role="status">Read markers are saved here only. Slack needs additional write access to sync them.</p> : null}
              {!feed && !feedError ? <p className="chat-feed-notice">Loading messages…</p> : null}
              {isVercelBoardRoom ? <VercelBoardConversation room={boardRoom} /> : null}
              {isVercelBoardRoom && projection.entries.length > 0 ? (
                <div className="vbc-scout-rule" role="separator"><span>In Scout only</span></div>
              ) : null}
              {feed && projection.entries.length === 0 && !isVercelBoardRoom ? (
                <section className="chat-intro" aria-label={`About ${channelLabel(channel.title)}`}>
                  <span className="chat-intro-mark" aria-hidden>#</span>
                  <h2 className="chat-intro-name">{channel.title.replace(/^#/u, "")}</h2>
                  {channel.topic ? <p className="chat-intro-topic">{channel.topic}</p> : null}
                  <p className="chat-intro-note">
                    Nothing has been posted here yet. Say something, or bring in the people and agents who belong in this room.
                  </p>
                  {!capabilities.invitesRequireOwner || viewer?.isOperator === true ? (
                    <div className="chat-intro-actions">
                      <button type="button" className="btn btn--sm" onClick={() => setSheetOpen(true)}>
                        <UserPlus size={15} strokeWidth={1.9} aria-hidden /> Invite people or agents
                      </button>
                    </div>
                  ) : null}
                  <div className="chat-intro-starters">
                    <p className="chat-intro-starters-label">Or start with</p>
                    <button
                      type="button"
                      className="chat-intro-starter"
                      onClick={() => {
                        if (!draft.trim()) setDraft("This channel is for ");
                        setComposerRequest({ kind: "focus", at: Date.now() });
                      }}
                    >
                      <MessageSquare size={15} strokeWidth={1.8} aria-hidden /> Post what this channel is for
                    </button>
                    {channelHasAskable ? (
                      <button
                        type="button"
                        className="chat-intro-starter"
                        onClick={() => setComposerRequest({ kind: "ask", at: Date.now() })}
                      >
                        <Bot size={15} strokeWidth={1.8} aria-hidden /> Ask an agent in this channel
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {feed?.reachesStart && projection.entries.length > 0 && !isVercelBoardRoom ? (
                <div className="chat-origin">
                  {slackWorkspace ? (
                    <p>
                      This is the start of <strong>{channelLabel(channel.title)}</strong> in <strong>{slackWorkspace.name}</strong>.
                    </p>
                  ) : (
                    <p>
                      Start of <strong>{channelLabel(channel.title)}</strong>
                    </p>
                  )}
                </div>
              ) : null}

              {projection.entries.map((entry) => {
                if (entry.kind === "day") {
                  return (
                    <div className="chat-day" key={entry.id}>
                      {source === "slack" ? <span className="chat-day-rule" aria-hidden="true" /> : null}
                      <span className="label-sm">{entry.label}</span>
                    </div>
                  );
                }
                if (entry.kind === "status") {
                  return (
                    <div className="chat-status-line" key={entry.id}>
                      {entry.message.body}
                    </div>
                  );
                }
                if (entry.kind === "status-fold") {
                  return <StatusFold key={entry.id} label={entry.label} messages={entry.messages} />;
                }
                return (
                  <Fragment key={entry.id}>
                  {unreadArrival.current?.messageId === entry.message.id ? (
                    <div className="chat-unread-divider" role="separator" aria-label="New messages">New messages</div>
                  ) : null}
                  <Turn
                    key={entry.id}
                    message={entry.message}
                    members={membersById}
                    nowMs={nowMs}
                    request={entry.request}
                    replyCount={entry.replyCount}
                    lastReplyAt={entry.lastReplyAt}
                    onOpenThread={() => beginReply(entry.message.id)}
                    onReply={() => beginReply(entry.message.id)}
                    onOpenMember={(actorId) => openPanel({ kind: "member", actorId })}
                    onReact={onReact}
                    onCopyLink={onCopyLink}
                    pinned={selectedReadState?.pins?.some(pin => pin.messageId === entry.message.id)}
                    viewerActorId={viewer?.actorId}
                    viewerIsOperator={viewer?.isOperator}
                    onCorrect={chatApi.correctMessage ? onCorrect : undefined}
                    onPin={chatApi.updatePins && selectedReadState ? (messageId, pinned) => void readState.updatePins(channelId!, messageId, pinned) : undefined}
                    saved={selectedReadState?.preferences?.savedMessageIds?.includes(entry.message.id)}
                    saveBusy={readState.attentionBusy}
                    onSave={chatApi.updateAttention && selectedReadState ? (messageId, saved) => void readState.updateAttention(channelId!, { messageId, saved }) : undefined}
                    onStopAsk={onStopAsk}
                    focused={focusMessageId === entry.message.id}
                    threadOpen={threadRootId === entry.message.id}
                    continues={entry.continues}
                    avatarSize={shellRail ? 36 : undefined}
                  />
                  </Fragment>
                );
              })}
              </div>
            </div>

            {reading.away ? (
              <div className="chat-reading-nav">
                <button type="button" className="btn btn--sm" onClick={reading.jumpToLatest}>
                  {reading.newCount > 0
                    ? `${reading.newCount} new ${reading.newCount === 1 ? "message" : "messages"} · Jump to latest ↓`
                    : "Jump to latest ↓"}
                </button>
              </div>
            ) : null}
            {(() => { const boardComposer = serverBoardRooms && isVercelBoardRoom && vercelBoardRoom; const composer = <div className="chat-composer-wrap">
              {/* Typing sits on the composer's top edge, in a slot that is
                  always reserved so the field never jumps. When nobody is
                  typing it says nothing — a quiet room needs no caption. */}
              <div className="chat-typing" role="status" aria-live="polite">
                {typingText ? <><span className="chat-typing-dots" aria-hidden><i /><i /><i /></span>{typingText}</> : null}
              </div>
              <ChannelComposer
                voiceNoteTranscriber={voiceNoteTranscriber}
                attachmentScope={JSON.stringify([viewer?.actorId, space, channelId])}
                members={members}
                conversationSuggestions={source === "slack" ? [...channels, ...directs] : []}
                mentions={channelDraft.draft.mentions}
                onMentionsChange={mentions => channelDraft.store.update(current => ({ ...current, mentions }))}
                draft={draft}
                onDraftChange={setDraft}
                askTargetId={askTargetId}
                onAskTargetChange={setAskTarget}
                onSend={boardComposer ? onSendBoard : onSendChannel}
                sending={sending}
                error={sendError}
                placeholder={boardComposer ? `Message ${vercelBoardRoom.channel}` : isVercelBoardRoom ? "Message in Scout" : `Message ${channelLabel(channel.title)}`}
                onInvite={() => setSheetOpen(true)}
                onDirect={(name) => {
                  const direct = directs.find(item => item.title.toLowerCase() === name.toLowerCase());
                  if (direct) { selectChannel(direct.id); return; }
                  const member = members.find(member => (member.displayName.toLowerCase() === name.toLowerCase() || memberDisplayName(member).toLowerCase() === name.toLowerCase()));
                  if (member) openPanel({ kind: "member", actorId: member.actorId });
                  else setPaletteOpen(true);
                }}
                request={composerRequest}
                formattingDefault={shellRail && source !== "slack" ? "off" : undefined}
                destination={slackWorkspace ? (
                  <>
                    <PlaceTile kind="slack" name={slackWorkspace.name} size={14} />
                    <span>
                      Posts to <strong>{channelLabel(channel.title)}</strong> in <strong>{slackWorkspace.name}</strong>
                      {viewer ? <> as <strong>@{viewer.displayName}</strong></> : null}
                    </span>
                  </>
                ) : boardComposer ? (
                  <span>
                    Posts to <strong>{vercelBoardRoom.channel}</strong> on Vercel Board
                    {viewer ? <> as <strong>{viewer.displayName}</strong></> : null}
                  </span>
                ) : isVercelBoardRoom && vercelBoardRoom ? (
                  <span>
                    Posts in Scout only. <strong>{vercelBoardRoom.channel}</strong> on the board does not see it.
                  </span>
                ) : undefined}
              />
            </div>;
            return boardComposer
              ? <ChatTransportProvider api={chatApi} capabilities={boardComposerCapabilities} source={source} address={address}>{composer}</ChatTransportProvider>
              : composer; })()}
            </>}
          </main>
        ) : (
          <main className="chat-channel">
            <div className="chat-feed">
              <p className="chat-feed-empty">
                {viewer?.isOperator
                  ? "Create a channel to start."
                  : "You are not in a channel yet. Open the invitation you were sent."}
              </p>
            </div>
          </main>
        )}

        {(channel || teamOpen) && panelOpen && isMidWidth && !isCompact ? (
          <div className="chat-panel-scrim" data-state={closingPanel ? "closing" : "open"} role="presentation" onClick={closePanel} />
        ) : null}

        {!isCompact && !shellRail ? (
          <div
            data-scout-sidebar-resize-handle=""
            role="separator"
            aria-orientation="vertical"
            aria-label={railed ? "Expand sidebar (drag out)" : "Resize or collapse sidebar"}
            title={railed
              ? "Drag out to expand · double-click to expand"
              : "Drag to resize · drag in to collapse · double-click to reset"}
            onPointerDown={handleSidebarResizePointerDown}
            onDoubleClick={(event) => {
              event.preventDefault();
              if (railed) {
                sidebarCollapse.setExpandedWidth(CHAT_SIDEBAR_WIDTH);
                sidebarCollapse.setCollapsed(false);
              } else {
                sidebarCollapse.resetExpandedWidth();
              }
            }}
            style={{
              position: "absolute",
              left: Math.max(0, sidebarWidth - 3),
              top: 0,
              bottom: 0,
              width: 6,
              zIndex: 50,
              cursor: "ew-resize",
              touchAction: "none",
            }}
          />
        ) : null}

        {sidebarCollapse.isSidebarResizing && sidebarCollapse.dragGhostWidth != null ? (
          <div
            data-scout-sidebar-resize-ghost=""
            aria-hidden="true"
            className="scout-sidebar-resize-ghost"
            style={{
              position: "absolute",
              left: sidebarCollapse.dragGhostWidth,
              top: 0,
              bottom: 0,
              width: 2,
              transform: "translateX(-50%)",
              zIndex: 55,
              pointerEvents: "none",
            }}
          />
        ) : null}

        {viewer && teamOpen ? (
          <TeamPanel
            spaceTitle={spaces.find((entry) => entry.slug === space)?.title ?? space}
            team={spaceTeam}
            loading={spaceTeamLoading}
            inviteError={inviteError}
            nowMs={nowMs}
            viewerActorId={viewer.actorId}
            viewerIsOperator={viewer.isOperator}
            revokingInviteId={revokingInviteId}
            onOpenMember={openTeamMember}
            onRevokeInvite={(targetChannelId, inviteId) => void revokeInvite(inviteId, targetChannelId)}
            onInvite={inviteFromTeam}
            inviteDisabled={channels.length === 0}
            onClose={closePanel}
            overlay={isMidWidth}
            closing={closingPanel !== null}
            onCloseComplete={finishClosePanel}
          />
        ) : null}

        {channel && viewer ? (
          <ChatRightPanel
            voiceNoteTranscriber={voiceNoteTranscriber}
            view={visiblePanel}
            groupThreadReplies={activityInPanel}
            channel={channel}
            members={members}
            membersLoading={rosterForChannel.current !== channelId}
            conversationSuggestions={source === "slack" ? [...channels, ...directs] : []}
            membersById={membersById}
            invites={invites}
            inviteError={inviteError}
            revokingInviteId={revokingInviteId}
            viewerActorId={viewer.actorId}
            viewerIsOperator={viewer.isOperator}
            nowMs={nowMs}
            roomSource={vercelBoardRoom ? <VercelBoardRoomSource room={vercelBoardRoom} /> : undefined}
            threadRoot={threadRoot}
            threadReplies={threadReplyList}
            threadRequest={threadRequest}
            threadRequestsByMessage={projection.requestsByMessage}
            threadDraft={threadDraft}
            threadAttachmentScope={JSON.stringify([viewer?.actorId, space, channelId, threadRootId])}
            threadAskTargetId={replyDraft.draft.targetActorId}
            onThreadAskTargetChange={targetActorId => replyDraft.store.update(current => ({ ...current, targetActorId }))}
            threadMentions={replyDraft.draft.mentions}
            onThreadMentionsChange={mentions => replyDraft.store.update(current => ({ ...current, mentions }))}
            onThreadDraftChange={(value) => {
              if (!threadRootId) return;
              presence.edited(threadRootId);
              replyDraft.store.update((current) => ({ ...current, body: value }));
            }}
            onSendThreadReply={onSendThreadReply}
            onReplyInThread={focusThreadReply}
            threadReplyRequest={threadReplyFocus}
            onReact={onReact}
            onCopyLink={onCopyLink}
            onCorrect={chatApi.correctMessage ? onCorrect : undefined}
            pinnedMessageIds={selectedReadState?.pins?.map(pin => pin.messageId)}
            onPin={chatApi.updatePins && selectedReadState ? (messageId, pinned) => void readState.updatePins(channelId!, messageId, pinned) : undefined}
            savedMessageIds={selectedReadState?.preferences?.savedMessageIds}
            onSave={chatApi.updateAttention && selectedReadState ? (messageId, saved) => void readState.updateAttention(channelId!, { messageId, saved }) : undefined}
            onStopAsk={onStopAsk}
            focusMessageId={focusMessageId}
            threadSending={threadSending}
            threadError={threadError}
            contextNotice={messageContext.error ?? (messageContext.loading ? "Loading discussion…" : messageContext.context?.hasMore && !messageContext.context.nextCursor ? "Showing recent replies and the selected message. Older replies are not all loaded." : null)}
            onRetryContext={messageContext.error ? messageContext.retry : undefined}
            onLoadEarlier={messageContext.context?.nextCursor ? () => void messageContext.loadEarlier() : undefined}
            loadingEarlier={messageContext.loadingEarlier}
            earlierError={messageContext.earlierError}
            following={Boolean(threadRootId && selectedReadState?.preferences?.followedThreadIds.includes(threadRootId))}
            followBusy={readState.attentionBusy}
            followError={readState.attentionError}
            onToggleFollow={chatApi.updateAttention && threadRootId && selectedReadState && (threadRoot || selectedReadState.preferences?.followedThreadIds.includes(threadRootId))
              ? () => void readState.updateAttention(channelId!, { threadId: threadRootId, following: !selectedReadState.preferences?.followedThreadIds.includes(threadRootId) }) : undefined}
            onMarkChannelRead={selectedReadState
              ? () => {
                for (const lane of selectedReadState.lanes) {
                  if (lane.latestMessageId) void readState.markRead(channelId!, lane.latestMessageId, lane.rootMessageId);
                }
              }
              : undefined}
            onMarkThreadRead={capabilities.readState && threadRootId && threadReplyList.length > 0
              // Hosted Chat offers Mark read only while the thread has something
              // unread in it; local Scout keeps the button whenever there are replies.
              && (!activityInPanel || (selectedReadState?.lanes.find((lane) => lane.rootMessageId === threadRootId)?.unreadMessageIds.length ?? 0) > 0)
              ? () => void readState.markRead(channelId!, threadReplyList.at(-1)!.id, threadRootId)
              : undefined}
            onMessagesSeen={capabilities.readState && channelId && selectedReadState && threadRootId
              ? (seenIds) => {
                  seenThreadIds.current = seenIds;
                  acknowledgeSeen();
                  const threadLane = selectedReadState.lanes.find((lane) => lane.rootMessageId === threadRootId);
                  if (!threadLane) return;
                  const replyId = readCursorForSeenMessages({
                    messages: threadReplyList.map((message) => ({ id: message.id, createdAt: message.createdAt })),
                    seenIds: new Set(seenIds),
                    lastReadMessageId: threadLane.lastReadMessageId,
                    unreadMessageIds: threadLane.unreadMessageIds,
                  });
                  if (replyId) void readState.markRead(channelId, replyId, threadRootId);
                }
              : undefined}
            onClose={closePanel}
            onBack={() => openPanel({ kind: "members" })}
            onOpenMember={(actorId) => openPanel({ kind: "member", actorId })}
            onMention={mentionMember}
            onRemoveMember={chatApi.removeMember && viewer.isOperator ? async (actorId) => {
              const isCurrent = selection.begin();
              await chatApi.removeMember!(channel.id, actorId, space);
              if (!isCurrent()) return;
              // Invalidate reads started before the confirmed removal.
              rosterReadGeneration.current += 1;
              setMembers(current => current.filter(member => member.actorId !== actorId));
              setPanel(current => current.kind === "member" && current.actorId === actorId ? { kind: "members" } : current);
              void loadRoster();
            } : undefined}
            onRevokeInvite={(inviteId) => void revokeInvite(inviteId)}
            onInvite={() => setSheetOpen(true)}
            activity={<ChatAttentionContent {...attentionProps} layout="panel" onClose={closePanel} />}
            toolContentHost={setChannelToolContentHost}
            toolTriggersHost={setChannelToolTriggersHost}
            overlay={isMidWidth}
            closing={closingPanel !== null}
            onCloseComplete={finishClosePanel}
            avatarSize={shellRail ? 36 : undefined}
            formattingDefault={shellRail && source !== "slack" ? "off" : undefined}
          />
        ) : null}

        {(channel || teamOpen) && panelOpen && !isMidWidth && !isCompact ? (
          <div
            data-scout-sidebar-resize-handle=""
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector"
            title="Drag to resize · double-click to reset"
            onPointerDown={handlePanelResizePointerDown}
            onDoubleClick={(event) => {
              event.preventDefault();
              // back to the window's share, which then follows the window again
              setPanelWidth(null);
              writePanelWidth(null);
            }}
            style={{
              position: "absolute",
              right: Math.max(0, livePanelWidth - 3),
              top: 0,
              bottom: 0,
              width: 6,
              zIndex: 50,
              cursor: "ew-resize",
              touchAction: "none",
            }}
          />
        ) : null}
      </div>
      {/* Sheets sit over the whole window. In the shell the room list lives in
          the shell's own rail, outside this surface, so a sheet drawn in here
          would sit under it: they go to the page body, themed as the rail is. */}
      {(() => {
        const sheet = boardSheetOpen && bootstrap?.vercelBoard ? (
          <VercelBoardConnect
            space={space}
            connection={bootstrap.vercelBoard}
            onClose={() => setBoardSheetOpen(false)}
            onChanged={() => loadBootstrap(false)}
            onLink={async (path) => {
              await chatApi.createChannel({ title: "", board: path, space });
              await loadBootstrap(false);
            }}
            onOpen={selectChannel}
          />
        ) : sheetOpen && channel && viewer ? (
          <InviteSheet
            key={`${space}:${channel.id}`}
            space={space}
            channel={channel}
            viewerActorId={viewer.actorId}
            viewerName={viewer.displayName}
            onClose={() => setSheetOpen(false)}
            onInvitesChanged={() => void loadInvites()}
          />
        ) : null;
        if (!sheet) return null;
        return inShell && typeof document !== "undefined"
          ? createPortal(<div className="chat-rail-host" data-scout-theme={theme}>{sheet}</div>, document.body)
          : sheet;
      })()}

      {paletteOpen ? (
        <JumpPalette
          rooms={channels}
          directs={directs}
          members={members}
          facts={paletteFacts}
          onClose={() => setPaletteOpen(false)}
          onPick={(target) => {
            setPaletteOpen(false);
            if (target.kind === "channel") selectChannel(target.id);
            else openPanel({ kind: "member", actorId: target.id });
          }}
        />
      ) : null}
      </ChatContextMenu>
      </ChatAvatarModeContext.Provider>
    </ChatSpaceTheme>
    </ChatQuestionResponder.Provider>
    </ChatRequestApprovalAccess.Provider>
    </ChatApprovalAccess.Provider>
    </ChatExecutionAccess.Provider>
    </ChatCorrectionScope.Provider>
  );
}

function StatusFold({
  label,
  messages,
}: {
  label: string;
  messages: { id: string; body: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="chat-status-line">
        <button type="button" className="chat-fold" onClick={() => setOpen((value) => !value)}>
          {`${open ? "⌃" : "⌵"} ${label}`}
        </button>
        <span className="chip chip--sm chip--mono chip--ghost chip--neutral">{messages.length}</span>
      </div>
      {open
        ? messages.map((message) => (
          <div className="chat-status-line" key={message.id}>{message.body}</div>
        ))
        : null}
    </>
  );
}
