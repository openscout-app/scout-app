import { describe, expect, test } from "bun:test";
import {
  canonicalRoomsSearch,
  readRoomsLocation,
  roomFamilyForKey,
  roomsAfterSlackDisconnect,
  roomsLocationHref,
  roomsLocationSearch,
  slackAuthorizationHref,
} from "./rooms-navigation.ts";

describe("lists in the Chats address", () => {
  test("a list is All narrowed, so only All keeps it", () => {
    expect(readRoomsLocation("?source=all&provider=scout&list=l1").listId).toBe("l1");
    expect(readRoomsLocation("?list=l1").listId).toBeNull();
    expect(readRoomsLocation("?source=slack&list=l1").listId).toBeNull();
  });

  test("opening a room keeps the list; a tab or null leaves it", () => {
    const inList = "?source=all&provider=scout&list=l1";
    expect(roomsLocationSearch(inList, "all", "slack", { space: null, channelId: "C1" }))
      .toBe("source=all&provider=slack&list=l1&channel=C1");
    expect(roomsLocationSearch(inList, "all", "scout", { space: null, channelId: null, listId: null }))
      .toBe("source=all&provider=scout");
    expect(roomsLocationSearch(inList, "scout", "scout", { space: null, channelId: null })).toBe("");
    expect(roomsLocationSearch("?source=all&provider=scout", "all", "scout", { space: null, channelId: null, listId: "l2" }))
      .toBe("source=all&provider=scout&list=l2");
  });

  test("moving between lists is a new history entry; staying put is not", () => {
    const inList = "?source=all&provider=scout&list=l1";
    expect(roomsLocationHref("/rooms", inList, "all", "scout", { ...readRoomsLocation(inList) })).toBeNull();
    expect(roomsLocationHref("/rooms", inList, "all", "scout", { ...readRoomsLocation(inList), listId: "l2" }))
      .toBe("/rooms?source=all&provider=scout&list=l2");
  });

  test("arrow keys walk families and lists alike", () => {
    const order = ["all", "scout", "slack", "list:l1", "list:l2"];
    expect(roomFamilyForKey(order, "slack", "ArrowRight")).toBe("list:l1");
    expect(roomFamilyForKey(order, "list:l2", "ArrowRight")).toBe("all");
    expect(roomFamilyForKey(order, "all", "End")).toBe("list:l2");
  });
});

describe("Scout DMs in Chats", () => {
  test("a DM is its own key, in Scout's tab and inside All", () => {
    expect(readRoomsLocation("?dm=conv-1")).toEqual({
      family: "scout", source: "scout", space: null, channelId: null, directId: "conv-1", listId: null, messageId: null,
    });
    expect(readRoomsLocation("?source=all&provider=scout&dm=conv-1").directId).toBe("conv-1");
    expect(roomsLocationSearch("", "scout", "scout", { space: null, channelId: null, directId: "conv-1" })).toBe("dm=conv-1");
    expect(roomsLocationSearch("", "all", "scout", { space: null, channelId: null, directId: "conv-1" }))
      .toBe("source=all&provider=scout&dm=conv-1");
  });

  test("a DM replaces the room, and a room replaces the DM", () => {
    expect(roomsLocationSearch("?channel=chn-1&space=research&message=m-1", "scout", "scout", { space: "research", channelId: "chn-1", directId: "conv-1" }))
      .toBe("dm=conv-1");
    expect(roomsLocationSearch("?dm=conv-1", "scout", "scout", { space: null, channelId: "chn-1" })).toBe("channel=chn-1");
    // An address carrying both opens the DM.
    expect(readRoomsLocation("?dm=conv-1&channel=chn-1&space=research")).toMatchObject({ directId: "conv-1", channelId: null, space: null });
  });

  test("Slack never opens a Scout DM key", () => {
    expect(readRoomsLocation("?source=slack&dm=conv-1&channel=D1").directId).toBeNull();
    expect(readRoomsLocation("?source=all&provider=slack&dm=conv-1&channel=D1")).toMatchObject({ directId: null, channelId: "D1" });
    expect(roomsLocationSearch("?dm=conv-1", "slack", "slack", { space: null, channelId: "D1", directId: "conv-1" }))
      .toBe("source=slack&channel=D1");
  });

  test("opening the DM already open adds no history entry; Back from a DM to a room is a real move", () => {
    expect(roomsLocationHref("/rooms", "?dm=conv-1", "scout", "scout", { space: null, channelId: null, directId: "conv-1" })).toBeNull();
    expect(roomsLocationHref("/rooms", "?dm=conv-1", "scout", "scout", { space: null, channelId: "chn-1" })).toBe("/rooms?channel=chn-1");
    expect(canonicalRoomsSearch("?provider=scout&dm=conv-1&source=all")).toBe("dm=conv-1&provider=scout&source=all");
  });
});

describe("Rooms locations", () => {
  test("keeps the aggregate and its active provider in the URL", () => {
    const location = readRoomsLocation("?view=rooms&source=all&provider=slack&channel=C123");
    expect(location).toEqual({ family: "all", source: "slack", space: null, channelId: "C123", directId: null, listId: null, messageId: null });
    expect(roomsLocationSearch("?view=rooms&source=slack", "all", "slack", location)).toBe("view=rooms&source=all&provider=slack&channel=C123");
  });

  test("accepts existing Slack deep links", () => {
    expect(readRoomsLocation("?space=slack%3AT123&channel=C123").source).toBe("slack");
    expect(readRoomsLocation("?source=slack&channel=C123").family).toBe("slack");
  });

  test("keeps provider, space, and room together without carrying a thread across", () => {
    const search = roomsLocationSearch(
      "?view=rooms&source=all&provider=scout&space=research&channel=scout-room&message=M1",
      "all",
      "slack",
      { space: "slack:T123", channelId: "C123" },
    );
    const location = readRoomsLocation(search);
    expect(location).toEqual({ family: "all", source: "slack", space: "slack:T123", channelId: "C123", directId: null, listId: null, messageId: null });
    expect(location.channelId).not.toBe("scout-room");
  });

  test("omits default spaces and restores the original provider URL shape", () => {
    expect(roomsLocationSearch("", "scout", "scout", { space: "home", channelId: "chn-1" })).toBe("channel=chn-1");
    expect(roomsLocationSearch("", "slack", "slack", { space: "slack", channelId: "C1" })).toBe("source=slack&channel=C1");
  });

  test("choosing the place already open adds no history entry", () => {
    const here = "?source=slack&channel=C033DG5ME&space=slack%3AT033DG5M6";
    const selection = { space: "slack:T033DG5M6", channelId: "C033DG5ME" };
    expect(roomsLocationHref("/rooms", here, "slack", "slack", selection)).toBeNull();
    expect(roomsLocationHref("/rooms", "?channel=chn-1", "scout", "scout", { space: null, channelId: "chn-1" })).toBeNull();
    // A real move still gets its entry, and dropping a thread is a real move.
    expect(roomsLocationHref("/rooms", here, "all", "slack", selection))
      .toBe("/rooms?source=all&channel=C033DG5ME&space=slack%3AT033DG5M6&provider=slack");
    expect(roomsLocationHref("/rooms", "?channel=chn-1&message=m-1", "scout", "scout", { space: null, channelId: "chn-1" }))
      .toBe("/rooms?channel=chn-1");
    expect(roomsLocationHref("/rooms", "?channel=chn-1", "scout", "scout", { space: null, channelId: null })).toBe("/rooms");
  });

  test("equivalent addresses add no history entry, whatever their spelling or order", () => {
    const slack = { space: "slack:T033DG5M6", channelId: "C033DG5ME" };
    // The order the app itself produced in the browser, and its reverse.
    expect(roomsLocationHref("/rooms", "?source=all&channel=C033DG5ME&provider=slack&space=slack%3AT033DG5M6", "all", "slack", slack)).toBeNull();
    expect(roomsLocationHref("/rooms", "?space=slack%3AT033DG5M6&provider=slack&channel=C033DG5ME&source=all", "all", "slack", slack)).toBeNull();
    // `?source=all` leaves the provider implicit: it is already Scout.
    expect(roomsLocationHref("/rooms", "?source=all&channel=chn-1", "all", "scout", { space: null, channelId: "chn-1" })).toBeNull();
    // A default space written out is the default space.
    expect(roomsLocationHref("/rooms", "?space=home&channel=chn-1", "scout", "scout", { space: null, channelId: "chn-1" })).toBeNull();
    // Legacy Slack links are Slack's family.
    expect(roomsLocationHref("/rooms", "?space=slack%3AT1&channel=C1", "slack", "slack", { space: "slack:T1", channelId: "C1" })).toBeNull();
    // Unrelated parameters still count, and so does a different provider.
    expect(canonicalRoomsSearch("?b=2&a=1&channel=chn-1")).toBe(canonicalRoomsSearch("?a=1&channel=chn-1&b=2"));
    expect(canonicalRoomsSearch("?a=1&channel=chn-1")).not.toBe(canonicalRoomsSearch("?a=2&channel=chn-1"));
    expect(roomsLocationHref("/rooms", "?source=all&channel=C1", "all", "slack", { space: null, channelId: "C1" }))
      .toBe("/rooms?source=all&channel=C1&provider=slack");
  });

  test("disconnecting Slack keeps All channels open on Scout's own last room", () => {
    const scout = { space: "review-b", channelId: "chn-b" };
    expect(roomsAfterSlackDisconnect("all", "slack", scout)).toEqual({ family: "all", source: "scout", selection: scout });
    expect(roomsAfterSlackDisconnect("slack", "slack", undefined))
      .toEqual({ family: "scout", source: "scout", selection: { space: null, channelId: null } });
    expect(roomsAfterSlackDisconnect("all", "scout", scout)).toBeNull();
    expect(roomsAfterSlackDisconnect("scout", "scout", scout)).toBeNull();
  });

  test("Connect Slack returns to the address the operator is on", () => {
    const here = "/rooms?source=all&provider=slack&channel=C1";
    expect(slackAuthorizationHref("/api/slack/client/oauth/authorize?next=%2Frooms%3Fsource%3Dslack", here))
      .toBe(`/api/slack/client/oauth/authorize?next=${encodeURIComponent(here)}`);
    expect(slackAuthorizationHref("https://scout.example/api/slack/client/oauth/authorize", here))
      .toBe(`https://scout.example/api/slack/client/oauth/authorize?next=${encodeURIComponent(here)}`);
  });
});

describe("Chats tab keys", () => {
  const order = ["all", "scout", "slack"] as const;

  test("arrows wrap through the tabs", () => {
    expect(roomFamilyForKey(order, "all", "ArrowRight")).toBe("scout");
    expect(roomFamilyForKey(order, "slack", "ArrowRight")).toBe("all");
    expect(roomFamilyForKey(order, "all", "ArrowLeft")).toBe("slack");
  });

  test("Home and End jump to the ends", () => {
    expect(roomFamilyForKey(order, "scout", "Home")).toBe("all");
    expect(roomFamilyForKey(order, "scout", "End")).toBe("slack");
  });

  test("other keys move nowhere", () => {
    expect(roomFamilyForKey(order, "scout", "Enter")).toBeNull();
    expect(roomFamilyForKey(order, "scout", "ArrowDown")).toBeNull();
  });
});

describe("Vercel in Chats", () => {
  test("Vercel is its own tab, carried by Scout's transport", () => {
    expect(readRoomsLocation("?source=vercel&channel=chn-board")).toEqual({
      family: "vercel", source: "scout", space: null, channelId: "chn-board", directId: null, listId: null, messageId: null,
    });
    expect(roomsLocationSearch("", "vercel", "scout", { space: null, channelId: "chn-board" })).toBe("source=vercel&channel=chn-board");
  });

  test("moving between Scout and Vercel changes the address, even on the same room", () => {
    expect(roomsLocationSearch("?source=vercel&channel=chn-1", "scout", "scout", { space: null, channelId: "chn-1" })).toBe("channel=chn-1");
    expect(roomsLocationHref("/rooms", "?channel=chn-1", "vercel", "scout", { space: null, channelId: "chn-1" })).toBe("/rooms?channel=chn-1&source=vercel");
    expect(canonicalRoomsSearch("?channel=chn-1&source=vercel")).toBe("channel=chn-1&source=vercel");
  });

  test("Slack going away leaves Vercel where it is", () => {
    expect(roomsAfterSlackDisconnect("vercel", "scout", undefined)).toBeNull();
  });
});
