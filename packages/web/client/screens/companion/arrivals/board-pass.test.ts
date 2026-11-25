import { describe, expect, test } from "bun:test";

import type { CornerThread } from "../system-corner/system-corner-model.ts";
import { boardLead, boardPass, remarkState, type BoardMemory, type BoardRow, type Remark } from "./arrivals-model.ts";
import { PASS_MS, PASS_ROW_MS } from "./board-motion.ts";

/* The pass (Studio /studies/companion-board-rewrites): what the board shows changes on a 30 s wall-clock grid. */

/** 11:30:00 local: a pass boundary in every timezone (offsets are whole minutes). */
const T0 = new Date(2026, 9, 15, 11, 30, 0).getTime();
const at = (h: number, m: number) => new Date(2026, 9, 15, h, m, 0).getTime();

function th(id: string, remark: Remark, over: Partial<CornerThread> = {}): CornerThread {
  return {
    id, workId: id, conversationId: null, task: id, handle: `openscout-${id}-1`, now: `${id} is reading`,
    state: remarkState(remark), at: at(11, 20), request: null, facts: [], remark, since: at(11, 20), ...over,
  };
}
const ask = (id: string, requestId: string, over: Partial<CornerThread> = {}) =>
  th(id, "ASKING", { request: { id: requestId } as CornerThread["request"], ...over });

const ids = (m: BoardMemory) => m.rows.map((r) => r.id);
const row = (m: BoardMemory, id: string) => m.rows.find((r) => r.id === id)!;
/** What a row shows, without when it turned. */
const shown = (r: BoardRow) => ({ id: r.id, remark: r.remark, now: r.now, hh: r.hh, mm: r.mm, section: r.section, asking: r.asking });

describe("boardPass", () => {
  test("the first snapshot is settled, stamped with its pass", () => {
    const m = boardPass(null, [th("a", "WORKING"), th("b", "DONE")], T0 + 1_000);
    expect(m.passAt).toBe(T0);
    for (const r of m.rows) expect([r.remarkAt, r.hhAt, r.mmAt, r.rollAt]).toEqual([-Infinity, -Infinity, -Infinity, -Infinity]);
    expect(m.glide).toBe(false);
  });

  test("cadence: nothing changes between passes; it all lands on the 30 s grid", () => {
    const m0 = boardPass(null, [th("a", "WORKING")], T0 + 1_000);
    const later = [th("a", "WORKING", { now: "a runs the tests" }), th("b", "WORKING")];
    expect(boardPass(m0, later, T0 + 5_000)).toBe(m0);
    expect(boardPass(m0, later, T0 + PASS_MS - 1)).toBe(m0);
    const m1 = boardPass(m0, later, T0 + PASS_MS + 250);
    expect(m1.passAt).toBe(T0 + PASS_MS);
    expect(row(m1, "a").now).toBe("a runs the tests");
    expect(ids(m1)).toContain("b");
    // The next pass is a whole PASS_MS later, whenever this one was read.
    expect(boardPass(m1, [th("a", "DONE")], T0 + 2 * PASS_MS - 1)).toBe(m1);
    expect(boardPass(m1, [th("a", "DONE")], T0 + 2 * PASS_MS).passAt).toBe(T0 + 2 * PASS_MS);
  });

  test("order is frozen: rows that stay keep their places; a newcomer goes first in its group", () => {
    const m0 = boardPass(null, [th("a", "WORKING", { at: at(11, 1) }), th("b", "WORKING", { at: at(11, 2) }), th("c", "WORKING", { at: at(11, 3) })], T0);
    const before = ids(m0);
    // Newer activity and a reshuffled pool reorder nothing.
    const busier = [th("c", "WORKING", { at: at(11, 9) }), th("b", "WORKING", { at: at(11, 29) }), th("a", "WORKING", { at: at(11, 8) })];
    expect(ids(boardPass(m0, busier, T0 + 10_000))).toEqual(before);
    const m1 = boardPass(m0, [...busier, th("d", "WORKING", { at: at(11, 29) })], T0 + PASS_MS);
    expect(ids(m1)).toEqual(["d", ...before]);
  });

  test("only the cells that changed turn; a row with nothing new holds", () => {
    const m0 = boardPass(null, [th("a", "WORKING"), th("b", "WORKING"), th("c", "WORKING")], T0);
    const m1 = boardPass(m0, [
      th("a", "WORKING", { now: "a edits arrivals.css" }),
      th("b", "DONE", { since: at(11, 31) }),
      th("c", "WORKING", { task: "c, retitled" }),
    ], T0 + PASS_MS, { fromBottom: false });
    const a = row(m1, "a");
    expect([a.remarkAt, a.hhAt, a.mmAt]).toEqual([-Infinity, -Infinity, -Infinity]);
    expect(a.rollAt).toBeGreaterThanOrEqual(T0 + PASS_MS);
    expect([a.prevNow, a.now, a.roll]).toEqual(["a is reading", "a edits arrivals.css", 1]);
    const b = row(m1, "b");
    expect(b.remark).toBe("DONE");
    expect(b.remarkAt).toBe(b.mmAt);
    expect(b.hhAt).toBe(-Infinity);
    expect(b.rollAt).toBe(-Infinity);
    // Long text (name, where) changes in place, never on flaps.
    const c = row(m1, "c");
    expect(c.thread.task).toBe("c, retitled");
    expect([c.remarkAt, c.hhAt, c.mmAt, c.rollAt]).toEqual([-Infinity, -Infinity, -Infinity, -Infinity]);
  });

  test("changed rows rewrite 3 frames apart from the board's corner", () => {
    const pool = (n: string) => [th("a", "WORKING", { now: n, at: at(11, 3) }), th("b", "WORKING", { now: n, at: at(11, 2) }), th("c", "WORKING", { now: n, at: at(11, 1) })];
    const m0 = boardPass(null, pool("x"), T0);
    const pass = T0 + PASS_MS;
    const bottom = boardPass(m0, pool("y"), pass, { fromBottom: true });
    const order = ids(bottom);
    expect(order.map((id) => row(bottom, id).rollAt)).toEqual([pass + 2 * PASS_ROW_MS, pass + PASS_ROW_MS, pass]);
    const top = boardPass(m0, pool("y"), pass, { fromBottom: false });
    expect(order.map((id) => row(top, id).rollAt)).toEqual([pass, pass + PASS_ROW_MS, pass + 2 * PASS_ROW_MS]);
  });

  test("a section change waits for the pass, then the row glides to its place", () => {
    const m0 = boardPass(null, [th("a", "WORKING"), th("b", "DONE")], T0);
    expect(row(m0, "a").section).toBe("departures");
    const done = [th("a", "DONE", { since: at(11, 30) }), th("b", "DONE")];
    expect(boardPass(m0, done, T0 + 12_000)).toBe(m0);
    const m1 = boardPass(m0, done, T0 + PASS_MS);
    expect(row(m1, "a").section).toBe("arrivals");
    expect(m1.glide).toBe(true);
    // A pass that moves nothing glides nothing.
    expect(boardPass(m1, done, T0 + 2 * PASS_MS).glide).toBe(false);
  });

  test("rows that move into a section together sort by what they did since, not by the last pass", () => {
    const m0 = boardPass(null, [th("a", "WORKING", { at: T0 - 60_000 }), th("b", "WORKING", { at: T0 - 10_000 }), th("z", "DONE", { at: T0 - 90_000 })], T0);
    // Between passes a finished last, b earlier.
    const m1 = boardPass(m0, [th("a", "DONE", { at: T0 + 25_000 }), th("b", "DONE", { at: T0 + 5_000 }), th("z", "DONE", { at: T0 - 90_000 })], T0 + PASS_MS);
    expect(m1.rows.filter((r) => r.section === "arrivals").map((r) => r.id)).toEqual(["a", "b", "z"]);
    expect(row(m1, "a").thread.at).toBe(T0 + 25_000);
  });

  test("a row keeps the remark it had until its turn in the pass comes", () => {
    const m0 = boardPass(null, [th("a", "WORKING")], T0);
    expect(row(m0, "a").prevRemark).toBe("WORKING");
    const m1 = boardPass(m0, [th("a", "DONE", { since: at(11, 30) })], T0 + PASS_MS);
    expect([row(m1, "a").prevRemark, row(m1, "a").remark]).toEqual(["WORKING", "DONE"]);
    expect(row(m1, "a").remarkAt).toBeGreaterThanOrEqual(T0 + PASS_MS);
  });

  test("an ask breaks in at once and its answer breaks out at once; its place waits for the pass", () => {
    const m0 = boardPass(null, [th("a", "WORKING"), th("b", "DONE")], T0);
    const m1 = boardPass(m0, [ask("a", "r1", { since: at(11, 30) }), th("b", "DONE")], T0 + 7_000);
    expect(m1).not.toBe(m0);
    const a = row(m1, "a");
    expect([a.remark, a.asking, a.remarkAt]).toEqual(["ASKING", true, T0 + 7_000]);
    expect(a.section).toBe("departures");
    expect(ids(m1)).toEqual(ids(m0));
    expect(m1.passAt).toBe(T0);
    expect(m1.glide).toBe(true);
    // The same ask again is nothing new; a new request on the row is.
    expect(boardPass(m1, [ask("a", "r1", { since: at(11, 30) }), th("b", "DONE")], T0 + 8_000)).toBe(m1);
    expect(row(boardPass(m1, [ask("a", "r2", { since: at(11, 30) }), th("b", "DONE")], T0 + 9_000), "a").thread.request?.id).toBe("r2");
    // On the pass it moves to Arrivals.
    const m2 = boardPass(m1, [ask("a", "r1", { since: at(11, 30) }), th("b", "DONE")], T0 + PASS_MS);
    expect(row(m2, "a").section).toBe("arrivals");
    expect(ids(m2)[0]).toBe("a");
    // Answered: it breaks out at once, back to the pass rhythm for its place.
    const m3 = boardPass(m2, [th("a", "WORKING", { since: at(11, 31) }), th("b", "DONE")], T0 + PASS_MS + 4_000);
    expect([row(m3, "a").remark, row(m3, "a").asking, row(m3, "a").section]).toEqual(["WORKING", false, "arrivals"]);
    expect(row(boardPass(m3, [th("a", "WORKING", { since: at(11, 31) }), th("b", "DONE")], T0 + 2 * PASS_MS), "a").section).toBe("departures");
  });

  test("a new ask comes in at once at the top; an answered request leaves at once", () => {
    const m0 = boardPass(null, [th("a", "WORKING")], T0);
    const m1 = boardPass(m0, [th("a", "WORKING", { now: "later" }), ask("req", "r9")], T0 + 3_000);
    expect(ids(m1)).toEqual(["req", "a"]);
    expect(row(m1, "req").remarkAt).toBe(T0 + 3_000);
    // Everything else still waits.
    expect(row(m1, "a").now).toBe("a is reading");
    const m2 = boardPass(m1, [th("a", "WORKING", { now: "later" })], T0 + 5_000);
    expect(ids(m2)).toEqual(["a"]);
    // A row that is not asking leaves on the pass, not before.
    expect(ids(boardPass(m2, [], T0 + 6_000))).toEqual(["a"]);
    expect(ids(boardPass(m2, [], T0 + PASS_MS))).toEqual([]);
  });

  test("reduced motion: the same passes and values, every cell settled, no glide", () => {
    const steps: Array<[CornerThread[], number]> = [
      [[th("a", "WORKING"), th("b", "DONE")], T0],
      [[ask("a", "r1"), th("b", "DONE")], T0 + 4_000],
      [[ask("a", "r1"), th("b", "STOPPED", { since: at(11, 30) }), th("c", "WORKING")], T0 + PASS_MS],
      [[th("a", "WORKING", { now: "after" }), th("b", "STOPPED", { since: at(11, 30) }), th("c", "QUIET")], T0 + 2 * PASS_MS],
    ];
    let moving: BoardMemory | null = null;
    let still: BoardMemory | null = null;
    for (const [pool, now] of steps) {
      moving = boardPass(moving, pool, now);
      still = boardPass(still, pool, now, { reduced: true });
      expect(still.rows.map(shown)).toEqual(moving.rows.map(shown));
      expect(still.passAt).toBe(moving.passAt);
      expect(still.glide).toBe(false);
      for (const r of still.rows) expect([r.remarkAt, r.hhAt, r.mmAt, r.rollAt]).toEqual([-Infinity, -Infinity, -Infinity, -Infinity]);
    }
  });

  test("the folded board leads with an ask, then what came back, then the work out", () => {
    const m = boardPass(null, [th("w", "WORKING"), th("d", "DONE"), th("e", "ENDED"), th("q", "ASKING")], T0);
    expect(boardLead(m.rows)?.id).toBe("q");
    expect(boardLead(m.rows.filter((r) => r.id !== "q"))?.id).toBe("d");
    expect(boardLead(m.rows.filter((r) => r.id === "w" || r.id === "e"))?.id).toBe("w");
  });

  test("each remark has its section: asks and what came back arrive, work out departs", () => {
    const m = boardPass(null, (["WORKING", "QUIET", "ASKING", "DONE", "STOPPED", "COMPACT", "ENDED"] as const).map((r) => th(r, r)), T0);
    expect(Object.fromEntries(m.rows.map((r) => [r.id, r.section]))).toEqual({
      WORKING: "departures", QUIET: "departures", COMPACT: "departures",
      ASKING: "arrivals", DONE: "arrivals", STOPPED: "arrivals", ENDED: "arrivals",
    });
  });
});
