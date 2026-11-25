import { describe, expect, test } from "bun:test";
import { paneCornerRadii } from "./frame-pane-corners.ts";

const sheet = { left: 48, top: 40, right: 1434, bottom: 872 };

describe("paneCornerRadii", () => {
  test("a pane in the sheet's top-left corner follows its arc, concentric", () => {
    const pane = { left: 52, top: 44, right: 392, bottom: 868 };
    expect(paneCornerRadii(sheet, pane, 14)).toEqual({ tl: 10, tr: 0, br: 0, bl: 10 });
  });

  test("a pane filling the sheet rounds all four corners", () => {
    const pane = { left: 52, top: 44, right: 1430, bottom: 868 };
    expect(paneCornerRadii(sheet, pane, 14)).toEqual({ tl: 10, tr: 10, br: 10, bl: 10 });
  });

  test("a pane between two others is square", () => {
    const pane = { left: 396, top: 44, right: 1126, bottom: 868 };
    expect(paneCornerRadii(sheet, pane, 14)).toEqual({ tl: 0, tr: 0, br: 0, bl: 0 });
  });

  test("a pane below the view's bar keeps its top corners square", () => {
    const pane = { left: 52, top: 84, right: 1430, bottom: 868 };
    expect(paneCornerRadii(sheet, pane, 14)).toEqual({ tl: 0, tr: 0, br: 10, bl: 10 });
  });

  test("uneven insets take the larger, so the curve stays inside the sheet's", () => {
    const pane = { left: 50, top: 48, right: 400, bottom: 400 };
    expect(paneCornerRadii(sheet, pane, 14).tl).toBe(6);
  });

  test("a square sheet, or an inset wider than the radius, leaves the pane square", () => {
    const pane = { left: 52, top: 44, right: 1430, bottom: 868 };
    expect(paneCornerRadii(sheet, pane, 0)).toEqual({ tl: 0, tr: 0, br: 0, bl: 0 });
    expect(paneCornerRadii(sheet, pane, 3)).toEqual({ tl: 0, tr: 0, br: 0, bl: 0 });
  });
});
