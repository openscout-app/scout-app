import { describe, expect, test } from "bun:test";

import type { OperatorAttentionItem, WorkItem } from "../../../lib/types.ts";
import { buildCornerThreads, byUrgency, permissionCommand, placesFor, plainLine, relAge, requestLine, turnsFrom } from "./system-corner-model.ts";

const NOW = 1_800_000_000_000;

function work(patch: Partial<WorkItem>): WorkItem {
  return {
    id: "w1", title: "Split the web server routes", summary: null, ownerId: "a1", ownerName: "witt",
    nextMoveOwnerId: null, nextMoveOwnerName: null, conversationId: "c1", createdAt: NOW - 600_000, updatedAt: NOW - 60_000,
    parentId: null, parentTitle: null, state: "working", acceptanceState: "accepted", priority: null, currentPhase: "build",
    attention: "silent", activeChildWorkCount: 0, activeFlightCount: 1, lastMeaningfulAt: NOW - 60_000,
    lastMeaningfulSummary: "moved 12 route files", ...patch,
  };
}

function request(patch: Partial<OperatorAttentionItem>): OperatorAttentionItem {
  return {
    id: "r1", kind: "approval", title: "Run tests", summary: null, detail: null, agentId: "a1", agentName: "witt",
    conversationId: "c1", updatedAt: NOW - 10_000, severity: "warning", sourceLabel: "Permission", actions: [], ...patch,
  };
}

describe("buildCornerThreads", () => {
  test("a request joins the work that shares its conversation", () => {
    const threads = buildCornerThreads([work({})], [request({})], NOW);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.state).toBe("asking");
    expect(threads[0]!.request?.id).toBe("r1");
  });

  test("a request with no work is its own thread", () => {
    const threads = buildCornerThreads([work({})], [request({ conversationId: "elsewhere" })], NOW);
    expect(threads.map((t) => t.state).sort()).toEqual(["asking", "working"]);
  });

  test("ended work leaves after half an hour, live work after a day", () => {
    const threads = buildCornerThreads([
      work({ id: "a", state: "done", updatedAt: NOW - 40 * 60_000, lastMeaningfulAt: NOW - 40 * 60_000 }),
      work({ id: "b", state: "done", updatedAt: NOW - 5 * 60_000, lastMeaningfulAt: NOW - 5 * 60_000 }),
      work({ id: "c", updatedAt: NOW - 30 * 3600_000, lastMeaningfulAt: NOW - 30 * 3600_000 }),
    ], [], NOW);
    expect(threads.map((t) => t.id)).toEqual(["b"]);
    expect(threads[0]!.state).toBe("ended");
  });

  test("notices are not requests", () => {
    expect(buildCornerThreads([], [request({ kind: "ask" })], NOW)).toHaveLength(0);
  });
});

test("nearest the corner: asks, waiting, newest work, ended", () => {
  const threads = buildCornerThreads([
    work({ id: "old", conversationId: null, updatedAt: NOW - 600_000, lastMeaningfulAt: NOW - 600_000 }),
    work({ id: "new", conversationId: null, updatedAt: NOW - 1000, lastMeaningfulAt: NOW - 1000 }),
    work({ id: "end", conversationId: null, state: "done" }),
    work({ id: "wait", conversationId: null, state: "review" }),
    work({ id: "ask" }),
  ], [request({})], NOW);
  expect([...threads].sort(byUrgency).map((t) => t.id)).toEqual(["ask", "wait", "new", "old", "end"]);
});

test("places: an ask goes to its conversation first, work to the work", () => {
  const [asking] = buildCornerThreads([work({})], [request({})], NOW);
  expect(placesFor(asking!).map((p) => p.id)).toEqual(["conversation", "work"]);
  const [working] = buildCornerThreads([work({})], [], NOW);
  expect(placesFor(working!).map((p) => p.id)).toEqual(["work", "conversation"]);
  const [bare] = buildCornerThreads([work({ conversationId: null })], [], NOW);
  expect(placesFor(bare!).map((p) => p.id)).toEqual(["work"]);
});

test("a native approval reads as the command it wants to run", () => {
  const item = request({
    permission: { requestId: "p", version: "1", sessionId: "s", projectRoot: "/x" },
    summary: JSON.stringify({ method: "item/commandExecution/requestApproval", command: "bun test packages/web" }),
  });
  expect(permissionCommand(item)).toBe("bun test packages/web");
  expect(requestLine(item)).toEqual({ verb: "wants to run", subject: "bun test packages/web" });
  expect(permissionCommand(request({ summary: "not json" }))).toBeNull();
});

test("relAge", () => {
  expect(relAge(NOW - 5_000, NOW)).toBe("now");
  expect(relAge(NOW - 5 * 60_000, NOW)).toBe("5m");
  expect(relAge(NOW - 3 * 3600_000, NOW)).toBe("3h");
  expect(relAge(0, NOW)).toBe("");
});

test("turns drop the opening ask and keep the last few, oldest first", () => {
  const turns = turnsFrom([
    { actorId: "a1", body: "On it.", createdAt: 2, class: "agent" },
    { actorId: "operator", body: "Split the web server routes.", createdAt: 1, class: "operator" },
    { actorId: "a1", body: "status", createdAt: 3, class: "status" },
    { actorId: "operator", body: "keep index.ts", createdAt: 4, class: "operator" },
  ], "Split the web server routes");
  expect(turns).toEqual([{ who: "them", text: "On it." }, { who: "you", text: "keep index.ts" }]);
});

test("plainLine reads markdown as one plain line", () => {
  expect(plainLine("## Recommendation\n**Yes**, use `jev`.\n- one\n- [two](http://x)")).toBe("Recommendation Yes, use jev. one two");
  expect(plainLine("abcdefghij", 5)).toBe("abcd…");
  // an HTML comment (a routing marker in an ask) is dropped, even one left open to the end
  expect(plainLine("## Goal\nAn ask must survive. <!-- SCOUT BROKER REPLY MODE --> Done.")).toBe("Goal An ask must survive. Done.");
  expect(plainLine("Ship it <!-- marker that never closes")).toBe("Ship it");
});

test("work rows carry the board's remark and when that state began", () => {
  const threads = buildCornerThreads([
    work({ id: "busy", conversationId: null, updatedAt: NOW - 60_000, lastMeaningfulAt: NOW - 60_000 }),
    work({ id: "quiet", conversationId: null, updatedAt: NOW - 6 * 60_000, lastMeaningfulAt: NOW - 6 * 60_000 }),
    work({ id: "done", conversationId: null, state: "done", updatedAt: NOW - 1_000 }),
    work({ id: "review", conversationId: null, state: "review", updatedAt: NOW - 2_000 }),
    work({ id: "cancelled", conversationId: null, state: "cancelled", updatedAt: NOW - 3_000 }),
    work({ id: "ask" }),
  ], [request({})], NOW);
  const by = Object.fromEntries(threads.map((t) => [t.id, [t.remark, t.since]]));
  expect(by).toEqual({
    busy: ["WORKING", NOW - 600_000],
    quiet: ["QUIET", NOW - 6 * 60_000],
    done: ["DONE", NOW - 1_000],
    review: ["DONE", NOW - 2_000],
    cancelled: ["STOPPED", NOW - 3_000],
    ask: ["ASKING", NOW - 10_000],
  });
});
