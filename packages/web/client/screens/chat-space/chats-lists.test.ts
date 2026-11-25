import { beforeEach, describe, expect, test } from "bun:test";
import type { ConversationDefinition } from "@openscout/protocol";
import {
  __test,
  addToList,
  createList,
  deleteList,
  directMemberKey,
  emptyChatsLists,
  loadChatsLists,
  narrowToList,
  normalizeListName,
  OPERATOR,
  parseChatsLists,
  removeFromList,
  renameList,
  roomMemberKey,
  saveChatsLists,
  updateChatsLists,
} from "./chats-lists.ts";
import { listMenuItems } from "./RoomsAggregateSidebar.tsx";
import type { RoomsCatalog } from "./rooms-catalog.ts";
import type { RoomsDirect } from "./rooms-directs.ts";

function channel(id: string): ConversationDefinition {
  return { id, kind: "channel", title: `#${id}`, visibility: "workspace", shareMode: "local", authorityNodeId: "node", participantIds: [] } as ConversationDefinition;
}

function direct(id: string): RoomsDirect {
  return { id, title: id, provider: "scout", hostId: null, hostName: null, kind: "direct", participantIds: [], lastMessageAt: null };
}

const catalog: RoomsCatalog[] = [
  { source: "scout", name: "Scout", spaces: [{ id: "home", title: "Home", conversations: [channel("release"), channel("design")], lastMessages: {} }] },
  { source: "slack", name: "Acme", spaces: [{ id: "slack", title: "Slack", conversations: [channel("C1"), channel("C2")], lastMessages: {} }] },
];

beforeEach(() => __test.reset());

describe("lists in Chats", () => {
  test("a list is made with a clean name, and refuses an empty one", () => {
    expect(normalizeListName("  Release \n work  ")).toBe("Release work");
    expect(normalizeListName("   ")).toBeNull();
    const empty = createList(emptyChatsLists(), "  ");
    expect(empty.list).toBeNull();
    expect(empty.state.lists).toHaveLength(0);
    const made = createList(emptyChatsLists(), "Release", { id: "l1", at: 5, members: ["dm:a", "dm:a"] });
    expect(made.list).toEqual({ id: "l1", name: "Release", createdAt: 5, members: [{ key: "dm:a", addedAt: 5, addedBy: OPERATOR }] });
  });

  test("members are added once, removed, and say who added them", () => {
    let state = createList(emptyChatsLists(), "Release", { id: "l1" }).state;
    state = addToList(state, "l1", "room:scout:home:release", { at: 1 });
    state = addToList(state, "l1", "room:scout:home:release", { at: 2 });
    state = addToList(state, "l1", "dm:conv-1", { at: 3, addedBy: "agent:triage" });
    expect(state.lists[0].members).toEqual([
      { key: "room:scout:home:release", addedAt: 1, addedBy: OPERATOR },
      { key: "dm:conv-1", addedAt: 3, addedBy: "agent:triage" },
    ]);
    state = removeFromList(state, "l1", "room:scout:home:release");
    expect(state.lists[0].members.map((member) => member.key)).toEqual(["dm:conv-1"]);
  });

  test("rename keeps the members; delete removes only the list", () => {
    let state = createList(emptyChatsLists(), "Release", { id: "l1", members: ["dm:a"] }).state;
    state = createList(state, "Design", { id: "l2" }).state;
    state = renameList(state, "l1", "Ship");
    expect(state.lists[0]).toMatchObject({ name: "Ship", members: [{ key: "dm:a" }] });
    expect(renameList(state, "l1", " ")).toBe(state);
    expect(deleteList(state, "l1").lists.map((list) => list.id)).toEqual(["l2"]);
  });

  test("a list narrows All to its members and counts the ones not there now", () => {
    const list = createList(emptyChatsLists(), "Release", {
      id: "l1",
      members: [roomMemberKey("scout", "home", "release"), roomMemberKey("slack", "slack", "C2"), directMemberKey("conv-1"), roomMemberKey("slack", "slack", "gone")],
    }).list!;
    const narrowed = narrowToList(list, catalog, [direct("conv-1"), direct("conv-2")]);
    expect(narrowed.places.map((place) => place.spaces[0].conversations.map((item) => item.id))).toEqual([["release"], ["C2"]]);
    expect(narrowed.directs.map((item) => item.id)).toEqual(["conv-1"]);
    expect(narrowed.missing).toBe(1);
  });

  test("the same room id in another space is another member", () => {
    const list = createList(emptyChatsLists(), "Home only", { id: "l1", members: [roomMemberKey("scout", "research", "release")] }).list!;
    expect(narrowToList(list, catalog, []).places[0].spaces[0].conversations).toHaveLength(0);
  });

  test("stored lists survive bad entries without losing good ones", () => {
    const parsed = parseChatsLists(JSON.stringify({
      lists: [
        { id: "l1", name: "Release", createdAt: 1, members: [{ key: "dm:a", addedAt: 2 }, { key: "dm:a" }, { nope: 1 }] },
        { id: "l1", name: "Duplicate id" },
        { id: "l2", name: "   " },
        "junk",
      ],
    }));
    expect(parsed.lists).toEqual([{ id: "l1", name: "Release", createdAt: 1, members: [{ key: "dm:a", addedAt: 2, addedBy: OPERATOR }] }]);
    expect(parseChatsLists("{not json")).toEqual(emptyChatsLists());
    expect(parseChatsLists(null)).toEqual(emptyChatsLists());
  });

  test("saved lists round-trip through storage", () => {
    const store = new Map<string, string>();
    const previous = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    };
    try {
      const state = createList(emptyChatsLists(), "Release", { id: "l1", at: 1, members: ["dm:a"] }).state;
      saveChatsLists(state);
      expect(store.has(__test.STORAGE_KEY)).toBe(true);
      __test.reset();
      expect(loadChatsLists()).toEqual(state);
      const next = updateChatsLists((current) => addToList(current, "l1", "dm:b", { at: 2 }));
      expect(next.lists[0].members).toHaveLength(2);
      expect(updateChatsLists((current) => current)).toBe(next);
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = previous;
    }
  });

  test("a row's menu adds to or removes from each list, then offers a new one", () => {
    const state = createList(createList(emptyChatsLists(), "Release", { id: "l1", members: ["dm:a"] }).state, "Design", { id: "l2" }).state;
    const labels = listMenuItems(state.lists, "dm:a").map((item) => item.kind === "action" ? item.label : "—");
    expect(labels).toEqual(["Remove from Release", "Add to Design", "—", "New list with this conversation…"]);
    expect(listMenuItems([], "dm:a").map((item) => item.kind === "action" ? item.label : "—")).toEqual(["New list with this conversation…"]);
  });
});
