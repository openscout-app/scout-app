/**
 * Ready from the flights (core `task-ready.ts`): seeds a control-plane store
 * the way mesh-ops.test.ts does and reads the operator's Ready list. A held
 * Ready is listed again only after its work item changes.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQLiteControlPlaneStore } from "@openscout/runtime";
import { closeDb } from "./internal/db.ts";
import { projectTaskReady, queryFleet, queryTaskReadyRows, taskReadyListed } from "./fleet.ts";

const tempRoots = new Set<string>();
const originalControlHome = process.env.OPENSCOUT_CONTROL_HOME;

afterEach(() => {
  closeDb();
  if (originalControlHome === undefined) delete process.env.OPENSCOUT_CONTROL_HOME;
  else process.env.OPENSCOUT_CONTROL_HOME = originalControlHome;
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots.clear();
});

const NOW = Date.now();

function seed(): void {
  const root = mkdtempSync(join(tmpdir(), "openscout-web-fleet-ready-"));
  tempRoots.add(root);
  process.env.OPENSCOUT_CONTROL_HOME = root;
  const store = new SQLiteControlPlaneStore(join(root, "control-plane.sqlite"));
  store.upsertNode({ id: "node-a", meshId: "mesh-1", name: "Local", advertiseScope: "local", registeredAt: NOW });
  store.upsertActor({ id: "operator", kind: "person", displayName: "Operator" });
  store.upsertActor({ id: "ranger", kind: "agent", displayName: "Ranger" });
  store.upsertAgent({
    id: "ranger", kind: "agent", definitionId: "ranger", displayName: "Ranger", agentClass: "general", capabilities: ["chat"],
    wakePolicy: "on_demand", homeNodeId: "node-a", authorityNodeId: "node-a", advertiseScope: "local",
  });
  store.upsertConversation({
    id: "dm.ranger", kind: "direct", title: "Ranger", visibility: "private", shareMode: "local",
    authorityNodeId: "node-a", participantIds: ["ranger", "operator"],
  });

  const task = (n: number, opts: {
    state: "completed" | "running" | "waiting";
    ready?: Record<string, unknown> | null;
    workUpdatedAt?: number;
  }) => {
    const workId = opts.workUpdatedAt === undefined ? undefined : `work-${n}`;
    if (workId) {
      store.recordCollaborationRecord({
        id: workId, kind: "work_item", title: `Work ${n}`, createdById: "operator", ownerId: "ranger",
        nextMoveOwnerId: "operator", conversationId: "dm.ranger", state: "review", acceptanceState: "pending",
        requestedById: "operator", createdAt: NOW - 60_000, updatedAt: opts.workUpdatedAt!,
      });
    }
    store.recordInvocation({
      id: `inv-${n}`, requesterId: "operator", requesterNodeId: "node-a", targetAgentId: "ranger", action: "consult",
      task: `Task ${n}`, ...(workId ? { collaborationRecordId: workId } : {}), conversationId: "dm.ranger",
      ensureAwake: true, stream: false, createdAt: NOW - 50_000 + n,
      metadata: { readyNotify: { on: true, byId: "operator", at: NOW - 50_000 } },
    });
    store.recordFlight({
      id: `flight-${n}`, invocationId: `inv-${n}`, requesterId: "operator", targetAgentId: "ranger", state: opts.state,
      summary: `Reply ${n}`, startedAt: NOW - 40_000, ...(opts.state === "running" ? {} : { completedAt: NOW - 20_000 }),
      ...(opts.ready ? { metadata: { ready: opts.ready } } : {}),
    });
  };

  const ready = (at: number, extra: Record<string, unknown> = {}) => ({ state: "ready", at, summary: "Shipped the route fix.", nodeId: "node-a", ...extra });
  task(1, { state: "completed", ready: ready(NOW - 10_000), workUpdatedAt: NOW - 10_000 });
  // Held, and the work has not changed since: off the list.
  task(2, { state: "completed", ready: ready(NOW - 9_000, { heldAt: NOW - 5_000, heldById: "operator" }), workUpdatedAt: NOW - 9_000 });
  // Held, then the work changed: back on the list.
  task(3, { state: "completed", ready: ready(NOW - 8_000, { heldAt: NOW - 7_000 }), workUpdatedAt: NOW - 1_000 });
  // Continued: the move went back to the agent.
  task(4, { state: "completed", ready: ready(NOW - 7_000, { state: "continued", continuedAt: NOW - 6_000 }), workUpdatedAt: NOW - 6_000 });
  // Waiting on review, with no work item: listed.
  task(5, { state: "waiting", ready: ready(NOW - 6_000) });
  // Finished without the mark's Ready, and one still running: neither is Ready.
  task(6, { state: "completed" });
  task(7, { state: "running", ready: ready(NOW - 5_000) });
}

describe("queryTaskReadyRows", () => {
  test("lists finished flights the runtime marked Ready, newest first, leaving out held and continued ones", () => {
    seed();
    const rows = queryTaskReadyRows();
    expect(rows.map((r) => r.flightId)).toEqual(["flight-5", "flight-3", "flight-1"]);
    expect(rows[2]).toEqual({
      invocationId: "inv-1",
      flightId: "flight-1",
      agentId: "ranger",
      agentName: "Ranger",
      conversationId: "dm.ranger",
      workId: "work-1",
      task: "Task 1",
      summary: "Shipped the route fix.",
      readyAt: NOW - 10_000,
      heldAt: null,
    });
    expect(rows[0]!.workId).toBeNull();
    expect(rows[1]!.heldAt).toBe(NOW - 7_000);
  });

  test("rides on the fleet state the attention projection reads", () => {
    seed();
    expect(queryFleet({ limit: 24, activityLimit: 0 }).ready?.map((r) => r.flightId)).toEqual(["flight-5", "flight-3", "flight-1"]);
  });
});

describe("taskReadyListed", () => {
  test("follows core: Ready, and never held or changed since the Hold", () => {
    expect(taskReadyListed({ state: "ready" }, null)).toBe(true);
    expect(taskReadyListed({ state: "ready", heldAt: 10 }, 9)).toBe(false);
    expect(taskReadyListed({ state: "ready", heldAt: 10 }, 10)).toBe(false);
    expect(taskReadyListed({ state: "ready", heldAt: 10 }, 11)).toBe(true);
    expect(taskReadyListed({ state: "ready", heldAt: 10 }, null)).toBe(false);
    expect(taskReadyListed({ state: "continued" }, null)).toBe(false);
  });
});

describe("projectTaskReady", () => {
  const row = (ready: unknown) => ({
    invocation_id: "inv", flight_id: "flt", target_agent_id: "ranger", agent_name: null, conversation_id: null,
    work_id: null, task: "t", ready_json: typeof ready === "string" ? ready : JSON.stringify(ready), work_updated_at: null,
  });

  test("a malformed record is not Ready", () => {
    expect(projectTaskReady(row("{"))).toBeNull();
    expect(projectTaskReady(row(null))).toBeNull();
    expect(projectTaskReady(row({ state: "ready", at: "soon", summary: "x" }))).toBeNull();
    expect(projectTaskReady(row({ state: "ready", at: 5 }))).toBeNull();
    expect(projectTaskReady(row({ state: "later", at: 5, summary: "x" }))).toBeNull();
  });

  test("keeps the agent's id when it has no display name", () => {
    expect(projectTaskReady(row({ state: "ready", at: 5, summary: "Done." }))).toMatchObject({ agentId: "ranger", agentName: null, summary: "Done.", readyAt: 5 });
  });
});
