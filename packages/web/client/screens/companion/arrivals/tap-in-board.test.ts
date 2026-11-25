import { describe, expect, test } from "bun:test";

import { TAP_IN_NOTCH, TAP_IN_SIZE, tapInKeyAction, tapInPlacement } from "./tap-in-model.ts";
import {
  TAP_CLOSED,
  closeTap,
  closedTap,
  detailsTap,
  ENGAGE_LIFT,
  ENGAGE_ROOM,
  engageTap,
  escapeLevel,
  moveCursor,
  panelRowOf,
  rowRectIn,
  settleTap,
  showsDetails,
  stackRoom,
  tapKeyStep,
  tapLayout,
  tapRow,
  tapRowClass,
  toggleTap,
  type TapSel,
  widgetWalk,
} from "./tap-in-board.ts";

const ORDER = ["a", "b", "c", "d"];
const open = (id: string): TapSel => ({ id, open: true, closing: false });
const cursor = (id: string): TapSel => ({ id, open: false, closing: false });
const folding = (id: string): TapSel => ({ id, open: true, closing: true });

describe("selection", () => {
  test("a tap opens the panel on the row", () => {
    expect(tapRow(TAP_CLOSED, "b")).toEqual(open("b"));
    expect(tapRow(cursor("a"), "b")).toEqual(open("b"));
  });
  test("the same row folds it; the cursor stays on the row", () => {
    const s = tapRow(open("b"), "b");
    expect(s).toEqual(folding("b"));
    expect(closedTap(s)).toEqual(cursor("b"));
  });
  test("another row swaps the content in place: still open, on the new row", () => {
    expect(tapRow(open("b"), "c")).toEqual(open("c"));
  });
  test("a tap while it folds opens it again", () => {
    expect(tapRow(folding("b"), "b")).toEqual(open("b"));
    expect(tapRow(folding("b"), "c")).toEqual(open("c"));
  });
  test("esc or × folds an open panel and leaves anything else alone", () => {
    expect(closeTap(open("b"))).toEqual(folding("b"));
    const closed = cursor("b");
    expect(closeTap(closed)).toBe(closed);
    expect(closeTap(TAP_CLOSED)).toBe(TAP_CLOSED);
  });
  test("the fold finishing only lands a folding panel", () => {
    const shown = open("b");
    expect(closedTap(shown)).toBe(shown);
  });
  test("return toggles the panel on the cursor row; nothing without a cursor", () => {
    expect(toggleTap(cursor("b"))).toEqual(open("b"));
    expect(toggleTap(open("b"))).toEqual(folding("b"));
    expect(toggleTap(folding("b"))).toEqual(open("b"));
    expect(toggleTap(TAP_CLOSED)).toBe(TAP_CLOSED);
  });
  test("the row reads tapped only while its panel is open; the cursor while closed or folding", () => {
    expect(tapRowClass(open("b"), "b")).toBe(" is-tapped");
    expect(tapRowClass(cursor("b"), "b")).toBe(" is-cursor");
    expect(tapRowClass(folding("b"), "b")).toBe(" is-cursor");
    expect(tapRowClass(open("b"), "a")).toBe("");
    expect(tapRowClass(TAP_CLOSED, "a")).toBe("");
  });
});

describe("the S and M walk follows what the widget draws", () => {
  const lines = ["hume", "seneca", "chopin", "ada", "descartes", "kant"].map((id) => ({ id }));

  test("M walks every line in arrival order", () => {
    expect(widgetWalk(lines, "m", 5)).toEqual(["hume", "seneca", "chopin", "ada", "descartes", "kant"]);
  });

  test("S walks only as far as its chips", () => {
    expect(widgetWalk(lines, "s", 5)).toEqual(["hume", "seneca", "chopin", "ada", "descartes"]);
  });

  test("a step moves the engage panel to the next line, past the board's own order", () => {
    const order = widgetWalk(lines, "s", 5);
    const at = { id: "chopin", open: true, closing: false };
    expect(tapKeyStep("next", at, order)).toEqual({ id: "ada", open: true, closing: false });
    expect(tapKeyStep("next", { ...at, id: "descartes" }, order)).toEqual({ ...at, id: "descartes" });
  });
});

describe("two levels: the engage panel, then Details", () => {
  test("a tap, return or the row's Reply opens the engage panel; Details is asked for", () => {
    expect(showsDetails(tapRow(TAP_CLOSED, "b"))).toBe(false);
    expect(showsDetails(toggleTap(cursor("b")))).toBe(false);
    expect(detailsTap("b")).toEqual({ ...open("b"), details: true });
    expect(showsDetails(detailsTap("b"))).toBe(true);
  });
  test("esc steps back from Details to the engage panel on the same row, then folds it", () => {
    expect(engageTap(detailsTap("b"))).toEqual(open("b"));
    const engaged = open("b");
    expect(engageTap(engaged)).toBe(engaged);
    const at = { draftInPanel: false, settings: false, scoutbot: false, composing: false, inComposer: false };
    expect(escapeLevel({ ...at, panel: true, details: true })).toBe("details");
    expect(escapeLevel({ ...at, panel: true, details: false })).toBe("panel");
    // A draft in the reply line and an open sheet still come first.
    expect(escapeLevel({ ...at, panel: true, details: true, draftInPanel: true })).toBe("field");
    expect(escapeLevel({ ...at, panel: true, details: true, settings: true })).toBe("settings");
  });
  test("a tap on Details' own row folds it; another row opens that row's engage panel", () => {
    expect(tapRow(detailsTap("b"), "b")).toEqual({ ...open("b"), details: true, closing: true });
    expect(tapRow(detailsTap("b"), "c")).toEqual(open("c"));
  });
  test("↑/↓ move the engage panel, never Details; a fold in Details finishes as Details", () => {
    expect(moveCursor(detailsTap("b"), ORDER, 1)).toEqual(open("c"));
    expect(moveCursor(open("b"), ORDER, -1)).toEqual(open("a"));
    expect(moveCursor({ ...detailsTap("b"), closing: true }, ORDER, 1)).toEqual({ id: "c", open: true, closing: true, folding: "b", details: true });
    expect(closedTap({ ...detailsTap("b"), closing: true })).toEqual(cursor("b"));
  });
  test("from the panel's empty reply line ↑/↓ still walk the board; with a draft they are the field's", () => {
    const reply = { tag: "INPUT", open: true, emptyReply: true };
    expect(tapInKeyAction({ key: "ArrowDown" }, reply)).toBe("next");
    expect(tapInKeyAction({ key: "ArrowUp" }, reply)).toBe("prev");
    expect(tapInKeyAction({ key: "ArrowDown" }, { ...reply, emptyReply: false })).toBeNull();
    expect(tapInKeyAction({ key: "ArrowDown", metaKey: true }, reply)).toBeNull();
    expect(tapInKeyAction({ key: "a" }, reply)).toBeNull();
    expect(tapInKeyAction({ key: "ArrowDown" }, { ...reply, open: false })).toBeNull();
  });
});

describe("the cursor", () => {
  test("↓ with no cursor takes the first row, ↑ the last", () => {
    expect(moveCursor(TAP_CLOSED, ORDER, 1)).toEqual(cursor("a"));
    expect(moveCursor(TAP_CLOSED, ORDER, -1)).toEqual(cursor("d"));
  });
  test("moves one row and stops at the ends", () => {
    expect(moveCursor(cursor("b"), ORDER, 1)).toEqual(cursor("c"));
    expect(moveCursor(cursor("b"), ORDER, -1)).toEqual(cursor("a"));
    const first = cursor("a");
    expect(moveCursor(first, ORDER, -1)).toBe(first);
    const last = cursor("d");
    expect(moveCursor(last, ORDER, 1)).toBe(last);
  });
  test("an open panel follows the cursor; a folding one is left to finish on its row", () => {
    expect(moveCursor(open("b"), ORDER, 1)).toEqual(open("c"));
    // ↑/↓ mid-fold: the cursor moves, the panel keeps folding on "b" until the fold lands.
    const moved = moveCursor(folding("b"), ORDER, 1);
    expect(moved).toEqual({ id: "c", open: true, closing: true, folding: "b" });
    expect(panelRowOf(moved)).toBe("b");
    expect(tapRowClass(moved, "c")).toBe(" is-cursor");
    expect(tapRowClass(moved, "b")).toBe("");
    // Another step keeps the fold on "b"; the fold landing leaves the cursor where it went.
    const again = moveCursor(moved, ORDER, 1);
    expect(again).toEqual({ id: "d", open: true, closing: true, folding: "b" });
    expect(closedTap(again)).toEqual(cursor("d"));
    // Return or a tap mid-fold opens the panel on the cursor row.
    expect(toggleTap(moved)).toEqual(open("c"));
    expect(tapRow(moved, "a")).toEqual(open("a"));
    expect(panelRowOf(open("c"))).toBe("c");
  });
  test("from a row that left the board, it carries on from where that row sat", () => {
    // "x" sat at index 2: ↓ goes to the row that took its place, ↑ to the one above.
    expect(moveCursor(open("x"), ORDER, 1, 2)).toEqual(open("c"));
    expect(moveCursor(open("x"), ORDER, -1, 2)).toEqual(open("b"));
    expect(moveCursor(open("x"), ["a"], 1, 3)).toEqual(open("a"));
    expect(moveCursor(open("x"), ORDER, 1)).toEqual(open("a"));
  });
  test("an empty board moves nothing", () => {
    const s = open("b");
    expect(moveCursor(s, [], 1)).toBe(s);
  });
  test("nothing moves the selection by itself: a gone row keeps an open panel, a closed cursor goes", () => {
    const ids = new Set(["a", "c"]);
    const shown = open("b");
    expect(settleTap(shown, ids)).toBe(shown);
    const fold = folding("b");
    expect(settleTap(fold, ids)).toBe(fold);
    expect(settleTap(cursor("b"), ids)).toBe(TAP_CLOSED);
    const here = cursor("a");
    expect(settleTap(here, ids)).toBe(here);
  });
});

describe("the board's keys", () => {
  const key = (k: string, mods: { metaKey?: boolean } = {}, tag = "BODY", isOpen = true) => tapInKeyAction({ key: k, ...mods }, { tag, open: isOpen });

  test("↑/↓ move the cursor, and an open panel follows", () => {
    expect(tapKeyStep(key("ArrowDown"), open("a"), ORDER)).toEqual(open("b"));
    expect(tapKeyStep(key("ArrowUp", {}, "BODY", false), cursor("c"), ORDER)).toEqual(cursor("b"));
  });
  test("return toggles the cursor row's panel; with no cursor it is not the board's", () => {
    expect(tapKeyStep(key("Enter", {}, "BODY", false), cursor("b"), ORDER)).toEqual(open("b"));
    expect(tapKeyStep(key("Enter"), open("b"), ORDER)).toEqual(folding("b"));
    expect(tapKeyStep(key("Enter", {}, "BODY", false), TAP_CLOSED, ORDER)).toBeNull();
  });
  test("return on a control, typing, ⌘O and ⌘↩ leave the selection alone", () => {
    expect(tapKeyStep(key("Enter", {}, "BUTTON"), open("b"), ORDER)).toBeNull();
    expect(tapKeyStep(key("ArrowDown", {}, "INPUT"), open("b"), ORDER)).toBeNull();
    expect(tapKeyStep(key("o", { metaKey: true }), open("b"), ORDER)).toBeNull();
    expect(tapKeyStep(key("Enter", { metaKey: true }), open("b"), ORDER)).toBeNull();
    expect(tapKeyStep(key("r"), open("b"), ORDER)).toBeNull();
  });

  const at = { draftInPanel: false, settings: false, scoutbot: false, composing: false, inComposer: false, panel: false };
  test("esc folds one level, nearest first", () => {
    expect(escapeLevel({ ...at, panel: true })).toBe("panel");
    expect(escapeLevel({ ...at, panel: true, settings: true })).toBe("settings");
    expect(escapeLevel({ ...at, panel: true, scoutbot: true })).toBe("scoutbot");
    expect(escapeLevel(at)).toBe("board");
  });
  test("esc in the reply line with a draft leaves the field and keeps the panel", () => {
    expect(escapeLevel({ ...at, panel: true, draftInPanel: true })).toBe("field");
  });
  test("the composer closes first when the key came from it, after the panel when not", () => {
    expect(escapeLevel({ ...at, panel: true, composing: true, inComposer: true })).toBe("composer");
    expect(escapeLevel({ ...at, panel: true, composing: true })).toBe("panel");
    expect(escapeLevel({ ...at, composing: true })).toBe("composer");
  });
});

describe("placement on the board", () => {
  const VIEW = { width: 1440, height: 900 };
  const BOARD = { left: 988, top: 520, right: 1428, bottom: 888 };

  test("a row's rect comes from the board and its offsets, inside the board's border", () => {
    expect(rowRectIn(BOARD, { offsetLeft: 12, offsetTop: 40, offsetWidth: 416, offsetHeight: 34 }, { left: 1, top: 1 }))
      .toEqual({ left: 1001, top: 561, right: 1417, bottom: 595 });
  });
  test("beside a bottom-right board: the panel opens to its left, its notch on the row", () => {
    const row = rowRectIn(BOARD, { offsetLeft: 12, offsetTop: 40, offsetWidth: 416, offsetHeight: 34 }, { left: 1, top: 1 });
    const { placement, tether } = tapLayout(BOARD, VIEW, row, false);
    expect(placement.mode).toBe("beside");
    expect(placement.from).toBe("right");
    expect(placement.box.left + placement.box.width).toBe(BOARD.left - TAP_IN_SIZE.GAP);
    expect(tether).toMatchObject({ left: BOARD.left - TAP_IN_SIZE.GAP - 1, top: 578 - TAP_IN_NOTCH.HALF, point: "right" });
  });
  test("a row gone from the board has no tether; the panel stays", () => {
    const { placement, tether } = tapLayout(BOARD, VIEW, null, false);
    expect(placement.mode).toBe("beside");
    expect(tether).toBeNull();
  });
  test("the stack opens above a bottom board with no tether", () => {
    const board = { left: 2, top: 446, right: 442, bottom: 800 };
    const { placement, tether } = tapLayout(board, { width: 444, height: 802 }, { left: 14, top: 500, right: 430, bottom: 534 }, true);
    expect(placement.mode).toBe("stack");
    expect(placement.from).toBe("bottom");
    expect(placement.box.width).toBe(440);
    expect(placement.box.height).toBe(TAP_IN_SIZE.MIN_H);
    expect(tether).toBeNull();
  });
  test("the panel sits at its row, as tall as what it holds, and moves with the cursor", () => {
    const row = { left: 1000, top: 560, right: 1416, bottom: 594 };
    const { placement, tether } = tapLayout(BOARD, VIEW, row, false);
    expect(placement.mode).toBe("beside");
    expect(placement.box.top).toBe(row.top - ENGAGE_LIFT);
    expect(placement.box.height).toBe(VIEW.height - TAP_IN_SIZE.INSET - placement.box.top);
    expect(placement.fit).toEqual({ min: 0, grow: "down" });
    expect(tether?.top).toBe(577 - TAP_IN_NOTCH.HALF);
    expect(tether?.near).toBe("top");
    const next = tapLayout(BOARD, VIEW, { ...row, top: 600, bottom: 634 }, false);
    expect(next.placement.box.top).toBe(600 - ENGAGE_LIFT);
  });
  test("low on the screen the panel stands on its row's bottom and grows up", () => {
    const row = { left: 1000, top: 840, right: 1416, bottom: 874 };
    const { placement, tether } = tapLayout(BOARD, VIEW, row, false);
    expect(VIEW.height - TAP_IN_SIZE.INSET - (row.top - ENGAGE_LIFT)).toBeLessThan(ENGAGE_ROOM);
    expect(placement.fit).toEqual({ min: 0, grow: "up" });
    expect(placement.box.top + placement.box.height).toBe(row.bottom + ENGAGE_LIFT);
    expect(tether?.near).toBe("bottom");
  });
  test("in the stack, and for a row gone from the board, the panel keeps the board's box and fits what it holds", () => {
    const board = { left: 2, top: 446, right: 442, bottom: 800 };
    const stack = tapLayout(board, { width: 444, height: 802 }, { left: 14, top: 500, right: 430, bottom: 534 }, true).placement;
    expect(stack.mode).toBe("stack");
    expect(stack.fit).toEqual({ min: 0, grow: "up" });
    const gone = tapLayout(BOARD, VIEW, null, false).placement;
    expect(gone.box).toEqual(tapInPlacement(BOARD, VIEW).box);
    expect(gone.fit?.min).toBe(0);
  });
  test("the stack grows by the panel's room, never past the screen", () => {
    const full = TAP_IN_SIZE.MIN_H + TAP_IN_SIZE.GAP + TAP_IN_SIZE.INSET;
    expect(stackRoom(360, 1000)).toBe(full);
    expect(stackRoom(800, 1000)).toBe(200);
    expect(stackRoom(1200, 1000)).toBe(0);
  });
});

describe("tapLayout on a notch", () => {
  const view = { width: 1152, height: 648 };
  test("the panel is the notch grown: joined to the board, its width, no tether", () => {
    const board = { left: 229, top: 0, right: 923, bottom: 34 };
    const row = { left: 700, top: 4, right: 760, bottom: 30 };
    const { placement, tether } = tapLayout(board, view, row, false, "top");
    expect(placement).toEqual({ mode: "notch", from: "top", box: { left: 229, top: 34, width: 694, height: 648 - 12 - 34 }, fit: { min: 0, grow: "down" } });
    expect(tether).toBeNull();
  });
  test("on a side notch the panel fills the notch's height", () => {
    const board = { left: 1118, top: 114, right: 1152, bottom: 534 };
    const { placement } = tapLayout(board, { width: 1152, height: 648 }, null, false, "right");
    expect(placement).toMatchObject({ mode: "notch", from: "right", box: { top: 114, height: 420, width: 440 }, fit: { min: 420, grow: "down" } });
  });
  test("off a notch it still opens beside the board", () => {
    const board = { left: 900, top: 100, right: 1140, bottom: 400 };
    expect(tapLayout(board, view, null, false).placement.mode).toBe("beside");
  });
});
