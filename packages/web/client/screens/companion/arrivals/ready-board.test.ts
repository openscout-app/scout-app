import { describe, expect, test } from "bun:test";

import type { OperatorAttentionItem, WorkDetail, WorkItem } from "../../../lib/types.ts";
import { buildCornerThreads, requestLine } from "../system-corner/system-corner-model.ts";
import { remarkOf, remarkSlot, remarkState, REMARKS } from "./arrivals-model.ts";
import { changeWord } from "./companion-choices.ts";
import { stripWorthy } from "./board-strip.ts";
import { askFromItem, tapInTarget, workView, type TapInWorkTarget } from "./tap-in-model.ts";

const NOW = 1_800_000_000_000;

const ready = (patch: Partial<OperatorAttentionItem> = {}): OperatorAttentionItem => ({
  id: "ready:flt-1", kind: "ready", title: "Ranger is ready", summary: "Fixed the **route** resolution.", detail: "Fix the session route",
  agentId: "ranger", agentName: "Ranger", conversationId: "dm.ranger", updatedAt: NOW - 30_000, severity: "info", sourceLabel: "Ready",
  ready: { invocationId: "inv-1", flightId: "flt-1", workId: "w1", summary: "Fixed the **route** resolution.", at: NOW - 30_000 },
  actions: [
    { kind: "continue", label: "Continue", flightId: "flt-1" },
    { kind: "hold", label: "Hold", flightId: "flt-1" },
    { kind: "open", label: "Open conversation", route: { view: "conversation", conversationId: "dm.ranger" } },
  ],
  ...patch,
});

const work = (patch: Partial<WorkItem> = {}): WorkItem => ({
  id: "w1", title: "Fix the session route", summary: null, ownerId: "ranger", ownerName: "Ranger",
  nextMoveOwnerId: "operator", nextMoveOwnerName: "you", conversationId: "chn-other", createdAt: NOW - 600_000, updatedAt: NOW - 30_000,
  parentId: null, parentTitle: null, state: "review", acceptanceState: "pending", priority: null, currentPhase: "review",
  attention: "silent", activeChildWorkCount: 0, activeFlightCount: 0, lastMeaningfulAt: NOW - 30_000,
  lastMeaningfulSummary: "a report", ...patch,
});

describe("Ready on the board", () => {
  test("joins its own work item by id, reads READY, and is never asking", () => {
    const [t, ...rest] = buildCornerThreads([work()], [ready()], NOW);
    expect(rest).toEqual([]);
    expect(t!.request?.id).toBe("ready:flt-1");
    expect(t!.state).toBe("waiting");
    expect(remarkOf(t!)).toBe("READY");
    expect(t!.since).toBe(NOW - 30_000);
    // What the agent said it did, as one plain line.
    expect(t!.now).toBe("Fixed the route resolution.");
  });

  test("without its work on the board it is a row of its own, named by what was asked", () => {
    const [t] = buildCornerThreads([], [ready({ ready: { invocationId: "inv-1", flightId: "flt-1", workId: null, summary: "Done it.", at: NOW - 5_000 } })], NOW);
    expect(t).toMatchObject({ id: "ready:flt-1", task: "Fix the session route", state: "waiting", remark: "READY", now: "Done it." });
  });

  test("sits with the asks at the top, waits on you, and stays on the folded strip", () => {
    expect(REMARKS).toContain("READY");
    expect(remarkSlot("READY")).toBe(remarkSlot("ASKING"));
    expect(remarkState("READY")).toBe("waiting");
    expect(changeWord("READY")).toBe("is ready");
    expect(stripWorthy("READY", false)).toBe(true);
  });

  test("its line says the agent is ready, not that it asks", () => {
    expect(requestLine(ready())).toEqual({ verb: "is ready", subject: "Fixed the route resolution." });
  });
});

describe("Ready in Tap in", () => {
  test("the block says who is ready and what it did, with Continue and Hold", () => {
    const ask = askFromItem(ready());
    expect(ask).toMatchObject({
      kindLabel: "Ready", heading: "Ranger is ready", reason: "Fixed the **route** resolution.", detail: "Asked: Fix the session route",
      options: [], note: null, ready: true,
    });
    expect(ask.decisions.map((d) => [d.kind, d.label])).toEqual([["continue", "Continue"], ["hold", "Hold"]]);
  });

  test("a running task offers Notify when done on its own flight; a finished one does not", () => {
    const [t] = buildCornerThreads([work({ state: "working", conversationId: "c1" })], [], NOW);
    const target = tapInTarget(t!) as TapInWorkTarget;
    const detail = (flightState: string, notify?: boolean) => ({
      id: "w1", title: "Fix the session route", conversationId: "c1", ownerName: "Ranger", childWork: [], timeline: [],
      activeFlights: [{ id: "f-own", state: flightState, agentName: "Ranger", conversationId: "c1", sessions: [], ...(notify === undefined ? {} : { notify }) }],
      allFlights: [], primaryInvocation: { flightId: "f-own", task: "Fix the session route", targetAgentName: "Ranger" },
    }) as unknown as WorkDetail;
    const view = (d: WorkDetail) => workView({ target, thread: t!, detail: d, messages: [], tail: [], now: NOW });
    expect(view(detail("running")).notify).toEqual({ flightId: "f-own", on: false });
    expect(view(detail("running", true)).notify).toEqual({ flightId: "f-own", on: true });
    expect(view(detail("completed", true)).notify).toBeNull();
  });
});
