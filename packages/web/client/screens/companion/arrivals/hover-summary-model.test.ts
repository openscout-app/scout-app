import { describe, expect, test } from "bun:test";

import type { OperatorAttentionItem } from "../../../lib/types.ts";
import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { hoverHitId, hoverIdOf, hoverSpot, hoverSummary } from "./hover-summary-model.ts";

const NOW = 1_700_000_000_000;

function thread(over: Partial<CornerThread> = {}): CornerThread {
  return { id: "w1", workId: "w1", conversationId: null, task: "Arrivals board port", handle: "openscout-ada-2", now: "writing arrivals.css", state: "working", at: NOW - 120_000, request: null, facts: [], project: "openscout", harness: "claude", ...over };
}

const question = { id: "q1", kind: "question", title: "may I push scout/arrivals?", summary: null, detail: null, agentId: null, agentName: null, conversationId: null, updatedAt: 0, severity: "info", sourceLabel: "Question", actions: [] } as unknown as OperatorAttentionItem;

describe("hover summary", () => {
  test("names the row as the board does: the namer's name, else the session's ask as one plain line", () => {
    const ask = "## Goal\nAn ask must survive a runtime restart. <!-- SCOUT BROKER REPLY MODE -->";
    const raw = thread({ handle: "claude", harness: "claude", task: ask });
    expect(hoverSummary(raw, NOW, "Restart-Surviving Ask Delivery").name).toBe("Restart-Surviving Ask Delivery");
    expect(hoverSummary(raw, NOW).name).toBe("Goal An ask must survive a runtime restart.");
    expect(hoverSummary(raw, NOW, "  ").name).toBe("Goal An ask must survive a runtime restart.");
  });

  test("who, where, its state and since when, then its latest line", () => {
    expect(hoverSummary(thread(), NOW)).toEqual({ name: "ada", where: "openscout", state: "WORKING", asking: false, since: "2m ago", ask: null, line: "writing arrivals.css" });
  });

  test("an open ask takes the second line's place, its verb apart", () => {
    const v = hoverSummary(thread({ state: "asking", request: question, now: "may I push scout/arrivals?" }), NOW);
    expect(v.asking).toBe(true);
    expect(v.state).toBe("ASKING");
    expect(v.ask).toEqual({ verb: "asks", subject: "may I push scout/arrivals?" });
  });

  test("a project the name already says is not said twice; a state that just began is now", () => {
    const v = hoverSummary(thread({ handle: "claude", harness: "claude", task: "", project: "openscout", since: NOW - 1_000 }), NOW);
    expect(v.name).toBe("openscout");
    expect(v.where).toBe("");
    expect(v.since).toBe("now");
  });

  test("board rows and chips report a region of their own; plates keep theirs", () => {
    expect(hoverIdOf(hoverHitId("w1"))).toBe("w1");
    expect(hoverIdOf("popover")).toBeNull();
    expect(hoverIdOf(null)).toBeNull();
    expect(hoverIdOf("plate:w1", "plate:")).toBe("w1");
  });
});

describe("where the hover summary sits", () => {
  const view = { width: 1400, height: 900 };
  const size = { width: 260, height: 40 };

  test("a figure: above it, centred, inside the view", () => {
    expect(hoverSpot({ left: 400, top: 560, width: 30, height: 34 }, size, view)).toEqual({ left: 285, top: 512 });
    expect(hoverSpot({ left: 0, top: 560, width: 30, height: 34 }, size, view).left).toBe(8);
  });

  test("no room above: below it", () => {
    expect(hoverSpot({ left: 400, top: 10, width: 30, height: 34 }, size, view)).toEqual({ left: 285, top: 52 });
  });

  test("a row: beside the board on the side with room, level with the row", () => {
    const board = { left: 1030, top: 700, width: 340, height: 240 };
    expect(hoverSpot({ left: 1040, top: 800, width: 320, height: 26 }, size, view, board)).toEqual({ left: 762, top: 793 });
    // A board hanging from the top or bottom edge (a notch): under (or over) it, centred on the chip, not beside.
    const notch = { left: 500, top: 0, width: 440, height: 40 };
    const chip = { left: 600, top: 8, width: 60, height: 24 };
    expect(hoverSpot(chip, size, view, notch, "top")).toEqual({ left: 500, top: 48 });
    const low = { left: 500, top: 860, width: 440, height: 40 };
    expect(hoverSpot({ ...chip, top: 868 }, size, view, low, "bottom")).toEqual({ left: 500, top: 860 - 8 - size.height });
    expect(hoverSpot({ ...chip, left: 0 }, size, view, notch, "top").left).toBe(8);
    const leftBoard = { left: 12, top: 700, width: 340, height: 240 };
    expect(hoverSpot({ left: 20, top: 800, width: 320, height: 26 }, size, view, leftBoard)).toEqual({ left: 360, top: 793 });
  });

  test("a board with no room beside it (the stack's own window): above the row", () => {
    const narrow = { width: 360, height: 300 };
    const board = { left: 0, top: 0, width: 360, height: 300 };
    expect(hoverSpot({ left: 10, top: 200, width: 340, height: 26 }, size, narrow, board)).toEqual({ left: 50, top: 152 });
  });
});
