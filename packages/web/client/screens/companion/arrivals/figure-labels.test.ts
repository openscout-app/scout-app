import { describe, expect, test } from "bun:test";

import { deskLabelInk, deskLabelText, figureLabelOf, figureLabelSign, figureLabelText, LABEL_INK_DARK_ABOVE, labelInkFor } from "./figure-labels.ts";

describe("a figure's label", () => {
  test("comes from the runtime's roster tag: its project code and its number", () => {
    expect(figureLabelOf({ projectCode: "OS", numberText: "003" })).toEqual({ project: "OS", code: "003" });
    expect(figureLabelOf({ projectCode: null, numberText: "012" })).toEqual({ project: null, code: "012" });
  });

  test("an agent the runtime has not numbered has none", () => {
    expect(figureLabelOf(null)).toBeUndefined();
    expect(figureLabelOf(undefined)).toBeUndefined();
  });

  test("the label: project code and three digits, or the digits alone; as a call sign with a dash", () => {
    expect(figureLabelText({ project: "OS", code: "003" })).toBe("OS 003");
    expect(figureLabelText({ project: null, code: "003" })).toBe("003");
    expect(figureLabelSign({ project: "OS", code: "003" })).toBe("OS-003");
    expect(figureLabelSign({ project: null, code: "003" })).toBeUndefined();
  });
});

describe("a figure's label on the desk", () => {
  test("is its roster number alone; the project never shows on the desk", () => {
    expect(deskLabelText({ project: "OS", code: "005" })).toBe("005");
    expect(deskLabelText({ project: null, code: "012" })).toBe("012");
    // The board's row keeps the project with the number.
    expect(figureLabelText({ project: "OS", code: "005" })).toBe("OS 005");
  });

  test("takes dark ink only over a desktop picture lighter than 0.18", () => {
    expect(LABEL_INK_DARK_ABOVE).toBe(0.18);
    expect(labelInkFor(0)).toBe("light");
    expect(labelInkFor(0.18)).toBe("light");
    expect(labelInkFor(0.181)).toBe("dark");
    expect(labelInkFor(1)).toBe("dark");
  });

  test("draws light ink when the host has no read of the picture under it", () => {
    expect(deskLabelInk({ labelInk: "dark" })).toBe("dark");
    expect(deskLabelInk({ labelInk: "light" })).toBe("light");
    expect(deskLabelInk({})).toBe("light");
    expect(deskLabelInk(null)).toBe("light");
    expect(deskLabelInk(undefined)).toBe("light");
  });
});
