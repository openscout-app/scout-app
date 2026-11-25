import { describe, expect, test } from "bun:test";
import { scoutbotPageForRoute } from "./scoutbot-navigation.ts";

describe("scoutbotPageForRoute", () => {
  test("names a destination page by its product label, never the view name", () => {
    expect(scoutbotPageForRoute({ view: "inbox" })).toEqual({ label: "Home" });
    expect(scoutbotPageForRoute({ view: "broker" })).toEqual({ label: "Dispatch" });
    expect(scoutbotPageForRoute({ view: "agents-v2" })).toEqual({ label: "Projects" });
  });

  test("reads an ops route without a mode as Operations, and other modes by name", () => {
    expect(scoutbotPageForRoute({ view: "ops" })).toEqual({ label: "Operations" });
    expect(scoutbotPageForRoute({ view: "ops", mode: "world" })).toEqual({ label: "World" });
    expect(scoutbotPageForRoute({ view: "ops", mode: "tail" })).toEqual({ label: "Tail" });
  });

  test("carries the records open on the page", () => {
    expect(scoutbotPageForRoute({ view: "sessions", sessionId: "sess-1", agentId: " einstein-13 " })).toEqual({
      label: "Sessions",
      open: { sessionId: "sess-1", agentId: "einstein-13" },
    });
    expect(scoutbotPageForRoute({ view: "conversation", conversationId: "dm-1", composeDraft: "hello" })).toEqual({
      label: "Messages",
      open: { conversationId: "dm-1" },
    });
  });

  test("drops empty and non-string fields", () => {
    expect(scoutbotPageForRoute({ view: "code", line: 12, path: "", project: "scout" })).toEqual({
      label: "Code Browser",
      open: { project: "scout" },
    });
  });

  test("returns null for a route that is not a page", () => {
    expect(scoutbotPageForRoute(undefined)).toBeNull();
    expect(scoutbotPageForRoute("inbox")).toBeNull();
    expect(scoutbotPageForRoute({ view: "admin" })).toBeNull();
  });

  test("on macOS names only the native shell's pages", () => {
    expect(scoutbotPageForRoute({ view: "messages" }, "macos")).toEqual({ label: "Comms" });
    expect(scoutbotPageForRoute({ view: "ops", mode: "lanes" }, "macos")).toEqual({ label: "Agent Lanes" });
    expect(scoutbotPageForRoute({ view: "search" }, "macos")).toBeNull();
    expect(scoutbotPageForRoute({ view: "inbox" }, "macos")).toBeNull();
  });
});
