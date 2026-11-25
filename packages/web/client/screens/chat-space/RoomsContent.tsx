import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useScout } from "../../scout/Provider.tsx";
import { useConversationList } from "../../lib/use-conversation-list.ts";
import { ConversationScreen } from "../chat/ConversationScreen.tsx";
import { HostConversationScreen } from "../chat/HostConversationScreen.tsx";
import { ChatTransportProvider } from "./chat-transport.tsx";
import { createQueryChatAddress } from "./chat-address.ts";
import { chatApi, DEFAULT_CHAT_SPACE, LOCAL_CHAT_CAPABILITIES } from "./chat-api.ts";
import { SLACK_CHAT_CAPABILITIES, slackChatApi, slackConnectionStatus, slackDisconnect, type SlackConnectionStatus } from "./slack-chat-api.ts";
import type { ChatBootstrap } from "./chat-api.ts";
import { PlaceTile } from "./rooms-place.tsx";
import { LayersGlyph, VercelMark } from "./rooms-glyphs.tsx";
import { useVercelBoardRooms } from "./vercel-board-rooms.ts";
import { readRoomsCatalog, type RoomsCatalog } from "./rooms-catalog.ts";
import { roomsDirectConversation, roomsDirectsForFamily, roomsDirectsFromConversations } from "./rooms-directs.ts";
import {
  readRoomsLocation,
  roomFamilyForKey,
  ROOMS_DIRECT_QUERY_KEY,
  roomsAfterSlackDisconnect,
  roomsLocationHref,
  roomsLocationSearch,
  slackAuthorizationHref,
  type RoomFamily,
  type RoomSelection,
  type RoomSource,
} from "./rooms-navigation.ts";
import { disconnectSlackConnection, readSlackConnection, type SlackConnectionTransport } from "./rooms-slack-connection.ts";
import { ListGlyph, RoomsAggregateSidebar, type RoomsListView } from "./RoomsAggregateSidebar.tsx";
import {
  createList,
  deleteList,
  endListDraft,
  loadChatsLists,
  narrowToList,
  renameList,
  saveChatsLists,
  startListDraft,
  updateChatsLists,
  useChatsListDraft,
  useChatsLists,
  type ChatsList,
} from "./chats-lists.ts";
import { RoomsSlackOffline } from "./RoomsSlackOffline.tsx";
import { BOOTSTRAP_POLL_MS } from "./chat-space-model.ts";
import { usePoll } from "./use-poll.ts";
import "./RoomsContent.css";

const slackConnection: SlackConnectionTransport = { status: slackConnectionStatus, disconnect: slackDisconnect };

function currentAddress(): string {
  return `${window.location.pathname}${window.location.search}`;
}

const FAMILIES: ReadonlyArray<{ family: RoomFamily; label: string }> = [
  { family: "all", label: "All" },
  { family: "scout", label: "Scout" },
  { family: "slack", label: "Slack" },
  { family: "vercel", label: "Vercel" },
];

/** A Chats tab: a family, or a list (`list:<id>`), which is All narrowed. */
type ChatsTab = RoomFamily | `list:${string}`;

function listTab(id: string): ChatsTab {
  return `list:${id}`;
}

/** Where a tab remembers its last room. Vercel's rooms are Scout's, so they keep their own place. */
type RoomMemory = RoomSource | "vercel";
function memoryOf(family: RoomFamily, source: RoomSource): RoomMemory {
  return family === "vercel" ? "vercel" : source;
}

const ChatSpaceSurface = lazy(() =>
  import("./ChatSpaceSurface.tsx").then((module) => ({ default: module.ChatSpaceSurface })),
);

/**
 * The name field for a new list, in the tab band. Enter makes the list and
 * opens it; Escape, or leaving the field empty, puts New list back.
 */
function NewListField({
  withConversation,
  onCreate,
  onCancel,
}: {
  withConversation: boolean;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="rooms-new-list-field"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onCreate(name);
      }}
    >
      <input
        autoFocus
        value={name}
        maxLength={60}
        placeholder={withConversation ? "Name the list for this conversation" : "List name"}
        aria-label="New list name"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => { if (!name.trim()) onCancel(); }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }}
      />
      <button type="submit" disabled={!name.trim()}>Create</button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={onCancel}>Cancel</button>
    </form>
  );
}

export function RoomsContent() {
  const [family, setFamily] = useState<RoomFamily>(() => readRoomsLocation(window.location.search).family);
  const [source, setSource] = useState<RoomSource>(() => readRoomsLocation(window.location.search).source);
  const [directId, setDirectId] = useState<string | null>(() => readRoomsLocation(window.location.search).directId);
  const [listId, setListId] = useState<string | null>(() => readRoomsLocation(window.location.search).listId);
  const { lists } = useChatsLists();
  const listDraft = useChatsListDraft();
  // A list another profile made, or one deleted since, falls back to All.
  const activeList: ChatsList | null = family === "all" && listId ? lists.find((list) => list.id === listId) ?? null : null;
  const [lastRooms, setLastRooms] = useState<Partial<Record<RoomMemory, RoomSelection>>>(() => {
    const here = readRoomsLocation(window.location.search);
    return { [memoryOf(here.family, here.source)]: { space: here.space, channelId: here.channelId, directId: here.directId } };
  });
  // The Board rooms, read once for every tab: Vercel lists them, Scout leaves them out, All marks them.
  const boardRooms = useVercelBoardRooms(true);
  const { navigate } = useScout();
  const { sessions, loading: directListLoading, loadError: directListError } = useConversationList();
  const scoutDirects = useMemo(() => roomsDirectsFromConversations(sessions), [sessions]);
  const [slack, setSlack] = useState<ChatBootstrap | null>(null);
  const [connection, setConnection] = useState<SlackConnectionStatus | null>(null);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [catalog, setCatalog] = useState<RoomsCatalog[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  // Until the first read lands, an empty catalog means "not read yet", not "none".
  const [catalogReady, setCatalogReady] = useState(false);
  const [catalogErrors, setCatalogErrors] = useState<string[]>([]);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const catalogRequest = useRef(0);
  const tabRefs = useRef<Partial<Record<ChatsTab, HTMLButtonElement | null>>>({});

  const address = useMemo(() => {
    // A room written by the conversation surface replaces an open DM.
    const base = createQueryChatAddress(source === "slack" ? "slack" : DEFAULT_CHAT_SPACE, { clearKeys: [ROOMS_DIRECT_QUERY_KEY] });
    return {
      read: base.read,
      write(next: Parameters<typeof base.write>[0], replace: boolean) {
        const before = currentAddress();
        base.write(next, replace);
        setDirectId(null);
        setLastRooms((current) => ({
          ...current,
          [memoryOf(family, source)]: { space: next.space, channelId: next.channelId, directId: null },
        }));
        // The shell's router hears history only through popstate. A new entry
        // the surface pushed is announced the way navigateTo announces its
        // own, so the shell's Back and route stay in step with the address.
        if (!replace && currentAddress() !== before) window.dispatchEvent(new PopStateEvent("popstate"));
      },
    };
  }, [family, source]);

  useEffect(() => {
    const onPopState = () => {
      const here = readRoomsLocation(window.location.search);
      setFamily(here.family);
      setSource(here.source);
      setDirectId(here.directId);
      setListId(here.listId);
      setLastRooms((current) => ({
        ...current,
        [memoryOf(here.family, here.source)]: { space: here.space, channelId: here.channelId, directId: here.directId },
      }));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    setCheckingConnection(true);
    void readSlackConnection(slackConnection, currentAddress()).then((result) => {
      if (!active) return;
      setConnection(result);
      setCheckingConnection(false);
    });
    return () => { active = false; };
  }, [source, connectionVersion]);

  // A Slack address with Slack known to be disconnected shows how to connect,
  // under the same address, instead of mounting a Slack room that cannot load.
  const slackOffline = source === "slack" && connection !== null && !connection.connected;

  useEffect(() => {
    if ((source !== "slack" && !connection?.connected) || connection?.connected === false || slack) return;
    let active = true;
    void slackChatApi.bootstrap().then((result) => {
      if (active) setSlack(result);
    }).catch(() => {});
    return () => { active = false; };
  }, [connection?.connected, slack, source]);

  const loadCatalog = useCallback(async () => {
    const request = ++catalogRequest.current;
    const sources: Array<{ source: RoomSource; api: typeof chatApi | typeof slackChatApi }> = [
      { source: "scout", api: chatApi },
      ...(connection?.connected ? [{ source: "slack" as const, api: slackChatApi }] : []),
    ];
    const results = await Promise.allSettled(sources.map(({ api, source: place }) => readRoomsCatalog(api, place)));
    if (request !== catalogRequest.current) return;
    const errors: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const name = sources[index].source === "slack" ? "Slack" : "Scout";
        const reason = result.reason instanceof Error ? result.reason.message : "The channel catalog could not be read.";
        errors.push(`${name} channels could not be refreshed. ${reason}`);
      }
    });
    setCatalog((current) => {
      const next = new Map(current.map((place) => [place.source, place]));
      if (!connection?.connected) next.delete("slack");
      results.forEach((result) => {
        if (result.status === "fulfilled") next.set(result.value.source, result.value);
      });
      return [...next.values()];
    });
    setCatalogErrors(errors);
    setCatalogLoading(false);
    setCatalogReady(true);
  }, [connection?.connected, catalogVersion]);

  useEffect(() => {
    if (family !== "all") return;
    setCatalogLoading(true);
    void loadCatalog();
  }, [family, loadCatalog]);
  usePoll(loadCatalog, BOOTSTRAP_POLL_MS, family === "all");

  function navigateTo(nextFamily: RoomFamily, nextSource: RoomSource, selection: RoomSelection) {
    const href = roomsLocationHref(window.location.pathname, window.location.search, nextFamily, nextSource, selection);
    if (!href) return;
    window.history.pushState(null, "", href);
    setLastRooms((current) => ({ ...current, [memoryOf(nextFamily, nextSource)]: selection }));
    setFamily(nextFamily);
    setSource(nextSource);
    setDirectId(nextSource === "scout" ? selection.directId ?? null : null);
    setListId(readRoomsLocation(window.location.search).listId);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function selectFamily(next: RoomFamily) {
    const here = readRoomsLocation(window.location.search);
    // Where the operator is now, by tab: a Board room open under All is Vercel's.
    const hereMemory: RoomMemory = family === "vercel" || (source === "scout" && here.channelId && boardRooms.rooms.has(here.channelId))
      ? "vercel"
      : source;
    const nextSource: RoomSource = next === "all" ? source : next === "vercel" ? "scout" : next;
    const selection = next === "all" || memoryOf(next, nextSource) === hereMemory
      ? { ...here, listId: null }
      : lastRooms[memoryOf(next, nextSource)] ?? { space: null, channelId: null };
    // A DM only All may list does not follow the operator into Scout's tab.
    const hostDirect = next === "scout" && selection.directId
      ? scoutDirects.find((item) => item.id === selection.directId)?.provider === null
      : false;
    navigateTo(next, nextSource, hostDirect ? { space: null, channelId: null } : selection);
  }

  /** Open a list. The conversation open now stays open beside it. */
  function selectList(id: string) {
    navigateTo("all", source, { ...readRoomsLocation(window.location.search), listId: id });
  }

  function selectTab(tab: ChatsTab) {
    if (tab.startsWith("list:")) selectList(tab.slice("list:".length));
    else selectFamily(tab as RoomFamily);
  }

  function createNamedList(name: string) {
    const result = createList(loadChatsLists(), name, { members: listDraft?.firstMember ? [listDraft.firstMember] : [] });
    endListDraft();
    if (!result.list) return;
    saveChatsLists(result.state);
    selectList(result.list.id);
  }

  // A Board room opened under Scout (an older link, a room the list read late) belongs to Vercel's tab.
  useEffect(() => {
    if (family !== "scout" || !boardRooms.ready) return;
    const here = readRoomsLocation(window.location.search);
    if (!here.channelId || here.directId || !boardRooms.rooms.has(here.channelId)) return;
    const search = roomsLocationSearch(window.location.search, "vercel", "scout", here);
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
    setLastRooms((current) => ({ ...current, vercel: { space: here.space, channelId: here.channelId, directId: null } }));
    setFamily("vercel");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [boardRooms, family, lastRooms]);

  const selectDirect = useCallback((id: string) => {
    const href = roomsLocationHref(
      window.location.pathname,
      window.location.search,
      family === "all" ? "all" : "scout",
      "scout",
      { space: null, channelId: null, directId: id },
    );
    if (!href) return;
    window.history.pushState(null, "", href);
    setLastRooms((current) => ({ ...current, scout: { space: null, channelId: null, directId: id } }));
    if (family !== "all") setFamily("scout");
    setSource("scout");
    setDirectId(id);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [family]);

  const tabOrder: ChatsTab[] = [...FAMILIES.map((item) => item.family), ...lists.map((list) => listTab(list.id))];
  const activeTab: ChatsTab = activeList ? listTab(activeList.id) : family;

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const target = roomFamilyForKey(tabOrder, activeTab, event.key);
    if (target === null) return;
    event.preventDefault();
    selectTab(target);
    tabRefs.current[target]?.focus();
  }

  // The disconnect resolves after renders the operator may have caused, so it
  // decides where to go from where Rooms is then, not where the click was.
  const here = useRef({ family, source, lastRooms });
  here.current = { family, source, lastRooms };

  async function disconnect() {
    if (!connection || disconnecting) return;
    setDisconnecting(true);
    const outcome = await disconnectSlackConnection(slackConnection, connection, currentAddress());
    setDisconnecting(false);
    if (!outcome.ok) {
      setConnection((current) => current ? { ...current, error: outcome.error } : current);
      return;
    }
    setConnection(outcome.status);
    setSlack(null);
    const next = roomsAfterSlackDisconnect(here.current.family, here.current.source, here.current.lastRooms.scout);
    if (next) navigateTo(next.family, next.source, next.selection);
  }

  function openScout() {
    navigateTo(family === "all" ? "all" : "scout", "scout", lastRooms.scout ?? { space: null, channelId: null });
  }

  // The DM open in the workspace, drawn by Scout's own conversation screens.
  const openDirect = source === "scout" && directId
    ? scoutDirects.find((item) => item.id === directId) ?? null
    : null;
  const directPane = source === "scout" && directId ? (
    openDirect?.hostId ? (
      <HostConversationScreen
        key={`${openDirect.hostId}:${directId}`}
        conversationId={directId}
        machineId={openDirect.hostId}
        hostName={openDirect.hostName ?? openDirect.hostId}
      />
    ) : openDirect ? (
      <ConversationScreen
        key={directId}
        conversationId={directId}
        navigate={navigate}
        embedded
        showBackNav={false}
        messageFirst
      />
    ) : (
      <p className="chat-feed-notice" role="status" data-direct-unresolved>
        {directListLoading
          ? "Loading direct message…"
          : directListError
            ? `The direct message could not be read. ${directListError}`
            : "This direct message is not available."}
      </p>
    )
  ) : null;
  const directRows = useMemo(
    () => family === "scout" ? roomsDirectsForFamily(scoutDirects, "scout").map(roomsDirectConversation) : [],
    [family, scoutDirects],
  );
  const allDirects = family === "all" ? roomsDirectsForFamily(scoutDirects, "all") : undefined;

  // A list is All narrowed to its members, drawn by the same list.
  const narrowed = activeList ? narrowToList(activeList, catalog, allDirects ?? []) : null;
  const listedCatalog = narrowed ? narrowed.places : catalog;
  const catalogDirects = narrowed ? narrowed.directs : allDirects;
  const leaveList = () => navigateTo("all", source, { ...readRoomsLocation(window.location.search), listId: null });
  const roomsList: RoomsListView | null = activeList ? {
    id: activeList.id,
    name: activeList.name,
    memberCount: activeList.members.length,
    // Until both reads land, an unshown member may only be not read yet.
    missing: catalogReady && !catalogLoading && !directListLoading ? narrowed?.missing ?? 0 : 0,
    onRename: (name) => updateChatsLists((state) => renameList(state, activeList.id, name)),
    onDelete: () => {
      updateChatsLists((state) => deleteList(state, activeList.id));
      leaveList();
    },
    onShowAll: leaveList,
  } : null;

  const slackName = slack?.source?.kind === "slack"
    ? slack.source.name
    : catalog.find((place) => place.source === "slack")?.name ?? connection?.teamName ?? "Slack";
  const tabs = (
    <div className="rooms-tabs-band">
      <div className="rooms-tabs-lead">
      <div className="rooms-tabs" role="tablist" aria-label="Messages">
        {FAMILIES.map((item) => {
          const selected = activeTab === item.family;
          return (
            <button
              key={item.family}
              ref={(element) => { tabRefs.current[item.family] = element; }}
              type="button"
              role="tab"
              id={`rooms-tab-${item.family}`}
              className="rooms-tab"
              aria-selected={selected}
              aria-controls="rooms-tabpanel"
              tabIndex={selected ? 0 : -1}
              data-active={selected || undefined}
              onClick={() => selectFamily(item.family)}
              onKeyDown={onTabKeyDown}
            >
              {item.family === "all"
                ? <span className="rooms-tab-mark" aria-hidden><LayersGlyph size={14} /></span>
                : item.family === "vercel"
                  ? <span className="rooms-tab-mark" aria-hidden><VercelMark size={13} /></span>
                  : <PlaceTile kind={item.family} name={item.family === "slack" ? slackName : "Scout"} size={16} />}
              <span>{item.label}</span>
            </button>
          );
        })}
        {lists.map((list) => {
          const tab = listTab(list.id);
          const selected = activeTab === tab;
          return (
            <button
              key={tab}
              ref={(element) => { tabRefs.current[tab] = element; }}
              type="button"
              role="tab"
              id={`rooms-tab-list-${list.id}`}
              className="rooms-tab"
              data-list-tab={list.id}
              aria-selected={selected}
              aria-controls="rooms-tabpanel"
              tabIndex={selected ? 0 : -1}
              data-active={selected || undefined}
              onClick={() => selectList(list.id)}
              onKeyDown={onTabKeyDown}
            >
              <span className="rooms-tab-mark" aria-hidden><ListGlyph size={14} /></span>
              <span className="rooms-tab-name">{list.name}</span>
            </button>
          );
        })}
      </div>
      {listDraft ? (
        <NewListField
          withConversation={listDraft.firstMember !== null}
          onCreate={createNamedList}
          onCancel={endListDraft}
        />
      ) : (
        <button type="button" className="rooms-new-list" onClick={() => startListDraft()}>
          New list
        </button>
      )}
      </div>
      <div className="rooms-tabs-connection">
        {connection?.connected ? (
          <>
            <span>{connection.source === "oauth" ? `Slack: ${slackName}` : "Slack: server connection"}</span>
            {connection.source === "oauth" ? (
              <button type="button" disabled={disconnecting} onClick={() => void disconnect()}>
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : null}
          </>
        ) : connection ? (
          connection.oauthConfigured && connection.authorizationUrl ? (
            <a href={slackAuthorizationHref(connection.authorizationUrl, currentAddress())}>Connect Slack</a>
          ) : <span>Slack is not connected</span>
        ) : <span>Checking Slack…</span>}
        {connection?.error ? <p role="status">{connection.error}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="rooms-source-surface" data-source={source} data-family={family} data-list={activeList?.id}>
      {tabs}
      <div
        className="rooms-source-content"
        role="tabpanel"
        id="rooms-tabpanel"
        aria-labelledby={activeList ? `rooms-tab-list-${activeList.id}` : `rooms-tab-${family}`}
      >
        {slackOffline ? (
          <RoomsSlackOffline
            connection={connection}
            authorizationHref={connection.oauthConfigured && connection.authorizationUrl
              ? slackAuthorizationHref(connection.authorizationUrl, currentAddress())
              : null}
            hasChannel={readRoomsLocation(window.location.search).channelId !== null}
            checking={checkingConnection}
            onCheckAgain={() => setConnectionVersion((version) => version + 1)}
            onOpenScout={openScout}
            list={family === "all" ? (
              <RoomsAggregateSidebar
                places={listedCatalog}
                list={roomsList}
                loading={catalogLoading || !catalogReady}
                errors={catalogErrors}
                onRetry={() => setCatalogVersion((version) => version + 1)}
                activeSource="slack"
                activeSpace={readRoomsLocation(window.location.search).space ?? "slack"}
                activeChannelId={readRoomsLocation(window.location.search).channelId}
                readStates={{}}
                onSelect={(nextSource, space, channelId) => navigateTo("all", nextSource, { space, channelId })}
                directs={catalogDirects}
                onSelectDirect={selectDirect}
                boardRooms={boardRooms.rooms}
              />
            ) : undefined}
          />
        ) : (
        <ChatTransportProvider
          api={source === "slack" ? slackChatApi : chatApi}
          capabilities={source === "slack" ? SLACK_CHAT_CAPABILITIES : LOCAL_CHAT_CAPABILITIES}
          source={source}
          address={address}
        >
          <Suspense fallback={null}>
            <ChatSpaceSurface
              key={memoryOf(family, source)}
              inShell
              roomListInPage
              roomsCatalog={family === "all" ? listedCatalog : undefined}
              roomsList={roomsList}
              roomKind={family === "vercel" ? "board" : family === "scout" ? "scout" : undefined}
              vercelBoardRooms={boardRooms}
              catalogLoading={catalogLoading || !catalogReady}
              catalogErrors={catalogErrors}
              onRetryCatalog={() => setCatalogVersion((version) => version + 1)}
              onSelectCatalogRoom={(nextSource, space, channelId) => navigateTo(family, nextSource, { space, channelId })}
              directRows={directRows}
              catalogDirects={catalogDirects}
              activeDirectId={source === "scout" ? directId : null}
              onSelectDirect={selectDirect}
              directPane={directPane}
              directTitle={openDirect?.title ?? null}
            />
          </Suspense>
        </ChatTransportProvider>
        )}
      </div>
    </div>
  );
}
