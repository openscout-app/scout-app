import { describe, expect, test } from "bun:test";

import { notchAwayOnVisible, notchBoardStyle, notchCorner, notchHeld, notchInsets, notchOpenWidth, notchPlace, notchDropEdge, notchSizeStep, NOTCH_OPEN_MAX, parseBoardPlace, parseNotchEdge } from "./notch-model.ts";

describe("notch", () => {
  test("unknown choices read as the corner and the top edge", () => {
    expect(parseBoardPlace(null)).toBe("corner");
    expect(parseBoardPlace("notch")).toBe("notch");
    expect(parseNotchEdge("diagonal")).toBe("top");
    expect(parseNotchEdge("left")).toBe("left");
  });

  test("the board grows away from its edge", () => {
    expect(notchCorner("top")).toBe("top-right");
    expect(notchCorner("bottom")).toBe("bottom-right");
    expect(notchCorner("left")).toBe("top-left");
    expect(notchCorner("right")).toBe("top-right");
  });

  test("insets keep the board inside what macOS gives windows", () => {
    const view = { width: 1512, height: 982 };
    // Menu bar 33 high, Dock 70 on the bottom.
    expect(notchInsets({ x: 0, y: 33, width: 1512, height: 879 }, view)).toEqual({ top: 33, right: 0, bottom: 70, left: 0 });
    expect(notchInsets(null, view)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("on top, a raised panel hangs the board from the edge, centered on the camera", () => {
    const view = { width: 1512, height: 982 };
    const visible = { x: 0, y: 32, width: 1512, height: 880 };
    const housing = { x: 663.5, y: 0, width: 185, height: 32 };
    expect(notchPlace("top", { visible, housing, aboveMenuBar: true }, view)).toEqual({
      insets: { top: 0, right: 0, bottom: 70, left: 0 }, hang: true, bar: 32, housing: { center: 756, width: 185 }, desk: null,
    });
    // An external display: hangs over the bar, no camera to center on.
    expect(notchPlace("top", { visible, housing: null, aboveMenuBar: true }, view)).toMatchObject({ hang: true, bar: 32, housing: null });
    // A host that did not raise the panel, or another edge: under the menu bar.
    expect(notchPlace("top", { visible, housing, aboveMenuBar: false }, view)).toMatchObject({ hang: false, insets: { top: 32 }, housing: null });
    expect(notchPlace("left", { visible, housing, aboveMenuBar: true }, view)).toMatchObject({ hang: false, housing: null });
  });

  test("Scout Desk's notch on the same top edge: folded tucks away, open stands below it", () => {
    const view = { width: 1512, height: 982 };
    const visible = { x: 0, y: 32, width: 1512, height: 880 };
    const housing = { x: 663.5, y: 0, width: 185, height: 32 };
    const deskNotch = { x: 606, y: 0, width: 300, height: 92 };
    // Folded: it keeps its place and tucks into the edge while Desk's is out.
    expect(notchPlace("top", { visible, housing, aboveMenuBar: true, deskNotch }, view)).toMatchObject({ hang: true, desk: "tuck" });
    // Open or held: below Desk's shape, centered on the display, no longer behind the menu bar.
    const below = notchPlace("top", { visible, housing, aboveMenuBar: true, deskNotch }, view, true);
    expect(below).toMatchObject({ hang: false, bar: 0, housing: null, desk: "below", insets: { top: 100 } });
    expect(notchBoardStyle("top", below, view)).toMatchObject({ top: "100px", left: "756px" });
    // Desk's notch gone, or the board on another edge or under the menu bar: nothing to make room for.
    expect(notchPlace("top", { visible, housing, aboveMenuBar: true, deskNotch: null }, view, true)).toMatchObject({ hang: true, desk: null });
    expect(notchPlace("left", { visible, housing, aboveMenuBar: true, deskNotch }, view)).toMatchObject({ desk: null });
    expect(notchPlace("top", { visible, housing, aboveMenuBar: false, deskNotch }, view)).toMatchObject({ desk: null });
  });

  test("the board centers along its edge, on the camera when there is one", () => {
    const view = { width: 1512, height: 982 };
    const visible = { x: 0, y: 32, width: 1512, height: 880 };
    const housing = { x: 600, y: 0, width: 185, height: 32 };
    const onCamera = notchPlace("top", { visible, housing, aboveMenuBar: true }, view);
    expect(notchBoardStyle("top", onCamera, view)).toEqual({ top: "0px", bottom: "auto", left: "693px", right: "auto", translate: "-50% 0" });
    const under = notchPlace("top", { visible, housing: null, aboveMenuBar: false }, view);
    expect(notchBoardStyle("top", under, view)).toMatchObject({ top: "32px", left: "756px" });
    const bottom = notchPlace("bottom", { visible, housing: null, aboveMenuBar: false }, view);
    expect(notchBoardStyle("bottom", bottom, view)).toMatchObject({ bottom: "70px", top: "auto", left: "756px" });
    // Beside the menu bar and the Dock: the middle of what is left.
    expect(notchBoardStyle("left", bottom, view)).toEqual({ top: "472px", bottom: "auto", left: "0px", right: "auto", translate: "0 -50%" });
    expect(notchBoardStyle("right", bottom, view)).toMatchObject({ right: "0px", left: "auto", top: "472px" });
  });

  test("the opened board takes half the edge, within bounds", () => {
    expect(notchOpenWidth("top", { width: 1512 })).toBe(756);
    expect(notchOpenWidth("top", { width: 3008 })).toBe(NOTCH_OPEN_MAX);
    expect(notchOpenWidth("left", { width: 1512 })).toBe(605);
    expect(notchOpenWidth("bottom", { width: 500 })).toBe(440);
  });

  test("the notch is the strip or the open board: a step up opens, a step down folds", () => {
    expect(notchSizeStep("s", "m")).toBe("open");
    expect(notchSizeStep("s", "l")).toBe("open");
    expect(notchSizeStep("l", "m")).toBe("fold");
    expect(notchSizeStep("l", "s")).toBe("fold");
    expect(notchSizeStep("m", "s")).toBe("fold");
  });

  test("anything opened from the notch holds it; a bare board does not", () => {
    const none = { composing: false, settings: false, scoutbot: false, details: false, choices: false, menu: false, typing: false };
    expect(notchHeld(none)).toBe(false);
    for (const key of Object.keys(none) as (keyof typeof none)[]) expect(notchHeld({ ...none, [key]: true })).toBe(true);
  });

  test("hidden, the notch is away; shown after that, or first shown, it arrives", () => {
    expect(notchAwayOnVisible(true, false)).toBe("away");
    expect(notchAwayOnVisible(false, true)).toBe("arriving");
    expect(notchAwayOnVisible(undefined, true)).toBe("arriving");
    // Still shown, or no host at all (the browser preview): leave it as it is.
    expect(notchAwayOnVisible(true, true)).toBe("keep");
    expect(notchAwayOnVisible(undefined, undefined)).toBe("keep");
  });

  test("a board let go near an edge's middle hangs there; anywhere else it stands free", () => {
    const view = { width: 1600, height: 1000 };
    const insets = { top: 32, right: 0, bottom: 70, left: 0 };
    const at = (left: number, top: number, width = 200, height = 34) => ({ left, top, width, height });
    // Back where it hung, under the menu bar or behind it.
    expect(notchDropEdge(at(700, 32), insets, view)).toBe("top");
    expect(notchDropEdge(at(700, 0), insets, view)).toBe("top");
    // Pulled down off the edge: free.
    expect(notchDropEdge(at(700, 120), insets, view)).toBeNull();
    // Along the top edge but toward a corner: free, so it can stand in the corner.
    expect(notchDropEdge(at(40, 32), insets, view)).toBeNull();
    // On the middle of another edge, inside the Dock.
    expect(notchDropEdge(at(1600 - 34, 400, 34, 200), insets, view)).toBe("right");
    expect(notchDropEdge(at(700, 1000 - 70 - 34), insets, view)).toBe("bottom");
    expect(notchDropEdge(at(10, 400, 34, 200), insets, view)).toBe("left");
  });
});
