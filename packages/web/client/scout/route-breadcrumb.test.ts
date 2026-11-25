import { describe, expect, test } from "bun:test";
import { ROUTE_VIEW_LABELS, routeBreadcrumbForRoute } from "./route-breadcrumb.ts";

describe("route breadcrumbs (SCO-083)", () => {
  test("skips top-level primary destinations", () => {
    expect(routeBreadcrumbForRoute({ view: "inbox" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "agents-v2" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "messages" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "search" })).toBeNull();
    expect(routeBreadcrumbForRoute({ view: "broker" })).toBeNull();
    // Sessions is its own area; the slot toolbar owns its heading.
    expect(routeBreadcrumbForRoute({ view: "sessions" })).toBeNull();
  });

  test("uses agent-first labels for Agents workspace routes", () => {
    expect(ROUTE_VIEW_LABELS["agents-v2"]).toBe("Agents");
    expect(ROUTE_VIEW_LABELS.code).toBe("Files");
    expect(ROUTE_VIEW_LABELS.repos).toBe("Repos");
  });

  test("labels rooms and direct messages as Chat", () => {
    expect(ROUTE_VIEW_LABELS.inbox).toBe("Feed");
    expect(ROUTE_VIEW_LABELS.rooms).toBe("Chat");
    expect(ROUTE_VIEW_LABELS.messages).toBe("Chat");
    expect(routeBreadcrumbForRoute({ view: "rooms" })).toBe("Chat");
  });

  test("labels detail and ops surfaces", () => {
    expect(routeBreadcrumbForRoute({ view: "conversation", conversationId: "c1" })).toBe(
      "Conversation",
    );
    expect(routeBreadcrumbForRoute({ view: "settings", section: "agents" })).toBe(
      "Agent Configuration",
    );
    expect(routeBreadcrumbForRoute({ view: "settings" })).toBe("Settings");
    expect(routeBreadcrumbForRoute({ view: "work", workId: "", board: true })).toBe("Board");
    expect(routeBreadcrumbForRoute({ view: "agents-v2", indexView: "projects" })).toBe("Projects");
    expect(routeBreadcrumbForRoute({ view: "terminal" })).toBe("Terminals");
    expect(routeBreadcrumbForRoute({ view: "mesh" })).toBe("Hosts");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "issues" })).toBe("Tail");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "atop" })).toBe("Processes");
    expect(routeBreadcrumbForRoute({ view: "ops" })).toBe("Control");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "tail" })).toBe("Tail");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "lanes" })).toBe("Lanes");
    expect(routeBreadcrumbForRoute({ view: "ops", mode: "world" })).toBe("Network");
    expect(routeBreadcrumbForRoute({ view: "repos" })).toBe("Repos");
    expect(routeBreadcrumbForRoute({ view: "code" })).toBe("Files");
    expect(routeBreadcrumbForRoute({ view: "repo-diff", path: "/tmp/x" })).toBe("Diff");
  });

  test("exposes labels for all primary-area views", () => {
    for (const view of [
      "inbox",
      "activity",
      "briefings",
      "agents-v2",
      "agent-info",
      "repos",
      "repo-diff",
      "code",
      "sessions",
      "terminal",
      "messages",
      "conversation",
      "broker",
      "work",
      "follow",
      "search",
      "ops",
      "mesh",
      "harnesses",
      "settings",
    ] as const) {
      expect(ROUTE_VIEW_LABELS[view]).toBeTruthy();
    }
  });
});
