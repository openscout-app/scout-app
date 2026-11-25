export type RoomSource = "scout" | "slack";
/** A Chat tab. Vercel is its own family: the Board channels Scout keeps as rooms, carried by Scout's transport. */
export type RoomFamily = RoomSource | "all" | "vercel";

export interface RoomSelection {
  space: string | null;
  channelId: string | null;
  /**
   * A Scout direct conversation, opened in the same workspace. Scout's room
   * API serves channels only, so a DM is its own key rather than a `channel`.
   * Slack's DMs are Slack channels and keep using `channel`.
   */
  directId?: string | null;
  /**
   * A list the operator made (chats-lists.ts). A list is All narrowed to its
   * members, so it is kept only under All. Left undefined, a move keeps the
   * list the address already names; null leaves it.
   */
  listId?: string | null;
}

/** The Rooms query key for a Scout direct conversation. */
export const ROOMS_DIRECT_QUERY_KEY = "dm";

/** The Rooms query key for a list. */
export const ROOMS_LIST_QUERY_KEY = "list";

export interface RoomsLocation extends RoomSelection {
  family: RoomFamily;
  source: RoomSource;
  directId: string | null;
  listId: string | null;
  messageId: string | null;
}

export function defaultRoomSpace(source: RoomSource): string {
  return source === "slack" ? "slack" : "home";
}

export function readRoomsLocation(search: string): RoomsLocation {
  const params = new URLSearchParams(search);
  const requested = params.get("source");
  const space = params.get("space")?.trim() || null;
  const legacySlack = requested === "slack" || space?.startsWith("slack:") === true;
  const family: RoomFamily = requested === "all" ? "all" : requested === "vercel" ? "vercel" : legacySlack ? "slack" : "scout";
  const source: RoomSource = family === "all"
    ? params.get("provider") === "slack" || (params.get("provider") === null && legacySlack) ? "slack" : "scout"
    : family === "vercel" ? "scout" : family;
  // Only Scout opens a `dm`; a Slack address that carries one ignores it.
  const directId = source === "scout" ? params.get(ROOMS_DIRECT_QUERY_KEY)?.trim() || null : null;
  return {
    family,
    source,
    space: directId ? null : space,
    channelId: directId ? null : params.get("channel")?.trim() || null,
    directId,
    listId: family === "all" ? params.get(ROOMS_LIST_QUERY_KEY)?.trim() || null : null,
    messageId: directId ? null : params.get("message")?.trim() || null,
  };
}

export function roomsLocationSearch(
  currentSearch: string,
  family: RoomFamily,
  source: RoomSource,
  selection: RoomSelection,
): string {
  const params = new URLSearchParams(currentSearch);
  if (family === "all") {
    params.set("source", "all");
    params.set("provider", source);
    if (selection.listId) params.set(ROOMS_LIST_QUERY_KEY, selection.listId);
    else if (selection.listId === null) params.delete(ROOMS_LIST_QUERY_KEY);
  } else if (family === "vercel") {
    params.set("source", "vercel");
    params.delete("provider");
    params.delete(ROOMS_LIST_QUERY_KEY);
  } else {
    if (source === "slack") params.set("source", "slack");
    else params.delete("source");
    params.delete("provider");
    params.delete(ROOMS_LIST_QUERY_KEY);
  }
  const directId = source === "scout" ? selection.directId ?? null : null;
  if (directId) params.set(ROOMS_DIRECT_QUERY_KEY, directId);
  else params.delete(ROOMS_DIRECT_QUERY_KEY);
  if (selection.channelId && !directId) params.set("channel", selection.channelId);
  else params.delete("channel");
  if (!directId && selection.space && selection.space !== defaultRoomSpace(source)) {
    params.set("space", selection.space);
  } else {
    params.delete("space");
  }
  params.delete("message");
  return params.toString();
}

/**
 * One spelling for every address that opens the same place: the provider an
 * aggregate link leaves implicit, a default space written out, legacy Slack
 * links and parameter order all collapse, while unrelated parameters stay.
 */
export function canonicalRoomsSearch(search: string): string {
  const here = readRoomsLocation(search);
  const params = new URLSearchParams(roomsLocationSearch(search, here.family, here.source, here));
  if (here.messageId) params.set("message", here.messageId);
  params.sort();
  return params.toString();
}

/**
 * The history entry for a Rooms move, or null when it would not change where
 * the operator is. Pushing an equivalent entry made the next Back look like it
 * did nothing, for instance after choosing the family already open from a link
 * that left its provider implicit (`?source=all`).
 */
export function roomsLocationHref(
  pathname: string,
  currentSearch: string,
  family: RoomFamily,
  source: RoomSource,
  selection: RoomSelection,
): string | null {
  const search = roomsLocationSearch(currentSearch, family, source, selection);
  if (canonicalRoomsSearch(search) === canonicalRoomsSearch(currentSearch)) return null;
  return `${pathname}${search ? `?${search}` : ""}`;
}

/**
 * Where Rooms goes once Slack is disconnected, or null to stay put. All
 * channels stays open and returns to Scout's last room; Slack's own family has
 * nothing left to show, so it hands over to Scout's.
 */
export function roomsAfterSlackDisconnect(
  family: RoomFamily,
  source: RoomSource,
  lastScout: RoomSelection | undefined,
): { family: RoomFamily; source: RoomSource; selection: RoomSelection } | null {
  if (source !== "slack") return null;
  return {
    family: family === "all" ? "all" : "scout",
    source: "scout",
    selection: lastScout ?? { space: null, channelId: null },
  };
}

/**
 * The Connect Slack link, returning to the address the operator is on now
 * rather than to whatever address the status read happened to name.
 */
export function slackAuthorizationHref(authorizationUrl: string, returnTo: string): string {
  const url = new URL(authorizationUrl, "http://rooms.invalid");
  url.searchParams.set("next", returnTo);
  return url.origin === "http://rooms.invalid" ? `${url.pathname}${url.search}` : url.toString();
}

/**
 * The tab a key moves to in the Chats tablist: arrows wrap, Home and End jump
 * to the ends. Any other key, or a tab not in the list, moves nowhere.
 */
export function roomFamilyForKey<Tab extends string = RoomFamily>(
  order: readonly Tab[],
  current: Tab,
  key: string,
): Tab | null {
  const index = order.indexOf(current);
  if (index < 0 || order.length === 0) return null;
  const next = key === "ArrowRight" ? (index + 1) % order.length
    : key === "ArrowLeft" ? (index + order.length - 1) % order.length
      : key === "Home" ? 0
        : key === "End" ? order.length - 1 : null;
  return next === null ? null : order[next] ?? null;
}
