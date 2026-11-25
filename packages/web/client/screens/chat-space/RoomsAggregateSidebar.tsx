import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ChatReadState, ConversationDefinition } from "@openscout/protocol";
import { summarizeChatReadState } from "../../../shared/chat-read-state.ts";
import { useContextMenu, type MenuItem } from "../../components/ContextMenu.tsx";
import { hasOwnRoomTitle, roomTitle, shortRoomId } from "./chat-space-model.ts";
import {
  addToList,
  directMemberKey,
  listHas,
  removeFromList,
  roomMemberKey,
  startListDraft,
  updateChatsLists,
  useChatsLists,
  type ChatsList,
} from "./chats-lists.ts";
import type { RoomsCatalog, RoomsCatalogSpace } from "./rooms-catalog.ts";
import type { RoomsDirect } from "./rooms-directs.ts";
import { PlaceTile } from "./rooms-place.tsx";
import { LayersGlyph, SearchGlyph, VercelMark } from "./rooms-glyphs.tsx";
import type { RoomSource } from "./rooms-navigation.ts";
import type { VercelBoardRoomRef } from "./vercel-board-rooms.ts";

const NO_BOARD_ROOMS: ReadonlyMap<string, VercelBoardRoomRef> = new Map();

export function RoomsAggregateSidebar({
  places,
  loading,
  errors,
  onRetry,
  activeSource,
  activeSpace,
  activeChannelId,
  readStates,
  onSelect,
  directs = [],
  activeDirectId = null,
  onSelectDirect,
  list = null,
  boardRooms = NO_BOARD_ROOMS,
}: {
  places: RoomsCatalog[];
  loading: boolean;
  errors: string[];
  onRetry: () => void;
  activeSource: RoomSource;
  activeSpace: string;
  activeChannelId: string | null;
  readStates: Record<string, ChatReadState>;
  onSelect: (source: RoomSource, space: string, channelId: string) => void;
  /** Scout's DMs (rooms-directs.ts); Slack's come inside its catalog. */
  directs?: RoomsDirect[];
  activeDirectId?: string | null;
  onSelectDirect?: (id: string) => void;
  /** Set when this is a list the operator made: `places` and `directs` already hold only its members. */
  list?: RoomsListView | null;
  /** Scout's rooms that are Vercel Board channels: All lists them under Vercel, by their Board channel. */
  boardRooms?: ReadonlyMap<string, VercelBoardRoomRef>;
}) {
  const [query, setQuery] = useState("");
  const { lists } = useChatsLists();
  const openMenu = useContextMenu();
  const listRef = useRef<HTMLDivElement | null>(null);
  const queryRef = useRef<HTMLInputElement | null>(null);
  const needle = query.trim().toLowerCase();
  const filtered = useMemo(() => places.map((place) => ({
    ...place,
    spaces: place.spaces.map((space) => ({
      ...space,
      conversations: space.conversations.filter((conversation) =>
        !(place.source === "scout" && boardRooms.has(conversation.id))
        && (!needle || `${roomTitle(conversation)} ${conversation.topic ?? ""}`.toLowerCase().includes(needle))),
    })),
  })), [boardRooms, needle, places]);
  // Board rooms, by board: they live in Scout's catalog but are Vercel's to list.
  const boards = useMemo(() => {
    const byBoard = new Map<string, { place: RoomsCatalog; space: RoomsCatalogSpace; conversation: ConversationDefinition; board: VercelBoardRoomRef }[]>();
    for (const place of places) {
      if (place.source !== "scout") continue;
      for (const space of place.spaces) {
        for (const conversation of space.conversations) {
          const board = boardRooms.get(conversation.id);
          if (!board || (needle && !`${board.channel} ${board.board?.name ?? ""}`.toLowerCase().includes(needle))) continue;
          const name = board.board?.name ?? "";
          byBoard.set(name, [...(byBoard.get(name) ?? []), { place, space, conversation, board }]);
        }
      }
    }
    for (const rows of byBoard.values()) rows.sort((a, b) => a.board.channel.localeCompare(b.board.channel));
    return [...byBoard.entries()];
  }, [boardRooms, needle, places]);
  const boardShown = boards.reduce((count, [, rows]) => count + rows.length, 0);
  const shownDirects = useMemo(() => directs.filter((direct) =>
    !needle || `${direct.title} ${direct.hostName ?? ""}`.toLowerCase().includes(needle)), [directs, needle]);
  const scoutDirects = shownDirects.filter((direct) => direct.provider === "scout");
  const hostDirects = shownDirects.filter((direct) => direct.provider === null);
  const total = places.reduce((count, place) => count + place.spaces.reduce((sum, space) => sum + space.conversations.length, 0), 0)
    + directs.length;
  const shown = filtered.reduce((count, place) => count + place.spaces.reduce((sum, space) => sum + space.conversations.length, 0), 0)
    + shownDirects.length + boardShown;

  function unread(place: RoomsCatalog, space: RoomsCatalogSpace, conversation: ConversationDefinition): { text: string; mentions: number } | null {
    if (place.source !== activeSource || space.id !== activeSpace) return null;
    const state = readStates[conversation.id];
    const attention = state ? summarizeChatReadState(state) : null;
    if (!attention || (!attention.unread && !attention.incomplete)) return null;
    return { text: `${attention.unread || ""}${attention.incomplete ? "+" : ""}`, mentions: attention.mentions };
  }

  function onRowMenu(event: ReactMouseEvent, key: string) {
    if (event.altKey || event.shiftKey) return;
    openMenu(event, listMenuItems(lists, key));
  }

  function room(place: RoomsCatalog, space: RoomsCatalogSpace, conversation: ConversationDefinition, board?: VercelBoardRoomRef) {
    const channel = conversation.kind === "channel";
    const title = board ? board.channel : channel ? roomTitle(conversation) : conversation.title;
    const attention = unread(place, space, conversation);
    const badge = attention?.text ?? null;
    // A Board room's count is Scout's own traffic, not the Board's, so it
    // shows as a dot; only a mention gets a number.
    const dot = Boolean(board && attention && !attention.mentions);
    // An open DM is the selection; no room is current under it.
    const current = !activeDirectId && place.source === activeSource && space.id === activeSpace && conversation.id === activeChannelId;
    return (
      <button
        type="button"
        className="rooms-aggregate-row"
        data-active={current || undefined}
        data-side-row
        key={`${place.source}:${space.id}:${conversation.id}`}
        aria-current={current ? "page" : undefined}
        aria-label={roomRowLabel(title, place, space, dot ? "+" : badge, board ? "Vercel" : undefined)}
        onClick={() => onSelect(place.source, space.id, conversation.id)}
        onContextMenu={(event) => onRowMenu(event, roomMemberKey(place.source, space.id, conversation.id))}
      >
        {board ? <span className="rooms-aggregate-hash" data-board aria-hidden><VercelMark size={11} /></span>
          : channel && place.source === "slack" ? <span className="rooms-aggregate-hash" aria-hidden>#</span> : null}
        <span className="rooms-aggregate-name">{title.replace(/^#/u, "")}</span>
        {channel && !board && !hasOwnRoomTitle(conversation) ? <small>{shortRoomId(conversation.id)}</small> : null}
        {dot ? <span className="rooms-aggregate-unread" data-dot aria-hidden />
          : badge ? <span className="rooms-aggregate-unread" aria-hidden>{badge}</span> : null}
      </button>
    );
  }

  function direct(item: RoomsDirect) {
    const current = item.id === activeDirectId;
    return (
      <button
        type="button"
        className="rooms-aggregate-row"
        data-active={current || undefined}
        data-side-row
        data-direct-id={item.id}
        key={`dm:${item.id}`}
        aria-current={current ? "page" : undefined}
        aria-label={directRowLabel(item)}
        onClick={() => onSelectDirect?.(item.id)}
        onContextMenu={(event) => onRowMenu(event, directMemberKey(item.id))}
      >
        <span className="rooms-aggregate-name">{item.title}</span>
        {item.hostName ? <small>{item.hostName}</small> : null}
      </button>
    );
  }

  return (
    <nav className="chat-sidebar rooms-aggregate" aria-label={list ? list.name : "All conversations"} data-list={list ? "" : undefined}>
      <div className="rooms-aggregate-head">
        {list
          ? <ListHead list={list} total={total} />
          : <div className="rooms-aggregate-title"><LayersGlyph size={16} /><strong>All conversations</strong><span>{total}</span></div>}
        <label className="rooms-aggregate-search">
          <SearchGlyph size={14} />
          <input
            ref={queryRef}
            type="search"
            value={query}
            placeholder={list ? "Filter this list" : "Filter all conversations"}
            aria-label={list ? `Filter ${list.name}` : "Filter all conversations"}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                listRef.current?.querySelector<HTMLButtonElement>("[data-side-row]")?.focus();
              }
            }}
          />
        </label>
      </div>
      <div
        className="rooms-aggregate-list"
        ref={listRef}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          const rows = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[data-side-row]") ?? []);
          const index = rows.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault();
          // Up from the first row returns to the filter, where Down entered.
          if (event.key === "ArrowUp" && index === 0) {
            queryRef.current?.focus();
            return;
          }
          const next = event.key === "Home" ? 0
            : event.key === "End" ? rows.length - 1
              : event.key === "ArrowDown" ? Math.min(rows.length - 1, index + 1) : index - 1;
          rows[next]?.focus();
        }}
      >
        {loading ? <p className="rooms-aggregate-note">Loading channels…</p> : null}
        {errors.map((error) => <div className="rooms-aggregate-error" role="status" key={error}>
          <p>{error}</p>
          <button type="button" onClick={onRetry}>Try again</button>
        </div>)}
        {!loading && total === 0 && errors.length === 0 && !list ? <p className="rooms-aggregate-note">No conversations are available in these places.</p> : null}
        {!loading && list && list.memberCount === 0 ? (
          <div className="rooms-aggregate-note rooms-list-empty" data-list-empty>
            <p>Nothing in this list yet.</p>
            <p>Right-click a conversation under All and choose Add to {list.name}.</p>
            <button type="button" onClick={list.onShowAll}>Show all conversations</button>
          </div>
        ) : null}
        {!loading && list && list.missing > 0 ? (
          <p className="rooms-aggregate-note" data-list-missing>
            {list.missing === 1
              ? "1 conversation in this list is not available right now."
              : `${list.missing} conversations in this list are not available right now.`}
          </p>
        ) : null}
        {needle && shown === 0 && total > 0 ? <p className="rooms-aggregate-note">No conversations match “{query.trim()}”.</p> : null}
        {filtered.map((place) => {
          const placeShown = place.spaces.reduce((count, space) => count + space.conversations.length, 0);
          const placeDirects = place.source === "scout" ? scoutDirects : [];
          if (placeShown === 0 && placeDirects.length === 0) return null;
          return (
            <section className="rooms-aggregate-place" aria-label={`${place.source === "scout" ? "Scout" : "Slack"} rooms`} key={place.source}>
              <div className="rooms-aggregate-place-head">
                <PlaceTile kind={place.source} name={place.name} size={20} />
                <strong>{place.source === "scout" ? "Scout" : "Slack"}</strong>
                {place.source === "slack" && place.name !== "Slack" ? <small>{place.name}</small> : null}
              </div>
              {place.spaces.map((space) => {
                if (space.conversations.length === 0) return null;
                const channels = space.conversations.filter((conversation) => conversation.kind === "channel");
                const directs = space.conversations.filter((conversation) => conversation.kind !== "channel");
                return (
                  <div className="rooms-aggregate-space" key={space.id}>
                    {place.spaces.length > 1 ? <div className="rooms-aggregate-subhead">{space.title}</div> : null}
                    {channels.map((conversation) => room(place, space, conversation))}
                    {directs.length > 0 ? <div className="rooms-aggregate-subhead">Direct messages</div> : null}
                    {directs.map((conversation) => room(place, space, conversation))}
                  </div>
                );
              })}
              {placeDirects.length > 0 ? (
                <div className="rooms-aggregate-space" data-directs="scout">
                  <div className="rooms-aggregate-subhead">Direct messages</div>
                  {placeDirects.map(direct)}
                </div>
              ) : null}
            </section>
          );
        })}
        {boardShown > 0 ? (
          <section className="rooms-aggregate-place" aria-label="Vercel rooms">
            <div className="rooms-aggregate-place-head">
              <span className="rooms-aggregate-mark" aria-hidden><VercelMark size={14} /></span>
              <strong>Vercel</strong>
            </div>
            {boards.map(([name, rows]) => (
              <div className="rooms-aggregate-space" key={name || "board"}>
                {name ? <div className="rooms-aggregate-subhead">{name}</div> : null}
                {rows.map(({ place, space, conversation, board }) => room(place, space, conversation, board))}
              </div>
            ))}
          </section>
        ) : null}
        {/* A Scout catalog that failed still leaves its DMs reachable. */}
        {scoutDirects.length > 0 && !filtered.some((place) => place.source === "scout") ? (
          <section className="rooms-aggregate-place" aria-label="Scout direct messages">
            <div className="rooms-aggregate-place-head">
              <PlaceTile kind="scout" name="Scout" size={20} />
              <strong>Scout</strong>
            </div>
            <div className="rooms-aggregate-space" data-directs="scout">
              <div className="rooms-aggregate-subhead">Direct messages</div>
              {scoutDirects.map(direct)}
            </div>
          </section>
        ) : null}
        {/* DMs on other hosts: no provider tab claims them, so All alone lists them. */}
        {hostDirects.length > 0 ? (
          <section className="rooms-aggregate-place" aria-label="Direct messages on other hosts">
            <div className="rooms-aggregate-place-head">
              <strong>Other hosts</strong>
            </div>
            <div className="rooms-aggregate-space" data-directs="hosts">
              <div className="rooms-aggregate-subhead">Direct messages</div>
              {hostDirects.map(direct)}
            </div>
          </section>
        ) : null}
      </div>
    </nav>
  );
}

/** What a list view needs beyond its rows. */
export interface RoomsListView {
  id: string;
  name: string;
  /** Members saved in the list, shown or not. */
  memberCount: number;
  /** Members whose conversation is not in any catalog right now. */
  missing: number;
  onRename: (name: string) => void;
  onDelete: () => void;
  onShowAll: () => void;
}

/**
 * The menu a conversation row opens: add it to or remove it from each list,
 * or start a new list with it.
 */
export function listMenuItems(lists: readonly ChatsList[], key: string): MenuItem[] {
  const items: MenuItem[] = lists.map((list): MenuItem => listHas(list, key)
    ? { kind: "action", label: `Remove from ${list.name}`, onSelect: () => updateChatsLists((state) => removeFromList(state, list.id, key)) }
    : { kind: "action", label: `Add to ${list.name}`, onSelect: () => updateChatsLists((state) => addToList(state, list.id, key)) });
  if (items.length > 0) items.push({ kind: "separator" });
  items.push({ kind: "action", label: "New list with this conversation…", onSelect: () => startListDraft(key) });
  return items;
}

function ListHead({ list, total }: { list: RoomsListView; total: number }) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(list.name);

  if (mode === "rename") {
    return (
      <form
        className="rooms-aggregate-title rooms-list-rename"
        onSubmit={(event) => {
          event.preventDefault();
          list.onRename(name);
          setMode("view");
        }}
      >
        <input
          autoFocus
          value={name}
          aria-label="List name"
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setName(list.name);
            setMode("view");
          }}
        />
        <button type="submit" disabled={!name.trim()}>Save</button>
      </form>
    );
  }

  return (
    <div className="rooms-list-head">
      <div className="rooms-aggregate-title">
        <ListGlyph size={16} />
        <strong>{list.name}</strong>
        <span>{total}</span>
      </div>
      {mode === "delete" ? (
        <div className="rooms-list-actions" role="group" aria-label={`Delete ${list.name}`}>
          <span>Delete this list? Its conversations stay in Chats.</span>
          <button type="button" data-tone="danger" onClick={list.onDelete}>Delete</button>
          <button type="button" onClick={() => setMode("view")}>Cancel</button>
        </div>
      ) : (
        <div className="rooms-list-actions">
          <button type="button" onClick={() => { setName(list.name); setMode("rename"); }}>Rename</button>
          <button type="button" onClick={() => setMode("delete")}>Delete list</button>
        </div>
      )}
    </div>
  );
}

/** Three short rules with a lead dot: a list. Thin, 16px, inline. */
export function ListGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden>
      <path d="M6 4.5h7M6 8h7M6 11.5h7" />
      <circle cx="3.25" cy="4.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="3.25" cy="8" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="3.25" cy="11.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A row's accessible name: the room, its place, and what is waiting in it. */
export function roomRowLabel(title: string, place: RoomsCatalog, space: RoomsCatalogSpace, badge: string | null, placeName?: string): string {
  const parts = [title, placeName ?? (place.source === "scout" ? "Scout" : "Slack")];
  if (place.spaces.length > 1) parts.push(space.title);
  if (badge) {
    const count = badge.replace("+", "");
    parts.push(count ? `${count} unread${badge.endsWith("+") ? " or more" : ""}` : "unread");
  }
  return parts.join(", ");
}

/** A Scout DM row's accessible name: who, where it lives, and that it is a DM. */
export function directRowLabel(direct: RoomsDirect): string {
  return [direct.title, direct.hostName ? `direct message on ${direct.hostName}` : "Scout direct message"].join(", ");
}
