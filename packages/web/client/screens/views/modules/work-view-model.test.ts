import { describe, expect, test } from "bun:test";
import type { Route, WorkDetail, WorkItem } from "../../../lib/types.ts";
import {
  filterWorkByAgents,
  flightDelivery,
  offersOpenFull,
  pageWorkId,
  panelWork,
  workCaseFacts,
  workChildRows,
  workFlightRows,
  workListPath,
  workListRows,
  workOptions,
  sessionOwnerLabel,
  workOwnerLabel,
  workParticipants,
  workRowMark,
} from "./work-view-model.ts";

describe("sessionOwnerLabel", () => {
  test("a generated name reads as its harness; a real name stays", () => {
    expect(sessionOwnerLabel("Session Mwdrjdwj 7m6eee", "claude")).toBe("Claude session");
    expect(sessionOwnerLabel("Session Mwdrjdwj 7m6eee", null)).toBe("Session");
    expect(sessionOwnerLabel("demo-app-bach-9", "claude")).toBe("demo-app-bach-9");
  });
});

describe("workOwnerLabel", () => {
  const harnessOf = (id: string) => (id === "a1" ? "claude" : undefined);
  const owner = (fields: Partial<Pick<WorkItem, "ownerId" | "ownerName" | "nextMoveOwnerId" | "nextMoveOwnerName">>) =>
    ({ ownerId: null, ownerName: null, nextMoveOwnerId: null, nextMoveOwnerName: null, ...fields }) as Pick<WorkItem, "ownerId" | "ownerName" | "nextMoveOwnerId" | "nextMoveOwnerName">;

  test("keeps a chosen name, the next move's owner first", () => {
    expect(workOwnerLabel(owner({ ownerName: "arc-dickens-4" }), harnessOf)).toBe("arc-dickens-4");
    expect(workOwnerLabel(owner({ ownerName: "a", nextMoveOwnerName: "Arach" }), harnessOf)).toBe("Arach");
  });

  test("names a generated session by its harness", () => {
    expect(workOwnerLabel(owner({ ownerId: "a1", ownerName: "Session Mwfxl324 Wqoium" }), harnessOf)).toBe("Claude session");
    expect(workOwnerLabel(owner({ ownerId: "zz", ownerName: "Session Mwfxl324 Wqoium" }), harnessOf)).toBe("Session");
  });
});

const item = (over: Partial<WorkItem>): WorkItem => ({
  id: "w1",
  title: "Port the Work view",
  summary: null,
  ownerId: "agent-a",
  ownerName: "Ada",
  nextMoveOwnerId: "agent-a",
  nextMoveOwnerName: "Ada",
  conversationId: "c1",
  createdAt: 1_000,
  updatedAt: 2_000,
  parentId: null,
  parentTitle: null,
  state: "working",
  acceptanceState: "none",
  priority: null,
  currentPhase: "Working",
  attention: "silent",
  activeChildWorkCount: 0,
  activeFlightCount: 1,
  lastMeaningfulAt: 2_000,
  lastMeaningfulSummary: null,
  ...over,
});

type Flight = WorkDetail["allFlights"][number];
const flight = (over: Partial<Flight>): Flight => ({
  id: "f1",
  invocationId: "i1",
  agentId: "agent-a",
  agentName: "Ada",
  conversationId: "c1",
  collaborationRecordId: null,
  state: "running",
  summary: null,
  startedAt: 1_500,
  completedAt: null,
  sessions: [],
  ...over,
});

const detail = (over: Partial<WorkDetail>): WorkDetail => ({
  ...item({}),
  childWork: [],
  activeFlights: [],
  timeline: [],
  primaryInvocation: null,
  allFlights: [],
  inventory: undefined as unknown as WorkDetail["inventory"],
  ...over,
});

describe("which work item a panel shows", () => {
  test("the page's work item comes from /work/:id, and from Ops Tail or Follow links that name one", () => {
    expect(pageWorkId({ view: "work", workId: "w1" })).toBe("w1");
    expect(pageWorkId({ view: "work", workId: "" })).toBe("");
    expect(pageWorkId({ view: "ops", mode: "tail", workId: "w2" } as Route)).toBe("w2");
    expect(pageWorkId({ view: "follow", workId: "w3" } as Route)).toBe("w3");
    expect(pageWorkId({ view: "inbox" })).toBe("");
  });

  test("@route follows the page; a fixed id pins; empty is none", () => {
    const page: Route = { view: "work", workId: "w1" };
    expect(panelWork(page, "@route")).toEqual({ workId: "w1", following: true, own: true });
    expect(panelWork(page, "w9")).toEqual({ workId: "w9", following: false, own: false });
    expect(panelWork(page, undefined)).toEqual({ workId: "", following: false, own: false });
    // following, but on another view: not the page's own panel
    expect(panelWork({ view: "ops", mode: "tail", workId: "w1" } as Route, "@route")).toEqual({ workId: "w1", following: true, own: false });
  });

  test("Open full is offered unless the panel already is the page's item", () => {
    const page: Route = { view: "work", workId: "w1" };
    expect(offersOpenFull(page, panelWork(page, "@route"))).toBe(false);
    expect(offersOpenFull(page, panelWork(page, "w2"))).toBe(true);
    expect(offersOpenFull({ view: "inbox" }, panelWork({ view: "inbox" }, "w2"))).toBe(true);
    expect(offersOpenFull(page, panelWork(page, ""))).toBe(false);
  });
});

describe("the work list", () => {
  test("reads active work by default, done too with Show", () => {
    expect(workListPath(undefined)).toBe("/api/work?limit=40");
    expect(workListPath("")).toBe("/api/work?limit=40");
    expect(workListPath("all")).toBe("/api/work?active=false&limit=60");
  });

  test("a machine scope keeps work its agents own or have the next move on", () => {
    const items = [
      item({ id: "a", ownerId: "x", nextMoveOwnerId: "x" }),
      item({ id: "b", ownerId: "y", nextMoveOwnerId: "x" }),
      item({ id: "c", ownerId: "y", nextMoveOwnerId: "operator" }),
    ];
    expect(filterWorkByAgents(items, null).map((w) => w.id)).toEqual(["a", "b", "c"]);
    expect(filterWorkByAgents(items, new Set(["x"])).map((w) => w.id)).toEqual(["a", "b"]);
  });

  test("most recently moved first, an owner filter when set", () => {
    const items = [item({ id: "old", lastMeaningfulAt: 1 }), item({ id: "new", lastMeaningfulAt: 9, ownerId: "b" })];
    expect(workListRows(items, undefined).map((w) => w.id)).toEqual(["new", "old"]);
    expect(workListRows(items, "b").map((w) => w.id)).toEqual(["new"]);
  });

  test("marks a blocker and a review that is the operator's move, nothing else", () => {
    expect(workRowMark(item({ attention: "interrupt" }))).toBe("Blocked");
    expect(workRowMark(item({ attention: "interrupt", state: "done" }))).toBeNull();
    expect(workRowMark(item({ state: "review", nextMoveOwnerId: "operator" }))).toBe("Awaiting your review");
    expect(workRowMark(item({ state: "review", nextMoveOwnerId: "agent-a" }))).toBeNull();
    expect(workRowMark(item({ state: "review", nextMoveOwnerId: "operator", acceptanceState: "accepted" }))).toBeNull();
    expect(workRowMark(item({ attention: "badge" }))).toBeNull();
  });

  test("the picker lists recent work by title, with the id when titles repeat", () => {
    const options = workOptions([
      item({ id: "a", title: "Same", lastMeaningfulAt: 2 }),
      item({ id: "b", title: "Same", lastMeaningfulAt: 3 }),
      item({ id: "c", title: "Other", lastMeaningfulAt: 1 }),
    ]);
    expect(options).toEqual([
      { value: "b", label: "Same · b" },
      { value: "a", label: "Same · a" },
      { value: "c", label: "Other" },
    ]);
  });
});

describe("flights and deliveries", () => {
  test("the delivery line reads the broker's outcome, else the sessions", () => {
    expect(flightDelivery(flight({ dispatchOutcome: { status: "queued_until_online", reason: "thread_held_externally", checkedAt: 1 } })))
      .toBe("Queued until online: its thread is open in another app");
    expect(flightDelivery(flight({ dispatchOutcome: { status: "not_submitted", reason: null, checkedAt: 1 } }))).toBe("Not delivered yet");
    expect(flightDelivery(flight({ dispatchOutcome: { status: "submission_unknown", reason: "ECONNRESET", checkedAt: 1 } }))).toBe("Delivery unknown: econnreset");
    expect(flightDelivery(flight({ sessions: [{ sessionId: "s1", startedAt: 1, lastAcknowledgedAt: 1 }] }))).toBe("Delivered to a session");
    expect(flightDelivery(flight({ state: "queued" }))).toBe("Queued");
    expect(flightDelivery(flight({}))).toBeNull();
  });

  test("every flight once, active first then newest, opening its observed session", () => {
    const d = detail({
      primaryInvocation: { flightId: "f2" } as WorkDetail["primaryInvocation"],
      allFlights: [
        flight({ id: "f1", state: "completed", startedAt: 100, completedAt: 200 }),
        flight({ id: "f2", state: "completed", startedAt: 300, completedAt: 400, sessions: [
          { sessionId: "s-old", startedAt: 1, lastAcknowledgedAt: 1 },
          { sessionId: "s-new", startedAt: 5, lastAcknowledgedAt: 5 },
        ] }),
      ],
      activeFlights: [flight({ id: "f3", state: "running", startedAt: 50, agentId: "agent-b", agentName: null, requesterWaitTimedOut: true })],
    });
    const rows = workFlightRows(d, null);
    expect(rows.map((r) => r.id)).toEqual(["f3", "f2", "f1"]);
    expect(rows[0]).toMatchObject({ active: true, agentLabel: "agent-b", waitNote: "The asker stopped waiting; the agent may still be running." });
    expect(rows[1]).toMatchObject({ primary: true, sessionId: "s-new", sessionCount: 2, open: { view: "sessions", flightId: "f2", sessionId: "s-new", agentId: "agent-a" } });
    expect(rows[2]!.open).toEqual({ view: "sessions", flightId: "f1", agentId: "agent-a" });
  });

  test("a machine scope keeps only its agents' flights", () => {
    const d = detail({ allFlights: [flight({ id: "f1", agentId: "x" }), flight({ id: "f2", agentId: "y" })] });
    expect(workFlightRows(d, new Set(["y"])).map((r) => r.id)).toEqual(["f2"]);
  });

  test("child work: open first, then most recently moved", () => {
    const d = detail({ childWork: [item({ id: "done", state: "done", lastMeaningfulAt: 9 }), item({ id: "old", lastMeaningfulAt: 1 }), item({ id: "new", lastMeaningfulAt: 5 })] });
    expect(workChildRows(d).map((w) => w.id)).toEqual(["new", "old", "done"]);
  });
});

describe("participants", () => {
  test("one row per person, roles first, the operator named and never a link target", () => {
    const d = detail({
      ownerId: "agent-a",
      ownerName: "Ada",
      nextMoveOwnerId: "operator",
      nextMoveOwnerName: null,
      primaryInvocation: { requesterId: "operator", requesterName: "Art", targetAgentId: "agent-a", targetAgentName: "Ada", flightId: "f1", createdAt: 10 } as WorkDetail["primaryInvocation"],
      allFlights: [flight({ id: "f1", agentId: "agent-a", startedAt: 20, completedAt: 30 }), flight({ id: "f2", agentId: "agent-b", agentName: "Bo", startedAt: 40 })],
      timeline: [
        { id: "t1", kind: "message", at: 50, actorId: "agent-c", actorName: "Cy", title: null, summary: "hi", detailKind: null, flightId: null, messageId: null, conversationId: null },
        { id: "t2", kind: "message", at: 60, actorId: "agent-a", actorName: "Ada", title: null, summary: null, detailKind: null, flightId: null, messageId: null, conversationId: null },
        { id: "t3", kind: "collaboration_event", at: 70, actorId: "system", actorName: null, title: null, summary: null, detailKind: null, flightId: null, messageId: null, conversationId: null },
      ],
    });
    const people = workParticipants(d, "Art");
    expect(people.map((p) => [p.label, p.roles.join("+"), p.events, p.flights])).toEqual([
      ["Ada", "Owner+Ran", 1, 1],
      ["Art", "Next move+Asked", 0, 0],
      ["Bo", "Ran", 0, 1],
      ["Cy", "Wrote", 1, 0],
    ]);
    expect(people.find((p) => p.label === "Art")!.operator).toBe(true);
    expect(people.find((p) => p.label === "Ada")!.lastAt).toBe(60);
  });

  test("the operator is You when their name is not known yet", () => {
    const d = detail({ ownerId: "operator", ownerName: null, nextMoveOwnerId: "operator" });
    expect(workParticipants(d, null)).toMatchObject([{ id: "operator", label: "You", roles: ["Owner"] }]);
  });
});

describe("case facts", () => {
  test("the inspector's facts in its order, next move only when it differs", () => {
    const facts = workCaseFacts(detail({ acceptanceState: "pending_review", priority: "high", attention: "interrupt", nextMoveOwnerId: "operator", nextMoveOwnerName: "Art", activeChildWorkCount: 2, activeFlightCount: 1 }));
    expect(facts).toEqual([
      { label: "Phase", value: "Working" },
      { label: "Acceptance", value: "pending review" },
      { label: "Priority", value: "high" },
      { label: "Signal", value: "Blocked" },
      { label: "Owner", value: "Ada" },
      { label: "Next move", value: "Art" },
      { label: "Children", value: "2" },
      { label: "Flights", value: "1" },
    ]);
    expect(workCaseFacts(detail({})).map((f) => f.label)).toEqual(["Phase", "Acceptance", "Owner", "Children", "Flights"]);
  });
});
