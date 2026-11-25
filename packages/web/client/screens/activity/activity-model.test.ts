import { describe, expect, test } from "bun:test";
import type { ActivityItem } from "../../lib/types.ts";
import {
  activityCategory,
  activityFacts,
  activityHasTerminal,
  activityJumps,
  activityStampLabel,
  activitySummary,
  activitySyncNote,
  activityTitle,
  actorInitial,
  isActivityCategory,
  kindLabel,
  pathLeaf,
  shortId,
  visibleActivity,
} from "./activity-model.ts";

const NOW = 1_700_000_000_000;

const item = (over: Partial<ActivityItem>): ActivityItem => ({
  id: "act-1",
  kind: "message_sent",
  ts: NOW - 60_000,
  actorName: "Hudson",
  title: null,
  summary: null,
  conversationId: null,
  workspaceRoot: null,
  agentId: null,
  agentName: null,
  flightId: null,
  invocationId: null,
  sessionId: null,
  messageId: null,
  recordId: null,
  ...over,
});

describe("labels", () => {
  test("known kinds read as verbs; others lose their dots and underscores", () => {
    expect(kindLabel("agent.online")).toBe("came online");
    expect(kindLabel("ask_sent")).toBe("sent a request");
    expect(kindLabel("broker.peer_joined")).toBe("broker peer joined");
  });

  test("the page's five groups, by kind", () => {
    expect(activityCategory("agent.registered")).toBe("presence");
    expect(activityCategory("node_online")).toBe("presence");
    expect(activityCategory("flight_created")).toBe("work");
    expect(activityCategory("ask_working")).toBe("work");
    expect(activityCategory("message.sent")).toBe("message");
    expect(activityCategory("collaboration.ask")).toBe("collaboration");
    expect(activityCategory("broker.restart")).toBe("system");
    expect(isActivityCategory("work")).toBe(true);
    expect(isActivityCategory("")).toBe(false);
    expect(isActivityCategory("bogus")).toBe(false);
  });

  test("short ids, path leaves and initials as the page drew them", () => {
    expect(shortId("abc")).toBe("abc");
    expect(shortId("conversation-123456789")).toBe("conversa...6789");
    expect(pathLeaf("/example/workstation-user/dev/openscout/")).toBe("openscout");
    expect(pathLeaf(null)).toBeNull();
    expect(actorInitial(null)).toBe("S");
    expect(actorInitial("hudson")).toBe("H");
  });
});

describe("one record's text", () => {
  test("the title, else who did what", () => {
    expect(activityTitle(item({ title: "Shipped it" }))).toBe("Shipped it");
    expect(activityTitle(item({ kind: "agent.online" }))).toBe("Hudson came online");
    expect(activityTitle(item({ actorName: null, kind: "agent.offline" }))).toBe("system went offline");
  });

  test("the summary only when it says more than the title", () => {
    expect(activitySummary(item({ title: "A", summary: "B" }))).toBe("B");
    expect(activitySummary(item({ title: "A", summary: "A", workspaceRoot: "/w/pomo" }))).toBeNull();
    expect(activitySummary(item({ conversationId: "conversation-123456789" }))).toBeNull();
    expect(activitySummary(item({}))).toBeNull();
    // a title cut from the summary is not said twice
    expect(activitySummary(item({ title: "Approved, no findings at…", summary: "Approved, no findings at the pushed head." }))).toBeNull();
  });
});

describe("which records show", () => {
  const rows = [
    item({ id: "old", ts: NOW - 300_000, agentId: "a1", workspaceRoot: "/w/pomo" }),
    item({ id: "verdict", kind: "flight.completed", ts: NOW - 10_000, agentId: "a1" }),
    item({ id: "new", kind: "flight_created", ts: NOW - 5_000, agentId: "a2", workspaceRoot: "/w/talkie" }),
    item({ id: "other", kind: "agent.online", ts: NOW - 20_000, agentId: "a3", workspaceRoot: "/w/pomo" }),
  ];

  test("newest first, harness verdicts left out", () => {
    expect(visibleActivity(rows, { agentIds: null }).map((row) => row.id)).toEqual(["new", "other", "old"]);
  });

  test("the page's machine narrows by agent", () => {
    expect(visibleActivity(rows, { agentIds: new Set(["a1", "a3"]) }).map((row) => row.id)).toEqual(["other", "old"]);
  });

  test("a panel's project and group narrow further", () => {
    expect(visibleActivity(rows, { agentIds: null, project: "/w/pomo" }).map((row) => row.id)).toEqual(["other", "old"]);
    expect(visibleActivity(rows, { agentIds: null, category: "work" }).map((row) => row.id)).toEqual(["new"]);
    expect(visibleActivity(rows, { agentIds: null, project: "/w/pomo", category: "presence" }).map((row) => row.id)).toEqual(["other"]);
    // an unknown group is no filter
    expect(visibleActivity(rows, { agentIds: null, category: "bogus" })).toHaveLength(3);
  });

  test("it never reorders the list it was given", () => {
    const copy = [...rows];
    visibleActivity(rows, { agentIds: null });
    expect(rows).toEqual(copy);
  });
});

describe("where a record goes", () => {
  test("thread, work, agent, session, follow, in the page's order", () => {
    const jumps = activityJumps(
      item({
        conversationId: "c1",
        recordId: "w1",
        agentId: "a1",
        agentName: "Hudson",
        sessionId: "s1",
        flightId: "f1",
      }),
    );
    expect(jumps.map((jump) => jump.label)).toEqual(["Thread", "Work", "Hudson", "Session", "Follow"]);
    expect(jumps.map((jump) => jump.route)).toEqual([
      { view: "conversation", conversationId: "c1" },
      { view: "work", workId: "w1" },
      { view: "agents-v2", agentId: "a1" },
      { view: "sessions", sessionId: "s1" },
      { view: "follow", flightId: "f1", conversationId: "c1" },
    ]);
  });

  test("an unnamed agent reads Agent; nothing to link, nothing shown", () => {
    expect(activityJumps(item({ agentId: "a1" }))[0]!.label).toBe("Agent");
    expect(activityJumps(item({}))).toEqual([]);
  });

  test("a terminal is reachable from an agent or a session", () => {
    expect(activityHasTerminal(item({ agentId: "a1" }))).toBe(true);
    expect(activityHasTerminal(item({ sessionId: "s1" }))).toBe(true);
    expect(activityHasTerminal(item({ conversationId: "c1" }))).toBe(false);
  });
});

describe("its details", () => {
  test("every id it carries, in the page's order", () => {
    const facts = activityFacts(
      item({ id: "act-9", agentName: "Hudson", conversationId: "c1", sessionId: "session-1234567890" }),
      () => "Oct 14",
    );
    expect(facts.map((fact) => fact.label)).toEqual(["Event", "Recorded", "Actor", "Agent", "Workspace", "Thread", "Session", "Record id"]);
    expect(facts.find((fact) => fact.label === "Workspace")!.value).toBe("Not attached");
    expect(facts.find((fact) => fact.label === "Session")!.value).toBe("session-...7890");
    expect(facts.filter((fact) => fact.code).map((fact) => fact.label)).toEqual(["Event", "Record id"]);
  });
});

describe("the sync line", () => {
  test("reading, updated, or the snapshot kept through a failed refresh", () => {
    expect(activitySyncNote({ loading: true, error: null, shown: false, loadedAt: null }, NOW)).toBe("Loading audit ledger...");
    expect(activitySyncNote({ loading: false, error: null, shown: true, loadedAt: NOW - 60_000 }, NOW)).toBe("Updated 1m");
    expect(activitySyncNote({ loading: false, error: "down", shown: true, loadedAt: NOW - 120_000 }, NOW)).toBe(
      "Showing last confirmed snapshot from 2m",
    );
    expect(activitySyncNote({ loading: false, error: "down", shown: true, loadedAt: null }, NOW)).toBe(
      "Showing last confirmed snapshot from earlier",
    );
    expect(activitySyncNote({ loading: false, error: null, shown: false, loadedAt: null }, NOW)).toBe("Waiting for first snapshot");
  });
});

describe("activityStampLabel", () => {
  test("today reads as a clock, an older day as its date, never the full timestamp", () => {
    const now = new Date(2026, 10, 13, 15, 0, 0).getTime();
    const today = activityStampLabel(new Date(2026, 10, 13, 0, 53, 8).getTime(), now);
    expect(today).toMatch(/^\d{2}:53:08$/);
    const older = activityStampLabel(new Date(2026, 10, 12, 23, 0, 0).getTime(), now);
    expect(older).toContain("12");
    expect(older).not.toContain("2026");
    expect(activityStampLabel(null, now)).toBe("");
  });
});
