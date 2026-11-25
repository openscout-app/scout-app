import { describe, expect, test } from "bun:test";
import { sheetPlacement } from "./board-sheet.ts";

const view = { width: 1600, height: 1000 };

describe("sheetPlacement", () => {
  test("a board in the bottom right opens its sheet to the left, standing on the board's bottom", () => {
    const board = { left: 1250, top: 900, right: 1588, bottom: 988 };
    expect(sheetPlacement(board, view)).toEqual({ from: "right", left: 1250 - 12 - 400, width: 400, top: null, bottom: 12, maxHeight: 976 });
  });

  test("a board in the top left opens its sheet to the right, hanging from the board's top", () => {
    const board = { left: 12, top: 12, right: 46, bottom: 46 };
    expect(sheetPlacement(board, view)).toEqual({ from: "left", left: 58, width: 400, top: 12, bottom: null, maxHeight: 976 });
  });

  test("with no room beside, it opens above a low board on the board's side", () => {
    const narrow = { width: 700, height: 1000 };
    const board = { left: 250, top: 700, right: 690, bottom: 988 };
    expect(sheetPlacement(board, narrow)).toEqual({ from: "bottom", left: 288, width: 400, top: null, bottom: 312, maxHeight: 676 });
  });

  test("with no room beside, it opens below a high board and keeps inside the view", () => {
    const narrow = { width: 500, height: 800 };
    const board = { left: 30, top: 12, right: 470, bottom: 300 };
    expect(sheetPlacement(board, narrow)).toEqual({ from: "top", left: 30, width: 400, top: 312, bottom: null, maxHeight: 476 });
  });
});

describe("sheetPlacement on a notch", () => {
  const view = { width: 1152, height: 648 };
  test("hangs from a top notch with no gap, as wide as the board and centred on it", () => {
    const board = { left: 229, top: 0, right: 923, bottom: 34 };
    expect(sheetPlacement(board, view, 400, "top")).toEqual({ from: "top", left: 229, width: 694, top: 34, bottom: null, maxHeight: 648 - 12 - 34, notch: true });
  });
  test("a board narrower than the sheet widens it about the board's centre", () => {
    const board = { left: 500, top: 0, right: 700, bottom: 34 };
    const at = sheetPlacement(board, view, 400, "top");
    expect([at.left, at.width]).toEqual([400, 400]);
  });
  test("stands on a bottom notch", () => {
    const board = { left: 229, top: 614, right: 923, bottom: 648 };
    expect(sheetPlacement(board, view, 400, "bottom")).toMatchObject({ from: "bottom", top: null, bottom: 648 - 614, maxHeight: 614 - 12, notch: true });
  });
  test("pops out of a side notch as its own card, centred, as tall as it needs", () => {
    const board = { left: 0, top: 200, right: 34, bottom: 448 };
    const at = sheetPlacement(board, view, 400, "left");
    expect(at).toMatchObject({ from: "left", left: 34 + 12, width: 400, top: null, bottom: null, float: true });
    expect(at.notch).toBeUndefined();
    expect(at.maxHeight).toBe(view.height - 24);
  });
});
