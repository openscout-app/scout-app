import { afterEach, describe, expect, test } from "bun:test";

import {
  chatSpacesMessage,
  nativeSpacesHost,
  parseNativeSpaceCommand,
  postToApp,
  resetNativeSpacesHost,
  takePendingNativeSpaceCommand,
} from "./native-spaces.ts";

const SPACES = [
  { slug: "home", title: "Home", conversationId: null, isDefault: true, channelCount: 3 },
  { slug: "design-review", title: "Design review", conversationId: null, isDefault: false },
];

function appWindow(search: string) {
  const posted: unknown[] = [];
  return {
    posted,
    win: {
      location: { search },
      webkit: { messageHandlers: { scoutNativeUI: { postMessage: (message: unknown) => posted.push(message) } } },
    } as {
      location: { search: string };
      webkit: { messageHandlers: { scoutNativeUI: { postMessage: (message: unknown) => void } } };
      __scoutPendingChatSpace?: unknown;
    },
  };
}

afterEach(() => resetNativeSpacesHost());

describe("the Mac app's spaces bridge", () => {
  test("runs only when the app opts in and its handler is there", () => {
    expect(nativeSpacesHost(appWindow("").win)).toBe(false);
    resetNativeSpacesHost();
    expect(nativeSpacesHost({ location: { search: "?nativeSpaces=1" } })).toBe(false);
    resetNativeSpacesHost();
    expect(nativeSpacesHost(appWindow("?nativeSpaces=1").win)).toBe(true);
  });

  test("the opt-in outlives the page rewriting its query string", () => {
    const { win } = appWindow("?nativeSpaces=1&channel=c1");
    expect(nativeSpacesHost(win)).toBe(true);
    win.location.search = "?channel=c2";
    expect(nativeSpacesHost(win)).toBe(true);
  });

  test("reports what the server answered, and nothing once signed out", () => {
    expect(chatSpacesMessage({ spaces: SPACES, current: "design-review", signedIn: true, canCreate: true })).toEqual({
      kind: "chat-spaces",
      current: "design-review",
      signedIn: true,
      canCreate: true,
      spaces: [
        { slug: "home", title: "Home", isDefault: true, channelCount: 3 },
        // No count from the server is no count, not zero.
        { slug: "design-review", title: "Design review", isDefault: false, channelCount: null },
      ],
    });
    expect(chatSpacesMessage({ spaces: SPACES, current: "home", signedIn: false, canCreate: true })).toEqual({
      kind: "chat-spaces", current: null, signedIn: false, canCreate: false, spaces: [],
    });
  });

  test("posts to the app only when it is listening", () => {
    const quiet = appWindow("");
    postToApp({ kind: "chat-spaces", current: null, signedIn: false, canCreate: false, spaces: [] }, quiet.win);
    expect(quiet.posted).toHaveLength(0);
    resetNativeSpacesHost();
    const app = appWindow("?nativeSpaces=1");
    postToApp({ kind: "chat-spaces", current: null, signedIn: false, canCreate: false, spaces: [] }, app.win);
    expect(app.posted).toHaveLength(1);
  });

  test("takes only well-formed commands", () => {
    expect(parseNativeSpaceCommand({ type: "select", slug: "design-review" })).toEqual({ type: "select", slug: "design-review" });
    expect(parseNativeSpaceCommand({ type: "select", slug: "../admin" })).toBeNull();
    expect(parseNativeSpaceCommand({ type: "select", slug: "Design" })).toBeNull();
    expect(parseNativeSpaceCommand({ type: "create", requestId: "r1", title: "  Acme  ", channel: " general " }))
      .toEqual({ type: "create", requestId: "r1", title: "Acme", channel: "general" });
    expect(parseNativeSpaceCommand({ type: "create", requestId: "r1", title: "   " })).toBeNull();
    expect(parseNativeSpaceCommand({ type: "create", requestId: "", title: "Acme" })).toBeNull();
    expect(parseNativeSpaceCommand({ type: "delete", slug: "home" })).toBeNull();
    expect(parseNativeSpaceCommand(null)).toBeNull();
  });

  test("a command sent before the page listened is taken once", () => {
    const { win } = appWindow("?nativeSpaces=1");
    win.__scoutPendingChatSpace = { type: "select", slug: "ops" };
    expect(takePendingNativeSpaceCommand(win)).toEqual({ type: "select", slug: "ops" });
    expect(takePendingNativeSpaceCommand(win)).toBeNull();
  });
});
