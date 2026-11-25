/**
 * Lists in Chats: named sets of conversations the operator picks by hand.
 *
 * A list holds member keys, not conversations. The rows still come from the
 * provider catalogs and the runtime's conversation list, so a list never
 * invents a row and never copies a record; a member whose conversation is not
 * in any catalog right now is simply not drawn.
 *
 * Every member records who added it. Today that is always the operator; the
 * field is there so an agent following a rule can add members later without a
 * change to the stored shape.
 *
 * Saved in this browser profile (localStorage), like the Messages pins.
 */

import { useSyncExternalStore } from "react";
import type { RoomsCatalog } from "./rooms-catalog.ts";
import type { RoomsDirect } from "./rooms-directs.ts";
import type { RoomSource } from "./rooms-navigation.ts";

const STORAGE_KEY = "scout:chats:lists:v1";

/** Who put a conversation in a list: "operator", or an agent's id. */
export type ChatsListAddedBy = string;

export interface ChatsListMember {
  key: string;
  addedAt: number;
  addedBy: ChatsListAddedBy;
}

export interface ChatsList {
  id: string;
  name: string;
  createdAt: number;
  members: ChatsListMember[];
}

export interface ChatsListsState {
  lists: ChatsList[];
}

export const OPERATOR: ChatsListAddedBy = "operator";

/** The member key for a room in a provider catalog. */
export function roomMemberKey(source: RoomSource, space: string, conversationId: string): string {
  return `room:${source}:${space}:${conversationId}`;
}

/** The member key for a Scout direct conversation. */
export function directMemberKey(conversationId: string): string {
  return `dm:${conversationId}`;
}

export function emptyChatsLists(): ChatsListsState {
  return { lists: [] };
}

/** A name that is safe to show and store: trimmed, one line, not empty. */
export function normalizeListName(name: string): string | null {
  const value = name.replace(/\s+/gu, " ").trim().slice(0, 60);
  return value ? value : null;
}

export function createList(
  state: ChatsListsState,
  name: string,
  options: { id?: string; at?: number; members?: string[]; addedBy?: ChatsListAddedBy } = {},
): { state: ChatsListsState; list: ChatsList | null } {
  const clean = normalizeListName(name);
  if (!clean) return { state, list: null };
  const at = options.at ?? Date.now();
  const list: ChatsList = {
    id: options.id ?? newListId(state),
    name: clean,
    createdAt: at,
    members: [...new Set(options.members ?? [])].map((key) => ({ key, addedAt: at, addedBy: options.addedBy ?? OPERATOR })),
  };
  return { state: { lists: [...state.lists, list] }, list };
}

export function renameList(state: ChatsListsState, listId: string, name: string): ChatsListsState {
  const clean = normalizeListName(name);
  if (!clean) return state;
  return { lists: state.lists.map((list) => list.id === listId ? { ...list, name: clean } : list) };
}

export function deleteList(state: ChatsListsState, listId: string): ChatsListsState {
  return { lists: state.lists.filter((list) => list.id !== listId) };
}

export function addToList(
  state: ChatsListsState,
  listId: string,
  key: string,
  options: { at?: number; addedBy?: ChatsListAddedBy } = {},
): ChatsListsState {
  return {
    lists: state.lists.map((list) => {
      if (list.id !== listId || list.members.some((member) => member.key === key)) return list;
      return { ...list, members: [...list.members, { key, addedAt: options.at ?? Date.now(), addedBy: options.addedBy ?? OPERATOR }] };
    }),
  };
}

export function removeFromList(state: ChatsListsState, listId: string, key: string): ChatsListsState {
  return {
    lists: state.lists.map((list) => list.id === listId
      ? { ...list, members: list.members.filter((member) => member.key !== key) }
      : list),
  };
}

export function listHas(list: ChatsList, key: string): boolean {
  return list.members.some((member) => member.key === key);
}

/**
 * The catalog and DMs a list shows: the same places and spaces, holding only
 * the list's members. `missing` counts members not in the catalog right now
 * (a disconnected Slack, a removed room), so the list can say so.
 */
export function narrowToList(
  list: ChatsList,
  places: readonly RoomsCatalog[],
  directs: readonly RoomsDirect[],
): { places: RoomsCatalog[]; directs: RoomsDirect[]; missing: number } {
  const keys = new Set(list.members.map((member) => member.key));
  const found = new Set<string>();
  const narrowed = places.map((place) => ({
    ...place,
    spaces: place.spaces.map((space) => ({
      ...space,
      conversations: space.conversations.filter((conversation) => {
        const key = roomMemberKey(place.source, space.id, conversation.id);
        if (!keys.has(key)) return false;
        found.add(key);
        return true;
      }),
    })),
  }));
  const shownDirects = directs.filter((direct) => {
    const key = directMemberKey(direct.id);
    if (!keys.has(key)) return false;
    found.add(key);
    return true;
  });
  return { places: narrowed, directs: shownDirects, missing: keys.size - found.size };
}

function newListId(state: ChatsListsState): string {
  const taken = new Set(state.lists.map((list) => list.id));
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8);
    if (id && !taken.has(id)) return id;
  }
}

/* ── storage ─────────────────────────────────────────────────────────────── */

export function parseChatsLists(raw: string | null): ChatsListsState {
  if (!raw) return emptyChatsLists();
  try {
    const parsed = JSON.parse(raw) as { lists?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.lists)) return emptyChatsLists();
    const lists: ChatsList[] = [];
    const ids = new Set<string>();
    for (const entry of parsed.lists) {
      if (!entry || typeof entry !== "object") continue;
      const value = entry as Record<string, unknown>;
      const name = typeof value.name === "string" ? normalizeListName(value.name) : null;
      if (typeof value.id !== "string" || !value.id || ids.has(value.id) || !name) continue;
      ids.add(value.id);
      const seen = new Set<string>();
      const members = Array.isArray(value.members) ? value.members.flatMap((member): ChatsListMember[] => {
        if (!member || typeof member !== "object") return [];
        const item = member as Record<string, unknown>;
        if (typeof item.key !== "string" || !item.key || seen.has(item.key)) return [];
        seen.add(item.key);
        return [{
          key: item.key,
          addedAt: typeof item.addedAt === "number" && Number.isFinite(item.addedAt) ? item.addedAt : 0,
          addedBy: typeof item.addedBy === "string" && item.addedBy ? item.addedBy : OPERATOR,
        }];
      }) : [];
      lists.push({
        id: value.id,
        name,
        createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : 0,
        members,
      });
    }
    return { lists };
  } catch {
    return emptyChatsLists();
  }
}

let memory: ChatsListsState | null = null;
const listeners = new Set<() => void>();

function readStored(): ChatsListsState {
  try {
    if (typeof localStorage !== "undefined") return parseChatsLists(localStorage.getItem(STORAGE_KEY));
  } catch {
    // Storage blocked: the in-memory copy holds the lists for this session.
  }
  return emptyChatsLists();
}

export function loadChatsLists(): ChatsListsState {
  if (!memory) memory = readStored();
  return memory;
}

export function saveChatsLists(next: ChatsListsState): ChatsListsState {
  memory = next;
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota or disabled storage: memory still holds it for the session.
  }
  for (const listener of listeners) listener();
  return next;
}

/** Apply a change to the saved lists and tell every reader. */
export function updateChatsLists(change: (state: ChatsListsState) => ChatsListsState): ChatsListsState {
  const current = loadChatsLists();
  const next = change(current);
  return next === current ? current : saveChatsLists(next);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of this profile changed the lists.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    memory = parseChatsLists(event.newValue);
    listener();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function useChatsLists(): ChatsListsState {
  return useSyncExternalStore(subscribe, loadChatsLists, loadChatsLists);
}

/* ── naming a new list ───────────────────────────────────────────────────── */

/**
 * A new list being named in the tab band. A row's menu can start one with
 * that row as its first member; the band draws the name field.
 */
export interface ChatsListDraft {
  firstMember: string | null;
}

let draft: ChatsListDraft | null = null;
const draftListeners = new Set<() => void>();

export function startListDraft(firstMember: string | null = null): void {
  draft = { firstMember };
  for (const listener of draftListeners) listener();
}

export function endListDraft(): void {
  if (!draft) return;
  draft = null;
  for (const listener of draftListeners) listener();
}

export function useChatsListDraft(): ChatsListDraft | null {
  return useSyncExternalStore(
    (listener) => { draftListeners.add(listener); return () => { draftListeners.delete(listener); }; },
    () => draft,
    () => draft,
  );
}

export const __test = {
  STORAGE_KEY,
  reset() {
    memory = null;
    draft = null;
  },
};
